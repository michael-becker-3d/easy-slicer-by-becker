import type { BedMesh, KlipperMeshProfiles } from '../../shared/types.ts'

/**
 * Werkzeugnummern, die eine Datei wirklich wechselt. Gelesen werden nur
 * Befehlszeilen: `T0`…`Tn` am Zeilenanfang und `_A_CHANGE_FILAMENT CHANNEL=n`.
 * `M104 S215 T0` ist ein Parameter, kein Werkzeugwechsel.
 */
export function toolsUsedInGcode(gcode: string): number[] {
  const found = new Set<number>()
  for (const raw of gcode.split('\n')) {
    const line = raw.split(';')[0].trim()
    if (!line) continue
    const tool = /^T(\d+)(?:\s|$)/i.exec(line)
    if (tool) found.add(Number(tool[1]))
    const change = /^_A_CHANGE_FILAMENT\b.*\bCHANNEL\s*=\s*(\d+)/i.exec(line)
    if (change) found.add(Number(change[1]))
  }
  return [...found].filter((n) => Number.isFinite(n)).sort((a, b) => a - b)
}

/**
 * Startbefehl für eine Datei mit Werkzeugwechseln auf dem AD5X (IFS).
 * Werkzeug n entspricht Slot n+1, weil der Slicer den Slot-Index als
 * Werkzeugnummer ausgibt. `null`, wenn die Datei nichts wechselt.
 */
export function colorStartCommand(name: string, tools: number[]): string | null {
  const unique = [...new Set(tools)]
    .filter((tool) => Number.isInteger(tool) && tool >= 0)
    .sort((a, b) => a - b)
  if (unique.length === 0) return null
  const map = unique.map((tool) => `T${tool}=${tool + 1}`).join(' ')
  return `PRINT_ZCOLOR FILENAME="${name}" PLATE=1 ALLOWED_TOOL_COUNT=${unique.length} ${map}`
}

/** Moonraker-REST-Client (Klipper). */
export class KlipperClient {
  readonly baseUrl: string

  constructor(input: string) {
    this.baseUrl = KlipperClient.normalize(input)
  }

