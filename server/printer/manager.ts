import { EventEmitter } from 'node:events'
import type { BedMesh, ConsoleLine, PrinterProfile, PrinterStatus, ZMeasurement } from '../../shared/types.ts'
import { machineOffset } from '../../shared/types.ts'
import { loadMesh, saveMesh } from '../meshStore.ts'
import type { Area } from '../footprint.ts'
import { printerById } from '../../shared/catalog.ts'
import { MockTransport, SerialTransport, type Transport } from './transport.ts'
import { KlipperClient } from './klipper.ts'
import { OctoPrintClient } from './octoprint.ts'
import { GcodeStreamer } from './streamer.ts'
import { meshFromPoints, parseMeshTable, parseProbeLines, type ProbePoint } from './mesh.ts'
import { recordMesh } from '../history.ts'

export type ConnectOptions = {
  mode: 'serial' | 'simulation' | 'klipper' | 'octoprint'
  path?: string
  /** 0 oder weggelassen = Baudrate automatisch ermitteln */
  baud?: number
  profileId: string
  url?: string
  /** OctoPrint-API-Key (Header X-Api-Key) */
  apiKey?: string
}

type Waiter = {
  buf: string[]
  collect: boolean
  resolve: (lines: string[]) => void
  reject: (err: Error) => void
  timer: ReturnType<typeof setTimeout>
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms))

const IDLE_PRINT: PrinterStatus['print'] = { state: 'idle', file: null, progress: 0, etaSeconds: null }

/**
 * Schichtmarken aus den LAYER-Kommentaren auf die Nummer der tatsächlich
 * gesendeten Befehlszeilen abbilden (der Streamer überspringt Kommentare).
 * Erkennt `;LAYER:n` (Easy-Slicer/Cura), `;LAYER` und `;LAYER_CHANGE`.
 */
function layerMarkOffsets(gcode: string): number[] {
  const marks: number[] = []
  let codeLines = 0
  for (const raw of gcode.split('\n')) {
    const line = raw.trim()
    if (!line) continue
    if (line.startsWith(';')) {
      if (/^;\s*LAYER(?::|\b)/i.test(line) || /^;\s*LAYER_CHANGE\b/i.test(line)) marks.push(codeLines)
      continue
    }
    codeLines++
  }
  return marks
}

export class PrinterManager extends EventEmitter {
  status: PrinterStatus = {
    connection: 'disconnected',
    mode: 'simulation',
    port: null,
    firmware: null,
    bed: null,
    temps: { nozzle: 0, nozzleTarget: 0, bed: 0, bedTarget: 0 },
    position: { x: 0, y: 0, z: 0 },
    zOffset: 0,
    babystep: 0,
    message: null,
    print: IDLE_PRINT,
  }
  mesh: BedMesh | null = null
  log: ConsoleLine[] = []
  profileId = 'anycubic-vyper'
  /** Rohantworten der letzten Bettmessung — Diagnose für echte Geräte. */
  probeLog: { at: number; mode: string; printerId: string; lines: string[] } | null = null

  private transport: Transport | null = null
  private klipper: KlipperClient | null = null
  private octo: OctoPrintClient | null = null
  private streamer: GcodeStreamer | null = null
  private pollTimer: ReturnType<typeof setInterval> | null = null
  private waiter: Waiter | null = null
  private chain: Promise<unknown> = Promise.resolve()
  /** Verhindert zwei gleichzeitige Startaufrufe, bevor der Status umschaltet. */
  private startPending = false

  constructor(profileId = 'anycubic-vyper') {
    super()
    this.profileId = profileId
    this.setMaxListeners(32)
  }

  private push(status: Partial<PrinterStatus>) {
    this.status = { ...this.status, ...status }
    this.emit('status', this.status)
  }

  private logLine(dir: ConsoleLine['dir'], text: string) {
    const entry: ConsoleLine = { t: Date.now(), dir, text }
    this.log.push(entry)
    if (this.log.length > 400) this.log.shift()
    this.emit('log', entry)
  }

  get connected(): boolean {
    return this.status.connection === 'connected'
  }

