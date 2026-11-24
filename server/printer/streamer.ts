export type StreamState = 'printing' | 'paused' | 'done' | 'error' | 'cancelled'

export type StreamProgress = { sent: number; total: number; state: StreamState; estimate?: number }

/**
 * Schickt G-Code zeilenweise mit einem Gleitfenster (Standard: 4 Zeilen
 * voraus), damit Marlin nicht überläuft und der Druck flüssig bleibt.
 */
export class GcodeStreamer {
  private lines: string[] = []
  private idx = 0
  private outstanding = 0
  private window = 4
  private active = false
  private paused = false

  onProgress: ((p: StreamProgress) => void) | null = null

  constructor(private send: (line: string) => void) {}

  get isActive(): boolean {
    return this.active
  }

  get isPaused(): boolean {
    return this.paused
  }

  /** Noch nicht bestätigte Zeilen — solange > 0 gehört das nächste "ok" dem Stream. */
  get pending(): number {
    return this.outstanding
  }

  start(gcode: string) {
    this.lines = gcode
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith(';'))
    this.idx = 0
    this.outstanding = 0
    this.active = true
    this.paused = false
    this.emit('printing')
    this.pump()
  }

  ack() {
    if (!this.active) return
    this.outstanding = Math.max(0, this.outstanding - 1)
    this.pump()
  }

  fail(message: string) {
    if (!this.active) return
    this.active = false
    this.outstanding = 0
    this.emit('error', message)
  }

  pause() {
    this.paused = true
    this.emit('paused')
  }

  resume() {
    if (!this.active) return
    this.paused = false
    this.emit('printing')
    this.pump()
  }

  cancel() {
    this.active = false
    this.outstanding = 0
    this.paused = false
    this.emit('cancelled')
  }

  private pump() {
    if (!this.active || this.paused) return
    while (this.outstanding < this.window && this.idx < this.lines.length) {
      const line = this.lines[this.idx++]
      try {
        this.send(line)
      } catch (err) {
        this.fail(err instanceof Error ? err.message : 'Senden fehlgeschlagen')
        return
      }
      this.outstanding++
    }
    if (this.idx >= this.lines.length && this.outstanding === 0) {
      this.active = false
      this.emit('done')
      return
    }
    this.emit(this.paused ? 'paused' : 'printing')
  }

  private emit(state: StreamState, message?: string) {
    this.onProgress?.({
      sent: this.idx,
      total: this.lines.length,
      state,
      estimate: undefined,
    })
    void message
  }
}