  /** "voron.local" → "http://voron.local:7125" */
  static normalize(input: string): string {
    let url = input.trim()
    if (!/^https?:\/\//i.test(url)) url = `http://${url}`
    url = url.replace(/\/+$/, '')
    const m = url.match(/^(https?:\/\/)([^/:]+)(:(\d+))?$/i)
    if (m && !m[4]) url = `${m[1]}${m[2]}:7125`
    return url
  }

  private async req(path: string, init?: RequestInit, timeoutMs = 12000): Promise<any> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), Math.max(1000, timeoutMs))
    try {
      const res = await fetch(`${this.baseUrl}${path}`, { ...init, signal: controller.signal })
      const text = await res.text()
      let data: any = {}
      try {
        data = text ? JSON.parse(text) : {}
      } catch {
        data = { raw: text }
      }
      if (!res.ok) throw new Error(data?.error?.message ?? `Moonraker HTTP ${res.status}`)
      return data
    } finally {
      clearTimeout(timer)
    }
  }

  async info(): Promise<any> {
    return this.req('/printer/info')
  }

  async query(objects: string[]): Promise<any> {
    const query = objects.map((o) => o).join('&')
    return this.req(`/printer/objects/query?${query}`)
  }

  async gcode(script: string, timeoutMs = 12000): Promise<void> {
    await this.req(
      `/printer/gcode/script?script=${encodeURIComponent(script)}`,
      { method: 'POST' },
      timeoutMs,
    )
  }

  /** Letzter Triggerpunkt der Probe in mm. */
  async probeZ(): Promise<number | null> {
    try {
      const data = await this.query(['probe'])
      const z = data?.result?.status?.probe?.last_z_result
      return typeof z === 'number' ? z : null
    } catch {
      return null
    }
  }

  /** Aus der laufenden Klipper-Konfiguration ableiten, wie Z abgetastet wird. */
  async probeInfo(): Promise<{ hasProbe: boolean; virtualEndstop: boolean; kind: string } | null> {
    try {
      const data = await this.req('/printer/objects/query?configfile=config')
      const cfg = (data?.result?.status?.configfile?.config ?? {}) as Record<string, unknown>
      const sections = Object.keys(cfg)
      const kind =
        sections.find((s) => s.startsWith('load_cell')) ??
        sections.find((s) => s.startsWith('bltouch')) ??
        sections.find((s) => s.startsWith('probe_eddy_current')) ??
        sections.find((s) => s === 'probe') ??
        sections.find((s) => s.startsWith('probe')) ??
        'none'
      const stepperZ = JSON.stringify(cfg.stepper_z ?? {})
      return {
        hasProbe: kind !== 'none',
        virtualEndstop: /z_virtual_endstop/.test(stepperZ),
        kind,
      }
    } catch {
      return null
    }
  }

  async mesh(): Promise<BedMesh | null> {
    try {
      const data = await this.query(['bed_mesh'])
      const bm = data?.result?.status?.bed_mesh
      if (!bm?.probed_matrix?.length) return null
      const rows: number[][] = bm.probed_matrix
      const min = bm.mesh_min ?? [0, 0]
      const max = bm.mesh_max ?? [235, 235]
      const xs = rows[0].length
      const ys = rows.length
      return {
        cols: xs,
        rows: ys,
        x0: min[0],
        y0: min[1],
        dx: xs > 1 ? (max[0] - min[0]) / (xs - 1) : 1,
        dy: ys > 1 ? (max[1] - min[1]) / (ys - 1) : 1,
        z: rows,
        source: 'klipper',
        capturedAt: Date.now(),
      }
    } catch {
      return null
    }
  }

  /** Gespeicherte Meshprofilnamen aus dem Klipper-Status lesen. */
  async meshProfiles(): Promise<KlipperMeshProfiles> {
    try {
      const data = await this.query(['bed_mesh'])
      const bm = data?.result?.status?.bed_mesh
      if (!bm) {
        return { profiles: [], current: null, available: false, reason: 'Klipper meldet kein bed_mesh.' }
      }
      const rawProfiles = bm.profiles
      const names = Array.isArray(rawProfiles)
        ? rawProfiles.filter((name: unknown): name is string => typeof name === 'string')
        : rawProfiles && typeof rawProfiles === 'object'
          ? Object.keys(rawProfiles)
          : []
      const current = typeof bm.profile_name === 'string' && bm.profile_name.trim() ? bm.profile_name : null
      return {
        profiles: [...new Set(names)].sort((a, b) => a.localeCompare(b, 'de', { numeric: true })),
        current,
        available: true,
      }
    } catch (err) {
      return {
        profiles: [],
        current: null,
        available: false,
        reason: err instanceof Error ? err.message : 'Meshprofile konnten nicht gelesen werden.',
      }
    }
  }

  async upload(name: string, gcode: string, start: boolean): Promise<void> {
    const form = new FormData()
    form.append('file', new Blob([gcode], { type: 'text/plain' }), name)
    form.append('root', 'gcodes')
    const res = await fetch(`${this.baseUrl}/server/files/upload?print=${start ? 'true' : 'false'}`, {
      method: 'POST',
      body: form,
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`Upload fehlgeschlagen (${res.status}) ${text.slice(0, 120)}`)
    }
  }

  async startPrint(name: string): Promise<void> {
    await this.req(`/printer/print/start?filename=${encodeURIComponent(name)}`, { method: 'POST' })
  }

  /**
   * Warten, bis Moonraker den neuen Dateinamen als laufend meldet. Der reine
   * HTTP-Erfolg von print/start oder upload?print=true reicht nicht: Bei einer
   * älteren abgeschlossenen Datei kann der Status sonst fälschlich als Erfolg
   * des neuen Auftrags gelesen werden.
   */
  async waitForPrintStart(
    name: string,
    opts: { timeoutMs?: number; pollMs?: number } = {},
  ): Promise<void> {
    const expected = name.split(/[\\/]/).pop() ?? name
    const timeoutMs = Math.max(1000, opts.timeoutMs ?? 20000)
    const pollMs = Math.max(100, opts.pollMs ?? 750)
    const deadline = Date.now() + timeoutMs
    let lastState = 'noch keine Antwort'

    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, pollMs))
      let data: any
      try {
        data = await this.query(['print_stats'])
      } catch (err) {
        lastState = err instanceof Error ? err.message : 'Abfrage fehlgeschlagen'
        continue
      }
      const stats = data?.result?.status?.print_stats ?? {}
      const state = String(stats.state ?? 'unbekannt')
      const reportedFile =
        typeof stats.filename === 'string' ? stats.filename.split(/[\\/]/).pop() ?? '' : ''
      if ((state === 'printing' || state === 'paused') && reportedFile === expected) return
      if (state === 'complete' && reportedFile === expected) return
      if (state === 'error') {
        throw new Error(`Drucker meldet einen Fehler statt des Starts von ${name}.`)
      }
      lastState = `${state}${reportedFile ? ` (${reportedFile})` : ''}`
    }

    throw new Error(
      `Druckstart nicht bestätigt: ${name} wurde hochgeladen, aber Klipper meldet ` +
        `nach ${Math.round(timeoutMs / 1000)} s keinen neuen Druck (zuletzt: ${lastState}).`,
    )
  }

  /**
   * AD5X/Z-Mod startet Dateien nicht über Moonrakers print/start, sondern über
   * das Makro SDCARD_PRINT_FILE. Es prüft die Datei, richtet IFS/Z-Control ein
   * und startet anschließend den eigentlichen Druck.
   *
   * Der HTTP-Erfolg des Makros beweist noch keinen laufenden Druck: Das Makro
   * arbeitet asynchron und kann die Datei ablehnen. Deshalb wird nach dem
   * Aufruf `print_stats` gelesen, bis Klipper den erwarteten Dateinamen als
   * `printing`/`paused` meldet. Es wird bewusst nicht automatisch erneut
   * gestartet — ein doppelter Makroaufruf könnte zwei Jobs auslösen.
   */
  async startFileViaMacro(
    name: string,
    opts: { timeoutMs?: number; pollMs?: number } = {},
  ): Promise<void> {
    if (!/^[A-Za-z0-9._-]+$/.test(name)) {
      throw new Error(`Ungültiger Dateiname für SDCARD_PRINT_FILE: ${name}`)
    }
    // Das AD5X-Makro prüft die Datei und führt Start/IFS vor dem eigentlichen
    // Druck aus. Das kann deutlich länger als ein normales G-Code-Kommando
    // dauern; ein 12-s-Abbruch würde einen bereits gestarteten Druck melden.
    await this.gcode(`SDCARD_PRINT_FILE FILENAME=${name}`, 120000)

    await this.waitForMacroPrint(name, opts)
  }

  /**
   * AD5X mit IFS: `_CHANGE_FILAMENT` holt seinen Slot aus der Zuordnung in
   * mod_data/file.json, und nur PRINT_ZCOLOR schreibt sie. Eine Datei mit
   * Werkzeugwechseln muss deshalb darüber starten — sonst bricht der erste
   * Wechsel mit „CHANNEL … out of range" ab. Ohne Wechsel bleibt der bisherige
   * Weg über SDCARD_PRINT_FILE.
   */
  async startFileViaColorMacro(name: string, tools: number[]): Promise<void> {
    if (!/^[A-Za-z0-9._-]+$/.test(name)) {
      throw new Error(`Ungültiger Dateiname für PRINT_ZCOLOR: ${name}`)
    }
    const command = colorStartCommand(name, tools)
    if (!command) {
      await this.startFileViaMacro(name)
      return
    }
    // Wie beim SDCARD_PRINT_FILE-Makro: Datei prüfen, IFS richten, dann
    // starten. Das kann länger dauern als ein normales Kommando.
    await this.gcode(command, 120000)
    await this.waitForMacroPrint(name)
  }

  /**
   * Warten, bis Klipper den erwarteten Dateinamen als laufend meldet. Der
   * Aufruf des Makros allein beweist keinen Druck: es arbeitet asynchron und
   * kann die Datei ablehnen. Es wird bewusst nicht automatisch erneut
   * gestartet — ein doppelter Aufruf könnte zwei Jobs auslösen.
   */
  private async waitForMacroPrint(
    name: string,
    opts: { timeoutMs?: number; pollMs?: number } = {},
  ): Promise<void> {
    const timeoutMs = Math.max(1000, opts.timeoutMs ?? 45000)
    const pollMs = Math.max(100, opts.pollMs ?? 750)
    const deadline = Date.now() + timeoutMs
    let lastState = 'noch keine Antwort'

    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, pollMs))
      let data: any
      try {
        data = await this.query(['print_stats'])
      } catch (err) {
        lastState = err instanceof Error ? err.message : 'Abfrage fehlgeschlagen'
        continue
      }

      const stats = data?.result?.status?.print_stats ?? {}
      const state = String(stats.state ?? 'unbekannt')
      const reportedFile =
        typeof stats.filename === 'string' ? stats.filename.split(/[\\/]/).pop() ?? '' : ''

      if (state === 'printing' || state === 'paused') {
        if (reportedFile && reportedFile !== name) {
          throw new Error(
            `AD5X meldet einen anderen Druck (${reportedFile}), nicht ${name}. ` +
              'Der neue Auftrag wurde nicht als laufend bestätigt.',
          )
        }
        return
      }
      if (state === 'complete' && reportedFile === name) return
      if (state === 'error') {
        throw new Error(`AD5X meldet einen Druckfehler statt des Starts von ${name}.`)
      }
      lastState = `${state}${reportedFile ? ` (${reportedFile})` : ''}`
    }

    throw new Error(
      `AD5X-Start nicht bestätigt: ${name} wurde hochgeladen, aber Klipper meldet ` +
        `nach ${Math.round(timeoutMs / 1000)} s keinen laufenden Druck (zuletzt: ${lastState}). ` +
        'Bitte am Drucker prüfen; nicht automatisch erneut starten.',
    )
  }

  async pause(): Promise<void> {
    await this.req('/printer/print/pause', { method: 'POST' })
  }

  async resume(): Promise<void> {
    await this.req('/printer/print/resume', { method: 'POST' })
  }

  async cancel(): Promise<void> {
    await this.req('/printer/print/cancel', { method: 'POST' })
  }

  async emergencyStop(): Promise<void> {
    await this.req('/printer/emergency_stop', { method: 'POST' })
  }
}
