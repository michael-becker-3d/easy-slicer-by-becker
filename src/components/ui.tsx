import { useEffect, useId, useState, type ReactNode } from 'react'
import { settingInfo } from '../settingsInfo.ts'
import { currentUiScale } from '../uiScale.ts'
import { useSettingReset } from './settingsReset.tsx'

/** Kleiner Info-Punkt: zeigt beim Klick, was die Einstellung verändert. */
export function InfoDot({ label, unit, text }: { label: string; unit?: string; text?: string }) {
  const [open, setOpen] = useState(false)
  // Sprechblase waagerecht ins Fenster schieben — in schmalen Spalten lief sie
  // sonst links bzw. rechts aus dem Fenster hinaus.
  const [shift, setShift] = useState(0)
  const info = text ?? settingInfo(label, unit)
  if (!info) return null
  return (
    <span className="relative inline-flex shrink-0">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          const rect = e.currentTarget.getBoundingClientRect()
          const scale = currentUiScale()
          const pad = 8
          const half = 120
          const viewportWidth = window.innerWidth / scale
          const center = rect.left / scale + rect.width / scale / 2
          let next = 0
          if (center - half < pad) next = pad - (center - half)
          else if (center + half > viewportWidth - pad) next = viewportWidth - pad - (center + half)
          setShift(next)
          setOpen((o) => !o)
        }}
        onBlur={() => setOpen(false)}
        aria-label={`Info zu ${label}`}
        aria-expanded={open}
        className={`grid h-4 w-4 place-items-center rounded-full border text-[8px] font-bold transition ${
          open ? 'border-amber/70 text-amber' : 'border-line/80 text-white/35 hover:border-amber/60 hover:text-amber'
        }`}
      >
        i
      </button>
      {open && (
        <span
          role="tooltip"
          style={{ transform: `translateX(calc(-50% + ${shift}px))` }}
          className="absolute bottom-full left-1/2 z-50 mb-1.5 w-60 rounded-xl border border-amber/30 bg-ink-950/97 px-2.5 py-2 text-[10px] leading-snug font-normal tracking-normal normal-case text-white/65 shadow-xl"
        >
          <span className="mb-1 block text-[9px] font-semibold tracking-[0.12em] text-amber/80 uppercase">{label}</span>
          {info}
        </span>
      )}
    </span>
  )
}

