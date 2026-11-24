import type { BedMesh, PrinterStatus } from '../../shared/types.ts'

export type OctoSnapshot = {
  state: PrinterStatus['print']['state']
  file: string | null
  progress: number
  etaSeconds: number | null
  temps: { nozzle: number; nozzleTarget: number; bed: number; bedTarget: number }
  position: { x: number; y: number; z: number } | null
}

/**
 * OctoPrint über die dokumentierte REST-API (X-Api-Key).
 * Grenze: OctoPrint gibt weder Bett-Mesh noch Probe-Werte zurück — dafür
 * braucht es Moonraker (Klipper) oder USB.
 */
export class OctoPrintClient {
  readonly baseUrl: string

  constructor(input: string, private apiKey = '') {
    this.baseUrl = OctoPrintClient.normalize(input)
  }

  /** "192.168.1.50:5000" → "http://192.168.1.50:5000" */
  static normalize(input: string): string {
    let url = input.trim()
    if (!/^https?:\/\//i.test(url)) url = `http://${url}`
    return url.replace(/\/+$/, '')
  }

  private async req(path: string, init: RequestInit = {}): Promise<any> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 12000)
    try {
      const headers: Record<string, string> = { ...(init.headers as Record<string, string> | undefined) }
      if (this.apiKey) headers['X-Api-Key'] = this.apiKey
      const res = await fetch(`${this.baseUrl}${path}`, { ...init, headers, signal: controller.signal })
      const text = await res.text()
      if (res.status === 401 || res.status === 403) throw new Error('API-Key fehlt oder ist falsch.')
      if (!res.ok) {
        let detail = ''
        try {
          detail = (JSON.parse(text) as { error?: string }).error ?? ''
        } catch {
          detail = text.slice(0, 120)
        }
        throw new Error(`OctoPrint HTTP ${res.status}${detail ? `: ${detail}` : ''}`)
      }
      if (!text) return {}
      try {
        return JSON.parse(text)
      } catch {
        return { raw: text }
      }
    } finally {
      clearTimeout(timer)
    }
  }

  /**
   * Prüft den API-Key gegen einen geschützten Endpunkt. `/api/version` ist
   * öffentlich und taugt dafür nicht — ohne Key würde jede Verbindung als
   * erfolgreich gelten, während Status und Steuerung still scheitern.
   */
  async verifyKey(): Promise<void> {
    if (!this.apiKey) {
      throw new Error('API-Key fehlt — OctoPrint verlangt ihn für Status und Steuerung (Einstellungen → API).')
    }
    await this.req('/api/job')
  }

  async version(): Promise<{ server: string; api: string }> {
    const data = await this.req('/api/version')
    return {
      server: String(data.server ?? data.text ?? 'unbekannt'),
      api: String(data.api ?? ''),
    }
  }

  async status(): Promise<OctoSnapshot> {
    const [printer, job] = await Promise.all([
      this.req('/api/printer?exclude=history').catch(() => null),
      this.req('/api/job').catch(() => null),
    ])

    const temps = printer?.temperature ?? {}
    const tool = temps.tool0 ?? {}
    const bed = temps.bed ?? {}
    const flags = printer?.state?.flags ?? {}
    const name = job?.job?.file?.name ? String(job.job.file.name) : null

    const completion = Number(job?.progress?.completion ?? 0)
    const progress = Number.isFinite(completion) ? Math.min(1, Math.max(0, completion / 100)) : 0
    const left = Number(job?.progress?.printTimeLeft ?? NaN)

    const state: PrinterStatus['print']['state'] = flags.printing
      ? 'printing'
      : flags.paused
        ? 'paused'
        : flags.error || flags.closedOrError
          ? 'error'
          : name && progress >= 0.999
            ? 'complete'
            : 'idle'

    return {
      state,
      file: name,
      progress,
      etaSeconds: Number.isFinite(left) && left > 0 ? Math.round(left) : null,
      temps: {
        nozzle: Number(tool.actual ?? 0),
        nozzleTarget: Number(tool.target ?? 0),
        bed: Number(bed.actual ?? 0),
        bedTarget: Number(bed.target ?? 0),
      },
      position: null,
    }
  }

  async gcode(script: string): Promise<void> {
    const commands = script
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
    if (!commands.length) return
    await this.req('/api/printer/command', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commands }),
    })
  }

  async upload(name: string, gcode: string, start: boolean): Promise<void> {
    const form = new FormData()
    form.append('file', new Blob([gcode], { type: 'text/plain' }), name)
    form.append('select', 'true')
    form.append('print', start ? 'true' : 'false')
    await this.req('/api/files/local', { method: 'POST', body: form })
  }

  private async jobCommand(body: Record<string, unknown>): Promise<void> {
    // Dokumentiert ist POST /api/job (Singular) — /api/jobs gibt es nicht
    await this.req('/api/job', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  }

  async pause(): Promise<void> {
    await this.jobCommand({ command: 'pause', action: 'pause' })
  }

  async resume(): Promise<void> {
    await this.jobCommand({ command: 'pause', action: 'resume' })
  }

  async cancel(): Promise<void> {
    await this.jobCommand({ command: 'cancel' })
  }

  async emergencyStop(): Promise<void> {
    await this.gcode('M112')
  }

  async mesh(): Promise<BedMesh | null> {
    return null
  }

  async probeZ(): Promise<number | null> {
    return null
  }

  async probeInfo(): Promise<{ hasProbe: boolean; virtualEndstop: boolean; kind: string } | null> {
    return null
  }
}
