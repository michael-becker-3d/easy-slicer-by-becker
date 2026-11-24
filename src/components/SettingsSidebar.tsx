import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type {
  BuildPlate,
  BrimType,
  FilamentSlot,
  FuzzySkinMode,
  InfillPattern,
  InputShaperMethod,
  LayerOrder,
  ModelObjectInfo,
  NozzleMaterial,
  PathOrder,
  PlateFilamentTemps,
  PlateProfile,
  PrinterProfile,
  PrintSettings,
  RoleGcodeSettings,
  SeamPosition,
  SkirtType,
  SupportPattern,
  TexturePatternChoice,
  TopTexturePatternChoice,
  TextureZone,
  WallOrder,
} from '../../shared/types.ts'
import type { QualityPreset } from '../../shared/catalog.ts'
import { InfoDot, Segmented, Stepper, Toggle } from './ui.tsx'
import { HeightRangeEditor } from './HeightRangeEditor.tsx'
import { scaledLength, shrinkageFromMeasurement } from '../../shared/shrinkage.ts'
import { elephantFootInset } from '../../shared/calibration.ts'
import {
  SURFACE_TEXTURE_PATTERNS,
  SURFACE_TEXTURE_PRESETS,
  surfaceTextureSwatch,
  type SurfaceTexturePreset,
} from '../../shared/surfaceTexture.ts'

/**
 * Muster ohne eigenes Preset. Nur sie stehen im Musteratlas, damit Atlas und
 * Presets nicht dieselbe Auswahl doppelt anbieten.
 */
const ATLAS_ONLY_PATTERNS = SURFACE_TEXTURE_PATTERNS.filter(
  (entry) => !SURFACE_TEXTURE_PRESETS.some((preset) => preset.pattern === entry.value),
)

type Limits = {
  layer: [number, number]
  nozzle: number[]
  speed: number
  accel: number
  travel: number
  bed: number
  nozzleTemp: number
}

type Props = {
  settings: PrintSettings
  baseline: PrintSettings
  qualityPresets: QualityPreset[]
  qualityId: string
  onQualityChange: (id: string) => void
  /** Aktuellen Stand als eigenes Qualitätsprofil sichern. */
  onSaveQualityProfile: (name: string) => void
  /** Eigenes Profil umbenennen; Rückgabe ist eine Fehlermeldung oder null. */
  onRenameQualityProfile: (id: string, name: string) => string | null
  /** Eigenes Profil dauerhaft löschen. */
  onDeleteQualityProfile: (id: string) => void
  onChange: (next: PrintSettings) => void
  onReset: () => void
  limits: Limits
  nozzleMaterial?: NozzleMaterial
  onNozzleMaterial?: (material: NozzleMaterial) => void
  profiles?: { id: string; name: string }[]
  /** Alle Katalog- und eigenen Profile für die Slot-Auswahl. */
  filamentProfiles?: { id: string; name: string }[]
  currentFilamentName?: string
  /** `targetId` überschreibt genau dieses gespeicherte Profil; ohne Id wird neu angelegt. */
  onSaveFilament?: (name: string, targetId?: string) => string | null
  onLoadFilament?: (id: string) => void
  onDeleteFilament?: (id: string) => void
  printer: PrinterProfile
  objects: ModelObjectInfo[]
  selectedObjectId?: string | null
  /** Objektwerte ändern, z. B. das Filament pro Objekt. */
  onObjects?: (next: ModelObjectInfo[]) => void
  slots: FilamentSlot[]
  onSlotsChange: (slots: FilamentSlot[]) => void
  onAssignSlot: (objectId: string, slot: FilamentSlot | null) => void
  onOpenPrinterSettings: () => void
  /** Alle verfügbaren Bettarten aus dem Katalog. */
  plates?: BuildPlate[]
  /** Gespeicherte Plattenprofile des aktuellen Druckers. */
  plateProfiles?: Record<string, PlateProfile>
  /** Aktives Filament, dessen Temperaturen in den Plattenprofilen liegen. */
  filamentId?: string
  /** Aktuell gewählte Platte; wird in der Matrix hervorgehoben. */
  activePlateId?: string
  /** Standardwerte je Platte: Filamenttemperatur + Plattenoffset. */
  plateFallbackTemps?: Record<string, { bed: number; firstLayer: number }>
  /** Speichert eine Betttemperatur direkt im Plattenprofil. */
  onPlateTemps?: (plateId: string, patch: Partial<PlateFilamentTemps>) => void
  /** Aktiver IFS/AMS-Slot; wird im Filament-Reiter hervorgehoben. */
  activeSlotId?: string
  onActiveSlot?: (slotId: string) => void
  /** Muster nur ansehen: zeigt die Textur am Modell, ohne die Oberflächenstruktur zu slicen. */
  texturePreview?: boolean
  onTexturePreview?: (next: boolean) => void
}

type Path = string[]

import { FEATURES } from '../../shared/release.ts'

const NOZZLE_MATERIALS: { id: NozzleMaterial; label: string; hint: string }[] = [
  { id: 'brass', label: 'Messing', hint: 'Sehr gute Wärmeleitung, aber weich — nicht für CF/GF.' },
  { id: 'hardened-steel', label: 'Gehärteter Stahl', hint: 'Für Kohle-/Glasfaser und abrasives Material.' },
  { id: 'stainless', label: 'Edelstahl', hint: 'Robuster als Messing, für viele Materialien geeignet.' },
  { id: 'unknown', label: 'Unbekannt', hint: 'Bei abrasivem Filament vorsichtig und langsamer drucken.' },
]

const INFILL_OPTIONS: { value: InfillPattern; label: string }[] = [
  { value: 'grid', label: 'Grid' },
  { value: 'lines', label: 'Linien' },
  { value: 'triangles', label: 'Triangles' },
  { value: 'zigzag', label: 'Zickzack' },
  { value: 'concentric', label: 'Ringe' },
  { value: 'gyroid', label: 'Gyroid' },
  { value: 'honeycomb', label: 'Waben' },
  { value: 'crosshatch', label: 'Kreuz' },
  { value: 'cubic', label: 'Cubic' },
  { value: 'octet', label: 'Octet' },
]

const SUPPORT_PATTERN_OPTIONS: { value: SupportPattern; label: string }[] = [
  { value: 'grid', label: 'Gitter' },
  { value: 'lines', label: 'Linien' },
  { value: 'zigzag', label: 'Zickzack' },
]

const SLOT_COLORS = ['#f8fafc', '#fbbf24', '#5eead4', '#f472b6', '#60a5fa', '#a3e635']

const ROLE_OPTIONS: { id: keyof RoleGcodeSettings; label: string }[] = [
  { id: 'outerWall', label: 'Außenwand' },
  { id: 'innerWall', label: 'Innenwand' },
  { id: 'solid', label: 'Deck-/Bodenschicht' },
  { id: 'sparse', label: 'Füllung' },
  { id: 'support', label: 'Stützen' },
  { id: 'bridge', label: 'Brücke' },
  { id: 'iron', label: 'Glätten' },
  { id: 'adhesion', label: 'Saum / Umrandung' },
]

type TabId = 'quality' | 'structure' | 'speed' | 'filament' | 'cooling' | 'support' | 'multi' | 'other'

const TABS: { id: TabId; label: string }[] = [
  { id: 'quality', label: 'Qualität' },
  { id: 'structure', label: 'Struktur' },
  { id: 'speed', label: 'Geschwindigkeit' },
  { id: 'cooling', label: 'Kühlung' },
  { id: 'support', label: 'Stützen' },
  { id: 'multi', label: 'Mehrfarbig' },
  { id: 'other', label: 'Sonstige' },
]

function getPath(obj: unknown, path: Path): unknown {
  let cur: any = obj
  for (const key of path) cur = cur?.[key]
  return cur
}

function setPath<T>(obj: T, path: Path, value: unknown): T {
  if (path.length === 0) return value as T
  const [key, ...rest] = path
  const source: any = obj ?? {}
  const copy: any = Array.isArray(source) ? [...source] : { ...source }
  copy[key] = setPath(copy[key], rest, value)
  return copy as T
}

function Section({
  title,
  hint,
  children,
  badge,
  active = true,
}: {
  title: string
  hint: string
  children: ReactNode
  badge?: string
  active?: boolean
}) {
  if (!active) return null
  return (
    <section className="overflow-hidden rounded-2xl border border-line/70 bg-ink-900/55">
      <div className="border-b border-line/50 px-3 py-2.5">
        <div className="flex flex-wrap items-center gap-1.5 text-[12px] font-semibold tracking-wide text-white/85">
          {title}
          {badge && (
            <span className="rounded-full bg-amber/15 px-1.5 py-0.5 text-[9px] font-semibold tracking-wider text-amber/90 uppercase">
              {badge}
            </span>
          )}
        </div>
        <div className="mt-0.5 text-[10px] leading-snug text-white/40">{hint}</div>
      </div>
      <div className="px-3 py-3">{children}</div>
    </section>
  )
}

function Subhead({ children }: { children: ReactNode }) {
  return (
    <div className="col-span-full mt-1.5 mb-0.5 flex items-center gap-2 first:mt-0">
      <span className="text-[9px] font-semibold tracking-[0.14em] text-white/30 uppercase">{children}</span>
      <span className="h-px flex-1 bg-line/50" />
    </div>
  )
}

/**
 * Echter Muster-Swatch: Dieselbe prozedurale Textur wie auf der Wand wird in
 * ein kleines Graustufenfeld gerastert. Dadurch zeigt die Kachel die Struktur
 * des Musters und nicht nur ein generisches Symbol.
 */
function TextureSwatch({
  pattern,
  scale,
  angle,
  className = '',
}: {
  pattern: SurfaceTexturePreset['pattern']
  scale: number
  angle: number
  className?: string
}) {
  const cells = 10
  const values = useMemo(
    () => surfaceTextureSwatch(pattern, scale, angle, cells),
    [pattern, scale, angle],
  )
  return (
    <svg
      viewBox={`0 0 ${cells * 2} ${cells * 2}`}
      preserveAspectRatio="none"
      aria-hidden="true"
      shapeRendering="crispEdges"
      className={`block w-full bg-ink-950 ${className}`}
    >
      {values.map((value, index) => {
        const shade = Math.round(40 + ((Math.max(-1, Math.min(1, value)) + 1) / 2) * 54)
        return (
          <rect
            key={index}
            x={(index % cells) * 2}
            y={Math.floor(index / cells) * 2}
            width={2}
            height={2}
            fill={`rgb(${shade + 7}, ${shade + 3}, ${Math.max(0, shade - 4)})`}
          />
        )
      })}
    </svg>
  )
}

/**
 * Aufklappbare Untergruppe innerhalb eines Einstellungsreiters.
 * Die Kopfzeile bleibt schmal; der Pfeil sitzt rechts, damit die Gruppen
 * auch bei vielen Werten schnell aus dem Weg geräumt werden können.
 */
function Fold({
  title,
  hint,
  defaultOpen = true,
  children,
}: {
  title: string
  hint?: string
  defaultOpen?: boolean
  children: ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="col-span-full overflow-hidden rounded-xl border border-line/60 bg-ink-900/30">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-2.5 py-2 text-left transition hover:bg-white/[0.025]"
      >
        <span className="text-[9px] font-semibold tracking-[0.14em] text-white/45 uppercase">{title}</span>
        <span className="h-px flex-1 bg-line/50" />
        {hint && <span className="shrink-0 text-[8px] text-white/25">{hint}</span>}
        <span className="w-3 shrink-0 text-right text-[12px] leading-none text-white/40">{open ? '▾' : '▸'}</span>
      </button>
      {open && <div className="grid grid-cols-1 gap-2 border-t border-line/40 px-2.5 py-2.5">{children}</div>}
    </div>
  )
}

function Num({
  label,
  unit,
  value,
  path,
  settings,
  baseline,
  onChange,
  step,
  min,
  max,
  displayFactor = 1,
}: {
  label: string
  unit?: string
  value: number
  path: Path
  settings: PrintSettings
  baseline: PrintSettings
  onChange: (next: PrintSettings) => void
  step: number
  min?: number
  max?: number
  /** Anzeigefaktor, z. B. 100 für einen gespeicherten Anteil 0,12 → 12 %. */
  displayFactor?: number
}) {
  const base = getPath(baseline, path)
  const reset =
    typeof base === 'number' && Math.abs(base - value) > 1e-9
      ? () => onChange(setPath(settings, path, base))
      : undefined
  const clamp = (v: number) =>
    Math.min(max ?? Number.POSITIVE_INFINITY, Math.max(min ?? Number.NEGATIVE_INFINITY, v))
  return (
    <Stepper
      label={label}
      value={value * displayFactor}
      unit={unit}
      step={step}
      min={min}
      max={max}
      // Der Stepper arbeitet in Anzeigeeinheiten (12 %), gespeichert wird der
      // Anteil (0,12). Grenzen wie min={2} max={60} gelten deshalb für v —
      // clamp(v / displayFactor) hätte 0,12 gegen 2…60 geprüft und auf 200 %
      // hochgezogen.
      onChange={(v) => onChange(setPath(settings, path, clamp(v) / displayFactor))}
      onReset={reset}
    />
  )
}

function ElephantFootCalculator({
  settings,
  onChange,
}: {
  settings: PrintSettings
  onChange: (next: PrintSettings) => void
}) {
  const [target, setTarget] = useState('20')
  const [measured, setMeasured] = useState('')
  const parseNumber = (value: string) => Number(value.trim().replace(',', '.'))
  const targetValue = parseNumber(target)
  const measuredValue = parseNumber(measured)
  const calculated = measured.trim() ? elephantFootInset(targetValue, measuredValue) : null
  const clamped = calculated === null ? null : Math.min(0.5, Math.max(-0.5, Math.round(calculated * 1000) / 1000))
  const inRange = clamped !== null && Math.abs(calculated!) <= 0.5
  const formatMm = (value: number) => Number(value.toFixed(3)).toString().replace('.', ',')

  const apply = () => {
    if (!inRange || clamped === null) return
    onChange(
      setPath(settings, ['elephantFoot'], {
        ...settings.elephantFoot,
        enabled: true,
        amount: clamped,
      }),
    )
  }

  return (
    <div className="col-span-full rounded-lg border border-line/60 bg-ink-950/40 p-2">
      <div className="text-[9px] font-semibold tracking-[0.12em] text-white/40 uppercase">
        Fußbreite → Einzug
      </div>
      <p className="mt-0.5 text-[9px] leading-snug text-white/30">
        Sollbreite und breiteste Stelle der ersten Schicht messen. Einzug = (Fußbreite − Sollbreite) / 2.
      </p>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <label className="grid gap-1 text-[9px] text-white/45">
          Sollbreite
          <input
            value={target}
            onChange={(event) => setTarget(event.target.value)}
            inputMode="decimal"
            aria-label="Sollbreite für Elefantenfuß"
            className="w-full rounded-md border border-line/70 bg-ink-950/60 px-2 py-1 text-[11px] text-white/80 outline-none focus:border-amber/60"
          />
        </label>
        <label className="grid gap-1 text-[9px] text-white/45">
          Fußbreite
          <input
            value={measured}
            onChange={(event) => setMeasured(event.target.value)}
            inputMode="decimal"
            placeholder="z. B. 20,4"
            aria-label="Gemessene Fußbreite"
            className="w-full rounded-md border border-line/70 bg-ink-950/60 px-2 py-1 text-[11px] text-white/80 outline-none focus:border-amber/60"
          />
        </label>
      </div>
      {calculated !== null && (
        <p className={`mt-2 text-[10px] ${inRange ? 'text-mint/80' : 'text-amber/80'}`}>
          {inRange
            ? `Einzug ${formatMm(clamped!)} mm pro Seite — die erste Schicht wird um ${formatMm(clamped! * 2)} mm schmaler.`
            : `Rechnerisch ${formatMm(calculated)} mm pro Seite; der erlaubte Bereich ist −0,5 bis +0,5 mm.`}
        </p>
      )}
      <button
        type="button"
        onClick={apply}
        disabled={!inRange}
        className="mt-2 rounded-lg border border-amber/40 bg-amber/15 px-2.5 py-1 text-[10px] font-semibold text-amber transition hover:bg-amber/25 disabled:cursor-not-allowed disabled:border-line/50 disabled:bg-transparent disabled:text-white/25"
      >
        Einzug übernehmen
      </button>
    </div>
  )
}

