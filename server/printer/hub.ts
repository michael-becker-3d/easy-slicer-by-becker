import type { BedMesh, ConsoleLine, PrinterStatus } from '../../shared/types.ts'
import { PrinterManager } from './manager.ts'

export type HubPrinterSnapshot = {
  id: string
  status: PrinterStatus
  mesh: BedMesh | null
  log: ConsoleLine[]
}

/**
 * Ein Manager je Drucker. Die Verbindungen und ihr Polling laufen unabhängig
 * weiter, auch wenn die Oberfläche auf einen anderen Drucker umschaltet.
 */
export class PrinterHub {
  private readonly managers = new Map<string, PrinterManager>()
  private readonly defaultId: string
  private readonly onCreate?: (id: string, manager: PrinterManager) => void
  selectedId: string

  constructor(options: {
    defaultId: string
    onCreate?: (id: string, manager: PrinterManager) => void
  }) {
    this.defaultId = options.defaultId
    this.selectedId = options.defaultId
    this.onCreate = options.onCreate
  }

  ensure(id: string): PrinterManager {
    const clean = id.trim()
    if (!clean) {
      if (this.managers.size === 0) return this.ensure(this.defaultId)
      return this.selected
    }
    let manager = this.managers.get(clean)
    if (!manager) {
      manager = new PrinterManager(clean)
      this.managers.set(clean, manager)
      this.onCreate?.(clean, manager)
    }
    return manager
  }

  select(id: string): PrinterManager {
    const clean = id.trim()
    if (!clean) throw new Error('Drucker-ID fehlt.')
    const manager = this.ensure(clean)
    this.selectedId = clean
    return manager
  }

  resolve(id?: unknown): PrinterManager {
    const clean = typeof id === 'string' ? id.trim() : ''
    return clean ? this.ensure(clean) : this.selected
  }

  get selected(): PrinterManager {
    return this.ensure(this.selectedId)
  }

  snapshot(): HubPrinterSnapshot[] {
    return [...this.managers.entries()].map(([id, manager]) => ({
      id,
      status: manager.status,
      mesh: manager.mesh,
      log: manager.log.slice(-120),
    }))
  }

  async disconnectAll(): Promise<void> {
    await Promise.all([...this.managers.values()].map((manager) => manager.disconnect().catch(() => undefined)))
  }
}
