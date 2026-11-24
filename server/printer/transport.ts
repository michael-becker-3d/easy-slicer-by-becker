/** Bricht eine Zusage nach `ms` ab — ein hängender Port darf nie blockieren. */
function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (err) => {
        clearTimeout(timer)
        reject(err)
      },
    )
  })
}

export type LineHandler = (line: string) => void

export interface Transport {
  readonly kind: 'serial' | 'simulation'
  readonly label: string
  open(): Promise<void>
  close(): Promise<void>
  send(line: string): void
  onLine(cb: LineHandler): void
  onClose(cb: () => void): void
}

/** Echtes USB-Serial über das optionale Paket `serialport`. */
export class SerialTransport implements Transport {
  readonly kind = 'serial' as const
  readonly label: string
  private port: any = null
  private buffer = ''
  private lineCbs: LineHandler[] = []
  private closeCbs: (() => void)[] = []

  constructor(private path: string, private baud: number) {
    this.label = `${path} @ ${baud}`
  }

  async open(): Promise<void> {
    let mod: any
    try {
      mod = await import('serialport')
    } catch {
      throw new Error(
        'Paket "serialport" ist nicht verfügbar (native Bindung fehlt). Nutze den Simulationsmodus oder installiere serialport neu.',
      )
    }
    const SerialPort = mod.SerialPort ?? mod.default?.SerialPort
    if (!SerialPort) throw new Error('serialport konnte nicht geladen werden.')

    // Kein Konstruktor-Callback: bei autoOpen:false wird er nie aufgerufen und
    // das Warten darauf würde ewig hängen. Geöffnet wird ausschließlich hier.
    this.port = new SerialPort({
      path: this.path,
      baudRate: this.baud,
      // Feste 8N1-Einstellungen: CH340/CH341-Boards erwarten sie so.
      dataBits: 8,
      stopBits: 1,
      parity: 'none',
      rtscts: false,
      autoOpen: false,
    })
    await withTimeout(
      new Promise<void>((resolve, reject) => {
        this.port.open((err: Error | null) => (err ? reject(err) : resolve()))
      }),
      4000,
      `Port ${this.path} ließ sich nicht öffnen (Zeitüberschreitung). Läuft noch ein anderes Programm darauf?`,
    )
    this.port.on('data', (chunk: Buffer) => this.handleData(chunk.toString('utf8')))
    this.port.on('close', () => this.closeCbs.forEach((cb) => cb()))
    this.port.on('error', (err: Error) => this.lineCbs.forEach((cb) => cb(`!! ${err.message}`)))

    // DTR/RTS setzen: Arduino-/Marlin-Boards (auch über CH340) booten beim
    // Öffnen des Ports neu. Ohne diese Leitungen bleibt der Drucker stumm.
    await withTimeout(
      new Promise<void>((resolve) => {
        try {
          this.port.set({ dtr: true, rts: true }, () => resolve())
        } catch {
          resolve()
        }
      }),
      2000,
      'DTR/RTS ließen sich nicht setzen.',
    ).catch(() => undefined)
    await withTimeout(
      new Promise<void>((resolve) => {
        try {
          this.port.flush(() => resolve())
        } catch {
          resolve()
        }
      }),
      2000,
      'Puffer ließ sich nicht leeren.',
    ).catch(() => undefined)
    // Reset abwarten, sonst geht das erste M115 im Bootvorgang verloren.
    await new Promise((r) => setTimeout(r, 1800))
    this.buffer = ''
  }

  private handleData(text: string) {
    this.buffer += text
    const parts = this.buffer.split(/\r?\n/)
    this.buffer = parts.pop() ?? ''
    for (const line of parts) {
      const clean = line.trim()
      if (clean) this.lineCbs.forEach((cb) => cb(clean))
    }
  }

  async close(): Promise<void> {
    if (this.port?.isOpen) {
      await new Promise<void>((resolve) => this.port.close(() => resolve()))
    }
    this.port = null
  }

  send(line: string) {
    if (!this.port?.isOpen) throw new Error('Serielle Verbindung ist geschlossen.')
    this.port.write(line + '\n')
  }

  onLine(cb: LineHandler) { this.lineCbs.push(cb) }
  onClose(cb: () => void) { this.closeCbs.push(cb) }
}

/**
 * Marlin-Simulation: verhält sich wie ein älterer Drucker (Vyper/Ender),
 * inkl. G29-Messung, M420-V-Meshausgabe und Babystepping.
 */
