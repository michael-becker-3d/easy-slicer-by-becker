/**
 * Scan-zu-Druck: Bewertung und Vorbereitung eines Fotogrammetrie-Meshes.
 *
 * Ein Scan ist kein CAD-Teil: Er ist meist unskaliert, verrauscht, hat offene
 * Ränder und besteht oft aus mehreren Inseln. Diese Datei beurteilt genau das
 * und schlägt die nächsten Schritte vor, ohne selbst Geometrie zu verändern.
 */
import type { Vec3 } from './types.ts'

export type ScanSeverity = 'critical' | 'warn' | 'hint' | 'ok'

export type ScanFinding = {
  id: string
  severity: ScanSeverity
  title: string
  /** Messwert, z. B. „148 offene Kanten“. */
  detail: string
  /** Warum das für den Druck zählt. */
  why: string
}

export type ScanInfo = {
  triangles: number
  size: Vec3
  /** Kanten, die nur zu einem Dreieck gehören. */
  openEdges: number
  /** Zusammenhängende Inseln. */
  components: number
}

/** Ab dieser Dreieckszahl wird das Slicen spürbar zäh. */
export const SCAN_TRIANGLE_WARN = 300_000
/** Unter dieser längsten Kante ist ein Maßstab mit hoher Wahrscheinlichkeit falsch. */
export const SCAN_TINY_MM = 10

const fmt = (value: number, digits = 1) => value.toFixed(digits).replace('.', ',')

/** Typische Scan-Probleme, sortiert nach Schwere. */
export function assessScan(info: ScanInfo, bed?: { x: number; y: number; z: number }): ScanFinding[] {
  const findings: ScanFinding[] = []
  const longest = Math.max(info.size.x, info.size.y, info.size.z)

  if (info.openEdges > 0) {
    findings.push({
      id: 'open-edges',
      severity: info.openEdges > 50 ? 'critical' : 'warn',
      title: 'Netz ist nicht wasserdicht',
      detail: `${info.openEdges} offene Kante${info.openEdges === 1 ? '' : 'n'}`,
      why: 'Der Slicer kann an offenen Rändern nicht entscheiden, wo innen und außen liegt. Es entstehen Löcher in der Wand oder die Kontur bricht ab. „Mesh reparieren“ schließt die Ränder.',
    })
  }

  if (info.components > 1) {
    findings.push({
      id: 'components',
      severity: 'warn',
      title: 'Mehrere Einzelkörper',
      detail: `${info.components} zusammenhanglose Inseln`,
      why: 'Foto-Scans enthalten oft lose Splitter oder eine zweite Schale. Beim Slicen werden sie mitgedruckt, obwohl sie nicht zum Teil gehören. „In Einzelteile trennen“ macht sie sichtbar, danach die störenden löschen.',
    })
  }

  if (info.triangles > SCAN_TRIANGLE_WARN) {
    findings.push({
      id: 'triangles',
      severity: 'hint',
      title: 'Sehr feines Netz',
      detail: `${Math.round(info.triangles / 1000)}.000 Dreiecke`,
      why: 'Für den Druck ist die Auflösung meist höher als die Düse. Das Slicen und Aushöhlen dauert dadurch deutlich länger; eine gröbere Aushöhl-Stufe reduziert das Netz vorher.',
    })
  }

  if (longest > 0 && longest < SCAN_TINY_MM) {
    findings.push({
      id: 'scale',
      severity: 'hint',
      title: 'Maßstab vermutlich unskaliert',
      detail: `größte Kante nur ${fmt(longest)} mm`,
      why: 'Fotogrammetrie liefert zunächst einheitenlose Koordinaten. Erst ein bekanntes Ist-Maß (z. B. die Höhe einer mitfotografierten Referenz) macht daraus Millimeter. Unten lässt sich das Soll-Maß setzen.',
    })
  }

  if (bed) {
    const tooBig =
      info.size.x > bed.x + 1e-6 || info.size.y > bed.y + 1e-6 || info.size.z > bed.z + 1e-6
    if (tooBig) {
      findings.push({
        id: 'bed',
        severity: 'critical',
        title: 'Passt nicht aufs Bett',
        detail: `${fmt(info.size.x)} × ${fmt(info.size.y)} × ${fmt(info.size.z)} mm bei ${bed.x} × ${bed.y} × ${bed.z} mm`,
        why: 'Entweder verkleinern oder über den Montage-Assistenten teilen. Ein zu großes Teil wird sonst beim Slicen abgeschnitten.',
      })
    }
  }

  if (!findings.length) {
    findings.push({
      id: 'clean',
      severity: 'ok',
      title: 'Keine typischen Scan-Probleme',
      detail: `${info.triangles.toLocaleString('de-DE')} Dreiecke, geschlossen, ein Körper`,
      why: 'Das Netz kann direkt skaliert und gedruckt werden. Prüfe trotzdem das Maß, denn die Einheit eines Scans ist nicht selbstverständlich.',
    })
  }

  const rank: Record<ScanSeverity, number> = { critical: 0, warn: 1, hint: 2, ok: 3 }
  return findings.sort((a, b) => rank[a.severity] - rank[b.severity])
}

