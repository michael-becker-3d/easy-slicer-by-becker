import type { BuildPlate, FilamentProfile, PrinterProfile, PrinterStatus } from '../../shared/types.ts'
import { FEATURES } from '../../shared/release.ts'
import { isUiScaleId, UI_SCALE_PRESETS, type UiScaleId } from '../uiScale.ts'

export type StudioLayout = 'classic' | 'workshop'

type Props = {
  view: 'studio' | 'multiprint' | 'printer' | 'calibration' | 'gcode' | 'webui'
  onView: (v: 'studio' | 'multiprint' | 'printer' | 'calibration' | 'gcode' | 'webui') => void
  status: PrinterStatus
  printer: PrinterProfile
  filament: FilamentProfile
  plate: BuildPlate
  nozzle: number
  onSetup: () => void
  /** Netzwerkdrucker verbinden (Moonraker/Klipper, OctoPrint) */
  onWeb: () => void
  /** Logdatei anzeigen (die EXE startet ohne Konsolenfenster) */
  onLogs: () => void
  /** Programm beenden */
  onQuit: () => void
  theme: 'dark' | 'light'
  onTheme: () => void
  /** Klassische Ansicht oder Werkstatt-Reihenfolge. */
  layout: StudioLayout
  onLayout: (layout: StudioLayout) => void
  /** Globale UI-Skalierung inklusive Schriftgrößen. */
  uiScale: UiScaleId
  onUiScale: (id: UiScaleId) => void
}