export class MockTransport implements Transport {
  readonly kind = 'simulation' as const
  readonly label = 'Simulation (Marlin)'
  private lineCbs: LineHandler[] = []
  private closeCbs: (() => void)[] = []
  private meshValues: number[][] = []
  private meshCols = 7
  private meshRows = 7
  private babystep = 0
  private pos = { x: 0, y: 0, z: 0 }
  private temps = { no: 22, noT: 0, bed: 21, bedT: 0 }
  private timer: ReturnType<typeof setInterval> | null = null
  private open_ = false

  async open(): Promise<void> {
    this.open_ = true
    this.timer = setInterval(() => this.tick(), 700)
    this.emit('start')
  }

  async close(): Promise<void> {
    this.open_ = false
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.closeCbs.forEach((cb) => cb())
  }

  private tick() {
    const step = (cur: number, target: number, rate: number) =>
      cur < target ? Math.min(target, cur + rate) : Math.max(target, cur - rate)
    this.temps.no = step(this.temps.no, this.temps.noT, 2.4)
    this.temps.bed = step(this.temps.bed, this.temps.bedT, 1.1)
    this.emit(
      `T:${this.temps.no.toFixed(2)} /${this.temps.noT.toFixed(2)} B:${this.temps.bed.toFixed(2)} /${this.temps.bedT.toFixed(2)} @:0 B@:0`,
    )
  }

  private emit(line: string) {
    for (const cb of this.lineCbs) cb(line)
  }

  private later(ms: number, fn: () => void) {
    setTimeout(fn, ms)
  }

  send(raw: string) {
    if (!this.open_) return
    const line = raw.trim()
    if (!line) return
    const upper = line.toUpperCase()

    if (upper.startsWith('M115')) {
      this.emit('FIRMWARE_NAME:Marlin 2.0.9.1 (Easy-Slicer Simulation) SOURCE_CODE_URL:github.com/MarlinFirmware/Marlin')
      this.later(15, () => this.emit('ok'))
      return
    }
    if (upper.startsWith('M105')) {
      this.emit(
        `T:${this.temps.no.toFixed(2)} /${this.temps.noT.toFixed(2)} B:${this.temps.bed.toFixed(2)} /${this.temps.bedT.toFixed(2)}`,
      )
      this.later(5, () => this.emit('ok'))
      return
    }
    if (upper.startsWith('M114')) {
      this.emit(`X:${this.pos.x.toFixed(2)} Y:${this.pos.y.toFixed(2)} Z:${this.pos.z.toFixed(2)} E:0.00`)
      this.later(5, () => this.emit('ok'))
      return
    }
    if (upper.startsWith('M104')) {
      const m = line.match(/S\s*([\d.]+)/i)
      if (m) this.temps.noT = parseFloat(m[1])
      this.later(10, () => this.emit('ok'))
      return
    }
    if (upper.startsWith('M140')) {
      const m = line.match(/S\s*([\d.]+)/i)
      if (m) this.temps.bedT = parseFloat(m[1])
      this.later(10, () => this.emit('ok'))
      return
    }
    if (upper.startsWith('M190') || upper.startsWith('M109')) {
      const isBed = upper.startsWith('M190')
      const m = line.match(/S\s*([\d.]+)/i)
      const target = m ? parseFloat(m[1]) : 0
      if (isBed) this.temps.bedT = target
      else this.temps.noT = target
      this.later(120, () => this.emit('ok'))
      return
    }
    if (upper.startsWith('G28')) {
      this.emit('echo:Homee...')
      this.later(180, () => {
        this.pos = { x: 0, y: 0, z: 0 }
        this.emit('ok')
      })
      return
    }
    if (upper.startsWith('G29')) {
      this.probe()
      return
    }
    if (upper.startsWith('M420')) {
      if (/V/i.test(line)) {
        this.dumpMesh()
      } else {
        this.later(10, () => this.emit('ok'))
      }
      return
    }
    if (upper.startsWith('G30')) {
      const m = line.match(/X\s*(-?[\d.]+)\s*Y\s*(-?[\d.]+)/i)
      const x = m ? parseFloat(m[1]) : this.pos.x
      const y = m ? parseFloat(m[2]) : this.pos.y
      const z = this.warp(x, y)
      this.later(90, () => {
        this.emit(`Bed X: ${x.toFixed(2)} Y: ${y.toFixed(2)} Z: ${z.toFixed(3)}`)
        this.emit('ok')
      })
      return
    }
    if (upper.startsWith('M290')) {
      const m = line.match(/Z\s*(-?[\d.]+)/i)
      if (m) this.babystep += parseFloat(m[1])
      this.later(8, () => {
        this.emit(`echo:Babystep: ${this.babystep.toFixed(3)}`)
        this.emit('ok')
      })
      return
    }
    if (upper.startsWith('M206')) {
      this.later(8, () => {
        this.emit('echo:Home-Offset gesetzt')
        this.emit('ok')
      })
      return
    }
    if (upper.startsWith('M500')) {
      this.later(60, () => {
        this.emit('echo:Settings Stored (EEPROM)')
        this.emit('ok')
      })
      return
    }
    if (upper.startsWith('M503')) {
      this.later(20, () => {
        this.emit('echo:; EEPROM Settings')
        this.emit('echo:  M92 X80.00 Y80.00 Z400.00 E420.00')
        this.emit('echo:  M206 X0.00 Y0.00 Z0.00')
        this.emit('ok')
      })
      return
    }
    if (upper.startsWith('M112')) {
      this.emit('echo:Not-Aus!')
      this.later(30, () => this.emit('ok'))
      return
    }
    if (upper.startsWith('M106') || upper.startsWith('M107')) {
      this.later(6, () => this.emit('ok'))
      return
    }
    if (upper.startsWith('G0') || upper.startsWith('G1')) {
      const g = (axis: string) => {
        const m = line.match(new RegExp(`${axis}\\s*(-?[\\d.]+)`, 'i'))
        return m ? parseFloat(m[1]) : null
      }
      const x = g('X'), y = g('Y'), z = g('Z')
      const dist = Math.hypot(x ?? this.pos.x - this.pos.x, y ?? this.pos.y - this.pos.y) || 20
      this.later(Math.min(60, 10 + dist), () => {
        if (x !== null) this.pos.x = x
        if (y !== null) this.pos.y = y
        if (z !== null) this.pos.z = z
        this.emit('ok')
      })
      return
    }

    // Alles andere: brav bestätigen
    this.later(6, () => this.emit('ok'))
  }