export function scanSummary(findings: ScanFinding[]): string {
  const critical = findings.filter((f) => f.severity === 'critical').length
  const warn = findings.filter((f) => f.severity === 'warn').length
  const hint = findings.filter((f) => f.severity === 'hint').length
  if (critical) return `${critical} kritisch${critical === 1 ? 'er' : 'e'} Befund${critical === 1 ? '' : 'e'} — vor dem Slicen beheben.`
  if (warn) return `${warn} Warnung${warn === 1 ? '' : 'en'} — prüfen, ob sie für dieses Teil zählt.`
  if (hint) return `${hint} Hinweis${hint === 1 ? '' : 'e'} — der Druck ist möglich.`
  return 'Netz ist druckbereit.'
}

export type ScaleAxis = 'x' | 'y' | 'z' | 'longest'

export type ScalePlan = {
  axis: ScaleAxis
  /** Aktuelles Maß der gewählten Achse in mm. */
  from: number
  /** Gewünschtes Maß in mm. */
  to: number
  factor: number
  newSize: Vec3
  feasible: boolean
  warnings: string[]
}

/**
 * Rechnet aus einem bekannten Ist-Maß den Maßstab. Bewusst nur eine Zahl:
 * Der Scan wird gleichmäßig skaliert, damit die Proportionen erhalten bleiben.
 */
export function planScale(
  size: Vec3,
  targetMm: number,
  axis: ScaleAxis = 'longest',
  bed?: { x: number; y: number; z: number },
): ScalePlan | null {
  const lengths: Record<'x' | 'y' | 'z', number> = { x: size.x, y: size.y, z: size.z }
  const from = axis === 'longest' ? Math.max(size.x, size.y, size.z) : lengths[axis]
  if (!Number.isFinite(targetMm) || targetMm <= 0 || !Number.isFinite(from) || from <= 0) return null
  const factor = targetMm / from
  const newSize = { x: size.x * factor, y: size.y * factor, z: size.z * factor }
  const warnings: string[] = []
  if (factor < 0.05 || factor > 10) {
    warnings.push(
      `Faktor ${fmt(factor, 2)} liegt außerhalb des zulässigen Bereichs (0,05–10). Bitte ein anderes Soll-Maß wählen.`,
    )
  }
  if (targetMm < 1) warnings.push('Unter 1 mm ist das Teil mit einer FDM-Düse nicht mehr sinnvoll druckbar.')
  if (bed) {
    const tooBig = newSize.x > bed.x || newSize.y > bed.y || newSize.z > bed.z
    if (tooBig) {
      warnings.push(
        `Das skalierte Teil (${fmt(newSize.x)} × ${fmt(newSize.y)} × ${fmt(newSize.z)} mm) passt nicht aufs Bett (${bed.x} × ${bed.y} × ${bed.z} mm).`,
      )
    }
  }
  return { axis, from, to: targetMm, factor, newSize, feasible: factor >= 0.05 && factor <= 10, warnings }
}

export type HollowDetail = 0.1 | 0.2 | 0.4

export type HollowInput = {
  /** Wandstärke im Druck in mm. */
  wall: number
  drainHoles: number
  drainDiameter: number
  /** Vereinfachung vor dem Aushöhlen in mm. */
  detail: number
}