function ShrinkageCard({
  settings,
  baseline,
  onChange,
  advanced,
}: {
  settings: PrintSettings
  baseline: PrintSettings
  onChange: (next: PrintSettings) => void
  advanced: boolean
}) {
  const shrinkage = settings.shrinkage ?? { x: 0, y: 0, z: 0 }
  const base = baseline.shrinkage ?? { x: 0, y: 0, z: 0 }
  const [target, setTarget] = useState('100')
  const [measured, setMeasured] = useState('')

  const parseNumber = (value: string) => Number(value.trim().replace(',', '.'))
  const targetValue = parseNumber(target)
  const measuredValue = parseNumber(measured)
  const calculated = measured.trim() ? shrinkageFromMeasurement(targetValue, measuredValue) : null
  const inRange = calculated !== null && calculated >= -5 && calculated <= 10
  const changed =
    Math.abs(shrinkage.x - base.x) > 1e-9 ||
    Math.abs(shrinkage.y - base.y) > 1e-9 ||
    Math.abs(shrinkage.z - base.z) > 1e-9

  const clamp = (value: number) => Math.min(10, Math.max(-5, Math.round(value * 1000) / 1000))
  const setShrinkage = (patch: Partial<{ x: number; y: number; z: number }>) =>
    onChange(setPath(settings, ['shrinkage'], { ...shrinkage, ...patch }))
  const resetShrinkage = () => onChange(setPath(settings, ['shrinkage'], base))
  const formatPercent = (value: number) => `${Number(value.toFixed(2)).toString().replace('.', ',')} %`
  const formatMm = (value: number) => `${Number(value.toFixed(2)).toString().replace('.', ',')} mm`
  const preview = (value: number) => `100 mm → ${formatMm(scaledLength(100, value))} bei ${formatPercent(value)}`

  return (
    <div className="col-span-full rounded-xl border border-line/70 bg-ink-900/40 p-2.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1 text-[10px] font-medium tracking-wider text-white/40 uppercase">
          <span>Schrumpfkompensation</span>
          <InfoDot label="Schrumpfkompensation" />
        </div>
        {changed && (
          <button
            type="button"
            onClick={resetShrinkage}
            title="Auf Profilwert zurücksetzen"
            className="text-[10px] text-white/30 transition hover:text-amber"
          >
            ↺
          </button>
        )}
      </div>
      <p className="mt-1 text-[9px] leading-snug text-white/30">
        Gleicht Materialschwund aus. Positive Werte vergrößern das Modell vor dem Slicen; 0 = aus.
      </p>

      <div className={`mt-2 grid gap-2 ${advanced ? 'grid-cols-3' : 'grid-cols-2'}`}>
        {advanced ? (
          <>
            <Stepper
              label="X"
              value={shrinkage.x}
              unit="%"
              step={0.1}
              min={-5}
              max={10}
              onChange={(value) => setShrinkage({ x: clamp(value) })}
            />
            <Stepper
              label="Y"
              value={shrinkage.y}
              unit="%"
              step={0.1}
              min={-5}
              max={10}
              onChange={(value) => setShrinkage({ y: clamp(value) })}
            />
          </>
        ) : (
          <Stepper
            label="X/Y"
            value={shrinkage.x}
            unit="%"
            step={0.1}
            min={-5}
            max={10}
            onChange={(value) => {
              const next = clamp(value)
              setShrinkage({ x: next, y: next })
            }}
          />
        )}
        <Stepper
          label="Z"
          value={shrinkage.z}
          unit="%"
          step={0.1}
          min={-5}
          max={10}
          onChange={(value) => setShrinkage({ z: clamp(value) })}
        />
      </div>

      <div className="mt-2 rounded-lg border border-line/60 bg-ink-950/35 px-2 py-1.5 text-[9px] leading-relaxed text-white/45">
        <div className="flex items-center gap-1 text-[8px] font-semibold tracking-wider text-white/30 uppercase">
          Beispiel
        </div>
        {advanced && Math.abs(shrinkage.x - shrinkage.y) > 1e-9 ? (
          <>
            <div>X: {preview(shrinkage.x)}</div>
            <div>Y: {preview(shrinkage.y)}</div>
          </>
        ) : (
          <div>X/Y: {preview(shrinkage.x)}</div>
        )}
        <div>Z: {preview(shrinkage.z)}</div>
      </div>

      <p className="mt-1 text-[9px] leading-snug text-white/25">
        Skaliert das gesamte Modell; Bohrungen wachsen mit. Für Loch-/Konturversatz in Millimetern ist der spätere
        Ausbau vorgesehen.
      </p>

      <div className="mt-2 rounded-xl border border-sky/25 bg-sky/[0.04] p-2">
        <div className="flex flex-wrap items-center justify-between gap-1">
          <span className="text-[9px] font-semibold tracking-wider text-sky/75 uppercase">Messwert-Rechner</span>
          <span className="text-[8px] text-white/25">Sollmaß und gemessenes Maß eintragen</span>
        </div>
        <div className="mt-1.5 grid grid-cols-2 gap-1.5">
          <label className="text-[9px] text-white/35">
            Sollmaß (mm)
            <input
              type="text"
              inputMode="decimal"
              autoComplete="off"
              value={target}
              onChange={(event) => setTarget(event.target.value)}
              className="tabular mt-1 w-full rounded-lg border border-line/80 bg-ink-900/70 px-2 py-1.5 text-[11px] text-white/80 outline-none focus:border-sky/50"
            />
          </label>
          <label className="text-[9px] text-white/35">
            Gemessen (mm)
            <input
              type="text"
              inputMode="decimal"
              autoComplete="off"
              value={measured}
              placeholder="z. B. 99,2"
              onChange={(event) => setMeasured(event.target.value)}
              className="tabular mt-1 w-full rounded-lg border border-line/80 bg-ink-900/70 px-2 py-1.5 text-[11px] text-white/80 outline-none focus:border-sky/50"
            />
          </label>
        </div>
        {calculated !== null ? (
          <div className="mt-1.5 flex flex-wrap items-center justify-between gap-1.5 rounded-lg border border-sky/20 bg-sky/[0.06] px-2 py-1.5">
            <div className="min-w-0">
              <div className="text-[8px] tracking-wider text-white/30 uppercase">Nötige X/Y-Kompensation</div>
              <div className="tabular text-[15px] font-semibold text-sky">{formatPercent(calculated)}</div>
              <div className="text-[8px] text-white/30">
                {formatMm(targetValue)} Soll · {formatMm(measuredValue)} Ist
              </div>
            </div>
            <button
              type="button"
              disabled={!inRange}
              onClick={() => setShrinkage({ x: calculated, y: calculated })}
              className="shrink-0 rounded-lg border border-sky/40 bg-sky/15 px-2 py-1.5 text-[9px] font-semibold text-sky transition enabled:hover:bg-sky/25 disabled:cursor-not-allowed disabled:opacity-40"
            >
              In X/Y übernehmen
            </button>
          </div>
        ) : (
          <p className="mt-1.5 text-[9px] leading-snug text-white/25">
            Ist-Maß eintragen — zum Beispiel 100 mm Soll und 99,2 mm gemessen.
          </p>
        )}
        {calculated !== null && !inRange && (
          <p className="mt-1 text-[9px] leading-snug text-amber/80">
            Das Ergebnis liegt außerhalb von −5 … +10 %. Bitte Soll- und Ist-Maß prüfen.
          </p>
        )}
        <p className="mt-1 text-[8px] leading-snug text-white/25">
          Formel: (Soll ÷ Ist − 1) × 100. Der Wert wird als X/Y-Kompensation übernommen; Z bleibt unverändert.
        </p>
      </div>
    </div>
  )
}

function Choice<T extends string>({
  label,
  value,
  path,
  options,
  settings,
  baseline,
  onChange,
}: {
  label: string
  value: T
  path: Path
  options: { value: T; label: string }[]
  settings: PrintSettings
  baseline: PrintSettings
  onChange: (next: PrintSettings) => void
}) {
  const base = getPath(baseline, path) as T | undefined
  return (
    <label className="min-w-0">
      <span className="mb-1 flex items-center gap-1 text-[10px] font-medium tracking-wider text-white/40 uppercase">
        <span className="min-w-0 flex-1 leading-snug">{label}</span>
        <InfoDot label={label} />
        {base !== undefined && base !== value && (
          <button
            type="button"
            onClick={() => onChange(setPath(settings, path, base))}
            title="Auf Profilwert zurücksetzen"
            className="ml-auto text-[10px] text-white/30 hover:text-amber"
          >
            ↺
          </button>
        )}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(setPath(settings, path, e.target.value))}
        className="w-full rounded-xl border border-line/80 bg-ink-900/70 px-2 py-1.5 text-xs text-white/85 outline-none focus:border-amber/60"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  )
}

function Bool({
  label,
  value,
  path,
  settings,
  baseline,
  onChange,
  hint,
}: {
  label: string
  value: boolean
  path: Path
  settings: PrintSettings
  baseline: PrintSettings
  onChange: (next: PrintSettings) => void
  hint?: string
}) {
  const base = getPath(baseline, path)
  const changed = typeof base === 'boolean' && base !== value
  return (
    <div className="col-span-full flex items-start justify-between gap-2 rounded-xl border border-line/60 bg-ink-900/40 px-2.5 py-2">
      <span className="min-w-0">
        <span className="flex items-center gap-1 text-[10px] font-medium text-white/65">
          {label}
          <InfoDot label={label} />
          {changed && (
            <button
              type="button"
              onClick={() => onChange(setPath(settings, path, base))}
              title="Auf Profilwert zurücksetzen"
              className="text-[10px] text-white/30 hover:text-amber"
            >
              ↺
            </button>
          )}
        </span>
        {hint && <span className="mt-0.5 block text-[9px] leading-snug text-white/25">{hint}</span>}
      </span>
      <Toggle checked={value} onChange={(v) => onChange(setPath(settings, path, v))} />
    </div>
  )
}

function MultiMaterial({
  printer,
  slots,
  profiles,
  objects,
  selectedObjectId,
  onSlotsChange,
  onAssignSlot,
}: {
  printer: PrinterProfile
  slots: FilamentSlot[]
  profiles: { id: string; name: string }[]
  objects: ModelObjectInfo[]
  selectedObjectId?: string | null
  onSlotsChange: (slots: FilamentSlot[]) => void
  onAssignSlot: (objectId: string, slot: FilamentSlot | null) => void
}) {
  if (!printer.ifs && slots.length === 0) {
    return (
      <p className="text-[10px] leading-relaxed text-white/35">
        Dieser Drucker hat keine Mehrfachzuführung. Mehrfarbige Objekte werden nicht angeboten.
      </p>
    )
  }

  return (
    <div className="space-y-2.5">
      <div className="flex items-start justify-between gap-2 rounded-xl border border-sky/25 bg-sky/5 px-2.5 py-2">
        <div className="min-w-0">
          <div className="text-[10px] font-semibold text-sky/85">{printer.ifs?.name ?? 'Mehrfachzuführung'}</div>
          <div className="mt-0.5 text-[9px] leading-snug text-white/35">
            {printer.ifs?.note ?? 'Slots werden separat pro Drucker gespeichert.'}
          </div>
        </div>
        <span className="shrink-0 rounded-full border border-sky/30 px-1.5 py-0.5 text-[8px] tracking-wider text-sky/70 uppercase">
          {slots.length} Slots
        </span>
      </div>

      <p className="rounded-xl border border-line/70 bg-ink-900/45 px-2.5 py-2 text-[9px] leading-snug text-white/35">
        Profile und Farben der Slots werden im Reiter <span className="text-sky/80">Filament</span> bearbeitet.
      </p>

      <div>
        <div className="mb-1 flex items-center gap-1 text-[10px] font-medium tracking-wider text-white/40 uppercase">
          <span>Objekt → Slot</span>
          <InfoDot label="Objekt-Slot" />
        </div>
        {objects.length === 0 ? (
          <p className="text-[9px] leading-snug text-white/30">
            Zuerst ein Modell laden. Danach kann jedes Objekt einem Slot zugeordnet werden.
          </p>
        ) : (
          <div className="space-y-1">
            {objects
              .filter((o) => o.placement.visible && !o.negative && !o.excluded)
              .map((o) => {
                const assigned =
                  slots.find((s) => s.id === o.placement.slotId) ??
                  slots.find((s) => s.profileId === o.placement.filamentId)
                return (
                  <label
                    key={o.id}
                    className={`flex items-center gap-1.5 rounded-lg border px-2 py-1 ${
                      selectedObjectId === o.id ? 'border-amber/40 bg-amber/5' : 'border-line/60 bg-ink-900/35'
                    }`}
                  >
                    <span className="min-w-0 flex-1 truncate text-[10px] text-white/65">{o.name}</span>
                    <select
                      value={assigned?.id ?? ''}
                      onChange={(e) => {
                        const slot = slots.find((s) => s.id === e.target.value) ?? null
                        onAssignSlot(o.id, slot)
                      }}
                      className="max-w-[11rem] rounded-lg border border-line/80 bg-ink-900/80 px-1.5 py-1 text-[9px] text-white/70 outline-none"
                    >
                      <option value="">Standard</option>
                      {slots.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.label} · {profiles.find((p) => p.id === s.profileId)?.name ?? s.profileId}
                        </option>
                      ))}
                    </select>
                  </label>
                )
              })}
          </div>
        )}
      </div>

      <p className="text-[9px] leading-snug text-white/25">
        Der Slicer druckt Objekte mit unterschiedlichen Slots aktuell nacheinander und setzt dazwischen M600. Für
        echtes Mehrfarben pro Schicht fehlt noch die Toolwechsel-Erzeugung.
      </p>
    </div>
  )
}