  async connect(opts: ConnectOptions): Promise<PrinterStatus> {
    if (this.transport || this.klipper || this.octo) await this.disconnect()
    this.profileId = opts.profileId
    const profile = printerById(opts.profileId)
    // Ein Mesh gehört zu genau einem Modell — beim Wechsel nichts übernehmen
    this.mesh = loadMesh(opts.profileId)
    if (this.mesh) this.emit('mesh', this.mesh)

    this.push({
      connection: 'connecting',
      mode: opts.mode,
      port:
        opts.mode === 'serial'
          ? opts.path ?? null
          : opts.mode === 'klipper' || opts.mode === 'octoprint'
            ? opts.url ?? null
            : 'simulation',
      bed: profile.bed,
      message: null,
      print: IDLE_PRINT,
    })

    if (opts.mode === 'klipper') {
      const client = new KlipperClient(opts.url ?? 'localhost')
      try {
        const info = await client.info()
        this.klipper = client
        this.push({
          connection: 'connected',
          port: client.baseUrl,
          firmware: `Klipper (${info?.result?.klippy_state ?? 'bereit'})`,
          message: null,
        })
        this.logLine('info', `Klipper verbunden: ${client.baseUrl}`)
        this.startPolling()
        void this.refreshMesh()
        return this.status
      } catch (err) {
        this.push({
          connection: 'error',
          message: `Klipper nicht erreichbar: ${err instanceof Error ? err.message : 'unbekannt'}`,
        })
        throw err
      }
    }

    if (opts.mode === 'octoprint') {
      const client = new OctoPrintClient(opts.url ?? 'localhost', opts.apiKey ?? '')
      try {
        const info = await client.version()
        // Version ist öffentlich — erst der Key-Nachweis macht die Verbindung gültig
        await client.verifyKey()
        this.octo = client
        this.push({
          connection: 'connected',
          port: client.baseUrl,
          firmware: `OctoPrint ${info.server}`,
          message: null,
        })
        this.logLine('info', `OctoPrint verbunden: ${client.baseUrl}`)
        this.startPolling()
        return this.status
      } catch (err) {
        this.push({
          connection: 'error',
          message: `OctoPrint nicht erreichbar: ${err instanceof Error ? err.message : 'unbekannt'}`,
        })
        throw err
      }
    }

    let transport: Transport
    if (opts.mode === 'serial') {
      try {
        const opened = await this.openSerial(opts.path ?? '/dev/ttyUSB0', opts.baud ?? 0, profile)
        transport = opened.transport
        if (opened.firmware) this.push({ firmware: opened.firmware })
      } catch (err) {
        this.push({
          connection: 'error',
          message: err instanceof Error ? err.message : 'Verbindung fehlgeschlagen',
        })
        throw err
      }
    } else {
      transport = new MockTransport()
    }

    transport.onLine((line) => this.handleLine(line))
    transport.onClose(() => {
      if (this.status.connection !== 'disconnected') {
        this.push({ connection: 'disconnected', message: 'Verbindung beendet' })
      }
    })

    try {
      // Seriell ist beim Öffnen bereits verbunden — nur die Simulation startet hier.
      if (opts.mode !== 'serial') await transport.open()
    } catch (err) {
      this.push({
        connection: 'error',
        message: err instanceof Error ? err.message : 'Verbindung fehlgeschlagen',
      })
      throw err
    }

    this.transport = transport
    this.push({ connection: 'connected', port: transport.label, message: null })
    this.logLine('info', `Verbunden: ${transport.label}`)

    try {
      const info = await this.command('M115', { timeout: 6000 })
      const fw = info.find((l) => /FIRMWARE_NAME/i.test(l))
      this.push({ firmware: fw ? fw.replace(/^.*FIRMWARE_NAME:/i, '').split(/\s{2,}|SOURCE_CODE/)[0].trim() : null })
    } catch {
      this.push({ firmware: null })
    }

    return this.status
  }

  /**
   * Öffnet USB-Serial und sucht die Baudrate, auf der der Drucker antwortet.
   * Ältere Marlin-Boards (Vyper, Ender) hängen oft an einem CH340/CH341 und
   * sprechen 115200, andere 250000 — deshalb wird ohne feste Vorgabe probiert.
   */
  private async openSerial(
    path: string,
    requested: number,
    profile: PrinterProfile,
  ): Promise<{ transport: SerialTransport; firmware: string | null }> {
    const auto = [...new Set([profile.baud || 115200, 115200, 250000, 500000, 57600, 9600])]
    const candidates = requested > 0 ? [requested] : auto
    const failed: string[] = []

    for (const baud of candidates) {
      const transport = new SerialTransport(path, baud)
      try {
        await transport.open()
        const lines = await this.probeSerial(transport)
        const fw = lines.find((l) => /FIRMWARE_NAME/i.test(l))
        if (!fw && !lines.some((l) => /^ok$/i.test(l.trim()))) {
          await transport.close().catch(() => undefined)
          failed.push(`${baud} (keine Antwort)`)
          continue
        }
        const name = fw ? fw.replace(/^.*FIRMWARE_NAME:/i, '').split(/\s{2,}|SOURCE_CODE/)[0].trim() : null
        this.logLine('info', `Seriell offen: ${path} @ ${baud}${name ? ` — ${name}` : ''}`)
        return { transport, firmware: name }
      } catch (err) {
        await transport.close().catch(() => undefined)
        failed.push(`${baud} (${err instanceof Error ? err.message : 'Fehler'})`)
      }
    }

    throw new Error(
      `Der Drucker antwortet auf ${path} nicht. Getestet: ${failed.join(', ')}. ` +
        'Kabel und Netzteil prüfen, unter Windows den CH341SER-Treiber installieren und sicherstellen, ' +
        'dass kein anderes Programm (Cura, OctoPrint, Pronterface) den Port belegt.',
    )
  }

