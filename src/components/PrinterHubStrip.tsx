import type { PrinterStatus } from '../../shared/types.ts'

type HubPrinter = {
  id: string
  name: string
  brand: string
  active: boolean
  detail: string
  studio: number
  model: string | null
}

function stateText(status: PrinterStatus | undefined): string {
  if (!status) return 'nicht verbunden'
  if (status.connection === 'connecting') return 'verbindet …'
  if (status.connection === 'error') return status.message ?? 'Fehler'
  if (status.connection !== 'connected') return 'nicht verbunden'
  const print = status.print
  if (print.state === 'printing') {
    return `${Math.round(print.progress * 100)} %${print.layer ? ` · Schicht ${print.layer.current}/${print.layer.total}` : ''}`
  }
  if (print.state === 'paused') return 'pausiert'
  if (print.state === 'complete') return 'fertig'
  if (print.state === 'error') return 'Druckfehler'
  return 'bereit'
}

export function PrinterHubStrip({
  printers,
  statuses,
  onSelect,
  onSettings,
  onPanes,
}: {
  printers: HubPrinter[]
  statuses: Record<string, PrinterStatus>
  onSelect: (id: string) => void
  /** Öffnet die Druckereinstellungen direkt für dieses Studio. */
  onSettings: (id: string) => void
  onPanes?: () => void
}) {
  if (printers.length === 0) return null
  return (
    <div className="shrink-0 border-b border-line/50 bg-ink-950/35 px-3 py-1">
      {/* Der absolut platzierte Knopf bekommt eine gemeinsame rechte Gutter
          im Grid. So bleiben beide Studios gleich breit, statt nur die letzte
          Karte mit einer individuellen Innenabstand-Regel zu verschmälern. */}
      <div className={`relative grid auto-cols-fr grid-flow-col gap-1.5 pb-0.5 ${onPanes ? 'pr-20' : ''}`}>
        {printers.map((printer) => {
          const status = statuses[printer.id]
          const online = status?.connection === 'connected'
          const printing = status?.print.state === 'printing'
          return (
            <div
              key={printer.id}
              className={`flex min-w-0 items-start gap-1.5 rounded-lg border px-2 py-1 transition ${
                printer.active
                  ? 'border-mint/55 bg-mint/[0.07]'
                  : 'border-line/70 bg-ink-900/45 hover:border-white/25'
              }`}
            >
              <button
                type="button"
                onClick={() => onSelect(printer.id)}
                className="min-w-0 flex-1 text-left"
              >
                <div className="flex items-center gap-1.5">
                  <span
                    className={`h-2 w-2 shrink-0 rounded-full ${
                      online ? (printing ? 'animate-pulse bg-amber' : 'bg-mint') : 'bg-white/20'
                    }`}
                  />
                  <span className="truncate text-[11px] font-semibold text-white/85">{printer.name}</span>
                </div>
                <div className="mt-0.5 flex items-center gap-1.5 text-[9px] leading-tight text-white/40">
                  <span className={`truncate ${online ? 'text-white/65' : 'text-white/30'}`}>{stateText(status)}</span>
                  {online && status && (
                    <span className="tabular ml-auto shrink-0 text-white/35">
                      {status.temps.nozzle.toFixed(0)}° / {status.temps.bed.toFixed(0)}°
                    </span>
                  )}
                </div>
                {printer.model && (
                  <div className="truncate text-[9px] leading-snug text-white/30">Objekt: {printer.model}</div>
                )}
                {printing && status && (
                  <div className="mt-0.5 h-0.5 overflow-hidden rounded-full bg-line/70">
                    <div
                      className="h-full bg-amber"
                      style={{ width: `${Math.max(0, Math.min(100, status.print.progress * 100))}%` }}
                    />
                  </div>
                )}
              </button>
              <div className="flex shrink-0 items-center gap-1 pt-0.5">
                <button
                  type="button"
                  onClick={() => onSettings(printer.id)}
                  title={`Druckereinstellungen für ${printer.name}`}
                  aria-label={`Druckereinstellungen für ${printer.name} öffnen`}
                  className="grid h-5 w-5 place-items-center rounded-md border border-line/70 bg-ink-900/70 text-[10px] text-white/45 transition hover:border-amber/50 hover:text-amber"
                >
                  ⚙
                </button>
                <span className="rounded bg-white/8 px-1 py-0.5 text-[8px] font-bold tracking-wide text-white/45 uppercase">
                  Studio {printer.studio}
                </span>
                {printer.active && (
                  <span className="rounded bg-mint/15 px-1 py-0.5 text-[8px] font-bold tracking-wide text-mint uppercase">
                    aktiv
                  </span>
                )}
              </div>
            </div>
          )
        })}
        {onPanes && (
          <button
            type="button"
            onClick={onPanes}
            title="Zwei Panes öffnen"
            className="absolute top-1/2 right-3 z-10 -translate-y-1/2 rounded-lg border border-mint/35 bg-ink-950/90 px-2 py-1 text-[9px] font-semibold text-mint/90 shadow-sm transition hover:bg-mint/15"
          >
            2 Panes
          </button>
        )}
      </div>
    </div>
  )
}
