/**
 * Schichtweiser Mehrfarbdruck: G-Code mehrerer Farben verschachteln.
 *
 * Die Slice-Engine schneidet ein Netz und schreibt eine Farbe. Für mehrere
 * Farben wird deshalb je Werkzeug ein eigener Durchlauf geschnitten und danach
 * Schicht für Schicht zusammengesetzt:
 *
 *   Schicht 1: Farbe A drucken → Wechsel → spülen (Turm) → Farbe B drucken
 *   Schicht 2: Farbe A drucken → Wechsel → spülen (Turm) → Farbe B drucken
 *   …
 *
 * Damit das ohne E-Versatz funktioniert, schreibt die Engine mit
 * `resetExtruderEachLayer` am Schichtanfang `G92 E0`. Jeder Block rechnet dann
 * für sich absolut und kann beliebig eingesetzt werden.
 *
 * Dieses Modul arbeitet nur auf Text und Vorschaudaten; es kennt weder die
 * Engine noch den Server.
 */
import { PREVIEW_STRIDE, type PreviewLayer } from '../shared/types.ts'

export type GcodeLayerSection = {
  /** Oberkante der Schicht in mm (wie im `; Z:`-Kommentar). */
  z: number
  /** Kopf der Schicht bis einschließlich `; Z:` (Schichtmarker, Retract). */
  header: string[]
  /** Ab `G92 E0`: Z-Hub, Lüfter und die eigentlichen Bahnen. */
  body: string[]
  /** 0-basierte Zeile des Kopfes in der Quelldatei. */
  headerLine: number
  /** 0-basierte Zeile des Rumpfes in der Quelldatei. */
  bodyLine: number
}

export type GcodeSections = {
  preamble: string[]
  layers: GcodeLayerSection[]
  tail: string[]
}

export type ColorGroupGcode = {
  /** Eindeutige Farbgruppe — nicht die Werkzeugnummer: zwei Filamente können
   *  denselben Slot nutzen (manueller Wechsel per M600). */
  id: number
  tool: number
  sections: GcodeSections
  layers: PreviewLayer[]
  /** Mittelpunkt der Objekte dieser Farbe — Ziel einer sicheren Fahrt. */
  center: { x: number; y: number }
  /** Düsentemperatur dieser Farbe für den Wechselbefehl. */
  nozzle: number
  bed: number
  /** Düsendurchmesser und Filamentdurchmesser für die Spülmenge. */
  nozzleDiameter: number
  filamentDiameter: number
}

export type ToolChangeResult = {
  lines: string[]
  filamentMm?: number
  seconds?: number
  volumeMm3?: number
  /** Nach dem Wechsel ist der Extruder um diesen Betrag zurückgezogen (mm).
   *  Der nächste Block setzt `G92 E0` — ohne Übernahme fehlt dieses Material. */
  relief?: number
}

export type AssembleStats = {
  toolChanges: number
  towerFilamentMm: number
  towerSeconds: number
  towerVolumeMm3: number
}

export type AssembleResult = {
  gcode: string
  layers: PreviewLayer[]
  stats: AssembleStats
}

const stripLineNumber = (line: string): string => line.replace(/^N\d+\s+/, '')

/**
 * Zerlegt einen Engine-G-code in Vorspann, Schichten und Endblock. Der
 * Endblock beginnt mit dem festen Kommentar `; ---- Ende ----`.
 */
export function splitGcodeSections(gcode: string): GcodeSections {
  const lines = gcode.split('\n')
  while (lines.length && lines[lines.length - 1] === '') lines.pop()

  const layerStarts: number[] = []
  let tailStart = lines.length
  for (let i = 0; i < lines.length; i++) {
    const line = stripLineNumber(lines[i])
    if (line === ';BEFORE_LAYER_CHANGE') layerStarts.push(i)
    if (line === '; ---- Ende ----') {
      tailStart = i
      break
    }
  }

  const preamble = lines.slice(0, layerStarts[0] ?? tailStart)
  const layers: GcodeLayerSection[] = layerStarts.map((start, index) => {
    const end = Math.min(index + 1 < layerStarts.length ? layerStarts[index + 1] : tailStart, tailStart)
    const chunk = lines.slice(start, end)
    let zLine = -1
    for (let i = 0; i < chunk.length; i++) {
      if (/^; Z:/.test(stripLineNumber(chunk[i]))) {
        zLine = i
        break
      }
    }
    if (zLine < 0) zLine = Math.max(0, chunk.length - 1)
    const match = /^; Z:\s*(-?[\d.]+)/.exec(stripLineNumber(chunk[zLine] ?? ''))
    const z = match ? Number(match[1]) : 0
    return {
      z: Number.isFinite(z) ? z : 0,
      header: chunk.slice(0, zLine + 1),
      body: chunk.slice(zLine + 1),
      headerLine: start,
      bodyLine: start + zLine + 1,
    }
  })

  return { preamble, layers, tail: lines.slice(tailStart) }
}