  /** Schickt M115 mehrfach und sammelt die Antwort — der Reset braucht manchmal Anläufe. */
  private async probeSerial(transport: SerialTransport): Promise<string[]> {
    const lines: string[] = []
    transport.onLine((line) => lines.push(line))
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        transport.send('M115')
      } catch {
        return lines
      }
      const deadline = Date.now() + 1500
      while (Date.now() < deadline) {
        if (lines.some((l) => /FIRMWARE_NAME/i.test(l))) return lines
        await delay(100)
      }
    }
    return lines
  }

  async disconnect(): Promise<void> {
    this.stopPolling()
    const t = this.transport
    this.transport = null
    this.klipper = null
    this.octo = null
    this.streamer = null
    this.waiter = null
    if (t) await t.close().catch(() => undefined)
    // Nichts von der alten Verbindung stehen lassen: Port, Firmware und
    // Messwerte gehören zur beendeten Verbindung, nicht zum Druckerprofil.
    this.push({
      connection: 'disconnected',
      port: null,
      firmware: null,
      message: null,
      temps: { nozzle: 0, nozzleTarget: 0, bed: 0, bedTarget: 0 },
      position: { x: 0, y: 0, z: 0 },
      zOffset: 0,
      babystep: 0,
      print: IDLE_PRINT,
    })
    this.logLine('info', 'Verbindung getrennt')
  }

  private handleLine(raw: string) {
    const line = raw.trim()
    if (!line) return
    this.logLine('in', line)

    const temp = line.match(/T:\s*(-?[\d.]+)\s*\/\s*(-?[\d.]+).*?B:\s*(-?[\d.]+)\s*\/\s*(-?[\d.]+)/)
    if (temp) {
      this.push({
        temps: {
          nozzle: parseFloat(temp[1]),
          nozzleTarget: parseFloat(temp[2]),
          bed: parseFloat(temp[3]),
          bedTarget: parseFloat(temp[4]),
        },
      })
    }
    const pos = line.match(/X:\s*(-?[\d.]+)\s*Y:\s*(-?[\d.]+)\s*Z:\s*(-?[\d.]+)/)
    if (pos && !/^Bed/i.test(line)) {
      this.push({ position: { x: parseFloat(pos[1]), y: parseFloat(pos[2]), z: parseFloat(pos[3]) } })
    }
    const baby = line.match(/Babystep:\s*(-?[\d.]+)/i)
    if (baby) this.push({ babystep: parseFloat(baby[1]) })

    // Streaming hat Vorrang: jedes "ok" gehört zu einer gepufferten Zeile.
    // Läuft parallel ein Kommando, gehört das "ok" zu dessen Waiter.
    if (this.streamer?.isActive && this.streamer.pending > 0 && !this.waiter) {
      if (/^ok\b/i.test(line)) {
        this.streamer.ack()
        return
      }
      if (/^(error|!!|unknown command|kill|fatal)/i.test(line)) {
        this.streamer.fail(line)
        this.streamer = null
        return
      }
    }

    const w = this.waiter
    if (!w) return
    if (/^ok\b/i.test(line)) {
      clearTimeout(w.timer)
      this.waiter = null
      w.resolve(w.buf)
      return
    }
    if (/^(error|!!|unknown command|kill|fatal)/i.test(line)) {
      clearTimeout(w.timer)
      this.waiter = null
      w.reject(new Error(line))
      return
    }
    if (w.collect) w.buf.push(line)
  }

  command(line: string, opts: { timeout?: number; collect?: boolean } = {}): Promise<string[]> {
    if (this.klipper) {
      return this.klipper.gcode(line).then(() => []).catch((err) => {
        throw err instanceof Error ? err : new Error(String(err))
      })
    }
    if (this.octo) {
      this.logLine('out', line)
      return this.octo.gcode(line).then(() => [])
    }
    const run = () => this.sendAndWait(line, opts)
    const p = this.chain.then(run, run)
    this.chain = p.catch(() => undefined)
    return p
  }

  private sendAndWait(line: string, opts: { timeout?: number; collect?: boolean }): Promise<string[]> {
    return new Promise<string[]>((resolve, reject) => {
      if (!this.transport) {
        reject(new Error('Kein Drucker verbunden.'))
        return
      }
      const timer = setTimeout(() => {
        this.waiter = null
        reject(new Error(`Zeitüberschreitung bei "${line}"`))
      }, opts.timeout ?? 25000)
      this.waiter = { buf: [], collect: opts.collect ?? true, resolve, reject, timer }
      this.logLine('out', line)
      try {
        this.transport.send(line)
      } catch (err) {
        clearTimeout(timer)
        this.waiter = null
        reject(err instanceof Error ? err : new Error(String(err)))
      }
    })
  }

  /** Sofort senden, ohne auf "ok" zu warten — für Live-Eingriffe während des Drucks. */
  sendNow(line: string): void {
    if (this.klipper) {
      this.logLine('out', `${line}   (live)`)
      void this.klipper.gcode(line)
      return
    }
    if (this.octo) {
      this.logLine('out', `${line}   (live)`)
      void this.octo.gcode(line)
      return
    }
    if (!this.transport) throw new Error('Kein Drucker verbunden.')
    this.logLine('out', `${line}   (live)`)
    this.transport.send(line)
  }

  // ---------- Klipper-Status ----------

  private startPolling() {
    this.stopPolling()
    this.pollTimer = setInterval(() => void this.pollStatus(), 2000)
    void this.pollStatus()
  }

  private async pollStatus() {
    if (this.klipper) await this.pollKlipper()
    else if (this.octo) await this.pollOctoPrint()
  }

  private stopPolling() {
    if (this.pollTimer) clearInterval(this.pollTimer)
    this.pollTimer = null
  }

  private async pollKlipper() {
    if (!this.klipper) return
    try {
      const res = await this.klipper.query([
        'extruder',
        'heater_bed',
        'toolhead',
        'print_stats',
        'virtual_sdcard',
        'gcode_move',
      ])
      const st = res?.result?.status ?? {}
      const extruder = st.extruder ?? {}
      const bed = st.heater_bed ?? {}
      const toolhead = st.toolhead ?? {}
      const stats = st.print_stats ?? {}
      const vsd = st.virtual_sdcard ?? {}
      const move = st.gcode_move ?? {}

      const rawState = String(stats.state ?? 'standby')
      const state: PrinterStatus['print']['state'] =
        rawState === 'printing'
          ? 'printing'
          : rawState === 'paused'
            ? 'paused'
            : rawState === 'complete'
              ? 'complete'
              : rawState === 'error'
                ? 'error'
                : 'idle'

      const progress = typeof vsd.progress === 'number' ? vsd.progress : 0
      const duration = typeof stats.print_duration === 'number' ? stats.print_duration : 0
      const eta = progress > 0.02 ? Math.max(0, duration / progress - duration) : null
      // Klipper liefert Schichtdaten nur bei Dateien mit Metadaten (Slicer-Header)
      const layerInfo = stats.info ?? {}
      const currentLayer = Number(layerInfo.current_layer ?? 0)
      const totalLayer = Number(layerInfo.total_layer ?? 0)
      const layer =
        currentLayer > 0 && totalLayer > 0 ? { current: currentLayer, total: totalLayer } : null

      this.push({
        temps: {
          nozzle: Number(extruder.temperature ?? 0),
          nozzleTarget: Number(extruder.target ?? 0),
          bed: Number(bed.temperature ?? 0),
          bedTarget: Number(bed.target ?? 0),
        },
        position: {
          x: Number(toolhead.position?.[0] ?? 0),
          y: Number(toolhead.position?.[1] ?? 0),
          z: Number(toolhead.position?.[2] ?? 0),
        },
        zOffset: Number(move.homing_origin?.[2] ?? 0),
        print: {
          state,
          file: stats.filename ? String(stats.filename) : null,
          progress,
          etaSeconds: eta,
          layer,
        },
      })
    } catch {
      // kurze Aussetzer ignorieren
    }
  }

  private async pollOctoPrint() {
    if (!this.octo) return
    try {
      const snap = await this.octo.status()
      this.push({
        temps: snap.temps,
        position: snap.position ?? this.status.position,
        print: {
          state: snap.state,
          file: snap.file,
          progress: snap.progress,
          etaSeconds: snap.etaSeconds,
        },
      })
    } catch {
      // 409/offline: kurze Aussetzer ignorieren
    }
  }

  /** Bett-Mesh des Klipper-Geräts lesen und unter dem Profil ablegen. */
  async refreshMesh(): Promise<void> {
    if (!this.klipper) return
    const mesh = await this.klipper.mesh()
    if (mesh) {
      this.mesh = saveMesh(this.profileId, mesh)
      this.emit('mesh', this.mesh)
    }
  }

  /** Gespeicherte Meshprofilnamen des verbundenen Klipper-Druckers. */
  async meshProfiles() {
    if (!this.klipper) {
      return {
        profiles: [],
        current: null,
        available: false,
        reason: 'Klipper ist nicht verbunden.',
      }
    }
    return this.klipper.meshProfiles()
  }

  // ---------- Bettvermessung ----------

  /**
   * Vorhandenes Firmware-Mesh per USB lesen (Marlin M420 V), ohne neu zu
   * messen. Das Mesh wird für dieses Modell abgelegt und beim Slicen in den
   * G-Code eingerechnet — funktioniert auch ohne Klipper-Mod.
   */
  async importFirmwareMesh(): Promise<BedMesh> {
    if (this.klipper || this.octo) {
      throw new Error('Dieser Weg ist für USB/Marlin gedacht — bei Klipper wird das bed_mesh automatisch übernommen.')
    }
    if (!this.transport) throw new Error('Kein Drucker per USB verbunden.')
    const profile = printerById(this.profileId)
    this.push({ message: 'Firmware-Mesh wird gelesen …' })
    let lines: string[] = []
    try {
      lines = await this.command('M420 V', { timeout: 25000, collect: true })
    } catch (err) {
      throw new Error(err instanceof Error ? err.message : 'M420 V nicht beantwortet.')
    }
    this.logProbe('M420 V (Firmware-Mesh)', lines)
    const mesh = parseMeshTable(lines, profile)
    if (!mesh) {
      throw new Error(
        'Der Drucker hat kein gespeichertes Bett-Mesh gemeldet. Am Gerät einmal nivellieren (G29) oder „Automatisch (G29)“ nutzen.',
      )
    }
    mesh.source = 'firmware'
    this.mesh = saveMesh(profile.id, mesh)
    this.emit('mesh', this.mesh)
    try {
      recordMesh(this.profileId, this.mesh)
    } catch {
      // Verlauf ist optional
    }
    this.push({ message: 'Firmware-Mesh übernommen — Kompensation im G-Code' })
    return this.mesh
  }

  async probeBed(mode: 'auto' | 'manual', grid?: { cols: number; rows: number }, area?: Area): Promise<BedMesh> {
    if (this.klipper) return this.probeKlipper(area)
    if (this.octo)
      throw new Error('OctoPrint gibt keine Messwerte zurück — Bett-Mesh bitte über Moonraker oder USB messen.')
    if (!this.transport) throw new Error('Kein Drucker verbunden.')
    const profile = printerById(this.profileId)
    if (area) area = clampToDelta(profile, area)
    this.push({ message: area ? 'Modellbereich wird vermessen …' : 'Bett wird vermessen …' })

    try {
      let mesh: BedMesh | null = null

      if (area) {
        mesh = await this.probeSerialArea(area, grid?.cols ?? 5, grid?.rows ?? 5)
      } else if (mode === 'auto') {
        const g29 = await this.command('G29', { timeout: 240000, collect: true })
        await delay(200)
        let vLines: string[] = []
        try {
          vLines = await this.command('M420 V', { timeout: 25000 })
        } catch {
          vLines = []
        }
        this.logProbe('G29 + M420 V', [...g29, ...vLines])
        mesh = parseMeshTable([...g29, ...vLines], profile)
        if (!mesh) {
          const pts = parseProbeLines(g29)
          if (pts.length) mesh = meshFromPoints(pts, profile)
        }
      } else {
        const cols = grid?.cols ?? profile.meshGrid.cols
        const rows = grid?.rows ?? profile.meshGrid.rows
        const margin = profile.meshGrid.margin
        const spanX = profile.bed.x - margin * 2
        const spanY = profile.bed.y - margin * 2
        await this.command('G28', { timeout: 90000 })
        await this.command('G1 Z8 F600')
        const points: ProbePoint[] = []
        const raw: string[] = ['G28']
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            const x = margin + (spanX * c) / Math.max(1, cols - 1)
            const y = margin + (spanY * r) / Math.max(1, rows - 1)
            await this.command(`G1 X${x.toFixed(2)} Y${y.toFixed(2)} F4000`, { timeout: 20000 })
            const out = await this.command('G30', { timeout: 30000 })
            raw.push(`G30 @ X${x.toFixed(1)} Y${y.toFixed(1)} → ${out.join(' | ') || '(keine Antwort)'}`)
            const parsed = parseProbeLines(out)
            points.push(parsed.length ? parsed[parsed.length - 1] : { x, y, z: 0 })
            this.emit('probe-progress', { done: points.length, total: cols * rows })
          }
        }
        await this.command('G1 Z10 F600')
        this.logProbe('G30-Raster', raw)
        mesh = meshFromPoints(points, profile)
      }

      if (!mesh) throw new Error('Der Drucker hat keine Messwerte geliefert (kein ABL aktiv?).')
      mesh.source = !area && mode === 'auto' ? 'firmware' : 'manual'
      // Unter dem Profil ablegen, das gerade verbunden ist
      this.mesh = saveMesh(profile.id, mesh)
      mesh = this.mesh
      this.emit('mesh', mesh)
      try {
        recordMesh(this.profileId, mesh)
      } catch {
        // Verlauf ist optional
      }
      this.push({ message: 'Bett vermessen' })
      return mesh
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Messung fehlgeschlagen'
      this.push({ message: msg })
      throw err
    }
  }

  /** G30-Raster exakt im Modellbereich (Marlin ohne Firmware-Mesh-Zwang). */
  private async probeSerialArea(area: Area, cols: number, rows: number): Promise<BedMesh> {
    await this.command('G28', { timeout: 90000 })
    await this.command('G1 Z8 F600')
    const points: ProbePoint[] = []
    const cCount = Math.max(2, cols)
    const rCount = Math.max(2, rows)
    const raw: string[] = ['G28']

    for (let r = 0; r < rCount; r++) {
      for (let c = 0; c < cCount; c++) {
        const x = area.x0 + ((area.x1 - area.x0) * c) / (cCount - 1)
        const y = area.y0 + ((area.y1 - area.y0) * r) / (rCount - 1)
        await this.command(`G1 X${x.toFixed(2)} Y${y.toFixed(2)} F4000`, { timeout: 20000 })
        const out = await this.command('G30', { timeout: 30000 })
        raw.push(`G30 @ X${x.toFixed(1)} Y${y.toFixed(1)} → ${out.join(' | ') || '(keine Antwort)'}`)
        const parsed = parseProbeLines(out)
        points.push(parsed.length ? parsed[parsed.length - 1] : { x, y, z: 0 })
        this.emit('probe-progress', { done: points.length, total: cCount * rCount })
      }
    }
    await this.command('G1 Z10 F600')
    this.logProbe('G30-Raster (Modellbereich)', raw)
    const mesh = meshFromPoints(points, printerById(this.profileId))
    if (!mesh) throw new Error('Der Sensor hat keine Messwerte geliefert.')
    mesh.source = 'manual'
    return mesh
  }

  /** Bett und Düse für eine genaue Messung auf Temperatur bringen. */
  async heatForProbe(nozzle: number, bed: number): Promise<void> {
    if (!this.connected) throw new Error('Kein Drucker verbunden.')
    this.push({ message: 'Aufheizen vor der Messung …' })
    await this.command(`M140 S${bed}`, { timeout: 15000 })
    await this.command(`M190 S${bed}`, { timeout: 900000 })
    await this.command(`M104 S${nozzle}`, { timeout: 15000 })
    await this.command(`M109 S${nozzle}`, { timeout: 900000 })
  }

  /** Rohantworten der Messung mitschreiben — ohne sie ist ein Fehlschlag am Gerät nicht zu deuten. */
  private logProbe(mode: string, lines: string[]): void {
    const clean = lines.map((l) => l.replace(/\s+$/, '')).filter((l) => l.length > 0).slice(0, 600)
    this.probeLog = { at: Date.now(), mode, printerId: this.profileId, lines: clean }
    for (const line of clean) console.log(`[Messung ${mode}] ${line}`)
  }

  private async probeKlipper(area?: Area): Promise<BedMesh> {
    if (!this.klipper) throw new Error('Kein Klipper verbunden.')
    this.push({ message: area ? 'Klipper vermisst den Modellbereich …' : 'Klipper vermisst das Bett …' })
    const before = JSON.stringify(this.mesh?.z ?? [])
    // Delta: Raster auf den Kreis begrenzen und in die Mitte koordinieren
    const profile = printerById(this.profileId)
    const { dx, dy } = machineOffset(profile)
    const box = area ? clampToDelta(profile, area) : null
    const script = box
      ? `BED_MESH_CALIBRATE AREA_START=${(box.x0 + dx).toFixed(1)},${(box.y0 + dy).toFixed(1)} AREA_END=${(box.x1 + dx).toFixed(1)},${(box.y1 + dy).toFixed(1)}`
      : 'BED_MESH_CALIBRATE'
    await this.klipper.gcode(script)
    const deadline = Date.now() + 240000
    while (Date.now() < deadline) {
      await delay(2500)
      const mesh = await this.klipper.mesh()
      if (mesh && JSON.stringify(mesh.z) !== before) {
        this.logProbe('BED_MESH_CALIBRATE', [script, ...mesh.z.map((row) => row.map((v) => v.toFixed(3)).join(' '))])
        this.mesh = saveMesh(this.profileId, mesh)
        this.emit('mesh', this.mesh)
        this.push({ message: 'Bett vermessen (Klipper)' })
        return mesh
      }
    }
    throw new Error('Klipper hat kein neues Mesh geliefert (Timeout).')
  }

  // ---------- Z-Korrektur ----------

  async babystep(delta: number): Promise<number> {
    const rounded = Math.round(delta * 1000) / 1000
    if (this.klipper) {
      await this.klipper.gcode(`SET_GCODE_OFFSET Z_ADJUST=${rounded} MOVE=1`)
      this.push({ babystep: Math.round((this.status.babystep + rounded) * 1000) / 1000 })
      return this.status.babystep
    }
    const before = this.status.babystep
    await this.command(`M290 Z${rounded}`, { timeout: 8000 })
    // Marlin meldet den neuen Babystep nicht zuverlässig als Echo zurück.
    // Nur wenn kein Echo kam, den relativen Schritt selbst mitführen – sonst
    // würde derselbe Schritt doppelt gezählt.
    if (Math.abs(this.status.babystep - before) < 1e-6) {
      this.push({ babystep: Math.round((before + rounded) * 1000) / 1000 })
    }
    return this.status.babystep
  }

  async resetBabystep(): Promise<void> {
    const current = this.status.babystep
    if (Math.abs(current) < 1e-4) return
    if (this.klipper) {
      await this.klipper.gcode(`SET_GCODE_OFFSET Z_ADJUST=${-current} MOVE=1`)
      this.push({ babystep: 0 })
      return
    }
    await this.command(`M290 Z${-current}`, { timeout: 8000 })
    this.push({ babystep: 0 })
  }

  async setZOffset(value: number, persist: boolean): Promise<void> {
    const v = Math.round(value * 1000) / 1000
    if (this.klipper) {
      await this.klipper.gcode(`SET_GCODE_OFFSET Z=${v} MOVE=1`)
      if (persist) await this.klipper.gcode('SAVE_CONFIG')
    } else {
      await this.command(`M206 Z${v}`, { timeout: 10000 })
      if (persist) await this.command('M500', { timeout: 20000 })
    }
    this.push({ zOffset: v })
  }

  async enableMesh(): Promise<void> {
    if (this.klipper) {
      await this.klipper.gcode('BED_MESH_PROFILE LOAD=default')
    } else {
      await this.command('M420 S1', { timeout: 10000 })
    }
    this.logLine('info', 'Firmware-Mesh aktiviert')
  }

  async saveToEeprom(): Promise<void> {
    if (this.klipper) {
      await this.klipper.gcode('SAVE_CONFIG')
      this.logLine('info', 'Klipper-Konfiguration gespeichert (SAVE_CONFIG)')
      return
    }
    await this.command('M500', { timeout: 30000 })
    this.logLine('info', 'Einstellungen im EEPROM gespeichert (M500)')
  }

  // ---------- Steuerung ----------

  async jog(axis: 'X' | 'Y' | 'Z', delta: number, feed = 1800): Promise<void> {
    if (this.klipper) {
      const script = ['G91', `G1 ${axis}${delta} F${feed}`, 'G90'].join('\n')
      await this.klipper.gcode(script)
      return
    }
    await this.command('G91', { timeout: 8000 })
    await this.command(`G1 ${axis}${delta} F${feed}`, { timeout: 20000 })
    await this.command('G90', { timeout: 8000 })
  }

  async setTemp(heater: 'nozzle' | 'bed', value: number): Promise<void> {
    if (this.klipper) {
      const target = heater === 'bed' ? 'heater_bed' : 'extruder'
      await this.klipper.gcode(`SET_HEATER_TEMPERATURE HEATER=${target} TARGET=${value}`)
      return
    }
    await this.command(heater === 'bed' ? `M140 S${value}` : `M104 S${value}`, { timeout: 10000 })
  }

  async motorsOff(): Promise<void> {
    await this.command('M84', { timeout: 10000 })
  }

  async home(): Promise<void> {
    await this.command('G28', { timeout: 120000 })
  }

  // ---------- Z-Nullpunkt ----------

  /**
   * Triggerpunkt der Probe messen. Ein absoluter Düsenabstand lässt sich ohne
   * Referenz (Papier/Fühler) physikalisch nicht bestimmen — der Messwert dient
   * als Basis für die automatische Driftkorrektur gegen eine gespeicherte Referenz.
   */
  async measureZ(samples = 3): Promise<ZMeasurement> {
    if (!this.connected) throw new Error('Kein Drucker verbunden.')
    if (this.octo)
      throw new Error('Die Z-Messung braucht Sensorwerte — OctoPrint liefert sie nicht zurück. Bitte Moonraker oder USB nutzen.')
    const profile = printerById(this.profileId)
    const count = Math.max(1, Math.round(samples))
    const values: number[] = []
    this.push({ message: 'Z-Nullpunkt wird gemessen …' })

    if (this.klipper) {
      for (let i = 0; i < count; i++) {
        await this.klipper.gcode('PROBE')
        const z = await this.klipper.probeZ()
        if (z === null) throw new Error('Klipper liefert keinen Probe-Wert — ist [probe] konfiguriert?')
        values.push(z)
      }
    } else {
      const { x, y } = profile.bed
      await this.command('G28', { timeout: 120000 })
      await this.command('G1 Z10 F600')
      for (let i = 0; i < count; i++) {
        await this.command(`G1 X${(x / 2).toFixed(1)} Y${(y / 2).toFixed(1)} F4000`, { timeout: 20000 })
        const out = await this.command('G30', { timeout: 30000 })
        const parsed = parseProbeLines(out)
        if (!parsed.length) throw new Error('Der Sensor liefert keine Messwerte.')
        values.push(parsed[parsed.length - 1].z)
      }
      await this.command('G1 Z10 F600')
    }

    const mean = values.reduce((a, b) => a + b, 0) / values.length
    const info = this.klipper ? await this.klipper.probeInfo() : null
    const measurement: ZMeasurement = {
      samples: values.map((v) => Math.round(v * 1000) / 1000),
      mean: Math.round(mean * 1000) / 1000,
      spread: Math.round((Math.max(...values) - Math.min(...values)) * 1000) / 1000,
      offset: Math.round(this.status.zOffset * 1000) / 1000,
      probe: info?.hasProbe
        ? info.kind.startsWith('load_cell') || info.virtualEndstop
          ? 'strain-gauge'
          : info.kind.startsWith('bltouch')
            ? 'bltouch'
            : info.kind.startsWith('probe_eddy')
              ? 'inductive'
              : 'probe'
        : profile.probe,
      // Wägezellen/Nozzle-Kontakt: der Triggerpunkt ist die Bettfläche, der Offset also bauartbedingt null
      inherent: info ? info.virtualEndstop || info.kind.startsWith('load_cell') : profile.homesWithProbe,
    }
    this.push({
      message: `Z-Nullpunkt ${measurement.mean.toFixed(3)} mm · Streuung ${measurement.spread.toFixed(3)} mm`,
    })
    return measurement
  }

  /** Offset relativ nachführen (Klipper live, Marlin per M290/Babystep). */
  async applyZDelta(delta: number): Promise<void> {
    if (!this.connected) throw new Error('Kein Drucker verbunden.')
    const d = Math.round(delta * 1000) / 1000
    if (!Number.isFinite(d) || Math.abs(d) < 0.005) return
    if (this.klipper) {
      await this.klipper.gcode(`SET_GCODE_OFFSET Z_ADJUST=${d} MOVE=0`)
    } else {
      await this.command(`M290 Z${d}`, { timeout: 10000 })
    }
    this.push({ message: `Z-Offset um ${d > 0 ? '+' : ''}${d} mm nachgeführt` })
  }

  // ---------- Drucken ----------

  /** Kein zweiter Start, solange der letzte Druck noch läuft. */
  private assertCanStart(): void {
    if (this.status.print.state === 'printing' || this.status.print.state === 'paused') {
      throw new Error(
        `Es läuft bereits ein Druck (${this.status.print.file ?? 'unbekannte Datei'}). ` +
          'Bitte zuerst beenden oder pausieren.',
      )
    }
  }

  /**
   * Der AD5X (Z-Mod) ignoriert Moonrakers print/start. Sein SDCARD_PRINT_FILE-
   * Makro prüft die Datei und startet sie erst dann. Andere Klipper-Drucker
   * behalten den normalen Upload-mit-Start bei.
   *
   * Bei AD5X wird erst nach bestätigtem `print_stats` als gestartet gemeldet;
   * ein HTTP-Erfolg des Makros allein reicht nicht.
   */
  private async uploadKlipper(name: string, gcode: string, start: boolean): Promise<void> {
    if (!start) {
      await this.klipper!.upload(name, gcode, false)
      return
    }
    this.assertCanStart()
    if (this.startPending) {
      throw new Error('Ein Druckstart wird bereits vorbereitet — bitte kurz warten.')
    }
    this.startPending = true
    try {
      const viaAd5xMacro = this.profileId === 'flashforge-ad5x'
      // Nicht auf upload?print=true verlassen: Bei einer älteren complete-Datei
      // kann Moonraker den Upload annehmen, ohne den neuen Druck zu starten.
      await this.klipper!.upload(name, gcode, false)
      if (viaAd5xMacro) {
        await this.klipper!.startFileViaMacro(name)
      } else {
        await this.klipper!.startPrint(name)
        await this.klipper!.waitForPrintStart(name)
      }
    } finally {
      this.startPending = false
    }
  }

  /**
   * G-Code an Moonraker/OctoPrint senden — mit start=false nur ablegen,
   * mit start=true direkt drucken. USB-Streaming läuft über print().
   */
  async uploadGcode(name: string, gcode: string, start: boolean): Promise<string> {
    const safeName = name.replace(/[^\w.-]+/g, '_')
    if (this.klipper) {
      await this.uploadKlipper(safeName, gcode, start)
      this.logLine('info', `G-Code an Moonraker übertragen${start ? ' und gestartet' : ''}: ${safeName}`)
      if (start) this.push({ print: { state: 'printing', file: safeName, progress: 0, etaSeconds: null } })
      return safeName
    }
    if (this.octo) {
      await this.octo.upload(safeName, gcode, start)
      this.logLine('info', `G-Code an OctoPrint übertragen${start ? ' und gestartet' : ''}: ${safeName}`)
      if (start) this.push({ print: { state: 'printing', file: safeName, progress: 0, etaSeconds: null } })
      return safeName
    }
    throw new Error('Kein Netzwerkdrucker verbunden (Moonraker oder OctoPrint).')
  }

  async print(gcode: string, name: string): Promise<void> {
    if (this.klipper) {
      const safeName = name.replace(/[^\w.-]+/g, '_')
      await this.uploadKlipper(safeName, gcode, true)
      this.push({ print: { state: 'printing', file: safeName, progress: 0, etaSeconds: null } })
      return
    }
    if (this.octo) {
      const safeName = name.replace(/[^\w.-]+/g, '_')
      await this.octo.upload(safeName, gcode, true)
      this.push({ print: { state: 'printing', file: safeName, progress: 0, etaSeconds: null } })
      this.logLine('info', `G-Code an OctoPrint übertragen und gestartet: ${safeName}`)
      return
    }
    if (!this.transport) throw new Error('Kein Drucker verbunden.')
    if (this.streamer?.isActive) throw new Error('Es läuft bereits ein Druck.')

    const streamer = new GcodeStreamer((line) => {
      if (!this.transport) throw new Error('Verbindung verloren')
      this.transport.send(line)
    })
    this.streamer = streamer
    const startedAt = Date.now()
    const layerMarks = layerMarkOffsets(gcode)

    streamer.onProgress = (p) => {
      const progress = p.total ? p.sent / p.total : 0
      const elapsed = (Date.now() - startedAt) / 1000
      const eta = progress > 0.02 ? Math.max(0, Math.round(elapsed / progress - elapsed)) : null
      const state: PrinterStatus['print']['state'] =
        p.state === 'done'
          ? 'complete'
          : p.state === 'error'
            ? 'error'
            : p.state === 'cancelled'
              ? 'cancelled'
              : p.state
      let currentLayer = 0
      for (const mark of layerMarks) if (mark <= p.sent) currentLayer++
      const layer =
        layerMarks.length > 0
          ? { current: Math.max(1, Math.min(currentLayer, layerMarks.length)), total: layerMarks.length }
          : null

      this.push({
        print: {
          state,
          file: name,
          progress,
          etaSeconds: state === 'printing' || state === 'paused' ? eta : null,
          layer,
          lines: { sent: p.sent, total: p.total },
        },
      })
      if (p.state === 'done' || p.state === 'error' || p.state === 'cancelled') this.streamer = null
    }
    streamer.start(gcode)
  }

  async pausePrint(): Promise<void> {
    if (this.klipper) {
      await this.klipper.pause()
      return
    }
    if (this.octo) {
      await this.octo.pause()
      return
    }
    if (!this.streamer?.isActive) throw new Error('Es läuft kein Druck, der pausiert werden kann.')
    this.streamer.pause()
  }

  async resumePrint(): Promise<void> {
    if (this.klipper) {
      await this.klipper.resume()
      return
    }
    if (this.octo) {
      await this.octo.resume()
      return
    }
    if (!this.streamer?.isPaused) throw new Error('Der Druck ist nicht pausiert.')
    this.streamer.resume()
  }

  async cancelPrint(): Promise<void> {
    if (this.klipper) {
      await this.klipper.cancel()
      return
    }
    if (this.octo) {
      await this.octo.cancel()
      this.push({ print: { state: 'cancelled', file: this.status.print.file, progress: this.status.print.progress, etaSeconds: null } })
      return
    }
    const file = this.status.print.file
    const progress = this.status.print.progress
    this.streamer?.cancel()
    this.streamer = null
    if (this.transport) {
      try {
        this.transport.send('M104 S0')
        this.transport.send('M140 S0')
        this.transport.send('M84')
      } catch {
        /* egal */
      }
    }
    this.push({ print: { state: 'cancelled', file, progress, etaSeconds: null, lines: undefined } })
  }

  async emergencyStop(): Promise<void> {
    if (this.klipper) {
      await this.klipper.emergencyStop()
      this.push({ message: 'NOT-AUS gesendet' })
      return
    }
    if (this.octo) {
      await this.octo.emergencyStop()
      this.push({ message: 'NOT-AUS gesendet' })
      return
    }
    if (!this.transport) throw new Error('Kein Drucker verbunden.')
    this.transport.send('M112')
    this.waiter = null
    this.streamer = null
    this.push({ message: 'NOT-AUS gesendet' })
  }
}

/** Delta: Messraster auf das einbeschriebene Quadrat im Kreis begrenzen. */
function clampToDelta(profile: PrinterProfile, area: Area): Area {
  if (profile.kinematics !== 'delta') return area
  const cx = profile.bed.x / 2
  const cy = profile.bed.y / 2
  const r = (Math.min(profile.bed.x, profile.bed.y) / 2) * Math.SQRT1_2
  return {
    x0: Math.max(area.x0, cx - r),
    y0: Math.max(area.y0, cy - r),
    x1: Math.min(area.x1, cx + r),
    y1: Math.min(area.y1, cy + r),
  }
}

export async function listPorts(): Promise<{ path: string; label: string }[]> {
  const { scanDevices } = await import('./detect.ts')
  const devices = await scanDevices()
  return devices.map((d) => ({ path: d.path, label: d.label }))
}
