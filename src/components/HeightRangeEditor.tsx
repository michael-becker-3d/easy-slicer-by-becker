import type { HeightRangeModifier, HeightRangePatch, PrintSettings } from '../../shared/types.ts'
import { describeHeightRange } from '../../shared/heightRanges.ts'
import { InfoDot } from './ui.tsx'

type Props = {
  settings: PrintSettings
  onChange: (next: PrintSettings) => void
}

function Input({
  label,
  unit,
  value,
  onChange,
  step = 1,
  min,
  max,
}: {
  label: string
  unit?: string
  value: number | undefined
  onChange: (value: number | undefined) => void
  step?: number
  min?: number
  max?: number
}) {
  return (
    <label className="min-w-0">
      <span className="mb-0.5 block truncate text-[8px] text-white/35">
        {label}
        {unit ? ` (${unit})` : ''}
      </span>
      <input
        type="number"
        inputMode="decimal"
        step={step}
        min={min}
        max={max}
        value={value ?? ''}
        placeholder="—"
        title="Leer lassen = Einstellung bleibt unverändert"
        onChange={(event) => {
          const raw = event.target.value.trim().replace(',', '.')
          if (!raw) return onChange(undefined)
          const next = Number(raw)
          if (Number.isFinite(next)) onChange(next)
        }}
        className="w-full rounded-lg border border-line/70 bg-ink-900/60 px-1.5 py-1 text-[10px] text-white/80 outline-none focus:border-amber/60"
      />
    </label>
  )
}

/** Ein Höhenbereich mit den gängigen Druckparametern. */
export function HeightRangeEditor({ settings, onChange }: Props) {
  const ranges = settings.heightRanges ?? []
  const update = (index: number, patch: Partial<HeightRangeModifier>) => {
    onChange({
      ...settings,
      heightRanges: ranges.map((range, i) => (i === index ? { ...range, ...patch } : range)),
    })
  }
  const updatePatch = (index: number, patch: Partial<HeightRangePatch>) => {
    update(index, { patch: { ...ranges[index].patch, ...patch } })
  }
  const add = () => {
    const last = ranges[ranges.length - 1]
    const from = last ? Math.max(0, last.to) : 0
    onChange({
      ...settings,
      heightRanges: [...ranges, { from, to: from + 10, label: '', patch: {} }],
    })
  }
  const remove = (index: number) => {
    onChange({ ...settings, heightRanges: ranges.filter((_, i) => i !== index) })
  }

  return (
    <div className="col-span-full overflow-hidden rounded-xl border border-line/60 bg-ink-900/30">
      <div className="flex items-center gap-2 border-b border-line/40 px-2.5 py-2">
        <span className="text-[9px] font-semibold tracking-[0.14em] text-white/45 uppercase">
          Höhenbereiche
        </span>
        <InfoDot label="Height-Range-Modifier" />
        <span className="h-px flex-1 bg-line/50" />
        <button
          type="button"
          onClick={add}
          disabled={ranges.length >= 8}
          className="rounded-lg border border-amber/40 bg-amber/10 px-2 py-1 text-[9px] font-medium text-amber/90 transition hover:bg-amber/20 disabled:cursor-not-allowed disabled:opacity-35"
        >
          ＋ Bereich
        </button>
      </div>
      <div className="grid gap-2 px-2.5 py-2.5">
        {ranges.length === 0 && (
          <p className="text-[9px] leading-snug text-white/30">
            Keine Höhenbereiche. Ein Bereich kann ab Schicht 2 Tempo, Fluss, Linienbreite, Wände oder Füllung ändern.
          </p>
        )}
        {ranges.map((range, index) => {
          const invalid = !(range.to > range.from)
          return (
            <div key={index} className="rounded-xl border border-line/60 bg-ink-950/35 p-2">
              <div className="mb-1.5 flex items-center gap-1.5">
                <span className="text-[9px] font-medium text-white/55">Bereich {index + 1}</span>
                <span className="text-[8px] text-white/25">{describeHeightRange(range)}</span>
                <button
                  type="button"
                  onClick={() => remove(index)}
                  title="Bereich entfernen"
                  className="ml-auto text-[12px] leading-none text-white/30 hover:text-rose-300"
                >
                  ×
                </button>
              </div>
              <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-7">
                <Input
                  label="Von"
                  unit="mm"
                  step={0.1}
                  min={0}
                  value={range.from}
                  onChange={(value) => update(index, { from: value ?? 0 })}
                />
                <Input
                  label="Bis"
                  unit="mm"
                  step={0.1}
                  min={0}
                  value={range.to}
                  onChange={(value) => update(index, { to: value ?? 0 })}
                />
                <Input
                  label="Tempo"
                  unit="×"
                  step={0.05}
                  min={0.1}
                  max={3}
                  value={range.patch.speedFactor}
                  onChange={(value) => updatePatch(index, { speedFactor: value })}
                />
                <Input
                  label="Fluss"
                  unit="×"
                  step={0.02}
                  min={0.1}
                  max={2}
                  value={range.patch.flow}
                  onChange={(value) => updatePatch(index, { flow: value })}
                />
                <Input
                  label="Linie"
                  unit="×"
                  step={0.05}
                  min={0.5}
                  max={2}
                  value={range.patch.lineWidthFactor}
                  onChange={(value) => updatePatch(index, { lineWidthFactor: value })}
                />
                <Input
                  label="Wände"
                  step={1}
                  min={0}
                  max={8}
                  value={range.patch.walls}
                  onChange={(value) => updatePatch(index, { walls: value })}
                />
                <Input
                  label="Füllung"
                  unit="%"
                  step={5}
                  min={0}
                  max={100}
                  value={range.patch.infillDensity}
                  onChange={(value) => updatePatch(index, { infillDensity: value })}
                />
              </div>
              {invalid && (
                <p className="mt-1 text-[8px] text-amber/80">
                  „Bis“ muss größer als „Von“ sein; dieser Bereich wird sonst nicht angewendet.
                </p>
              )}
            </div>
          )
        })}
        {ranges.length > 0 && (
          <p className="text-[8px] leading-snug text-white/25">
            Gilt ab Schicht 2; der erste passende Bereich gewinnt. Leere Felder bleiben unverändert. Linienbreite und Wände werden auch in der Bahnplanung verwendet, nicht nur im Fluss.
          </p>
        )}
      </div>
    </div>
  )
}