export type HollowPlan = {
  wall: number
  drainHoles: number
  drainDiameter: number
  detail: HollowDetail
  duration: 'kurz' | 'mittel' | 'lang'
  durationLabel: string
  feasible: boolean
  /** Abstand der Bohrungen von der BBox-Mitte in mm (x/y), Unterkante ist z-min. */
  drains: { x: number; y: number }[]
  warnings: string[]
}

export const HOLLOW_WALL_MIN = 0.8
export const HOLLOW_WALL_MAX = 8
export const HOLLOW_DRAIN_MIN = 1.5
export const HOLLOW_DRAIN_MAX = 8
export const HOLLOW_MAX_HOLES = 6

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

/** Abflusslöcher gleichmäßig entlang der längeren Bettachse verteilen. */
export function drainOffsets(size: Vec3, count: number, diameter: number): { x: number; y: number }[] {
  const n = Math.round(clamp(count, 0, HOLLOW_MAX_HOLES))
  if (!n) return []
  const margin = Math.max(2, diameter / 2 + 1)
  const usable = size.x - margin * 2
  if (usable <= 0) return [{ x: 0, y: 0 }]
  if (n === 1) return [{ x: 0, y: 0 }]
  return Array.from({ length: n }, (_, index) => ({
    x: -usable / 2 + (usable * index) / (n - 1),
    y: 0,
  }))
}

export function planHollow(size: Vec3, input: Partial<HollowInput>, triangles = 0): HollowPlan {
  const requestedWall = Number(input.wall ?? 2) || 2
  const wall = clamp(requestedWall, HOLLOW_WALL_MIN, HOLLOW_WALL_MAX)
  const drainHoles = Math.round(clamp(Number(input.drainHoles ?? 2) || 0, 0, HOLLOW_MAX_HOLES))
  const drainDiameter = clamp(
    Number(input.drainDiameter ?? 3) || 3,
    HOLLOW_DRAIN_MIN,
    HOLLOW_DRAIN_MAX,
  )
  const requested = Number(input.detail ?? 0.2)
  const detail: HollowDetail = requested <= 0.15 ? 0.1 : requested >= 0.3 ? 0.4 : 0.2
  const smallest = Math.min(size.x, size.y, size.z)
  const warnings: string[] = []
  if (requestedWall > HOLLOW_WALL_MAX) {
    warnings.push(`Die Wandstärke wurde auf ${fmt(HOLLOW_WALL_MAX)} mm begrenzt — stärkere Wände sind kein Hohlkörper mehr.`)
  }

  let duration: HollowPlan['duration'] = triangles <= 20_000 ? 'kurz' : triangles <= 120_000 ? 'mittel' : 'lang'
  if (detail === 0.1 && duration !== 'lang') duration = duration === 'kurz' ? 'mittel' : 'lang'
  if (detail === 0.4 && duration !== 'kurz') duration = duration === 'lang' ? 'mittel' : 'kurz'
  const durationLabel =
    duration === 'kurz'
      ? 'wenige Sekunden bis etwa 15 s'
      : duration === 'mittel'
        ? 'etwa 15–45 s'
        : 'eine Minute oder länger'

  const feasible = smallest > wall * 2 + 0.5
  if (!feasible) {
    warnings.push(
      `Die kleinste Abmessung ist ${fmt(smallest)} mm. Bei ${fmt(wall)} mm Wand bleibt an den dünnsten Stellen kein Hohlraum — dort wird massiv gedruckt.`,
    )
  }
  if (wall < 1.2) warnings.push('Unter 1,2 mm Wandstärke wird die Schale bruch- und beulgefährdet.')
  if (drainHoles > 0 && drainDiameter < 2) {
    warnings.push('Abflusslöcher unter 2 mm setzen sich beim Drucken oder Reinigen leicht zu.')
  }
  if (detail === 0.4 && triangles > 0 && triangles < 30_000) {
    warnings.push('Das Netz ist bereits grob. Eine feinere Stufe erhält mehr Oberflächendetail.')
  }

  return {
    wall,
    drainHoles,
    drainDiameter,
    detail,
    duration,
    durationLabel,
    feasible,
    drains: drainOffsets(size, drainHoles, drainDiameter),
    warnings,
  }
}