export function TopBar({
  view,
  onView,
  status,
  printer,
  filament,
  plate,
  nozzle,
  onSetup,
  onWeb,
  onLogs,
  onQuit,
  theme,
  onTheme,
  layout,
  onLayout,
  uiScale,
  onUiScale,
}: Props) {
  const online = status.connection === 'connected'
  const label = online
    ? status.mode === 'simulation'
      ? 'Simulation'
      : status.mode === 'klipper'
        ? 'Klipper'
        : status.mode === 'octoprint'
          ? 'OctoPrint'
          : status.port ?? 'USB'
    : status.connection === 'connecting'
      ? 'Verbinde …'
      : 'Nicht verbunden'

  const tabs = ([
    { id: 'studio', label: 'Studio' },
    { id: 'multiprint', label: 'Multiprint' },
    { id: 'gcode', label: 'G-Code' },
    { id: 'calibration', label: 'Kalibrieren' },
    { id: 'printer', label: 'Drucker' },
    { id: 'webui', label: 'Web-UI' },
  ] as const).filter((tab) => FEATURES.webUi || tab.id !== 'webui')

  return (
    <header className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-line/60 px-4 py-2.5">
      <div className="flex items-center gap-2.5">
        <svg viewBox="0 0 40 40" className="h-9 w-9 shrink-0 drop-shadow-[0_2px_10px_rgba(251,191,36,0.25)]" role="img" aria-label="Easy-Slicer Logo">
          <defs>
            <linearGradient id="es-mark" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#5eead4" />
              <stop offset="0.55" stopColor="#fbbf24" />
              <stop offset="1" stopColor="#fb923c" />
            </linearGradient>
          </defs>
          <rect x="1" y="1" width="38" height="38" rx="11" fill="#0b1116" stroke="url(#es-mark)" strokeWidth="1.6" />
          {/* drei Drucklagen übereinander */}
          <path d="M10 24.6 L20 19.2 L30 24.6 L20 30 Z" fill="url(#es-mark)" opacity="0.9" />
          <path d="M10 18.6 L20 13.2 L30 18.6" fill="none" stroke="url(#es-mark)" strokeWidth="2.2" strokeLinecap="round" opacity="0.75" />
          <path d="M14.5 10.5 L25.5 10.5" stroke="url(#es-mark)" strokeWidth="1.8" strokeLinecap="round" opacity="0.45" />
          {/* Schnittlinie des Slicers */}
          <path d="M8 32 L32 8" stroke="#0b1116" strokeWidth="3.2" strokeLinecap="round" />
          <path d="M8 32 L32 8" stroke="url(#es-mark)" strokeWidth="1.1" strokeDasharray="2.5 3" strokeLinecap="round" />
        </svg>
        <div className="leading-none">
          <div className="text-[13px] font-semibold tracking-[0.16em] text-white/90">EASY-SLICER</div>
          <div className="mt-1 text-[9px] tracking-[0.22em] text-white/35 uppercase">by Becker</div>
        </div>
      </div>

      <nav className="flex w-full min-w-0 flex-wrap justify-center gap-1 rounded-xl border border-line/70 bg-ink-900/60 p-1 sm:w-auto sm:justify-start">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => onView(t.id)}
            className={`rounded-lg px-2 py-1.5 text-xs font-medium transition sm:px-3 ${
              view === t.id ? 'bg-white/10 text-white shadow-inner' : 'text-white/45 hover:text-white/80'
            }`}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {FEATURES.webUi && (
        <button
          type="button"
          onClick={onWeb}
          aria-label="Web-Drucker verbinden"
          data-testid="open-web-dialog"
          title="Netzwerkdrucker verbinden: IP, Port, Client"
          className={`flex items-center gap-1.5 rounded-xl border px-2.5 py-1.5 text-xs font-medium transition ${
            online && (status.mode === 'klipper' || status.mode === 'octoprint')
              ? 'border-mint/50 bg-mint/10 text-mint'
              : 'border-line/70 bg-ink-900/60 text-white/55 hover:border-sky/50 hover:text-sky'
          }`}
        >
          <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
          Web
        </button>
      )}

      <button
        type="button"
        onClick={onSetup}
        aria-label="Drucker wechseln"
        data-testid="printer-switch"
        className="flex min-w-0 items-center gap-2 rounded-xl border border-line/70 bg-ink-900/60 px-3 py-1.5 text-left transition hover:border-amber/40"
      >
        <div className="min-w-0">
          <div className="truncate text-[11px] font-medium text-white/85">{printer.name}</div>
          <div className="truncate text-[9px] text-white/35">
            {filament.name} · {plate.name} · ⌀{nozzle}
          </div>
        </div>
        <span className="text-[10px] text-amber">wechseln</span>
      </button>

      <div className="ml-auto flex flex-wrap items-center justify-end gap-1 whitespace-nowrap">
        {view === 'studio' && (
          <div
            role="group"
            aria-label="Studio-Layout"
            className="flex items-center rounded-xl border border-line/70 bg-ink-900/60 p-0.5"
          >
            <button
              type="button"
              onClick={() => onLayout('classic')}
              aria-pressed={layout === 'classic'}
              title="Klassisch: Einstellungen links, Vorschläge und Ergebnis rechts"
              className={`rounded-lg px-2 py-1 text-[10px] font-semibold transition ${
                layout === 'classic' ? 'bg-sky/15 text-sky' : 'text-white/40 hover:text-white/75'
              }`}
            >
              Klassisch
            </button>
            <button
              type="button"
              onClick={() => onLayout('workshop')}
              aria-pressed={layout === 'workshop'}
              title="Werkstatt: Werkstück und Ergebnis links, Einstellungen rechts"
              className={`rounded-lg px-2 py-1 text-[10px] font-semibold transition ${
                layout === 'workshop' ? 'bg-sky/15 text-sky' : 'text-white/40 hover:text-white/75'
              }`}
            >
              Werkstatt
            </button>
          </div>
        )}
        <label
          className="flex h-[27px] items-center gap-1 rounded-xl border border-line/70 bg-ink-900/60 px-1.5 text-[10px] text-white/40 transition hover:border-amber/50"
          title="UI-Größe automatisch an Fensterbreite und -höhe anpassen"
        >
          <span className="font-semibold tracking-wide">UI</span>
          <select
            value={uiScale}
            onChange={(event) => {
              if (isUiScaleId(event.target.value)) onUiScale(event.target.value)
            }}
            aria-label="UI-Größe und Auflösung"
            className="max-w-[132px] cursor-pointer bg-transparent text-[10px] text-white/70 outline-none"
          >
            <option value="auto">Automatisch</option>
            {UI_SCALE_PRESETS.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.label} · {Math.round(preset.scale * 100)} %
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={onTheme}
          title={theme === 'light' ? 'Dunkles Design einschalten' : 'Helles Design einschalten'}
          aria-label={theme === 'light' ? 'Dunkles Design einschalten' : 'Helles Design einschalten'}
          className="grid h-[27px] w-[27px] place-items-center rounded-xl border border-line/70 bg-ink-900/60 text-[12px] text-white/55 transition hover:border-amber/50 hover:text-amber"
        >
          {theme === 'light' ? '☾' : '☀'}
        </button>
        <button
          type="button"
          onClick={onLogs}
          title="Protokoll anzeigen"
          className="rounded-xl border border-line/70 bg-ink-900/60 px-2.5 py-1.5 text-[10px] text-white/50 transition hover:text-white"
        >
          Protokoll
        </button>
        <button
          type="button"
          onClick={onQuit}
          title="Programm beenden"
          className="rounded-xl border border-line/70 bg-ink-900/60 px-2.5 py-1.5 text-[10px] text-white/50 transition hover:border-rose/40 hover:text-rose"
        >
          Beenden
        </button>
        <button
          type="button"
          onClick={() => onView('printer')}
          className="flex items-center gap-2 rounded-xl border border-line/70 bg-ink-900/70 px-3 py-1.5 text-xs text-white/70 transition hover:border-white/20"
        >
        <span
          className={`h-1.5 w-1.5 rounded-full ${
            online ? 'bg-mint shadow-[0_0_8px] shadow-mint' : status.connection === 'error' ? 'bg-rose' : 'bg-white/25'
          }`}
        />
        <span className="max-w-[8rem] truncate">{label}</span>
        {status.temps.nozzle > 25 && (
          <span className="tabular text-[10px] text-amber">
            {Math.round(status.temps.nozzle)}°/{Math.round(status.temps.bed)}°
          </span>
        )}
        </button>
      </div>
    </header>
  )
}
