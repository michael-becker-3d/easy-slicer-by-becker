import { useEffect, useState } from 'react'
import type { PrinterStatus, WebUiInfo } from '../../shared/types.ts'
import { formatDuration } from '../../shared/types.ts'

/**
 * Mainsail/Fluidd direkt in der App. Der Server prüft vorher, ob der Webserver
 * Einbetten erlaubt (X-Frame-Options/CSP); wenn nicht, wird klar auf den
 * externen Browser verwiesen statt eine leere Fläche zu zeigen.
 */
export function WebUiPanel({
  info,
  status,
  onPause,
  onResume,
  onCancel,
  onClose,
  embedded = false,
}: {
  info: WebUiInfo
  /** Live-Werte für die schmale Leiste über der eingebetteten Oberfläche */
  status: PrinterStatus
  onPause: () => void
  onResume: () => void
  onCancel: () => void
  onClose: () => void
  /** Im App-Tab statt als modales Overlay anzeigen. */
  embedded?: boolean
}) {
  const [nonce, setNonce] = useState(0)
  const label =
    info.kind === 'mainsail'
      ? 'Mainsail'
      : info.kind === 'fluidd'
        ? 'Fluidd'
        : info.kind === 'octoprint'
          ? 'OctoPrint'
          : 'Web-Oberfläche'
  const { temps, print } = status
  const pct = Math.max(0, Math.min(100, Math.round(print.progress * 100)))
  const jobLabel =
    print.state === 'printing'
      ? 'druckt'
      : print.state === 'paused'
        ? 'pausiert'
        : print.state === 'complete'
          ? 'fertig'
          : print.state === 'error'
            ? 'Fehler'
            : print.state === 'cancelled'
              ? 'abgebrochen'
              : 'kein Job'
  const connectionLabel =
    status.connection !== 'connected'
      ? 'nicht verbunden'
      : status.mode === 'klipper'
        ? 'Klipper'
        : status.mode === 'octoprint'
          ? 'OctoPrint'
          : status.mode === 'simulation'
            ? 'Simulation'
            : (status.port ?? 'USB')

  useEffect(() => {
    setNonce((n) => n + 1)
  }, [info.url])

  const openExternal = () => window.open(info.url, '_blank', 'noopener,noreferrer')

  return (
    <div
      className={
        embedded
          ? 'flex min-h-0 flex-1 flex-col bg-ink-950/95'
          : 'fixed inset-0 z-[60] flex flex-col bg-ink-950/95 backdrop-blur-sm'
      }
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-line/60 px-3 py-2">
        <span className="rounded-full bg-mint/15 px-2 py-0.5 text-[9px] font-bold tracking-wide text-mint uppercase">
          {label}
        </span>
        <span className="min-w-0 flex-1 truncate text-[10px] text-white/40">
          {info.url}
          {info.title ? ` · ${info.title}` : ''}
        </span>
        {print.state === 'printing' && (
          <button
            type="button"
            onClick={onPause}
            className="rounded-lg border border-amber/40 bg-amber/10 px-2 py-1 text-[10px] text-amber transition hover:bg-amber/20"
          >
            Pause
          </button>
        )}
        {print.state === 'paused' && (
          <button
            type="button"
            onClick={onResume}
            className="rounded-lg border border-mint/40 bg-mint/10 px-2 py-1 text-[10px] text-mint transition hover:bg-mint/20"
          >
            Weiter
          </button>
        )}
        {(print.state === 'printing' || print.state === 'paused') && (
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-rose/40 bg-rose/10 px-2 py-1 text-[10px] text-rose transition hover:bg-rose/20"
          >
            Abbrechen
          </button>
        )}
        <button
          type="button"
          onClick={() => setNonce((n) => n + 1)}
          className="rounded-lg border border-line/80 px-2 py-1 text-[10px] text-white/55 transition hover:text-white"
        >
          Neu laden
        </button>
        <button
          type="button"
          onClick={openExternal}
          className="rounded-lg border border-line/80 px-2 py-1 text-[10px] text-white/55 transition hover:text-white"
        >
          Im Browser öffnen
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg border border-line/80 px-2 py-1 text-[10px] text-white/70 transition hover:border-rose/40 hover:text-rose"
        >
          Schließen
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line/60 bg-ink-900/50 px-3 py-1.5 text-[10px] text-white/50">
        <span className="flex items-center gap-1.5">
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              status.connection === 'connected'
                ? 'bg-mint shadow-[0_0_6px] shadow-mint'
                : status.connection === 'error'
                  ? 'bg-rose'
                  : 'bg-white/25'
            }`}
          />
          {connectionLabel}
        </span>
        <span>
          Düse <span className="tabular text-amber">{temps.nozzle.toFixed(0)}°</span>
          <span className="text-white/25">/{temps.nozzleTarget.toFixed(0)}°</span>
        </span>
        <span>
          Bett <span className="tabular text-sky">{temps.bed.toFixed(0)}°</span>
          <span className="text-white/25">/{temps.bedTarget.toFixed(0)}°</span>
        </span>
        <span className="ml-auto flex min-w-0 max-w-[60%] items-center gap-2">
          <span
            className={
              print.state === 'error'
                ? 'text-rose'
                : print.state === 'printing'
                  ? 'text-mint'
                  : 'text-white/40'
            }
          >
            {jobLabel}
          </span>
          {print.state !== 'idle' && (
            <>
              <span className="tabular text-white/60">{pct} %</span>
              {print.etaSeconds !== null && print.etaSeconds > 0 && (
                <span className="whitespace-nowrap text-white/40">noch {formatDuration(print.etaSeconds)}</span>
              )}
              {print.layer && (
                <span className="whitespace-nowrap text-white/40">
                  Schicht {print.layer.current}/{print.layer.total}
                </span>
              )}
              {print.file && <span className="truncate text-white/30">{print.file}</span>}
            </>
          )}
        </span>
      </div>
      <div className="h-0.5 bg-line">
        <div
          className="h-full bg-gradient-to-r from-mint to-amber transition-all"
          style={{ width: `${print.state === 'idle' ? 0 : pct}%` }}
        />
      </div>

      {info.embeddable ? (
        <iframe key={nonce} src={info.url} title={label} className="min-h-0 flex-1 border-0 bg-white" />
      ) : (
        <div className="grid flex-1 place-items-center overflow-y-auto p-6">
          <div className="max-w-md rounded-2xl border border-amber/30 bg-amber/8 p-4 text-center">
            <div className="text-xs font-semibold text-amber">{label} lässt sich nicht einbetten</div>
            <p className="mt-1 text-[10px] leading-snug text-white/50">
              {info.reason ?? 'Der Webserver erlaubt kein Einbetten in ein Fenster.'}
            </p>
            <p className="mt-1 text-[10px] leading-snug text-white/35">
              Die Adresse funktioniert im Browser — dort stehen auch alle Einstellungen (printer.cfg, Makros, Profile)
              zur Verfügung.
            </p>
            <button
              type="button"
              onClick={openExternal}
              className="mt-3 rounded-lg bg-gradient-to-r from-mint to-[#8ef0c8] px-3 py-1.5 text-[11px] font-semibold text-ink-950 transition hover:brightness-110"
            >
              Im Browser öffnen
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