/** Hat dieser Schichtrumpf eine echte Extrusion (kein reiner Rückzug)? */
export function hasExtrusion(body: string[]): boolean {
  for (const raw of body) {
    const line = stripLineNumber(raw)
    if (!/^G[123]\b/.test(line)) continue
    const code = line.split(';')[0]
    if (!/\bX-?\d/.test(code) || !/\bE-?\d/.test(code)) continue
    const match = /\bE(-?\d+(?:\.\d+)?)/.exec(code)
    if (match && Number(match[1]) > 0) return true
  }
  return false
}

/**
 * Setzt die Schichten aller Farben zusammen. Die Reihenfolge innerhalb einer
 * Schicht ist die Werkzeugnummer (aufsteigend), damit der Wechsel planbar ist.
 * Zwischen zwei Farben wird `onToolChange` eingefügt; der Rückruf schreibt
 * Wechselbefehl, Spülung in den Turm und die sichere Fahrt zum nächsten
 * Objekt.
 */
export function assembleLayerwise(input: {
  groups: ColorGroupGcode[]
  /** Schichthöhen der gemeinsamen Schichtplanung (für den Turm). */
  bands: { z: number; height: number }[]
  onToolChange: (group: ColorGroupGcode, z: number, height: number, layerIndex: number) => ToolChangeResult | null
}): AssembleResult {
  const groups = input.groups.filter((group) => group.sections.layers.length > 0)
  const stats: AssembleStats = { toolChanges: 0, towerFilamentMm: 0, towerSeconds: 0, towerVolumeMm3: 0 }
  if (!groups.length) return { gcode: '', layers: [], stats }

  const out: string[] = [...groups[0].sections.preamble]
  let currentGroup = groups[0].id
  const layerCount = Math.max(...groups.map((group) => group.sections.layers.length))
  const layers: PreviewLayer[] = []

  for (let index = 0; index < layerCount; index++) {
    const band = input.bands[index]
    const height = band?.height ?? 0.2
    const z = groups.map((group) => group.layers[index]?.z).find((value) => typeof value === 'number') ?? band?.z ?? 0
    const merged: PreviewLayer = { z, data: [] }
    let mergedLines: number[] | undefined = []

    const active = groups
      .map((group) => ({ group, section: group.sections.layers[index], layer: group.layers[index] }))
      .filter((entry) => !!entry.section && hasExtrusion(entry.section.body))
      .sort((a, b) => a.group.id - b.group.id)

    let headerWritten = false
    let pendingRelief = 0
    for (const { group, section, layer } of active) {
      if (!section) continue
      if (group.id !== currentGroup) {
        const change = input.onToolChange(group, section.z, height, index)
        if (change) {
          out.push(...change.lines)
          stats.toolChanges++
          stats.towerFilamentMm += change.filamentMm ?? 0
          stats.towerSeconds += change.seconds ?? 0
          stats.towerVolumeMm3 += change.volumeMm3 ?? 0
          pendingRelief = Math.max(0, change.relief ?? 0)
        }
        currentGroup = group.id
      }
      if (!headerWritten) {
        out.push(...section.header)
        headerWritten = true
      }
      const bodyStart = out.length
      const relief = pendingRelief
      let bodyExtra = 0
      if (relief > 0 && /^G92 E0\b/.test(stripLineNumber(section.body[0] ?? ''))) {
        // Der Wechsel hat den Extruder zurückgezogen, der Block setzt mit
        // `G92 E0` auf null. Ohne diese Zeile fehlt das Material im ersten Pfad
        // und jede Farbe beginnt mit einer Lücke.
        out.push(section.body[0])
        out.push(`G1 E-${relief.toFixed(3)} F1800 ; Rückzug nach dem Spülen übernehmen`)
        out.push(...section.body.slice(1))
        bodyExtra = 1
      } else {
        out.push(...section.body)
      }
      pendingRelief = 0

      if (layer) {
        merged.data.push(...layer.data)
        const expected = layer.data.length / PREVIEW_STRIDE
        if (mergedLines && layer.lines && layer.lines.length === expected) {
          const shift = bodyStart - section.bodyLine
          const bodyEnd = section.bodyLine + section.body.length
          for (const line of layer.lines) {
            const sourceIndex = line - 1
            if (sourceIndex < section.bodyLine || sourceIndex >= bodyEnd) {
              mergedLines = undefined
              break
            }
            mergedLines.push(line + shift + (bodyExtra && sourceIndex > section.bodyLine ? bodyExtra : 0))
          }
        } else {
          mergedLines = undefined
        }
      }
    }

    // Schichten ohne Extrusion (oberhalb eines kurzen Objekts) behalten ihren
    // Marker, damit die Vorschau keine Höhenlücke bekommt.
    if (!headerWritten) {
      const any = groups.find((group) => group.sections.layers[index])
      if (any) out.push(...any.sections.layers[index].header)
    }

    if (mergedLines && mergedLines.length !== merged.data.length / PREVIEW_STRIDE) mergedLines = undefined
    layers.push(mergedLines ? { z, data: merged.data, lines: mergedLines } : { z, data: merged.data })
  }

  out.push(...groups[0].sections.tail)
  return { gcode: `${out.join('\n')}\n`, layers, stats }
}