  private warp(x: number, y: number): number {
    const cx = 122.5, cy = 122.5
    return 0.000012 * ((x - cx) ** 2 + (y - cy) ** 2) - 0.18 + (Math.random() - 0.5) * 0.01
  }

  private probe() {
    const cols = this.meshCols, rows = this.meshRows
    const margin = 15
    const span = 245 - margin * 2
    this.meshValues = []
    this.emit('echo:G29 Auto Bed Leveling')
    let total = cols * rows
    let done = 0
    const step = () => {
      if (!this.open_) return
      const r = Math.floor(done / cols)
      const c = done % cols
      const x = margin + (span * c) / (cols - 1)
      const y = margin + (span * r) / (rows - 1)
      if (c === 0) this.meshValues.push([])
      const z = this.warp(x, y)
      this.meshValues[r].push(z)
      this.emit(`Bed X: ${x.toFixed(2)} Y: ${y.toFixed(2)} Z: ${z.toFixed(3)}`)
      done++
      if (done < total) this.later(45, step)
      else {
        this.later(80, () => {
          this.emit('echo:Probing done.')
          this.emit('ok')
        })
      }
    }
    this.later(60, step)
  }

  private dumpMesh() {
    if (!this.meshValues.length) {
      this.later(10, () => {
        this.emit('echo:No mesh stored')
        this.emit('ok')
      })
      return
    }
    this.emit(`Num X,Y: ${this.meshCols},${this.meshRows}`)
    this.emit('Z offset: 0.00000')
    this.emit('Measured points:')
    const header = ['      ', ...Array.from({ length: this.meshCols }, (_, i) => String(i).padStart(8))]
    this.emit(header.join(' '))
    this.meshValues.forEach((row, r) => {
      this.emit([String(r).padStart(4), ...row.map((v) => (v >= 0 ? '+' : '') + v.toFixed(5).padStart(7))].join(' '))
    })
    this.later(10, () => this.emit('ok'))
  }

  onLine(cb: LineHandler) { this.lineCbs.push(cb) }
  onClose(cb: () => void) { this.closeCbs.push(cb) }
}