export function SettingsSidebar({
  settings,
  baseline,
  qualityPresets,
  qualityId,
  onQualityChange,
  onSaveQualityProfile,
  onRenameQualityProfile,
  onDeleteQualityProfile,
  onChange,
  onReset,
  limits,
  nozzleMaterial,
  onNozzleMaterial,
  profiles = [],
  filamentProfiles = [],
  currentFilamentName,
  onSaveFilament,
  onLoadFilament,
  onDeleteFilament,
  printer,
  objects,
  selectedObjectId,
  onObjects,
  slots,
  onSlotsChange,
  onAssignSlot,
  onOpenPrinterSettings,
  plates = [],
  plateProfiles,
  filamentId,
  activePlateId,
  plateFallbackTemps,
  onPlateTemps,
  activeSlotId,
  onActiveSlot,
  texturePreview = false,
  onTexturePreview,
}: Props) {
  const [mode, setMode] = useState<'simple' | 'profi'>('profi')
  const [role, setRole] = useState<keyof RoleGcodeSettings>('outerWall')
  const [query, setQuery] = useState('')
  const [profileName, setProfileName] = useState('')
  const [filamentSaveOpen, setFilamentSaveOpen] = useState(false)
  const [filamentSaveError, setFilamentSaveError] = useState('')
  const [qualityProfileName, setQualityProfileName] = useState('')
  const [qualityEdit, setQualityEdit] = useState<'save' | 'rename'>('save')
  // Rechtsklick auf ein eigenes Profil fragt hier nach, bevor es gelöscht wird.
  const [qualityDelete, setQualityDelete] = useState<{ id: string; label: string } | null>(null)
  const [qualityProfileError, setQualityProfileError] = useState('')
  const [confirmQualityDelete, setConfirmQualityDelete] = useState(false)
  const [tab, setTab] = useState<TabId>('quality')
  const advanced = mode === 'profi'
  const filamentOpen = tab === 'filament'
  const objectForFilament =
    objects.find((o) => o.id === selectedObjectId) ??
    objects.find((o) => o.placement.visible && !o.negative && !o.excluded) ??
    objects[0] ??
    null
  const selectedCustomQuality =
    qualityPresets.find((preset) => preset.id === qualityId && preset.custom) ?? null
  const activeSavedFilament = profiles.find((profile) => profile.id === filamentId) ?? null

  useEffect(() => {
    setQualityEdit('save')
    setQualityProfileError('')
    setConfirmQualityDelete(false)
  }, [qualityId])
  const flowFactor = Math.max(0.01, settings.flow || 1)
  const lineWidth = settings.lineWidth > 0 ? settings.lineWidth : settings.nozzle
  const maxSpeedAt = (height: number) =>
    settings.maxVolumetricFlow > 0
      ? settings.maxVolumetricFlow / (lineWidth * Math.max(0.01, height) * flowFactor)
      : Infinity
  const flowLayerHeight = settings.adaptiveLayerHeight?.enabled
    ? Math.max(settings.layerHeight, settings.adaptiveLayerHeight.maxHeight)
    : settings.layerHeight
  const flowLayerLabel = settings.adaptiveLayerHeight?.enabled
    ? `${settings.adaptiveLayerHeight.minHeight.toFixed(2)}–${settings.adaptiveLayerHeight.maxHeight.toFixed(2)}`
    : settings.layerHeight.toFixed(2)
  const limitedSpeeds = [
    { label: 'Außenwand', value: settings.speeds.outerWall, max: maxSpeedAt(flowLayerHeight) },
    { label: 'Deckfläche', value: settings.speeds.topSurface, max: maxSpeedAt(flowLayerHeight) },
    { label: 'Füllung', value: settings.speeds.infill, max: maxSpeedAt(flowLayerHeight) },
    { label: 'Stützen', value: settings.speeds.support, max: maxSpeedAt(flowLayerHeight) },
  ].filter((s) => s.value > s.max + 0.05)

  const has = (id: string, terms: string) => {
    const q = query.trim().toLowerCase()
    if (!q) return true
    return terms.toLowerCase().includes(q)
  }
  // Bei einer Suche werden alle Treffer gezeigt; sonst genau ein Reiter.
  const showTab = (id: TabId) => (query.trim() ? true : tab === id)
  const common = { settings, baseline, onChange }
  const texturePattern = settings.fuzzySkin.pattern ?? 'noise'
  const textureScale = settings.fuzzySkin.scale ?? 3
  const textureAngle = settings.fuzzySkin.angle ?? 0
  const fuzzyActive = settings.fuzzySkin.mode !== 'off'
  const textureFaces = settings.fuzzySkin.faces ?? {
    enabled: false,
    front: true,
    back: true,
    left: true,
    right: true,
  }
  const setTextureFaces = (patch: Partial<typeof textureFaces>) =>
    onChange({
      ...settings,
      fuzzySkin: { ...settings.fuzzySkin, faces: { ...textureFaces, ...patch } },
    })
  const sameNumber = (a: number, b: number) => Math.abs(a - b) < 1e-9
  const isActiveTexturePreset = (preset: SurfaceTexturePreset) =>
    texturePattern === preset.pattern &&
    sameNumber(settings.fuzzySkin.thickness, preset.thickness) &&
    sameNumber(settings.fuzzySkin.pointDistance, preset.pointDistance) &&
    sameNumber(textureScale, preset.scale) &&
    sameNumber(textureAngle, preset.angle)
  const applyTexturePreset = (preset: SurfaceTexturePreset) =>
    onChange({
      ...settings,
      fuzzySkin: {
        ...settings.fuzzySkin,
        // Nur Werte übernehmen: Ob mit Struktur geslict wird, entscheidet
        // allein der Schalter „Oberflächenstruktur“. Sonst schaltete ein Klick
        // auf ein Preset ungewollt Fuzzy Skin ein, nur um das Muster anzusehen.
        pattern: preset.pattern,
        thickness: preset.thickness,
        pointDistance: preset.pointDistance,
        scale: preset.scale,
        angle: preset.angle,
      },
    })
  const applyTexturePattern = (pattern: SurfaceTexturePreset['pattern']) =>
    onChange({
      ...settings,
      fuzzySkin: {
        ...settings.fuzzySkin,
        pattern,
      },
    })
  const textureZones = settings.fuzzySkin.textureZones ?? []
  const setTextureZones = (next: TextureZone[]) =>
    onChange({ ...settings, fuzzySkin: { ...settings.fuzzySkin, textureZones: next } })
  const updateTextureZone = (index: number, patch: Partial<TextureZone>) =>
    setTextureZones(textureZones.map((zone, i) => (i === index ? { ...zone, ...patch } : zone)))
  const updateSlot = (id: string, patch: Partial<FilamentSlot>) => {
    onSlotsChange(slots.map((slot) => (slot.id === id ? { ...slot, ...patch } : slot)))
  }

  const openFilamentSave = () => {
    const baseName = activeSavedFilament?.name ?? currentFilamentName ?? 'Mein Filament'
    setProfileName(activeSavedFilament ? `${baseName} (Variante)` : `${baseName} (eigen)`)
    setFilamentSaveError('')
    setFilamentSaveOpen(true)
  }

  const saveFilamentProfile = (name: string, targetId?: string) => {
    const error = onSaveFilament?.(name, targetId) ?? null
    if (error) {
      setFilamentSaveError(error)
      return
    }
    setFilamentSaveError('')
    setFilamentSaveOpen(false)
  }

  const submitQualityProfileName = () => {
    const name = qualityProfileName.trim() || selectedCustomQuality?.label || 'Mein Profil'
    if (qualityEdit === 'rename' && selectedCustomQuality) {
      const error = onRenameQualityProfile(selectedCustomQuality.id, name)
      if (error) {
        setQualityProfileError(error)
        return
      }
      setQualityProfileName('')
      setQualityEdit('save')
      setQualityProfileError('')
      return
    }
    onSaveQualityProfile(name)
    setQualityProfileName('')
    setQualityProfileError('')
  }

  return (
    <aside className="flex min-w-0 flex-col gap-2.5">
      <div className="rounded-2xl border border-line/70 bg-ink-900/55 p-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="text-[10px] font-semibold tracking-[0.16em] text-white/40 uppercase">Projekt</div>
            <div className="mt-0.5 text-[10px] text-white/30">
              {filamentOpen ? 'Filament-Einstellungen' : 'Slicer-Einstellungen'}
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap justify-end gap-1">
            {filamentOpen && (
              <button
                type="button"
                onClick={() => {
                  setTab('quality')
                  setQuery('')
                }}
                title="Zurück zu den Slicer-Einstellungen"
                className="rounded-lg border border-line/80 px-2 py-1 text-[10px] text-white/50 transition hover:border-amber/50 hover:text-amber"
              >
                ← Slicer
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setTab('filament')
                setQuery('')
              }}
              className={`rounded-lg border px-2 py-1 text-[10px] transition ${
                filamentOpen
                  ? 'border-mint/50 bg-mint/10 text-mint'
                  : 'border-line/80 text-white/50 hover:border-mint/45 hover:text-mint'
              }`}
            >
              Filament
            </button>
            <button
              type="button"
              onClick={onOpenPrinterSettings}
              className="rounded-lg border border-line/80 px-2 py-1 text-[10px] text-white/50 transition hover:border-amber/50 hover:text-amber"
            >
              ⚙ Einstellungen
            </button>
          </div>
        </div>

        <label className="mt-3 block">
          <span className="mb-1 flex items-center gap-1 text-[9px] font-medium tracking-wider text-white/35 uppercase">
            Filamentprofil
          </span>
          <select
            value={filamentId ?? 'pla'}
            onChange={(event) => onLoadFilament?.(event.target.value)}
            disabled={!onLoadFilament}
            className="w-full rounded-lg border border-line/80 bg-ink-900/70 px-2 py-1.5 text-[11px] font-medium text-white/80 outline-none focus:border-amber/60 disabled:opacity-50"
          >
            <option value="pla">Standard · PLA</option>
            {profiles.length > 0 && (
              <optgroup label="Gespeicherte Profile">
                {profiles.map((profile) => (
                  <option key={profile.id} value={profile.id}>
                    {profile.name}
                  </option>
                ))}
              </optgroup>
            )}
            <optgroup label="Katalog">
              {filamentProfiles
                .filter((profile) => profile.id !== 'pla' && !profiles.some((saved) => saved.id === profile.id))
                .map((profile) => (
                  <option key={profile.id} value={profile.id}>
                    {profile.name}
                  </option>
                ))}
            </optgroup>
          </select>
          <span className="mt-1 block text-[8px] leading-snug text-white/25">
            Auswahl lädt Temperatur, Kühlung, Rückzug und Schrumpfung des gespeicherten Profils.
          </span>
        </label>

        {filamentOpen && onSaveFilament && (
          <div className="mt-2 rounded-xl border border-sky/25 bg-sky/5 p-2">
            <div className="flex items-center justify-between gap-1">
              <span className="text-[9px] font-medium tracking-wider text-sky/70 uppercase">
                Eigenes Filamentprofil
              </span>
              <span className="min-w-0 truncate text-[8px] text-white/30">
                Aktiv: {activeSavedFilament?.name ?? currentFilamentName ?? 'Standard'}
              </span>
            </div>
            {!filamentSaveOpen ? (
              <button
                type="button"
                onClick={openFilamentSave}
                className="mt-1.5 w-full rounded-lg border border-sky/40 bg-sky/15 px-2 py-2 text-[10px] font-semibold text-sky transition hover:bg-sky/25"
              >
                Speichern …
              </button>
            ) : (
              <div className="mt-1.5 space-y-1.5">
                {activeSavedFilament ? (
                  <button
                    type="button"
                    onClick={() => saveFilamentProfile(activeSavedFilament.name, activeSavedFilament.id)}
                    className="w-full rounded-lg border border-mint/40 bg-mint/15 px-2 py-2 text-left text-[10px] font-semibold text-mint transition hover:bg-mint/25"
                  >
                    In „{activeSavedFilament.name}“ speichern
                    <span className="mt-0.5 block text-[8px] font-normal text-mint/60">
                      Überschreibt dieses Profil mit den aktuellen Werten.
                    </span>
                  </button>
                ) : (
                  <p className="rounded-lg border border-amber/30 bg-amber/8 px-2 py-1.5 text-[8px] leading-snug text-amber/80">
                    „{currentFilamentName ?? 'Das aktuelle Profil'}“ ist ein Katalogprofil. Änderungen können nur als eigenes Profil gespeichert werden.
                  </p>
                )}

                <div className="rounded-lg border border-line/70 bg-ink-900/45 p-2">
                  <span className="block text-[8px] font-medium tracking-wider text-white/35 uppercase">
                    {activeSavedFilament ? 'Oder neues Profil anlegen' : 'Als neues Profil speichern'}
                  </span>
                  <div className="mt-1 flex gap-1.5">
                    <input
                      value={profileName}
                      onChange={(e) => {
                        setProfileName(e.target.value)
                        if (filamentSaveError) setFilamentSaveError('')
                      }}
                      onKeyDown={(e) => {
                        if (e.key !== 'Enter') return
                        e.preventDefault()
                        saveFilamentProfile(profileName.trim() || currentFilamentName || 'Mein Filament')
                      }}
                      placeholder="Name, z. B. PLA Blau"
                      maxLength={40}
                      className="min-w-0 flex-1 rounded-lg border border-line/80 bg-ink-900/70 px-2 py-1.5 text-[10px] text-white/80 outline-none focus:border-sky/50"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        saveFilamentProfile(profileName.trim() || currentFilamentName || 'Mein Filament')
                      }
                      className="shrink-0 rounded-lg bg-sky/25 px-2 py-1 text-[10px] font-semibold text-sky transition hover:bg-sky/35"
                    >
                      Neu speichern
                    </button>
                  </div>
                  {filamentSaveError && (
                    <p role="alert" className="mt-1 text-[9px] leading-snug text-rose">
                      {filamentSaveError}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setFilamentSaveOpen(false)}
                  className="w-full rounded-lg border border-line/70 px-2 py-1 text-[9px] text-white/40 transition hover:text-white/75"
                >
                  Abbrechen
                </button>
              </div>
            )}
            <p className="mt-1 text-[8px] leading-snug text-white/30">
              Speichert Temperatur, Kühlung, Rückzug, Fluss und Schrumpfung. Das aktive Profil wird danach weiterverwendet.
            </p>
          </div>
        )}

        <div className={filamentOpen ? 'hidden' : ''}>
          {objectForFilament && filamentProfiles.length > 0 && (
            <div className="mt-2.5 rounded-xl border border-line/70 bg-ink-900/45 p-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[9px] font-medium tracking-wider text-white/35 uppercase">
                  Filament für dieses Objekt
                </span>
                <span className="min-w-0 truncate text-[9px] text-white/30" title={objectForFilament.name}>
                  {objectForFilament.name} · {objectForFilament.size.x.toFixed(0)}×
                  {objectForFilament.size.y.toFixed(0)}×{objectForFilament.size.z.toFixed(0)} mm
                </span>
              </div>
              <select
                value={objectForFilament.placement.filamentId ?? ''}
                onChange={(e) => {
                  const filamentId = e.target.value || undefined
                  onObjects?.(
                    objects.map((o) =>
                      o.id === objectForFilament.id
                        ? { ...o, placement: { ...o.placement, filamentId } }
                        : o,
                    ),
                  )
                }}
                disabled={!onObjects}
                title="Beim Slicen werden Objekte mit unterschiedlichen Filamenten nacheinander gedruckt (M600 dazwischen)."
                className="mt-1 w-full rounded-lg border border-line/80 bg-ink-900/80 px-2 py-1 text-[10px] text-white/75 outline-none focus:border-amber/60 disabled:opacity-50"
              >
                <option value="">Standard (aktuelles Filament)</option>
                {filamentProfiles.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </div>
          )}

        <label className="mt-3 block">
          <span className="mb-1 flex items-center gap-1 text-[9px] font-medium tracking-wider text-white/35 uppercase">
            Qualitätsprofil
            <InfoDot label="Qualitätsprofil" />
          </span>
          <select
            value={qualityId}
            onChange={(e) => onQualityChange(e.target.value)}
            className="w-full rounded-lg border border-line/80 bg-ink-900/70 px-2 py-1.5 text-[11px] font-medium text-white/80 outline-none focus:border-amber/60"
          >
            {qualityPresets.map((p) => (
              <option key={p.id} value={p.id}>
                {p.custom ? '★ ' : ''}
                {p.label} · {p.layerHeight.toFixed(2).replace('.', ',')} mm
              </option>
            ))}
            <option value="custom" disabled>
              Benutzerdefiniert
            </option>
          </select>
        </label>

        <div className="mt-1.5 grid grid-cols-2 gap-1">
          {qualityPresets.map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => onQualityChange(preset.id)}
              onContextMenu={(e) => {
                if (!preset.custom) return
                e.preventDefault()
                setQualityDelete({ id: preset.id, label: preset.label })
              }}
              title={preset.custom ? `${preset.note ?? preset.label} · Rechtsklick löscht` : (preset.note ?? preset.label)}
              className={`rounded-lg border px-2 py-1 text-left transition ${
                qualityId === preset.id
                  ? 'border-amber/60 bg-amber/12 text-amber'
                  : 'border-line/70 text-white/45 hover:border-white/20 hover:text-white/70'
              }`}
            >
              <span className="block text-[10px] leading-snug font-semibold">
                {preset.custom ? '★ ' : ''}
                {preset.label}
              </span>
              <span className="block text-[8px] text-white/30">
                {preset.custom ? 'Eigenes · ' : ''}
                {preset.layerHeight.toFixed(2).replace('.', ',')} mm
              </span>
            </button>
          ))}
        </div>
        {qualityDelete && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 rounded-lg border border-rose/40 bg-rose/[0.06] px-2 py-1.5">
            <span className="min-w-0 flex-1 text-[9px] leading-snug text-white/60">
              Eigenes Profil „{qualityDelete.label}“ löschen?
            </span>
            <button
              type="button"
              onClick={() => {
                onDeleteQualityProfile(qualityDelete.id)
                setQualityDelete(null)
              }}
              className="shrink-0 rounded-md border border-rose/50 bg-rose/15 px-2 py-0.5 text-[9px] font-semibold text-rose transition hover:bg-rose/25"
            >
              Löschen
            </button>
            <button
              type="button"
              onClick={() => setQualityDelete(null)}
              className="shrink-0 rounded-md border border-line/70 px-2 py-0.5 text-[9px] text-white/45 transition hover:text-white/80"
            >
              Abbrechen
            </button>
          </div>
        )}
        {qualityPresets.find((p) => p.id === qualityId)?.note && (
          <p className="mt-1.5 rounded-lg border border-line/60 bg-ink-900/45 px-2 py-1.5 text-[9px] leading-snug text-white/45">
            {qualityPresets.find((p) => p.id === qualityId)?.note}
          </p>
        )}

        <div className="mt-2 flex gap-1.5">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Einstellungen suchen …"
            className="min-w-0 flex-1 rounded-lg border border-line/80 bg-ink-900/70 px-2 py-1.5 text-[10px] text-white/75 outline-none placeholder:text-white/25 focus:border-amber/50"
          />
          <button
            type="button"
            onClick={onReset}
            title="Alle Werte auf das gewählte Qualitätsprofil zurücksetzen"
            className="rounded-lg border border-line/80 px-2 text-[10px] text-white/35 transition hover:border-amber/50 hover:text-amber"
          >
            ↺
          </button>
        </div>

        <div className="mt-1.5 flex gap-1.5">
          <input
            value={qualityProfileName}
            onChange={(e) => {
              setQualityProfileName(e.target.value)
              setQualityProfileError('')
            }}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return
              e.preventDefault()
              submitQualityProfileName()
            }}
            maxLength={48}
            placeholder={qualityEdit === 'rename' ? 'Neuer Profilname …' : 'Eigenes Profil benennen …'}
            className="min-w-0 flex-1 rounded-lg border border-line/80 bg-ink-900/70 px-2 py-1.5 text-[10px] text-white/75 outline-none placeholder:text-white/25 focus:border-mint/50"
          />
          <button
            type="button"
            onClick={submitQualityProfileName}
            title={
              qualityEdit === 'rename'
                ? `Profil für ${printer.name} umbenennen`
                : `Aktuelle Qualitätswerte als eigenes Profil für ${printer.name} speichern`
            }
            className="shrink-0 rounded-lg border border-mint/40 bg-mint/10 px-2 py-1 text-[10px] font-semibold text-mint transition hover:bg-mint/20"
          >
            {qualityEdit === 'rename' ? 'Umbenennen' : 'Profil speichern'}
          </button>
          {qualityEdit === 'rename' && (
            <button
              type="button"
              onClick={() => {
                setQualityEdit('save')
                setQualityProfileName('')
                setQualityProfileError('')
              }}
              title="Umbenennen abbrechen"
              className="shrink-0 rounded-lg border border-line/80 px-2 text-[10px] text-white/40 transition hover:text-white/80"
            >
              ✕
            </button>
          )}
        </div>
        {qualityEdit !== 'rename' && qualityPresets.some((p) => p.custom) && (
          <div className="mt-1.5">
            <span className="text-[8px] tracking-wider text-white/25 uppercase">Vorhandenes überschreiben</span>
            <div className="mt-1 flex flex-wrap gap-1">
              {qualityPresets
                .filter((p) => p.custom)
                .map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => {
                      setQualityProfileName(p.label)
                      setQualityProfileError('')
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault()
                      setQualityDelete({ id: p.id, label: p.label })
                    }}
                    title={`Werte in „${p.label}“ speichern · Rechtsklick löscht`}
                    className={`max-w-full truncate rounded-md border px-1.5 py-0.5 text-[9px] transition ${
                      qualityProfileName.trim() === p.label
                        ? 'border-amber/60 bg-amber/12 text-amber'
                        : 'border-line/70 text-white/45 hover:border-white/25 hover:text-white/75'
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
            </div>
            <p className="mt-1 text-[8px] leading-snug text-white/25">
              Antippen wählt das Profil — danach „Profil speichern“.
            </p>
          </div>
        )}
        <p className="mt-1 text-[8px] leading-snug text-white/25">
          {qualityEdit === 'rename'
            ? `Neuer Name für „${selectedCustomQuality?.label ?? 'dieses Profil'}“.`
            : `Wird für ${printer.name} gespeichert. Gleicher Name überschreibt das Profil.`}
        </p>
        {qualityProfileError && (
          <p className="mt-1 text-[9px] leading-snug text-rose">{qualityProfileError}</p>
        )}

        {selectedCustomQuality && (
          <div className="mt-1.5 rounded-lg border border-mint/25 bg-mint/[0.04] px-2 py-1.5">
            {confirmQualityDelete ? (
              <div className="flex flex-wrap items-center gap-1">
                <span className="min-w-0 flex-1 text-[9px] leading-snug text-rose/90">
                  „{selectedCustomQuality.label}“ wirklich löschen?
                </span>
                <button
                  type="button"
                  onClick={() => {
                    onDeleteQualityProfile(selectedCustomQuality.id)
                    setConfirmQualityDelete(false)
                    setQualityProfileName('')
                    setQualityEdit('save')
                    setQualityProfileError('')
                  }}
                  className="rounded-md border border-rose/40 px-1.5 py-0.5 text-[9px] text-rose transition hover:bg-rose/10"
                >
                  Löschen
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmQualityDelete(false)}
                  className="rounded-md border border-line/80 px-1.5 py-0.5 text-[9px] text-white/45 transition hover:text-white/80"
                >
                  Abbrechen
                </button>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-1">
                <span className="min-w-0 flex-1 truncate text-[9px] text-mint/80">
                  ★ {selectedCustomQuality.label}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setQualityEdit('rename')
                    setQualityProfileName(selectedCustomQuality.label)
                    setQualityProfileError('')
                    setConfirmQualityDelete(false)
                  }}
                  className="rounded-md border border-mint/35 px-1.5 py-0.5 text-[9px] text-mint/85 transition hover:bg-mint/10"
                >
                  Umbenennen
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setConfirmQualityDelete(true)
                    setQualityEdit('save')
                    setQualityProfileError('')
                  }}
                  className="rounded-md border border-rose/30 px-1.5 py-0.5 text-[9px] text-rose/75 transition hover:bg-rose/10 hover:text-rose"
                >
                  Löschen
                </button>
              </div>
            )}
          </div>
        )}

        <div className="mt-2">
          <Segmented
            size="sm"
            value={mode}
            onChange={setMode}
            options={[
              { value: 'simple', label: 'Einfach' },
              { value: 'profi', label: 'Profi' },
            ]}
          />
        </div>
      </div>
      </div>

      <div
        className={`top-0 z-20 rounded-2xl border border-line/70 bg-ink-950/95 p-1.5 shadow-lg backdrop-blur ${
          filamentOpen ? 'hidden' : 'sticky'
        }`}
      >
        <div className="flex gap-1 overflow-x-auto pb-0.5">
          {TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                setTab(item.id)
                setQuery('')
              }}
              className={`shrink-0 rounded-xl px-2.5 py-1.5 text-[11px] font-medium whitespace-nowrap transition ${
                tab === item.id && !query.trim()
                  ? 'bg-amber/90 text-ink-950'
                  : 'text-white/55 hover:bg-white/6 hover:text-white/85'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {has('quality', 'qualität schichthöhe linienbreite naht glätten ironing flow brücke elefantenfuß erste schicht einzug kompensation adaptiv adaptive gap lücke lücken füllung höhenbereich height range modifier') && (
        <Section
          title="Qualität"
          hint={`${settings.layerHeight.toFixed(2)} mm${settings.adaptiveLayerHeight.enabled ? ' adaptiv' : ''} · ${settings.lineWidth.toFixed(2)} mm Linie`}
          active={showTab('quality')}
        >
          <div className="grid grid-cols-1 gap-2">
            <Num label="Schichthöhe" unit="mm" step={0.02} min={limits.layer[0]} max={limits.layer[1]} value={settings.layerHeight} path={['layerHeight']} {...common} />
            <Num label="Schichthöhe erste Schicht" unit="mm" step={0.02} min={limits.layer[0]} max={limits.layer[1]} value={settings.firstLayerHeight} path={['firstLayerHeight']} {...common} />
            <Fold
              title="Adaptive Schichthöhe"
              hint={
                settings.adaptiveLayerHeight.enabled
                  ? `${settings.adaptiveLayerHeight.minHeight.toFixed(2)}–${settings.adaptiveLayerHeight.maxHeight.toFixed(2)} mm · Ziel ${settings.adaptiveLayerHeight.quality.toFixed(2)} mm`
                  : 'aus'
              }
            >
              <Bool
                label="Adaptive Schichthöhe"
                value={settings.adaptiveLayerHeight.enabled}
                path={['adaptiveLayerHeight', 'enabled']}
                hint="Feinere Schichten auf flachen oder schrägen Flächen, höhere auf steilen Wänden. Die erste Schicht bleibt unverändert."
                {...common}
              />
              {settings.adaptiveLayerHeight.enabled && (
                <>
                  <Num
                    label="Min. Schichthöhe"
                    unit="mm"
                    step={0.02}
                    min={limits.layer[0]}
                    max={limits.layer[1]}
                    value={settings.adaptiveLayerHeight.minHeight}
                    path={['adaptiveLayerHeight', 'minHeight']}
                    {...common}
                  />
                  <Num
                    label="Max. Schichthöhe"
                    unit="mm"
                    step={0.02}
                    min={limits.layer[0]}
                    max={limits.layer[1]}
                    value={settings.adaptiveLayerHeight.maxHeight}
                    path={['adaptiveLayerHeight', 'maxHeight']}
                    {...common}
                  />
                  <Num
                    label="Zielabweichung"
                    unit="mm"
                    step={0.01}
                    min={0.02}
                    max={0.3}
                    value={settings.adaptiveLayerHeight.quality}
                    path={['adaptiveLayerHeight', 'quality']}
                    {...common}
                  />
                  <p className="rounded-lg border border-line/50 bg-ink-900/30 px-2 py-1.5 text-[9px] leading-snug text-white/35">
                    Kleinere Zielabweichung = feinere Schichten und mehr Zeit. Die maximale Höhe gilt an senkrechten Wänden; flache Flächen werden bis zur minimalen Höhe verfeinert.
                  </p>
                  {settings.adaptiveLayerHeight.minHeight > settings.adaptiveLayerHeight.maxHeight && (
                    <p className="rounded-lg border border-amber/30 bg-amber/8 px-2 py-1.5 text-[9px] leading-snug text-amber/80">
                      Die minimale Schichthöhe ist größer als die maximale. Beim Slicen werden die Grenzen getauscht — besser Min kleiner als Max einstellen.
                    </p>
                  )}
                </>
              )}
            </Fold>
            <Fold
              title="Gap-Fill / variable Breite"
              hint={
                settings.gapFill.enabled
                  ? `${settings.gapFill.minWidth.toFixed(2)}–${settings.gapFill.maxWidth.toFixed(2)} mm · Fluss ${settings.gapFill.flow.toFixed(2)}`
                  : 'aus'
              }
            >
              <Bool
                label="Gap-Fill"
                value={settings.gapFill.enabled}
                path={['gapFill', 'enabled']}
                hint="Füllt schmale Restflächen zwischen Wänden mit einer an die örtliche Dicke angepassten Bahn. Die Breite bleibt zwischen Min und Max."
                {...common}
              />
              {settings.gapFill.enabled && (
                <>
                  <Num
                    label="Min. Gap-Breite"
                    unit="mm"
                    step={0.02}
                    min={0.05}
                    max={1.2}
                    value={settings.gapFill.minWidth}
                    path={['gapFill', 'minWidth']}
                    {...common}
                  />
                  <Num
                    label="Max. Gap-Breite"
                    unit="mm"
                    step={0.02}
                    min={0.05}
                    max={1.2}
                    value={settings.gapFill.maxWidth}
                    path={['gapFill', 'maxWidth']}
                    {...common}
                  />
                  <Num
                    label="Gap-Fluss"
                    unit="×"
                    step={0.02}
                    min={0.1}
                    max={2}
                    value={settings.gapFill.flow}
                    path={['gapFill', 'flow']}
                    {...common}
                  />
                  <p className="rounded-lg border border-line/50 bg-ink-900/30 px-2 py-1.5 text-[9px] leading-snug text-white/35">
                    Die Bahnbreite folgt dem gemessenen Abstand zur Kante. Mehr Fluss hilft bei breiten Lücken; zu viel erzeugt Wülste an dünnen Stellen.
                  </p>
                  {settings.gapFill.minWidth > settings.gapFill.maxWidth && (
                    <p className="rounded-lg border border-amber/30 bg-amber/8 px-2 py-1.5 text-[9px] leading-snug text-amber/80">
                      Die minimale Gap-Breite ist größer als die maximale. Beim Slicen wird die maximale Breite als Obergrenze verwendet.
                    </p>
                  )}
                </>
              )}
            </Fold>
            <HeightRangeEditor settings={settings} onChange={onChange} />
            <Num label="Linienbreite" unit="mm" step={0.02} min={0.2} max={1.2} value={settings.lineWidth} path={['lineWidth']} {...common} />
            {advanced && (
              <>
                <Num label="Linienbreite erste Schicht" unit="mm" step={0.02} min={0.2} max={1.2} value={settings.firstLayerLineWidth} path={['firstLayerLineWidth']} {...common} />
                <Num label="Linienbreite Außenwand" unit="mm" step={0.02} min={0.2} max={1.2} value={settings.outerWallLineWidth} path={['outerWallLineWidth']} {...common} />
                <Num label="Linienbreite Innenwand" unit="mm" step={0.02} min={0.2} max={1.2} value={settings.innerWallLineWidth} path={['innerWallLineWidth']} {...common} />
                <Num label="Linienbreite Deckfläche" unit="mm" step={0.02} min={0.2} max={1.2} value={settings.topSurfaceLineWidth} path={['topSurfaceLineWidth']} {...common} />
              </>
            )}

            <Fold
              title="Elefantenfuß"
              hint={
                settings.elephantFoot.enabled
                  ? `${settings.elephantFoot.amount.toFixed(2)} mm · ${settings.elephantFoot.scope === 'outer-wall' ? 'Außenwand' : 'ganze Schicht'}`
                  : 'aus'
              }
            >
              <Bool
                label="Kompensation"
                value={settings.elephantFoot.enabled}
                path={['elephantFoot', 'enabled']}
                hint="Zieht nur die erste Schicht horizontal ein und lässt die Außenmaße der übrigen Schichten unverändert."
                {...common}
              />
              {settings.elephantFoot.enabled && (
                <>
                  <Num
                    label="Einzug pro Seite"
                    unit="mm"
                    step={0.05}
                    min={-0.5}
                    max={0.5}
                    value={settings.elephantFoot.amount}
                    path={['elephantFoot', 'amount']}
                    {...common}
                  />
                  <Choice
                    label="Kompensationsbereich"
                    value={settings.elephantFoot.scope}
                    path={['elephantFoot', 'scope']}
                    options={[
                      { value: 'outer-wall' as const, label: 'Nur Außenwand' },
                      { value: 'first-layer' as const, label: 'Gesamte erste Schicht' },
                    ]}
                    {...common}
                  />
                  {Math.abs(settings.elephantFoot.amount) >=
                    Math.max(0.1, (settings.firstLayerLineWidth > 0 ? settings.firstLayerLineWidth : settings.lineWidth) * 0.5) && (
                    <p className="rounded-lg border border-amber/30 bg-amber/8 px-2 py-1.5 text-[9px] leading-snug text-amber/80">
                      Der Einzug ist mindestens eine halbe erste Linienbreite groß. Das kann die Wandüberlappung und die Haftfläche der ersten Schicht zu stark verringern — Betrag reduzieren.
                    </p>
                  )}
                </>
              )}
              <ElephantFootCalculator settings={settings} onChange={onChange} />
            </Fold>

            <Fold title="Naht" hint={settings.seam.scarf.enabled ? 'Position, Scarf und Wischen' : 'Position und Wischen'}>
              <Choice
                label="Position"
                value={settings.seam.position}
                path={['seam', 'position']}
                options={[
                  { value: 'nearest' as SeamPosition, label: 'Nächste' },
                  { value: 'rear' as SeamPosition, label: 'Hinten' },
                  { value: 'aligned' as SeamPosition, label: 'Bündig' },
                  { value: 'random' as SeamPosition, label: 'Zufall' },
                ]}
                {...common}
              />
              <Num label="Nahtlücke" unit="mm" step={0.05} min={0} max={0.6} value={settings.seam.gap} path={['seam', 'gap']} {...common} />
              <Bool label="Naht wischen" value={settings.seam.wipe} path={['seam', 'wipe']} {...common} />
              <Bool
                label="Scarf-Naht"
                value={settings.seam.scarf.enabled}
                path={['seam', 'scarf', 'enabled']}
                hint="Lässt Anfang und Ende der Außenwand in Höhe und Fluss auslaufen, statt sie mit einer harten Kante zu treffen. Wirkt ab Schicht 2, nicht im Vasenmodus und nicht auf der ersten Schicht."
                {...common}
              />
              {settings.seam.scarf.enabled && (
                <>
                  <Num
                    label="Scarf-Länge"
                    unit="mm"
                    step={1}
                    min={1}
                    max={50}
                    value={settings.seam.scarf.length}
                    path={['seam', 'scarf', 'length']}
                    {...common}
                  />
                  <Num
                    label="Scarf-Starthöhe"
                    unit="%"
                    step={5}
                    min={0}
                    max={90}
                    value={settings.seam.scarf.startHeight}
                    path={['seam', 'scarf', 'startHeight']}
                    {...common}
                  />
                  <Num
                    label="Scarf-Schritte"
                    step={1}
                    min={2}
                    max={50}
                    value={settings.seam.scarf.steps}
                    path={['seam', 'scarf', 'steps']}
                    {...common}
                  />
                  <Num
                    label="Scarf-Fluss"
                    unit="×"
                    step={0.05}
                    min={0.2}
                    max={1.5}
                    value={settings.seam.scarf.flow}
                    path={['seam', 'scarf', 'flow']}
                    {...common}
                  />
                  <Bool
                    label="Scarf auch Innenwände"
                    value={settings.seam.scarf.innerWalls}
                    path={['seam', 'scarf', 'innerWalls']}
                    hint="Legt die Rampe auch an Innenwände. Standardmäßig bleibt die sichtbare Außenwand die einzige Scarf-Naht."
                    {...common}
                  />
                  <div className="col-span-full rounded-lg border border-sky/25 bg-sky/[0.04] px-2 py-1.5 text-[8px] leading-snug text-sky/70">
                    Die Rampe startet auf der vorherigen Schicht und endet wieder dort; die Düse wird danach
                    angehoben. Eine sehr kleine Starthöhe oder ein Fluss unter 0,8 kann die Naht dünn und
                    unterextrudiert wirken lassen. Nahtlücke bleibt zusätzlich aktiv.
                  </div>
                </>
              )}
            </Fold>

            <Fold title="Glätten" hint={settings.ironing.enabled ? 'aktiv' : 'aus'}>
            {FEATURES.surfaceGuard && (
              <>
                <Bool
                  label="Kratzerfreie Oberfläche"
                  value={settings.surfaceGuard.enabled}
                  path={['surfaceGuard', 'enabled']}
                  hint="Dichter Unterbau, zusätzliche Deckschichten und höherer Fahrweg-Hub gegen Düsenkratzer."
                  {...common}
                />
                {advanced && (
                  <>
                    <Num label="Zusätzliche Deckschichten" step={1} min={0} max={6} value={settings.surfaceGuard.extraTopLayers} path={['surfaceGuard', 'extraTopLayers']} {...common} />
                    <Num label="Volle Stützschichten" step={1} min={0} max={6} value={settings.surfaceGuard.baseSolidLayers} path={['surfaceGuard', 'baseSolidLayers']} {...common} />
                    <Num label="Fahrweg-Hub" unit="mm" step={0.1} min={0.2} max={1.5} value={settings.surfaceGuard.travelHop} path={['surfaceGuard', 'travelHop']} {...common} />
                    <Num label="Rückzug ab Weg" unit="mm" step={0.1} min={0.5} max={3} value={settings.surfaceGuard.retractAbove} path={['surfaceGuard', 'retractAbove']} {...common} />
                    <Num label="Glätteinzug Schutz" unit="mm" step={0.05} min={0} max={2} value={settings.surfaceGuard.ironingInset} path={['surfaceGuard', 'ironingInset']} {...common} />
                  </>
                )}
              </>
            )}
            <Bool
              label="Glätten aktiv"
              value={settings.ironing.enabled}
              path={['ironing', 'enabled']}
              hint="Oberfläche mit einer heißen Düse ohne Material glätten."
              {...common}
            />
            {advanced && (
              <>
                <Choice
                  label="Glättbereich"
                  value={settings.ironing.type}
                  path={['ironing', 'type']}
                  options={[
                    { value: 'top' as const, label: 'Nur oberste Schicht' },
                    { value: 'solid' as const, label: 'Alle Deckschichten' },
                  ]}
                  {...common}
                />
                <Num label="Glättwinkel" unit="°" step={5} min={0} max={175} value={settings.ironing.angle} path={['ironing', 'angle']} {...common} />
                <Choice
                  label="Glättmuster"
                  value={settings.ironing.pattern}
                  path={['ironing', 'pattern']}
                  options={[
                    { value: 'lines' as const, label: 'Linien' },
                    { value: 'grid' as const, label: 'Gitternetz' },
                    { value: 'concentric' as const, label: 'Konzentrisch' },
                  ]}
                  {...common}
                />
              </>
            )}
            <Num
              label="Glättfluss"
              unit="%"
              step={1}
              min={2}
              max={60}
              displayFactor={100}
              value={settings.ironing.flow}
              path={['ironing', 'flow']}
              {...common}
            />
            <Num label="Glätttempo" unit="mm/s" step={5} min={5} max={80} value={settings.ironing.speed} path={['ironing', 'speed']} {...common} />
            <Num
              label="Glättlinien-Abstand"
              unit="mm"
              step={0.01}
              min={0.04}
              max={0.4}
              value={settings.ironing.spacing}
              path={['ironing', 'spacing']}
              {...common}
            />
            <Num
              label="Glätteinzug"
              unit="mm"
              step={0.05}
              min={0}
              max={2}
              value={settings.ironing.inset}
              path={['ironing', 'inset']}
              {...common}
            />
            </Fold>

            <Fold title="Fluss" hint="Haupt, Deck, Boden, Brücke">
              <Num label="Hauptfluss (global)" unit="×" step={0.02} min={0.5} max={1.5} value={settings.flow} path={['flow']} {...common} />
              <Num label="Deckflächenfluss" unit="×" step={0.02} min={0.5} max={1.5} value={settings.topSurfaceFlow} path={['topSurfaceFlow']} {...common} />
              <Num label="Bodenflächenfluss" unit="×" step={0.02} min={0.5} max={1.5} value={settings.bottomSurfaceFlow} path={['bottomSurfaceFlow']} {...common} />
              <Num label="Brückenfluss" unit="×" step={0.02} min={0.5} max={1.5} value={settings.bridgeFlow} path={['bridgeFlow']} {...common} />
            </Fold>
          </div>
        </Section>
      )}

      {has('structure', 'struktur wände decklagen boden füllung infill überlappung reihenfolge') && (
        <Section
          title="Struktur"
          hint={`${settings.walls} Wände · ${settings.infillDensity} % Füllung`}
          active={showTab('structure')}
        >
          <div className="grid grid-cols-1 gap-2">
            <Subhead>Druckreihenfolge</Subhead>
            <Choice
              label="Reihenfolge der Wände"
              value={settings.printOrder.walls}
              path={['printOrder', 'walls']}
              options={[
                { value: 'inner-first' as WallOrder, label: 'Innen zuerst, außen zuletzt' },
                { value: 'outer-first' as WallOrder, label: 'Außen zuerst, innen zuletzt' },
              ]}
              {...common}
            />
            <Choice
              label="Reihenfolge innerhalb der Schicht"
              value={settings.printOrder.layer}
              path={['printOrder', 'layer']}
              options={[
                { value: 'walls-first' as LayerOrder, label: 'Wände, dann Decklage und Füllung' },
                { value: 'infill-first' as LayerOrder, label: 'Decklage und Füllung, dann Wände' },
              ]}
              {...common}
            />
            <Choice
              label="Sortierung der Einzelbahnen"
              value={settings.printOrder.paths}
              path={['printOrder', 'paths']}
              options={[
                { value: 'shortest' as PathOrder, label: 'Kürzeste Wege zwischen den Bahnen' },
                { value: 'generated' as PathOrder, label: 'Bahnen in Erzeugungsreihenfolge' },
              ]}
              {...common}
            />
            <Bool
              label="Durchgehende Innenbahnen"
              value={settings.printOrder.continuous}
              path={['printOrder', 'continuous']}
              hint="Kurze Wege zwischen Innenwänden und Füllbahnen ohne Rückzug und Z-Hop. Außenwände behalten ihren Rückzug."
              {...common}
            />
            <p className="rounded-xl border border-sky/20 bg-sky/[0.04] px-2.5 py-2 text-[10px] leading-snug text-white/45">
              Diese Optionen ändern die tatsächliche Fahrtreihenfolge im G-Code. Die kürzeste Sortierung
              vermeidet Leerfahrten; die Erzeugungsreihenfolge druckt die Bahnen ohne Umsortierung.
            </p>
            <Fold title="Wände und Füllung" hint={`${settings.walls} Wände · ${settings.infillDensity} %`}>
            <Num label="Wände" step={1} min={0} max={8} value={settings.walls} path={['walls']} {...common} />
            <Num label="Deckschichten" step={1} min={1} max={10} value={settings.topLayers} path={['topLayers']} {...common} />
            <Num label="Bodenschichten" step={1} min={1} max={10} value={settings.bottomLayers} path={['bottomLayers']} {...common} />
            <Num label="Füllung" unit="%" step={5} min={0} max={100} value={settings.infillDensity} path={['infillDensity']} {...common} />
            <Choice
              label="Füllmuster"
              value={settings.infillPattern}
              path={['infillPattern']}
              options={INFILL_OPTIONS}
              {...common}
            />
            <Num label="Füllwinkel" unit="°" step={5} min={0} max={175} value={settings.infillAngle} path={['infillAngle']} {...common} />
            {advanced && (
              <>
                <Num label="Füllungsüberlappung" unit="%" step={1} min={0} max={50} value={settings.infillOverlap} path={['infillOverlap']} {...common} />
                <Bool
                  label="Zusätzliche Wand alle 2 Schichten"
                  value={settings.alternateExtraWall}
                  path={['alternateExtraWall']}
                  hint="Verzahnt die Füllung zusätzlich mit den Wänden."
                  {...common}
                />
              </>
            )}
            </Fold>
          </div>
        </Section>
      )}

      {has('speed', 'geschwindigkeit tempo beschleunigung brücke stützen deckfläche') && (
        <Section
          title="Geschwindigkeit"
          hint={`${settings.speeds.print} mm/s Grundtempo`}
          active={showTab('speed')}
        >
          <div className="grid grid-cols-1 gap-2">
            <Fold title="Geschwindigkeit" hint={`${settings.speeds.print} mm/s`}>
            <Num label="Grundtempo" unit="mm/s" step={5} min={5} max={limits.speed} value={settings.speeds.print} path={['speeds', 'print']} {...common} />
            <Num label="Außenwand" unit="mm/s" step={5} min={5} max={limits.speed} value={settings.speeds.outerWall} path={['speeds', 'outerWall']} {...common} />
            <Num label="Innenwand" unit="mm/s" step={5} min={5} max={limits.speed} value={settings.speeds.innerWall} path={['speeds', 'innerWall']} {...common} />
            <Num label="Füllung" unit="mm/s" step={5} min={5} max={limits.speed} value={settings.speeds.infill} path={['speeds', 'infill']} {...common} />
            <Num label="Deckfläche" unit="mm/s" step={5} min={5} max={limits.speed} value={settings.speeds.topSurface} path={['speeds', 'topSurface']} {...common} />
            <Num label="Überhang" unit="mm/s" step={5} min={5} max={limits.speed} value={settings.speeds.overhang} path={['speeds', 'overhang']} {...common} />
            <Num label="Stützen" unit="mm/s" step={5} min={5} max={limits.speed} value={settings.speeds.support} path={['speeds', 'support']} {...common} />
            <Num label="Reisen" unit="mm/s" step={10} min={30} max={limits.travel} value={settings.speeds.travel} path={['speeds', 'travel']} {...common} />
            <Num label="Erste Schicht" unit="mm/s" step={5} min={5} max={60} value={settings.speeds.firstLayer} path={['speeds', 'firstLayer']} {...common} />
            {advanced && (
              <>
                <Num label="Brücke" unit="mm/s" step={5} min={5} max={limits.speed} value={settings.speeds.bridge} path={['speeds', 'bridge']} {...common} />
                <Num label="Stütz-Interface" unit="mm/s" step={5} min={5} max={limits.speed} value={settings.speeds.supportInterface} path={['speeds', 'supportInterface']} {...common} />
              </>
            )}
            </Fold>

            {advanced && (
              <Fold title="Beschleunigung" hint={`${settings.accelerations.print} mm/s²`}>
                <Num label="Grundaccel" unit="mm/s²" step={100} min={100} max={limits.accel} value={settings.accelerations.print} path={['accelerations', 'print']} {...common} />
                <Num label="Außenwand accel" unit="mm/s²" step={100} min={100} max={limits.accel} value={settings.accelerations.outerWall} path={['accelerations', 'outerWall']} {...common} />
                <Num label="Innenwand accel" unit="mm/s²" step={100} min={100} max={limits.accel} value={settings.accelerations.innerWall} path={['accelerations', 'innerWall']} {...common} />
                <Num label="Füllung accel" unit="mm/s²" step={100} min={100} max={limits.accel} value={settings.accelerations.infill} path={['accelerations', 'infill']} {...common} />
                <Num label="Deckfläche accel" unit="mm/s²" step={100} min={100} max={limits.accel} value={settings.accelerations.topSurface} path={['accelerations', 'topSurface']} {...common} />
                <Num label="Brücke accel" unit="mm/s²" step={100} min={100} max={limits.accel} value={settings.accelerations.bridge} path={['accelerations', 'bridge']} {...common} />
                <Num label="Stützen accel" unit="mm/s²" step={100} min={100} max={limits.accel} value={settings.accelerations.support} path={['accelerations', 'support']} {...common} />
                <Num label="Stütz-Interface accel" unit="mm/s²" step={100} min={100} max={limits.accel} value={settings.accelerations.supportInterface} path={['accelerations', 'supportInterface']} {...common} />
                <Num label="Reisen accel" unit="mm/s²" step={100} min={100} max={limits.accel} value={settings.accelerations.travel} path={['accelerations', 'travel']} {...common} />
                <Num label="Erste Schicht accel" unit="mm/s²" step={100} min={100} max={limits.accel} value={settings.accelerations.firstLayer} path={['accelerations', 'firstLayer']} {...common} />
              </Fold>
            )}
          </div>            <div className="col-span-full mt-1 flex flex-wrap items-center justify-between gap-1 rounded-xl border border-sky/20 bg-sky/[0.04] px-2.5 py-1.5 text-[9px] text-white/40">
              <span>Druckerlimit für dieses Profil</span>
              <span className="tabular text-sky/80">
                {limits.speed} mm/s · {limits.accel} mm/s²
              </span>
            </div>

            {limitedSpeeds.length > 0 && (
              <div className="mt-2 rounded-xl border border-amber/35 bg-amber/8 px-2.5 py-2">
              <div className="text-[9px] font-semibold tracking-wider text-amber uppercase">Volumenstrom bremst</div>
              <p className="mt-1 text-[9px] leading-relaxed text-white/50">
                Maximal {maxSpeedAt(flowLayerHeight).toFixed(1)} mm/s bei {flowLayerLabel} mm Schicht und{' '}
                {settings.maxVolumetricFlow} mm³/s. Der Slicer kappt betroffene Bahnen automatisch.
              </p>
              <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-[8px] text-white/35">
                {limitedSpeeds.map((s) => (
                  <span key={s.label}>
                    {s.label}: {s.value} → {s.max.toFixed(0)}
                  </span>
                ))}
              </div>
            </div>
          )}
        </Section>
      )}

      {has('filament', 'filament material farbe durchmesser volum strom temperatur bett düse platten schrumpf schrumpfung kompensation messwert sollmaß istmaß') && (
        <Section
          title="Filament"
          hint={`${currentFilamentName ?? 'Aktives Filament'} · ${settings.filamentDiameter.toFixed(2)} mm · ${settings.maxVolumetricFlow} mm³/s`}
          active={showTab('filament')}
        >
          <div className="grid grid-cols-1 gap-2">
            {slots.length > 0 && (
              <div className="col-span-full">
                <Subhead>Filamentbank</Subhead>
                <div className="grid grid-cols-2 gap-1.5">
                  {slots.map((slot, index) => (
                    <div
                      key={slot.id}
                      className={`rounded-xl border p-1.5 transition ${
                        activeSlotId === slot.id
                          ? 'border-mint/55 bg-mint/[0.06]'
                          : 'border-line/70 bg-ink-900/45'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => onActiveSlot?.(slot.id)}
                        className="flex w-full items-center gap-1.5 text-left"
                        title="Als aktiven Slot verwenden"
                      >
                        <span
                          className="h-2.5 w-2.5 shrink-0 rounded-full border border-white/25"
                          style={{ background: slot.color ?? SLOT_COLORS[index % SLOT_COLORS.length] }}
                        />
                        <span className="min-w-0 flex-1 truncate text-[10px] font-semibold text-white/70">
                          {slot.label}
                        </span>
                        <span className="text-[8px] text-white/25">{index + 1}</span>
                      </button>
                      <select
                        value={slot.profileId}
                        onChange={(e) => updateSlot(slot.id, { profileId: e.target.value })}
                        className="mt-1 w-full rounded-lg border border-line/80 bg-ink-900/80 px-1.5 py-1 text-[9px] text-white/70 outline-none focus:border-amber/50"
                      >
                        {filamentProfiles.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                      <div className="mt-1 flex items-center gap-1.5">
                        <input
                          type="color"
                          value={slot.color ?? SLOT_COLORS[index % SLOT_COLORS.length]}
                          onChange={(e) => updateSlot(slot.id, { color: e.target.value })}
                          aria-label={`Farbe für ${slot.label}`}
                          className="h-5 w-8 shrink-0 cursor-pointer rounded border border-line/60 bg-transparent"
                        />
                        <span className="min-w-0 truncate text-[8px] leading-snug text-white/25">
                          Farbe für Moonraker / IFS
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
                <p className="mt-1 text-[9px] leading-snug text-white/25">
                  Der aktive Slot wird beim Slicen als Werkzeug verwendet. Die Farbe wird als Slot-Farbe an Moonraker
                  übergeben; bei mehreren Slots druckt der Slicer die Objekte nacheinander mit M600.
                </p>
              </div>
            )}

            <Subhead>Material</Subhead>
            <Num label="Düse ⌀" unit="mm" step={0.1} min={0.2} max={1} value={settings.nozzle} path={['nozzle']} {...common} />
            <Num label="Filament ⌀" unit="mm" step={0.05} min={1.5} max={3} value={settings.filamentDiameter} path={['filamentDiameter']} {...common} />
            <Num label="Fluss" unit="×" step={0.02} min={0.5} max={1.5} value={settings.flow} path={['flow']} {...common} />
            <Num label="Max. Volumenstrom" unit="mm³/s" step={1} min={0} max={60} value={settings.maxVolumetricFlow} path={['maxVolumetricFlow']} {...common} />
            <p className="-mt-1 text-[9px] leading-snug text-white/25">0 = kein Deckel: der Slicer kappt dann keine Bahn.</p>
            <ShrinkageCard settings={settings} baseline={baseline} onChange={onChange} advanced={advanced} />
            <Num label="Düsentemperatur" unit="°C" step={5} min={150} max={limits.nozzleTemp} value={settings.temps.nozzle} path={['temps', 'nozzle']} {...common} />
            <Num label="Düsentemperatur erste Schicht" unit="°C" step={5} min={150} max={limits.nozzleTemp} value={settings.temps.firstLayerNozzle} path={['temps', 'firstLayerNozzle']} {...common} />
            <div className="col-span-full">
              <Subhead>Temperaturgrenzen</Subhead>
              <div className="grid grid-cols-2 gap-1.5">
                <div className="rounded-xl border border-line/70 bg-ink-900/45 px-2 py-1.5">
                  <div className="text-[9px] text-white/35">Düse maximal</div>
                  <div className="tabular mt-0.5 text-[12px] font-semibold text-amber/90">
                    {limits.nozzleTemp} °C
                  </div>
                </div>
                <div className="rounded-xl border border-line/70 bg-ink-900/45 px-2 py-1.5">
                  <div className="text-[9px] text-white/35">Bett maximal</div>
                  <div className="tabular mt-0.5 text-[12px] font-semibold text-amber/90">{limits.bed} °C</div>
                </div>
              </div>
              <p className="mt-1 text-[9px] leading-snug text-white/25">
                Gerätegrenzen für {printer.name}. Änderbar in den Druckereinstellungen unter „Bewegung & Grenzen“.
              </p>
            </div>
            {plates.length > 0 ? (
              <div className="col-span-full">
                <Subhead>Betttemperatur je Bettart</Subhead>
                <div className="space-y-1.5">
                  {plates.map((plate) => {
                    const override = filamentId
                      ? plateProfiles?.[plate.id]?.filamentTemps?.[filamentId]
                      : undefined
                    const fallback = plateFallbackTemps?.[plate.id] ?? {
                      bed: settings.temps.bed,
                      firstLayer: settings.temps.firstLayerBed,
                    }
                    const active = plate.id === activePlateId
                    const hasOverride = override?.bedTemp != null || override?.firstLayerBed != null
                    return (
                      <div
                        key={plate.id}
                        className={`rounded-xl border px-2 py-1.5 ${
                          active ? 'border-amber/45 bg-amber/[0.04]' : 'border-line/60 bg-ink-900/35'
                        }`}
                      >
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-[10px] font-semibold text-white/70">{plate.name}</span>
                          {active && (
                            <span className="rounded bg-amber/15 px-1 py-0.5 text-[8px] font-bold tracking-wide text-amber uppercase">
                              aktuell
                            </span>
                          )}
                          {plate.bedTempOffset !== 0 && (
                            <span className="tabular text-[8px] text-white/30">
                              {plate.bedTempOffset > 0 ? '+' : ''}
                              {plate.bedTempOffset} °C Offset
                            </span>
                          )}
                          {hasOverride && (
                            <span className="rounded bg-sky/10 px-1 py-0.5 text-[8px] text-sky/75">eigener Wert</span>
                          )}
                          {hasOverride && onPlateTemps && (
                            <button
                              type="button"
                              onClick={() =>
                                onPlateTemps(plate.id, { bedTemp: undefined, firstLayerBed: undefined })
                              }
                              title={`${plate.name} auf Filamentwert + Plattenoffset zurücksetzen`}
                              className="ml-auto text-[9px] text-white/30 hover:text-amber"
                            >
                              ↺
                            </button>
                          )}
                        </div>
                        <div className="mt-1 grid grid-cols-2 gap-1.5">
                          <label className="text-[9px] text-white/35">
                            Bett °C
                            <input
                              type="number"
                              min={1}
                              max={limits.bed}
                              disabled={!onPlateTemps}
                              value={override?.bedTemp ?? fallback.bed}
                              onChange={(e) => {
                                const raw = e.target.value
                                onPlateTemps?.(plate.id, {
                                  bedTemp: raw === '' ? undefined : Number(raw),
                                })
                              }}
                              title={`Standard: ${fallback.bed} °C (Filamentwert + Plattenoffset)`}
                              className="tabular mt-1 w-full rounded-lg border border-line/80 bg-ink-900/70 px-2 py-1.5 text-[11px] text-white/80 outline-none focus:border-amber/50 disabled:opacity-50"
                            />
                          </label>
                          <label className="text-[9px] text-white/35">
                            Erste Schicht °C
                            <input
                              type="number"
                              min={1}
                              max={limits.bed}
                              disabled={!onPlateTemps}
                              value={override?.firstLayerBed ?? fallback.firstLayer}
                              onChange={(e) => {
                                const raw = e.target.value
                                onPlateTemps?.(plate.id, {
                                  firstLayerBed: raw === '' ? undefined : Number(raw),
                                })
                              }}
                              title={`Standard: ${fallback.firstLayer} °C (Filamentwert + Plattenoffset)`}
                              className="tabular mt-1 w-full rounded-lg border border-line/80 bg-ink-900/70 px-2 py-1.5 text-[11px] text-white/80 outline-none focus:border-amber/50 disabled:opacity-50"
                            />
                          </label>
                        </div>
                      </div>
                    )
                  })}
                </div>
                <p className="mt-1 text-[9px] leading-snug text-white/25">
                  ↺ setzt auf Filamentwert + Plattenoffset zurück. Die Werte gelten für{' '}
                  {currentFilamentName ?? 'das aktive Filament'} und werden im Plattenprofil gespeichert; die aktive
                  Platte übernimmt sie sofort in den G-Code. Bei eigenen Filamentprofilen gelten die Temperaturen
                  absolut; der Plattenoffset wird dann nicht addiert.
                </p>
              </div>
            ) : (
              <>
                <Num label="Betttemperatur" unit="°C" step={5} min={0} max={limits.bed} value={settings.temps.bed} path={['temps', 'bed']} {...common} />
                <Num label="Betttemperatur erste Schicht" unit="°C" step={5} min={0} max={limits.bed} value={settings.temps.firstLayerBed} path={['temps', 'firstLayerBed']} {...common} />
              </>
            )}
            {onNozzleMaterial && (
              <div className="col-span-full">
                <div className="mb-1 flex items-center gap-1 text-[10px] font-medium tracking-wider text-white/40 uppercase">
                  <span>Düsenmaterial</span>
                  <InfoDot label="Düsenmaterial" />
                </div>
                <div className="grid grid-cols-2 gap-1">
                  {NOZZLE_MATERIALS.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      title={m.hint}
                      onClick={() => onNozzleMaterial(m.id)}
                      className={`rounded-lg border px-2 py-1 text-left text-[10px] transition ${
                        nozzleMaterial === m.id
                          ? 'border-amber/60 bg-amber/10 text-amber'
                          : 'border-line/70 text-white/55 hover:border-white/20'
                      }`}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <Subhead>Druckdynamik</Subhead>
            <Bool label="Pressure Advance" value={settings.pressureAdvance.enabled} path={['pressureAdvance', 'enabled']} {...common} />
            <Num label="Pressure Advance" step={0.005} min={0} max={2} value={settings.pressureAdvance.value} path={['pressureAdvance', 'value']} {...common} />

            {profiles.length > 0 && (
              <>
                <Subhead>Gespeicherte Filamentprofile</Subhead>
                <div className="col-span-full rounded-xl border border-line/70 bg-ink-900/40 p-2">
                  <div className="flex flex-wrap gap-1">
                    {profiles.map((p) => (
                      <span
                        key={p.id}
                        className="inline-flex items-center gap-1 rounded-md border border-line/70 bg-ink-900/50 px-1.5 py-0.5 text-[9px]"
                      >
                        <button
                          type="button"
                          onClick={() => onLoadFilament?.(p.id)}
                          className="max-w-[9rem] truncate text-white/60 transition hover:text-mint"
                          title={`${p.name} laden`}
                        >
                          {p.name}
                        </button>
                        <button
                          type="button"
                          onClick={() => onDeleteFilament?.(p.id)}
                          title={`${p.name} löschen`}
                          className="text-rose/50 transition hover:text-rose"
                        >
                          ✕
                        </button>
                      </span>
                    ))}
                  </div>
                </div>
              </>
            )}

          </div>
        </Section>
      )}

      {has('cooling', 'kühlung lüfter bauteilkühlung first layer schichten mindestzeit') && (
        <Section
          title="Kühlung"
          hint={`${settings.fanSpeed} % · Lüfter aus in ${settings.cooling.fanOffLayers} Schicht(en)`}
          active={showTab('cooling')}
        >
          <div className="grid grid-cols-1 gap-2">
            <Num label="Bauteilkühlung" unit="%" step={10} min={0} max={100} value={settings.fanSpeed} path={['fanSpeed']} {...common} />
            <Num
              label="Lüfter aus in den ersten Schichten"
              step={1}
              min={0}
              max={6}
              value={settings.cooling.fanOffLayers}
              path={['cooling', 'fanOffLayers']}
              {...common}
            />
            <p className="-mt-1 text-[9px] leading-snug text-white/25">
              0 = ab der ersten Schicht kühlen. Höhere Werte schalten den Lüfter in der ersten Schicht komplett aus
              und starten erst danach mit voller Drehzahl.
            </p>
            <Num label="Mindestschichtzeit" unit="s" step={1} min={0} max={120} value={settings.cooling.minLayerTime} path={['cooling', 'minLayerTime']} {...common} />
            <p className="-mt-1 text-[9px] leading-snug text-white/25">
              Kürzere Schichten werden abgewartet, damit die vorige Lage abkühlen kann. 0 schaltet die Wartezeit aus.
            </p>
            <div className="col-span-full rounded-xl border border-line/70 bg-ink-900/45 px-2.5 py-2 text-[9px] leading-relaxed text-white/35">
              Brücken- und Überhangtempo stehen im Reiter <span className="text-sky/80">Geschwindigkeit</span>.
              Lüfterdrehzahl und Mindestzeit gelten für das gesamte Projekt.
            </div>
          </div>
        </Section>
      )}

      {has('support', 'stützen support überhang kontakt interface baum') && (
        <Section
          title="Stützen"
          hint={settings.support.kind === 'none' ? 'Aus' : `${settings.support.kind} · ${settings.support.density} %`}
          active={showTab('support')}
        >
          <div className="grid grid-cols-1 gap-2">
            <div className="col-span-full">
              <div className="mb-1 flex items-center gap-1 text-[10px] font-medium tracking-wider text-white/40 uppercase">
                <span>Stützstruktur</span>
                <InfoDot label="Stützstruktur" />
              </div>
              <Segmented
                size="sm"
                value={settings.support.kind}
                onChange={(v) => onChange(setPath(settings, ['support', 'kind'], v))}
                options={[
                  { value: 'none', label: 'Aus' },
                  { value: 'normal', label: 'Normal' },
                  { value: 'tree', label: 'Baum' },
                ]}
              />
            </div>
            <Num label="Überhangwinkel" unit="°" step={5} min={10} max={80} value={settings.support.threshold} path={['support', 'threshold']} {...common} />
            <Num label="Stützdichte" unit="%" step={5} min={5} max={100} value={settings.support.density} path={['support', 'density']} {...common} />
            <Choice
              label="Stützmuster"
              value={settings.support.pattern}
              path={['support', 'pattern']}
              options={SUPPORT_PATTERN_OPTIONS}
              {...common}
            />
            {advanced && (
              <Choice
                label="Kontaktmuster"
                value={settings.support.interfacePattern}
                path={['support', 'interfacePattern']}
                options={SUPPORT_PATTERN_OPTIONS}
                {...common}
              />
            )}
            <Num label="Z-Abstand" unit="mm" step={0.05} min={0} max={1} value={settings.support.zDistance} path={['support', 'zDistance']} {...common} />
            <Num label="XY-Abstand" unit="mm" step={0.1} min={0.2} max={3} value={settings.support.xyDistance} path={['support', 'xyDistance']} {...common} />
            <Num label="Kontaktlagen" step={1} min={0} max={8} value={settings.support.interfaceLayers} path={['support', 'interfaceLayers']} {...common} />
            <Num label="Kontaktdichte" unit="%" step={5} min={20} max={100} value={settings.support.interfaceDensity} path={['support', 'interfaceDensity']} {...common} />
            {settings.support.kind === 'tree' && advanced && (
              <Num label="Baumwinkel" unit="°" step={5} min={0} max={70} value={settings.support.branchAngle} path={['support', 'branchAngle']} {...common} />
            )}
          </div>
        </Section>
      )}

      {has('multi', 'mehrfarbig multimaterial ams ace ifs cfs mmu slots farben') && printer.ifs && (
          <Section
            title="Mehrfarbig"
            hint={printer.ifs ? `${printer.ifs.name} · ${slots.length} Slots` : 'Mehrfachzuführung'}
            active={showTab('multi')}
            badge={printer.ifs ? printer.ifs.name : undefined}
          >
            <MultiMaterial
              printer={printer}
              slots={slots}
              profiles={filamentProfiles}
              objects={objects}
              selectedObjectId={selectedObjectId}
              onSlotsChange={onSlotsChange}
              onAssignSlot={onAssignSlot}
            />
          </Section>
        )}

      {has('other', 'sonstiges bett haftung mesh saum brim vase fuzzy rauschen oberfläche textur muster musteratlas presets swatches vorschau kacheln stein fels mauerwerk steinplatten holz holzmaserung jahresringe baumrinde rinde gehämmert rändel rauten wellen marmor schiefer beton sandstein leder korb korbgeflecht wabe bruchstein texturzone zonen deckflächenmuster naht scarf gcode output input shaper reset sequenziell einzeln objekte nacheinander druckreihenfolge freiraum abstand arc arc-fitting bogen g2 g3 kreisbogen') && (
        <Section
          title="Sonstige"
          hint="Haftung, Bett, Spezialmodi, G-Code-Ausgabe und Input Shaper"
          active={showTab('other')}
        >
          <div className="grid grid-cols-1 gap-2">
            <Choice
              label="Haftung"
              value={settings.adhesion}
              path={['adhesion']}
              options={[
                { value: 'none', label: 'Aus' },
                { value: 'skirt', label: 'Saum (Skirt)' },
                { value: 'brim', label: 'Brim' },
              ]}
              {...common}
            />

            <Fold
              title="Sequenzieller Druck"
              hint={settings.sequentialPrint.enabled ? `${settings.sequentialPrint.clearance.toFixed(1)} mm Abstand` : 'Aus'}
              defaultOpen={settings.sequentialPrint.enabled}
            >
              <Bool
                label="Objekte nacheinander drucken"
                value={settings.sequentialPrint.enabled}
                path={['sequentialPrint', 'enabled']}
                hint="Jedes Objekt wird vollständig gedruckt, bevor das nächste beginnt. Der Slicer sortiert nach Höhe und prüft den horizontalen Abstand."
                {...common}
              />
              {settings.sequentialPrint.enabled && (
                <Num
                  label="Mindestabstand"
                  unit="mm"
                  step={1}
                  min={0}
                  max={50}
                  value={settings.sequentialPrint.clearance}
                  path={['sequentialPrint', 'clearance']}
                  {...common}
                />
              )}
              {settings.sequentialPrint.enabled && (
                <p className="col-span-full rounded-xl border border-amber/25 bg-amber/[0.04] px-2.5 py-2 text-[10px] leading-snug text-white/45">
                  Der Abstand gilt zwischen den Objekt-Bounding-Boxen, inklusive Saum/Brim. Druckkopf,
                  Portal und Kabelwege müssen trotzdem am Drucker geprüft werden — der Slicer kennt
                  die Kopfform nicht. Bei mehreren Filamenten bleibt der M600-Wechsel aktiv.
                </p>
              )}
            </Fold>

            <Fold title="Saum (Skirt)" hint="Runde um das Bauteil" defaultOpen={settings.adhesion === 'skirt'}>
            <Num label="Umrundungsringe" step={1} min={1} max={20} value={settings.skirt.loops} path={['skirt', 'loops']} {...common} />
            <Choice
              label="Art der Umrandung"
              value={settings.skirt.type}
              path={['skirt', 'type']}
              options={[
                { value: 'outer_only' as SkirtType, label: 'Nur Außen' },
                { value: 'combined' as SkirtType, label: 'Außen + Löcher' },
              ]}
              {...common}
            />
            <Num label="Min. Extrusionslänge" unit="mm" step={5} min={0} max={200} value={settings.skirt.minLength} path={['skirt', 'minLength']} {...common} />
            <Num label="Abstand zum Bauteil" unit="mm" step={0.5} min={0} max={30} value={settings.skirt.distance} path={['skirt', 'distance']} {...common} />
            <Num label="Startpunkt" unit="°" step={5} min={-180} max={180} value={settings.skirt.startAngle} path={['skirt', 'startAngle']} {...common} />
            <Num label="Druckgeschwindigkeit" unit="mm/s" step={5} min={5} max={limits.speed} value={settings.skirt.speed} path={['skirt', 'speed']} {...common} />
            <Num label="Höhe" unit="Schichten" step={1} min={1} max={10} value={settings.skirt.layers} path={['skirt', 'layers']} {...common} />
            <Bool label="Luftzug-Schutz" value={settings.skirt.draftShield} path={['skirt', 'draftShield']} hint="Zusätzliche Schutzwand um das Bauteil." {...common} />
            </Fold>

            <Fold title="Brim" hint="Breite Haftfläche" defaultOpen={settings.adhesion === 'brim'}>
            <Choice
              label="Randtyp"
              value={settings.brim.type}
              path={['brim', 'type']}
              options={[
                { value: 'outer_only' as BrimType, label: 'Nur Außen' },
                { value: 'inner_only' as BrimType, label: 'Nur Innen' },
                { value: 'combined' as BrimType, label: 'Außen + Innen' },
              ]}
              {...common}
            />
            <Num label="Randbreite" unit="mm" step={0.4} min={0.4} max={20} value={settings.brim.width} path={['brim', 'width']} {...common} />
            <Num label="Lücke zum Objekt" unit="mm" step={0.05} min={0} max={2} value={settings.brim.gap} path={['brim', 'gap']} {...common} />
            <Num label="Brim-Flussverhältnis" unit="×" step={0.05} min={0.1} max={3} value={settings.brim.flow} path={['brim', 'flow']} {...common} />
            </Fold>

            <Fold title="Spezialmodus" hint="Vase und Oberflächenstruktur">
            <Bool
              label="Vasenmodus"
              value={settings.special.vase}
              path={['special', 'vase']}
              hint="Eine Außenwand ohne Füllung und Deckschichten. Z steigt spiralförmig an."
              {...common}
            />
            {settings.special.vase && (
              <div className="col-span-full rounded-lg border border-amber/35 bg-amber/8 px-2 py-1.5 text-[9px] leading-snug text-amber/90">
                <span className="font-semibold">Vasenmodus aktiv — beim Slicen automatisch gesetzt:</span>{' '}
                1 Außenwand, keine Füllung, keine Deck- oder Bodenschichten, keine Stützen. Wandzahl,
                Füllungsdichte und Deckschichten werden dabei überstimmt. Glätten und Oberflächenstruktur passen nicht
                zu einer Vase — sie bleiben zwar eingestellt, wirken aber nur auf Flächen, die es hier nicht gibt.
              </div>
            )}

            <Choice
              label="Oberflächenstruktur"
              value={settings.fuzzySkin.mode}
              path={['fuzzySkin', 'mode']}
              options={[
                { value: 'off' as FuzzySkinMode, label: 'Deaktiviert' },
                { value: 'external' as FuzzySkinMode, label: 'Nur Außenwand' },
                { value: 'all' as FuzzySkinMode, label: 'Alle Wände' },
              ]}
              {...common}
            />
                <Fold
                  title="Textur-Presets & Musteratlas"
                  hint={`${SURFACE_TEXTURE_PRESETS.length} Presets · ${ATLAS_ONLY_PATTERNS.length} Muster`}
                  defaultOpen
                >
                  <div className="col-span-full flex items-start justify-between gap-2 rounded-xl border border-sky/30 bg-sky/[0.05] px-2.5 py-2">
                    <span className="min-w-0">
                      <span className="flex items-center gap-1 text-[10px] font-medium text-white/70">
                        Muster in 3D ansehen
                        <InfoDot label="Muster in 3D ansehen" />
                      </span>
                      <span className="mt-0.5 block text-[9px] leading-snug text-white/30">
                        {fuzzyActive
                          ? 'Die Oberflächenstruktur ist aktiv — das Muster ist am Modell immer sichtbar.'
                          : 'Zeigt das Muster am Modell, ohne die Oberflächenstruktur zu slicen.'}
                      </span>
                    </span>
                    <span className={fuzzyActive ? 'opacity-40' : ''}>
                      <Toggle
                        checked={fuzzyActive || texturePreview}
                        onChange={(next) => {
                          if (!fuzzyActive) onTexturePreview?.(next)
                        }}
                      />
                    </span>
                  </div>
                  <div className="col-span-full rounded-xl border border-line/60 bg-ink-900/35 p-2">
                    <div className="flex items-center gap-1">
                      <span className="text-[9px] font-semibold tracking-wider text-white/55 uppercase">
                        Textur-Presets
                      </span>
                      <InfoDot label="Textur-Presets" />
                      <span className="ml-auto text-[8px] text-white/25">
                        {SURFACE_TEXTURE_PRESETS.length} Looks
                      </span>
                    </div>
                    <p className="mt-0.5 text-[8px] leading-snug text-white/30">
                      Fertige Looks: Muster, Tiefe, Merkmalsgröße, Richtung und Punktabstand in einem Klick.
                      Deckflächenmuster und Texturzonen bleiben erhalten.
                    </p>
                    <div className="mt-1.5 grid grid-cols-2 gap-1.5">
                      {SURFACE_TEXTURE_PRESETS.map((preset) => {
                        const active = isActiveTexturePreset(preset)
                        const patternLabel =
                          SURFACE_TEXTURE_PATTERNS.find((entry) => entry.value === preset.pattern)?.label ??
                          preset.pattern
                        return (
                          <button
                            key={preset.id}
                            type="button"
                            aria-pressed={active}
                            title={preset.hint}
                            onClick={() => applyTexturePreset(preset)}
                            className={`overflow-hidden rounded-lg border text-left transition ${
                              active
                                ? 'border-amber/70 bg-amber/10 ring-1 ring-amber/25'
                                : 'border-line/60 bg-ink-900/50 hover:border-white/30'
                            }`}
                          >
                            <TextureSwatch
                              pattern={preset.pattern}
                              scale={preset.scale}
                              angle={preset.angle}
                              className="h-10"
                            />
                            <span
                              className={`block px-1.5 pt-1 text-[9px] font-semibold leading-tight ${
                                active ? 'text-amber' : 'text-white/70'
                              }`}
                            >
                              {preset.label}
                            </span>
                            <span className="block px-1.5 pb-1 text-[7px] leading-tight text-white/30">
                              {patternLabel} · {preset.thickness.toFixed(2).replace('.', ',')} mm
                            </span>
                          </button>
                        )
                      })}
                    </div>
                  </div>

                  <div className="col-span-full rounded-xl border border-line/60 bg-ink-900/35 p-2">
                    <div className="flex items-center gap-1">
                      <span className="text-[9px] font-semibold tracking-wider text-white/55 uppercase">
                        Musteratlas
                      </span>
                      <InfoDot label="Musteratlas" />
                      <span className="ml-auto text-[8px] text-white/25">
                        {ATLAS_ONLY_PATTERNS.length} Muster
                      </span>
                    </div>
                    <p className="mt-0.5 text-[8px] leading-snug text-white/30">
                      Für diese Muster gibt es noch kein Preset. Ein Klick übernimmt nur das Muster in die
                      Wandtextur; Tiefe, Merkmalsgröße, Richtung und Punktabstand bleiben unverändert.
                    </p>
                    <div className="mt-1.5 grid grid-cols-4 gap-1">
                      {ATLAS_ONLY_PATTERNS.map((entry) => {
                        const selected = texturePattern === entry.value
                        return (
                          <button
                            key={entry.value}
                            type="button"
                            aria-pressed={selected}
                            title={entry.hint}
                            onClick={() => applyTexturePattern(entry.value)}
                            className={`overflow-hidden rounded-md border text-left transition ${
                              selected
                                ? 'border-sky/65 bg-sky/10 ring-1 ring-sky/25'
                                : 'border-line/60 bg-ink-900/50 hover:border-white/30'
                            }`}
                          >
                            <TextureSwatch
                              pattern={entry.value}
                              scale={textureScale}
                              angle={textureAngle}
                              className="h-9"
                            />
                            <span
                              className={`block min-h-[2.2em] px-1 py-0.5 text-[8px] leading-tight ${
                                selected ? 'text-sky' : 'text-white/55'
                              }`}
                            >
                              {entry.label}
                            </span>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                  {settings.fuzzySkin.mode === 'off' && (
                    <div className="col-span-full rounded-lg border border-sky/25 bg-sky/[0.04] px-2 py-1.5 text-[8px] leading-snug text-sky/70">
                      Die Oberflächenstruktur ist noch deaktiviert. Mit „Muster in 3D ansehen“ oben prüfst du
                      das Muster am Modell; geslict wird es erst, wenn du die Struktur einschaltest.
                    </div>
                  )}
                </Fold>
            {settings.fuzzySkin.mode !== 'off' && (
              <>
                <Bool
                  label="Auch Deckflächen"
                  value={settings.fuzzySkin.topSurfaces !== false}
                  path={['fuzzySkin', 'topSurfaces']}
                  hint="Legt die Struktur als erhöhtes Höhenfeld auf die sichtbare oberste Schicht. Nur nach oben, mit Rand- und Düsenabstand; kostet etwas Material und Zeit."
                  {...common}
                />
                <Choice
                  label="Oberflächenmuster"
                  value={settings.fuzzySkin.pattern ?? 'noise'}
                  path={['fuzzySkin', 'pattern']}
                  options={SURFACE_TEXTURE_PATTERNS.map(({ value, label }) => ({ value, label }))}
                  {...common}
                />
                {settings.fuzzySkin.topSurfaces !== false && (
                  <Choice
                    label="Deckflächenmuster"
                    value={settings.fuzzySkin.topPattern ?? 'inherit'}
                    path={['fuzzySkin', 'topPattern']}
                    options={[
                      { value: 'none' as TopTexturePatternChoice, label: 'Glatt (kein Muster)' },
                      { value: 'inherit' as TopTexturePatternChoice, label: 'Wie Wandmuster' },
                      ...SURFACE_TEXTURE_PATTERNS.map(({ value, label }) => ({
                        value: value as TopTexturePatternChoice,
                        label,
                      })),
                    ]}
                    {...common}
                  />
                )}
                {settings.fuzzySkin.topSurfaces !== false && settings.fuzzySkin.topPattern === 'none' && (
                  <p className="col-span-full rounded-lg border border-mint/25 bg-mint/[0.04] px-2 py-1.5 text-[9px] leading-snug text-mint/75">
                    Deckfläche bleibt glatt: keine erhöhten Texturbahnen auf der Oberseite. Die Wandtextur
                    bleibt aktiv.
                  </p>
                )}

                <Num label="Tiefe" unit="mm" step={0.05} min={0} max={1.5} value={settings.fuzzySkin.thickness} path={['fuzzySkin', 'thickness']} {...common} />
                <Num label="Merkmalsgröße" unit="mm" step={0.5} min={0.5} max={20} value={settings.fuzzySkin.scale ?? 3} path={['fuzzySkin', 'scale']} {...common} />
                <Num label="Richtung" unit="°" step={5} min={0} max={180} value={settings.fuzzySkin.angle ?? 0} path={['fuzzySkin', 'angle']} {...common} />
                <Num label="Punktabstand" unit="mm" step={0.1} min={0.2} max={3} value={settings.fuzzySkin.pointDistance} path={['fuzzySkin', 'pointDistance']} {...common} />
                <div className="col-span-full rounded-xl border border-line/60 bg-ink-900/35 p-2">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-1 text-[9px] font-semibold tracking-wider text-white/55 uppercase">
                        <span>Flächenzuweisung</span>
                        <InfoDot label="Flächenzuweisung" />
                      </div>
                      <div className="mt-0.5 text-[8px] leading-snug text-white/30">
                        Muster nur auf ausgewählte Wandseiten legen. Die 3D-Ansicht zeigt das Muster vor dem Slicen.
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setTextureFaces({ enabled: !textureFaces.enabled })}
                      className={`rounded-lg border px-2 py-1 text-[9px] font-medium transition ${
                        textureFaces.enabled
                          ? 'border-amber/60 bg-amber/12 text-amber'
                          : 'border-line/70 text-white/45 hover:border-white/20'
                      }`}
                    >
                      {textureFaces.enabled ? 'Flächenauswahl ein' : 'Alle Flächen'}
                    </button>
                  </div>
                  <div className={`mt-1.5 grid grid-cols-4 gap-1 ${textureFaces.enabled ? '' : 'opacity-40'}`}>
                    {(
                      [
                        ['front', 'Vorne −Y'],
                        ['back', 'Hinten +Y'],
                        ['left', 'Links −X'],
                        ['right', 'Rechts +X'],
                      ] as const
                    ).map(([face, label]) => {
                      const active = textureFaces.enabled && textureFaces[face] !== false
                      return (
                        <button
                          key={face}
                          type="button"
                          disabled={!textureFaces.enabled}
                          onClick={() => setTextureFaces({ [face]: !textureFaces[face] } as Partial<typeof textureFaces>)}
                          aria-pressed={active}
                          className={`rounded-md border px-1 py-1 text-[9px] transition ${
                            active
                              ? 'border-amber/50 bg-amber/10 text-amber'
                              : 'border-line/60 text-white/35 hover:text-white/60'
                          } disabled:cursor-not-allowed`}
                        >
                          {label}
                        </button>
                      )
                    })}
                  </div>
                  {textureFaces.enabled && (
                    <p className="mt-1 text-[8px] leading-snug text-white/25">
                      Abgeschaltete Seiten bleiben glatt. Die Zuordnung folgt der Hauptrichtung der Wand; bei runden
                      Teilen gilt die jeweils nächstliegende Seite.
                    </p>
                  )}
                </div>
                <div className="col-span-full rounded-xl border border-line/60 bg-ink-900/35 p-2">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-1 text-[9px] font-semibold tracking-wider text-white/55 uppercase">
                        <span>Texturzonen</span>
                        <InfoDot label="Texturzonen" />
                      </div>
                      <div className="mt-0.5 text-[8px] leading-snug text-white/30">
                        Leer = ganze Höhe. Sonst nur innerhalb der ersten passenden Zone; gilt für Wände und Deckflächen.
                      </div>
                    </div>
                    <button
                      type="button"
                      disabled={textureZones.length >= 4}
                      onClick={() => {
                        const last = textureZones[textureZones.length - 1]
                        const from = last && Number.isFinite(last.to) ? Math.max(0, last.to) : 0
                        setTextureZones([
                          ...textureZones,
                          { from, to: from + 10, pattern: 'inherit' as TexturePatternChoice },
                        ])
                      }}
                      className="shrink-0 rounded-lg border border-sky/35 bg-sky/10 px-2 py-1 text-[9px] font-semibold text-sky transition enabled:hover:bg-sky/20 disabled:cursor-not-allowed disabled:opacity-35"
                    >
                      + Zone
                    </button>
                  </div>
                  {textureZones.length === 0 ? (
                    <p className="mt-1.5 text-[8px] leading-snug text-white/25">
                      Ohne Zone wird die gewählte Struktur auf allen Höhen angewendet.
                    </p>
                  ) : (
                    <div className="mt-1.5 space-y-1.5">
                      {textureZones.map((zone, index) => {
                        const invalid = !Number.isFinite(zone.from) || !Number.isFinite(zone.to)
                        const reversed = !invalid && zone.to < zone.from
                        return (
                          <div
                            key={index}
                            className={`grid grid-cols-[1fr_1fr_1.5fr_auto] items-end gap-1 rounded-lg border px-1.5 py-1.5 ${
                              invalid ? 'border-amber/40 bg-amber/5' : 'border-line/50 bg-ink-900/35'
                            }`}
                          >
                            <label className="min-w-0">
                              <span className="mb-0.5 block text-[8px] text-white/35 uppercase">Von mm</span>
                              <input
                                type="number"
                                step={0.1}
                                min={0}
                                value={Number.isFinite(zone.from) ? zone.from : 0}
                                onChange={(event) => {
                                  const value = Number(event.target.value)
                                  updateTextureZone(index, { from: Number.isFinite(value) ? value : 0 })
                                }}
                                className="tabular w-full rounded-md border border-line/70 bg-ink-900/70 px-1.5 py-1 text-[10px] text-white/75 outline-none focus:border-sky/50"
                              />
                            </label>
                            <label className="min-w-0">
                              <span className="mb-0.5 block text-[8px] text-white/35 uppercase">Bis mm</span>
                              <input
                                type="number"
                                step={0.1}
                                min={0}
                                value={Number.isFinite(zone.to) ? zone.to : 0}
                                onChange={(event) => {
                                  const value = Number(event.target.value)
                                  updateTextureZone(index, { to: Number.isFinite(value) ? value : 0 })
                                }}
                                className="tabular w-full rounded-md border border-line/70 bg-ink-900/70 px-1.5 py-1 text-[10px] text-white/75 outline-none focus:border-sky/50"
                              />
                            </label>
                            <label className="min-w-0">
                              <span className="mb-0.5 block text-[8px] text-white/35 uppercase">Muster</span>
                              <select
                                value={zone.pattern ?? 'inherit'}
                                onChange={(event) =>
                                  updateTextureZone(index, { pattern: event.target.value as TexturePatternChoice })
                                }
                                className="w-full rounded-md border border-line/70 bg-ink-900/70 px-1 py-1 text-[9px] text-white/70 outline-none focus:border-sky/50"
                              >
                                <option value="inherit">Wie Grundmuster</option>
                                {SURFACE_TEXTURE_PATTERNS.map(({ value, label }) => (
                                  <option key={value} value={value}>
                                    {label}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <button
                              type="button"
                              onClick={() => setTextureZones(textureZones.filter((_, i) => i !== index))}
                              title="Zone entfernen"
                              className="mb-0.5 rounded-md px-1.5 py-1 text-[13px] leading-none text-white/30 transition hover:bg-amber/10 hover:text-amber"
                            >
                              ×
                            </button>
                            {invalid && (
                              <div className="col-span-full text-[8px] leading-snug text-amber/80">
                                Von und Bis müssen gültige Millimeterwerte sein; diese Zone wird nicht angewendet.
                              </div>
                            )}
                            {reversed && (
                              <div className="col-span-full text-[8px] leading-snug text-white/35">
                                Von und Bis sind vertauscht; der Bereich wird trotzdem als Von–Bis verwendet.
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
                <div className="col-span-full rounded-lg border border-line/50 bg-ink-900/35 px-2 py-1.5 text-[9px] leading-snug text-white/55">
                  {SURFACE_TEXTURE_PATTERNS.find((entry) => entry.value === (settings.fuzzySkin.pattern ?? 'noise'))?.hint}
                  {' '}Die Wandauslenkung wird je Seite ungefähr halbiert; für feine Muster den Punktabstand
                  kleiner als die Merkmalsgröße halten. Die Deckfläche wird nur erhöht und bleibt mit
                  sicherem Abstand zu Wand und Nachbarbahn.
                </div>
              </>
            )}
            </Fold>

            <Subhead>Bett & Prime</Subhead>
            <Bool label="Prime-Linie" value={settings.primeLine.enabled} path={['primeLine', 'enabled']} {...common} />
            <Num label="Prime-Länge" unit="mm" step={10} min={10} max={300} value={settings.primeLine.length} path={['primeLine', 'length']} {...common} />
            <Num label="Prime-Tempo" unit="mm/s" step={5} min={5} max={100} value={settings.primeLine.speed} path={['primeLine', 'speed']} {...common} />
            <Choice
              label="Bett-Mesh"
              value={settings.meshCompensation}
              path={['meshCompensation']}
              options={[
                { value: 'off', label: 'Aus' },
                { value: 'software', label: 'Im G-Code' },
              ]}
              {...common}
            />
            <Bool label="Adaptiv vor dem Start" value={settings.adaptiveMesh.enabled} path={['adaptiveMesh', 'enabled']} {...common} />
            {advanced && (
              <>
                <Num label="Adaptiv-Rand" unit="mm" step={5} min={0} max={60} value={settings.adaptiveMesh.margin} path={['adaptiveMesh', 'margin']} {...common} />
                <Num label="Adaptiv-Raster" step={1} min={2} max={11} value={settings.adaptiveMesh.grid} path={['adaptiveMesh', 'grid']} {...common} />
              </>
            )}
            <Bool label="Z-Offset nachführen" value={settings.autoZ.enabled} path={['autoZ', 'enabled']} {...common} />

            <Bool label="Input Shaper" value={settings.inputShaper.enabled} path={['inputShaper', 'enabled']} {...common} />
            <Choice
              label="Shaper-Methode"
              value={settings.inputShaper.method}
              path={['inputShaper', 'method']}
              options={[
                { value: 'auto' as InputShaperMethod, label: 'Automatisch (Firmware-Standard)' },
                { value: 'zv' as InputShaperMethod, label: 'ZV' },
                { value: 'mzv' as InputShaperMethod, label: 'MZV' },
                { value: 'ei' as InputShaperMethod, label: 'EI' },
                { value: '2hump_ei' as InputShaperMethod, label: '2HUMP_EI' },
                { value: '3hump_ei' as InputShaperMethod, label: '3HUMP_EI' },
              ]}
              {...common}
            />
            <Num label="Frequenz X" unit="Hz" step={1} min={5} max={200} value={settings.inputShaper.freqX} path={['inputShaper', 'freqX']} {...common} />
            <Num label="Frequenz Y" unit="Hz" step={1} min={5} max={200} value={settings.inputShaper.freqY} path={['inputShaper', 'freqY']} {...common} />
            <Num label="Dämpfung" step={0.01} min={0.01} max={0.5} value={settings.inputShaper.damping} path={['inputShaper', 'damping']} {...common} />
            <Subhead>G-Code-Ausgabe</Subhead>
            <Bool
              label="Objektnamen im G-Code"
              value={settings.output.objectLabels}
              path={['output', 'objectLabels']}
              hint="Schreibt OBJECT_START/OBJECT_END und Objektnamen als Kommentar. Hilfreich für Ausschluss und Mehrfarbdruck."
              {...common}
            />
            <Bool
              label="Bahnkommentare"
              value={settings.output.verbosePaths}
              path={['output', 'verbosePaths']}
              hint="Schreibt den Bahntyp (Außenwand, Füllung …) als Kommentar vor die Bahn."
              {...common}
            />
            <Bool
              label="Rückzug in der Füllung verringern"
              value={settings.output.reduceInfillRetraction}
              path={['output', 'reduceInfillRetraction']}
              hint="Halbiert den Rückzug bei Füllungsreisen; außerhalb der Füllung bleibt er unverändert."
              {...common}
            />
            <Bool
              label="Liniennummern hinzufügen"
              value={settings.output.lineNumbers}
              path={['output', 'lineNumbers']}
              hint="Setzt N-Nummern vor G-Code-Befehle, z. B. für ältere Drucker oder Prüfwerkzeuge."
              {...common}
            />
            <Bool
              label="Objekte ausschließen"
              value={settings.output.excludeObjects}
              path={['output', 'excludeObjects']}
              hint="Schreibt Firmware-Marker: Klipper EXCLUDE_OBJECT_*, andere Flavor M486. Bei ZMOD-Druckern (z. B. AD5X) stehen die Marker immer im G-Code, weil deren Startmakro die Objektliste für Purge-Linie und Parkposition liest — ohne sie fällt es auf eine Bahn an der vorderen Bettkante zurück."
              {...common}
            />
            <Fold
              title="Arc-Fitting (G2/G3)"
              hint={settings.arcFitting.enabled ? `${settings.arcFitting.tolerance.toFixed(2)} mm Toleranz` : 'Aus'}
              defaultOpen={settings.arcFitting.enabled}
            >
              <Bool
                label="Kreisbögen als G2/G3"
                value={settings.arcFitting.enabled}
                path={['arcFitting', 'enabled']}
                hint="Ersetzt geeignete Folgen kurzer Geraden auf geschlossenen Konturen durch echte Kreisbögen. Nur ohne Scarf-, Textur- und Vasen-Spirale."
                {...common}
              />
              {settings.arcFitting.enabled && (
                <Num
                  label="Bogen-Toleranz"
                  unit="mm"
                  step={0.01}
                  min={0.01}
                  max={0.3}
                  value={settings.arcFitting.tolerance}
                  path={['arcFitting', 'tolerance']}
                  {...common}
                />
              )}
              {settings.arcFitting.enabled && (
                <Num
                  label="Min. Segmente"
                  step={1}
                  min={3}
                  max={16}
                  value={settings.arcFitting.minSegments}
                  path={['arcFitting', 'minSegments']}
                  {...common}
                />
              )}
              {settings.arcFitting.enabled && (
                <p className="col-span-full rounded-xl border border-sky/20 bg-sky/[0.04] px-2.5 py-2 text-[10px] leading-snug text-white/45">
                  Die Kontur wird an den tatsächlichen Schnittpunkten geprüft. Eine zu große Toleranz ersetzt
                  auch enge Ecken durch einen Bogen; kleiner ist genauer, erzeugt aber mehr G1-Zeilen. Die
                  Vorschau bleibt eine Polylinie.
                </p>
              )}
            </Fold>
            <label className="col-span-full block">
              <span className="mb-1 block text-[9px] font-medium tracking-wider text-white/35 uppercase">
                Format des Dateinamens
              </span>
              <input
                value={settings.output.filenameFormat}
                onChange={(e) => onChange(setPath(settings, ['output', 'filenameFormat'], e.target.value))}
                spellCheck={false}
                placeholder="{input_filename_base}_{filament_type[0]}_{print_time}.gcode"
                className="w-full rounded-xl border border-line/80 bg-ink-900/70 px-2.5 py-1.5 font-mono text-[10px] text-white/80 outline-none placeholder:text-white/20 focus:border-amber/60"
              />
              <span className="mt-1 block text-[8px] leading-snug text-white/25">
                Platzhalter: {'{input_filename_base}'}, {'{filament_type[0]}'}, {'{print_time}'}, {'{layer_height}'},{' '}
                {'{nozzle_diameter}'}. Wird beim Speichern und Senden verwendet.
              </span>
            </label>

            <Subhead>G-Code je Extrusionsart</Subhead>
            <div className="col-span-full space-y-1.5">
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as keyof RoleGcodeSettings)}
                className="w-full rounded-xl border border-line/80 bg-ink-900/70 px-2 py-1.5 text-[10px] text-white/75 outline-none focus:border-amber/60"
              >
                {ROLE_OPTIONS.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
              <textarea
                value={settings.roleGcode[role]}
                onChange={(e) => onChange(setPath(settings, ['roleGcode', role], e.target.value))}
                rows={4}
                spellCheck={false}
                placeholder="z. B. M117 {layer} — oder leer lassen"
                className="w-full resize-y rounded-xl border border-line/80 bg-ink-900/70 px-2.5 py-1.5 font-mono text-[10px] leading-relaxed text-white/80 outline-none placeholder:text-white/20 focus:border-amber/60"
              />
              <p className="text-[8px] leading-snug text-white/25">
                Wird vor dem ersten Pfad dieser Art je Schicht eingefügt. {'{layer}'} und {'{z}'} werden ersetzt.
              </p>
            </div>

          </div>
        </Section>
      )}

    </aside>
  )
}