export function Panel({
  title,
  hint,
  right,
  children,
  className = '',
  collapsible = false,
  defaultOpen = true,
}: {
  title: string
  hint?: string
  right?: ReactNode
  children: ReactNode
  className?: string
  /** Kopfzeile als Auf-/Zuklapp-Schalter anbieten. */
  collapsible?: boolean
  /** Startzustand bei `collapsible`; standardmäßig offen. */
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  const contentId = useId()
  return (
    <section className={`rounded-2xl border border-line/70 glass ${className}`}>
      <header className={`flex items-start justify-between gap-2 px-4 ${open ? 'pt-3 pb-2' : 'py-2.5'}`}>
        <div className="min-w-0 flex-1">
          {collapsible ? (
            <button
              type="button"
              onClick={() => setOpen((value) => !value)}
              aria-expanded={open}
              aria-controls={contentId}
              className="flex w-full items-start gap-2 text-left"
            >
              <span
                aria-hidden="true"
                className="mt-0.5 w-3 shrink-0 text-center text-[11px] leading-none text-white/35"
              >
                {open ? '▾' : '▸'}
              </span>
              <span className="min-w-0">
                <span className="block text-[10px] font-semibold tracking-[0.18em] text-white/40 uppercase">
                  {title}
                </span>
                {open && hint && (
                  <span className="mt-1 block text-[11px] leading-tight text-white/35">{hint}</span>
                )}
              </span>
            </button>
          ) : (
            <div>
              <h2 className="text-[10px] font-semibold tracking-[0.18em] text-white/40 uppercase">{title}</h2>
              {hint && <p className="mt-1 text-[11px] leading-tight text-white/35">{hint}</p>}
            </div>
          )}
        </div>
        {right && <div className="flex shrink-0 items-start">{right}</div>}
      </header>
      <div id={contentId} className={open ? 'px-4 pb-4' : 'hidden'}>
        {children}
      </div>
    </section>
  )
}

export function Stepper({
  label,
  value,
  unit,
  step,
  precision = 0,
  onChange,
  onReset,
}: {
  label: string
  value: number
  unit?: string
  min?: number
  max?: number
  step: number
  precision?: number
  onChange: (v: number) => void
  /** Expliziter Rücksetzweg; sonst kommt der Profilwert aus dem Kontext. */
  onReset?: () => void
}) {
  const presetReset = useSettingReset(label, unit, value)
  const reset = onReset ?? presetReset?.reset
  const resetTo = onReset ? undefined : presetReset?.baseline
  // Während des Tippens bleibt der Text unangetastet. Erst Blur/Enter
  // übernimmt den Wert — sonst würde z. B. eine leere Eingabe sofort auf
  // das Minimum springen und komplettes Markieren/Ersetzen unmöglich machen.
  const [draft, setDraft] = useState<string | null>(null)
  useEffect(() => {
    setDraft(null)
  }, [value])
  const commit = () => {
    if (draft === null) return
    const raw = draft.trim().replace(',', '.')
    if (!raw) {
      setDraft(null)
      return
    }
    const next = Number(raw)
    if (Number.isFinite(next)) onChange(Math.round(next * 1000) / 1000)
    setDraft(null)
  }
  const nudge = (direction: 1 | -1) => {
    const next = Math.round((value + direction * step) * 1000) / 1000
    onChange(next)
  }
  return (
    <div className="min-w-0">
      <div className="mb-1 flex items-start gap-1 text-[11px] leading-snug font-medium tracking-wide text-white/60 uppercase">
        <span className="min-w-0 flex-1">{label}</span>
        <InfoDot label={label} unit={unit} />
        {reset && (
          <button
            type="button"
            onClick={reset}
            title={resetTo !== undefined ? `Auf Profilwert ${resetTo} zurücksetzen` : 'Auf Profilwert zurücksetzen'}
            aria-label={`${label} auf Profilwert zurücksetzen`}
            className="ml-auto grid h-4 w-4 shrink-0 place-items-center rounded-full border border-line/70 text-[10px] leading-none text-white/35 transition hover:border-amber/60 hover:text-amber"
          >
            ↺
          </button>
        )}
      </div>
      <div className="flex items-center gap-1 rounded-xl border border-line/80 bg-ink-900/70 px-1 py-1">
        <button
          type="button"
          onClick={() => nudge(-1)}
          className="grid h-6 w-6 shrink-0 place-items-center rounded-lg text-white/45 transition hover:bg-white/8 hover:text-white"
          aria-label={`${label} verringern`}
        >
          −
        </button>
        <div className="flex min-w-0 flex-1 items-baseline justify-center gap-1">
          <input
            type="number"
            aria-label={label}
            value={draft ?? String(Number(value.toFixed(3)))}
            step={step}
            inputMode="decimal"
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur()
              if (e.key === 'Escape') {
                setDraft(null)
                e.currentTarget.blur()
              }
            }}
            className="tabular w-full min-w-0 bg-transparent text-center text-[15px] font-semibold text-white outline-none"
          />
          {unit && <span className="shrink-0 text-[10px] text-white/35">{unit}</span>}
        </div>
        <button
          type="button"
          onClick={() => nudge(1)}
          className="grid h-6 w-6 shrink-0 place-items-center rounded-lg text-white/45 transition hover:bg-white/8 hover:text-white"
          aria-label={`${label} erhöhen`}
        >
          +
        </button>
      </div>
      <div className="sr-only">{precision}</div>
    </div>
  )
}

export function Slider({
  label,
  value,
  min,
  max,
  step,
  unit,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  unit?: string
  onChange: (v: number) => void
}) {
  return (
    <label className="block">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-[10px] font-medium tracking-wider text-white/40 uppercase">{label}</span>
        <span className="tabular text-[11px] font-semibold text-white/70">
          {value}
          {unit ? ` ${unit}` : ''}
        </span>
      </div>
      <input
        type="range"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full cursor-pointer appearance-none rounded-full bg-line"
      />
    </label>
  )
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  size = 'md',
}: {
  options: { value: T; label: string }[]
  value: T
  onChange: (v: T) => void
  size?: 'sm' | 'md'
}) {
  return (
    <div className={`flex gap-1 rounded-xl border border-line/80 bg-ink-900/60 p-1 ${size === 'sm' ? 'text-[10px]' : 'text-xs'}`}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`flex-1 rounded-lg px-2 py-1 font-medium transition ${
            value === o.value ? 'bg-amber/90 text-ink-950' : 'text-white/55 hover:bg-white/6 hover:text-white/80'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="flex items-center gap-2"
      aria-pressed={checked}
    >
      <span
        className={`relative h-5 w-9 rounded-full transition ${checked ? 'bg-amber' : 'bg-line'}`}
      >
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-ink-950 transition-all ${checked ? 'left-[1.15rem]' : 'left-0.5'}`}
        />
      </span>
      {label && <span className="text-xs text-white/60">{label}</span>}
    </button>
  )
}

export function Chip({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'amber' | 'mint' | 'sky' | 'rose' }) {
  const tones: Record<string, string> = {
    neutral: 'border-line text-white/50',
    amber: 'border-amber/40 text-amber bg-amber/10',
    mint: 'border-mint/40 text-mint bg-mint/10',
    sky: 'border-sky/40 text-sky bg-sky/10',
    rose: 'border-rose/40 text-rose bg-rose/10',
  }
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium tracking-wide ${tones[tone]}`}>
      {children}
    </span>
  )
}
