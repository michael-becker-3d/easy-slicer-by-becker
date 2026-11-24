import { useState } from 'react'
import type { MeshCompensation, NozzleMaterial, PrintSettings } from '../../shared/types.ts'
import { DEFAULT_SETTINGS, mergeSettings } from '../../shared/types.ts'
import type { QualityPreset } from '../../shared/catalog.ts'
import { InfoDot, Segmented, Stepper, Toggle } from './ui.tsx'
import { SettingsResetContext } from './settingsReset.tsx'

type Props = {
  settings: PrintSettings
  /** Werte des gewählten Qualitätsprofils — Ziel für die Rücksetzknöpfe */
  baseline: PrintSettings
  qualityPresets: QualityPreset[]
  qualityId: string
  onQualityChange: (id: string) => void
  onChange: (next: PrintSettings) => void
  onReset: () => void
  /** Werksgrenzen des gewählten Druckers — wird in den Kategorien angezeigt */
  limits?: {
    layer: [number, number]
    nozzle: number[]
    speed: number
    accel: number
    travel: number
    bed: number
    nozzleTemp: number
  }
  /** Eingebaute Düse — Messing, gehärteter Stahl, Edelstahl oder unbekannt */
  nozzleMaterial?: NozzleMaterial
  onNozzleMaterial?: (material: NozzleMaterial) => void
  /** Eigene Filamentprofile des Nutzers */
  profiles?: { id: string; name: string }[]
  currentFilamentName?: string
  onSaveFilament?: (name: string) => void
  onLoadFilament?: (id: string) => void
  onDeleteFilament?: (id: string) => void
}

type TabId =
  | 'quality'
  | 'strength'
  | 'infill'
  | 'support'
  | 'material'
  | 'speed'
  | 'motion'
  | 'cooling'
  | 'bed'
  | 'advanced'

const TABS: { id: TabId; label: string }[] = [
  { id: 'quality', label: 'Qualität' },
  { id: 'strength', label: 'Stärke' },
  { id: 'infill', label: 'Füllung' },
  { id: 'support', label: 'Stützen' },
  { id: 'material', label: 'Material' },
  { id: 'speed', label: 'Tempo' },
  { id: 'motion', label: 'Bewegung' },
  { id: 'cooling', label: 'Kühlung' },
  { id: 'bed', label: 'Haftung & Mesh' },
  { id: 'advanced', label: 'Erweitert' },
]

const NOZZLE_MATERIAL_OPTIONS: { id: NozzleMaterial; label: string; hint: string }[] = [
  { id: 'brass', label: 'Messing', hint: 'Bester Wärmeübergang, aber weich: Kohlefaser und Glasfaser schleifen die Bohrung aus.' },
  { id: 'hardened-steel', label: 'Gehärteter Stahl', hint: 'Für faserverstärkte Filamente geeignet; etwas schlechterer Wärmeübergang als Messing.' },
  { id: 'stainless', label: 'Edelstahl', hint: 'Verschleißfester als Messing, für abrasive Filamente brauchbar.' },
  { id: 'unknown', label: 'Unbekannt', hint: 'Slicer warnt bei faserhaltigen Filamenten, weil die Düse unbekannt ist.' },
]

const HINTS: Record<TabId, string> = {
  quality: 'Schichthöhe, erste Schicht und Oberfläche',
  strength: 'Wände und Decklagen bestimmen die Festigkeit',
  infill: 'Dichte und Muster der Füllung',
  support: 'Stützstrukturen, Kontaktlagen und Abstände',
  material: 'Düse, Volumenstrom, Temperaturen, Fluss, Schrumpfung und eigene Filamentprofile',
  speed: 'Geschwindigkeiten je Bahnart',
  motion: 'Retract, Z-Hop, Pressure Advance, Input Shaper und Fahrverhalten',
  cooling: 'Bauteilkühlung und Mindestschichtzeit',
  bed: 'Haftung, Bett-Mesh (im G-Code), adaptives Messen und Z-Automatik',
  advanced: 'Zurücksetzen und Grenzen',
}

type FieldPaths = Record<string, string[][]>

const FIELD_PATHS: Record<TabId, FieldPaths> = {
  quality: {
    'Schichthöhe|mm': [['layerHeight']],
    'Erste Schicht|mm': [['firstLayerHeight']],
    'Linienbreite|mm': [['lineWidth']],
    'Lücke|mm': [['seam', 'gap']],
    'Fluss|×': [['ironing', 'flow']],
    'Tempo|mm/s': [['ironing', 'speed']],
    'Abstand|mm': [['ironing', 'spacing']],
  },
  strength: {
    'Wände|': [['walls']],
    'Deckschichten|': [['topLayers']],
    'Bodenschichten|': [['bottomLayers']],
  },
  infill: {
    'Dichte|%': [['infillDensity']],
    'Füllwinkel|°': [['infillAngle']],
  },
  material: {
    'Düse ⌀|mm': [['nozzle']],
    'Filament ⌀|mm': [['filamentDiameter']],
    'Fluss|×': [['flow']],
    'Düse|°C': [['temps', 'nozzle']],
    'Düse erste Schicht|°C': [['temps', 'firstLayerNozzle']],
    'Bett|°C': [['temps', 'bed']],
    'Bett erste Schicht|°C': [['temps', 'firstLayerBed']],
    'Max. Volumenstrom|mm³/s': [['maxVolumetricFlow']],
    'X/Y|%': [['shrinkage', 'x'], ['shrinkage', 'y']],
    'Z|%': [['shrinkage', 'z']],
  },
  speed: {
    'Druck|mm/s': [['speeds', 'print']],
    'Außenwand|mm/s': [['speeds', 'outerWall']],
    'Innenwand|mm/s': [['speeds', 'innerWall']],
    'Füllung|mm/s': [['speeds', 'infill']],
    'Deckfläche|mm/s': [['speeds', 'solid']],
    'Überhang|mm/s': [['speeds', 'overhang']],
    'Stützen|mm/s': [['speeds', 'support']],
    'Reisen|mm/s': [['speeds', 'travel']],
    'Erste Schicht|mm/s': [['speeds', 'firstLayer']],
    'Druck|mm/s²': [['accelerations', 'print']],
    'Außenwand|mm/s²': [['accelerations', 'outerWall']],
    'Innenwand|mm/s²': [['accelerations', 'innerWall']],
    'Füllung|mm/s²': [['accelerations', 'infill']],
    'Deckfläche|mm/s²': [['accelerations', 'solid']],
    'Stützen|mm/s²': [['accelerations', 'support']],
    'Reisen|mm/s²': [['accelerations', 'travel']],
  },
  motion: {
    'Retract|mm': [['retraction', 'distance']],
    'Retract-Tempo|mm/s': [['retraction', 'speed']],
    'Retract ab Weg|mm': [['retraction', 'minTravel']],
    'Z-Hop|mm': [['zHop']],
    'Pressure Advance|': [['pressureAdvance', 'value']],
    'Frequenz X|Hz': [['inputShaper', 'freqX']],
    'Frequenz Y|Hz': [['inputShaper', 'freqY']],
    'Dämpfung|': [['inputShaper', 'damping']],
    'Jerk X|mm/s': [['classicJerk', 'x']],
    'Jerk Y|mm/s': [['classicJerk', 'y']],
    'Jerk Z|mm/s': [['classicJerk', 'z']],
    'Jerk E|mm/s': [['classicJerk', 'e']],
    'Junction Deviation|': [['junctionDeviation', 'value']],
    'Square Corner Velocity|mm/s': [['squareCornerVelocity', 'value']],
  },
  support: {
    'Überhangwinkel|°': [['support', 'threshold']],
    'Stützdichte|%': [['support', 'density']],
    'Z-Abstand|mm': [['support', 'zDistance']],
    'XY-Abstand|mm': [['support', 'xyDistance']],
    'Kontaktlagen|': [['support', 'interfaceLayers']],
    'Kontaktdichte|%': [['support', 'interfaceDensity']],
    'Baumwinkel|°': [['support', 'branchAngle']],
  },
  cooling: {
    'Bauteilkühlung|%': [['fanSpeed']],
    'Lüfter aus – erste Schichten|': [['cooling', 'fanOffLayers']],
    'Mindestschichtzeit|s': [['cooling', 'minLayerTime']],
  },
  bed: {
    'Rand|mm': [['adaptiveMesh', 'margin']],
    'Raster|': [['adaptiveMesh', 'grid']],
  },
  advanced: {},
}

function getPath(obj: unknown, path: string[]): unknown {
  let cur: any = obj
  for (const key of path) cur = cur?.[key]
  return cur
}

function setPath<T>(obj: T, path: string[], value: unknown): T {
  if (path.length === 0) return value as T
  const [key, ...rest] = path
  const source: any = obj ?? {}
  const copy: any = Array.isArray(source) ? [...source] : { ...source }
  copy[key] = setPath(copy[key], rest, value)
  return copy as T
}

export function SettingsDock({
  settings,
  baseline,
  qualityPresets,
  qualityId,
  onQualityChange,
  onChange,
  onReset,
  limits,
  nozzleMaterial,
  onNozzleMaterial,
  profiles,
  currentFilamentName,
  onSaveFilament,
  onLoadFilament,
  onDeleteFilament,
}: Props) {
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<TabId>('quality')
  const [profileName, setProfileName] = useState('')
  const patch = (p: Parameters<typeof mergeSettings>[1]) => onChange(mergeSettings(settings, p))
  const support = settings.support ?? DEFAULT_SETTINGS.support
  const cooling = settings.cooling ?? DEFAULT_SETTINGS.cooling
  const shrinkage = settings.shrinkage ?? DEFAULT_SETTINGS.shrinkage
  const primeLine = settings.primeLine ?? DEFAULT_SETTINGS.primeLine

  // Live-Hinweis im Tempo-Tab: Die gleiche Formel wie im Slicer, nur schon
  // während der Eingabe. So sieht man sofort, welche Geschwindigkeit der
  // eingestellte Volumenstrom noch zulässt.
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
  const speedChecks = [
    { label: 'Druck', value: settings.speeds.print, max: maxSpeedAt(flowLayerHeight) },
    { label: 'Außenwand', value: settings.speeds.outerWall, max: maxSpeedAt(flowLayerHeight) },
    { label: 'Innenwand', value: settings.speeds.innerWall, max: maxSpeedAt(flowLayerHeight) },
    { label: 'Füllung', value: settings.speeds.infill, max: maxSpeedAt(flowLayerHeight) },
    { label: 'Deckfläche', value: settings.speeds.solid, max: maxSpeedAt(flowLayerHeight) },
    { label: 'Überhang', value: settings.speeds.overhang, max: maxSpeedAt(flowLayerHeight) },
    { label: 'Stützen', value: settings.speeds.support, max: maxSpeedAt(flowLayerHeight) },
    { label: 'Erste Schicht', value: settings.speeds.firstLayer, max: maxSpeedAt(settings.firstLayerHeight) },
  ]
  const limitedSpeeds = speedChecks.filter((s) => s.value > s.max + 0.05)
  const speedFmt = (v: number) => v.toFixed(1).replace('.', ',')

  const fieldPaths = (label: string, unit?: string) => FIELD_PATHS[tab]?.[`${label}|${unit ?? ''}`]
  const resetContext = {
    baselineFor(label: string, unit?: string) {
      const paths = fieldPaths(label, unit)
      if (!paths?.length) return null
      const value = getPath(baseline, paths[0])
      return typeof value === 'number' && Number.isFinite(value) ? value : null
    },
    reset(label: string, unit?: string) {
      const paths = fieldPaths(label, unit)
      if (!paths?.length) return
      let next = settings
      for (const path of paths) {
        const value = getPath(baseline, path)
        if (typeof value === 'number' && Number.isFinite(value)) next = setPath(next, path, value)
      }
      onChange(next)
    },
  }

  return (
    <div className="border-t border-line/60 glass px-4 py-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="hidden w-[92px] shrink-0 pb-1 md:block">
          <div className="text-[10px] font-semibold tracking-[0.18em] text-white/40 uppercase">Einstellungen</div>
          <div className="mt-0.5 text-[10px] text-white/25">ⓘ zeigt, was sich ändert</div>
        </div>

        <div className="flex min-w-0 flex-1 flex-wrap items-end gap-3">
          <label className="min-w-[190px] flex-1 basis-full sm:flex-none sm:basis-[215px]">
            <span className="mb-1 flex items-center gap-1 text-[10px] font-medium tracking-wider text-white/40 uppercase">
              Qualitätsprofil
              <InfoDot label="Qualitätsprofil" />
            </span>
            <select
              value={qualityId}
              onChange={(e) => onQualityChange(e.target.value)}
              title={qualityPresets.find((p) => p.id === qualityId)?.note ?? 'Eigene Werte — kein Standardprofil aktiv'}
              className="w-full rounded-xl border border-line/80 bg-ink-900/70 px-2.5 py-2 text-xs font-medium text-white/80 outline-none transition focus:border-amber/60"
            >
              {qualityPresets.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label} · {p.layerHeight.toFixed(2).replace('.', ',')} mm
                </option>
              ))}
              <option value="custom" disabled>
                Benutzerdefiniert (eigene Werte)
              </option>
            </select>
          </label>

          <div className="grid min-w-[280px] flex-1 grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-3 xl:grid-cols-6">
            <Stepper
              label="Schichthöhe"
              value={settings.layerHeight}
              unit="mm"
              step={0.02}
              min={0.04}
              max={0.6}
              onChange={(v) => patch({ layerHeight: v })}
              onReset={
                settings.layerHeight !== baseline.layerHeight
                  ? () => onChange(mergeSettings(settings, { layerHeight: baseline.layerHeight }))
                  : undefined
              }
            />
            <Stepper
              label="Wände"
              value={settings.walls}
              step={1}
              min={0}
              max={8}
              onChange={(v) => patch({ walls: v })}
              onReset={settings.walls !== baseline.walls ? () => onChange(mergeSettings(settings, { walls: baseline.walls })) : undefined}
            />
            <Stepper
              label="Füllung"
              value={settings.infillDensity}
              unit="%"
              step={5}
              min={0}
              max={100}
              onChange={(v) => patch({ infillDensity: v })}
              onReset={
                settings.infillDensity !== baseline.infillDensity
                  ? () => onChange(mergeSettings(settings, { infillDensity: baseline.infillDensity }))
                  : undefined
              }
            />
            <Stepper
              label="Düse"
              value={settings.temps.nozzle}
              unit="°C"
              step={5}
              min={150}
              max={300}
              onChange={(v) => patch({ temps: { nozzle: v } })}
              onReset={
                settings.temps.nozzle !== baseline.temps.nozzle
                  ? () => onChange(mergeSettings(settings, { temps: { nozzle: baseline.temps.nozzle } }))
                  : undefined
              }
            />
            <Stepper
              label="Bett"
              value={settings.temps.bed}
              unit="°C"
              step={5}
              min={0}
              max={120}
              onChange={(v) => patch({ temps: { bed: v } })}
              onReset={
                settings.temps.bed !== baseline.temps.bed
                  ? () => onChange(mergeSettings(settings, { temps: { bed: baseline.temps.bed } }))
                  : undefined
              }
            />
            <Stepper
              label="Tempo"
              value={settings.speeds.print}
              unit="mm/s"
              step={5}
              min={10}
              max={200}
              onChange={(v) => patch({ speeds: { print: v } })}
              onReset={
                settings.speeds.print !== baseline.speeds.print
                  ? () => onChange(mergeSettings(settings, { speeds: { print: baseline.speeds.print } }))
                  : undefined
              }
            />
          </div>
        </div>

        <div className="flex w-full shrink-0 items-center justify-end gap-1.5 sm:w-auto">
          <button
            type="button"
            onClick={onReset}
            title="Alle Werte auf das gewählte Qualitätsprofil zurücksetzen"
            className="rounded-xl border border-line/80 px-2.5 py-2 text-[11px] font-medium text-white/45 transition hover:border-amber/50 hover:text-amber"
          >
            ↺ Profil
          </button>
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className={`rounded-xl border px-3 py-2 text-[11px] font-medium transition ${
              open ? 'border-amber/50 bg-amber/10 text-amber' : 'border-line/80 text-white/50 hover:text-white/85'
            }`}
          >
            Alle Einstellungen {open ? '▾' : '▸'}
          </button>
        </div>
      </div>

      {open && (
        <SettingsResetContext.Provider value={resetContext}>
        <div className="mt-3 border-t border-line/50 pt-3">
          <div className="flex flex-wrap gap-1">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={`rounded-lg px-2.5 py-1 text-[10px] font-medium transition ${
                  tab === t.id ? 'bg-amber/90 text-ink-950' : 'text-white/45 hover:bg-white/6 hover:text-white/80'
                }`}
              >
                {t.label}
              </button>
            ))}
            <span className="ml-auto self-center text-[9px] text-white/25">
              {HINTS[tab]} · ⓘ = was sich beim Umstellen ändert
            </span>
          </div>

          <div className="mt-3 grid gap-x-4 gap-y-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
            {tab === 'quality' && (
              <>
                <Stepper
                  label="Schichthöhe"
                  value={settings.layerHeight}
                  unit="mm"
                  step={0.02}
                  min={limits?.layer[0] ?? 0.04}
                  max={limits?.layer[1] ?? 0.6}
                  onChange={(v) => patch({ layerHeight: v })}
                />
                <Stepper
                  label="Erste Schicht"
                  value={settings.firstLayerHeight}
                  unit="mm"
                  step={0.02}
                  min={limits?.layer[0] ?? 0.08}
                  max={limits?.layer[1] ?? 0.6}
                  onChange={(v) => patch({ firstLayerHeight: v })}
                />
                <div className="rounded-xl border border-line/70 bg-ink-900/40 p-2.5">
                  <div className="mb-1 flex items-center gap-1 text-[10px] font-medium tracking-wider text-white/40 uppercase">
                    <span>Adaptiv</span>
                    <InfoDot label="Adaptive Schichthöhe" />
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[9px] text-white/35">
                      {settings.adaptiveLayerHeight.enabled
                        ? `${settings.adaptiveLayerHeight.minHeight.toFixed(2)}–${settings.adaptiveLayerHeight.maxHeight.toFixed(2)} mm`
                        : 'feste Höhe'}
                    </span>
                    <Toggle
                      checked={settings.adaptiveLayerHeight.enabled}
                      onChange={(v) => patch({ adaptiveLayerHeight: { enabled: v } })}
                    />
                  </div>
                </div>
                <div className="rounded-xl border border-line/70 bg-ink-900/40 p-2.5">
                  <div className="mb-1 flex items-center gap-1 text-[10px] font-medium tracking-wider text-white/40 uppercase">
                    <span>Gap-Fill</span>
                    <InfoDot label="Gap-Fill" />
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[9px] text-white/35">
                      {settings.gapFill.enabled
                        ? `${settings.gapFill.minWidth.toFixed(2)}–${settings.gapFill.maxWidth.toFixed(2)} mm`
                        : 'aus'}
                    </span>
                    <Toggle
                      checked={settings.gapFill.enabled}
                      onChange={(v) => patch({ gapFill: { enabled: v } })}
                    />
                  </div>
                </div>
                <div className="rounded-xl border border-line/70 bg-ink-900/40 p-2.5">
                  <div className="mb-1 flex items-center gap-1 text-[10px] font-medium tracking-wider text-white/40 uppercase">
                    <span>Höhenbereiche</span>
                    <InfoDot label="Height-Range-Modifier" />
                  </div>
                  <span className="text-[9px] text-white/35">
                    {(settings.heightRanges ?? []).length === 0
                      ? 'keine Modifier'
                      : `${settings.heightRanges.length} Bereich${settings.heightRanges.length === 1 ? '' : 'e'}`}
                  </span>
                </div>
                <Stepper
                  label="Linienbreite"
                  value={settings.lineWidth}
                  unit="mm"
                  step={0.02}
                  min={0.2}
                  max={1.2}
                  onChange={(v) => patch({ lineWidth: v })}
                />
                <div className="rounded-xl border border-line/70 bg-ink-900/40 p-2.5 sm:col-span-2">
                  <div className="mb-1 flex items-center gap-1 text-[10px] font-medium tracking-wider text-white/40 uppercase">
                    <span>Naht</span>
                    <InfoDot label="Naht" />
                  </div>
                  <Segmented
                    size="sm"
                    value={settings.seam.position}
                    onChange={(v) => patch({ seam: { position: v as PrintSettings['seam']['position'] } })}
                    options={[
                      { value: 'nearest', label: 'Nächste' },
                      { value: 'rear', label: 'Hinten' },
                      { value: 'aligned', label: 'Bündig' },
                      { value: 'random', label: 'Zufall' },
                    ]}
                  />
                  <div className="mt-2 grid grid-cols-2 items-end gap-2">
                    <Stepper
                      label="Lücke"
                      value={settings.seam.gap}
                      unit="mm"
                      step={0.05}
                      min={0}
                      max={0.6}
                      onChange={(v) => patch({ seam: { gap: v } })}
                    />
                    <div className="flex items-center justify-between rounded-lg border border-line/60 px-2 py-1.5">
                      <span className="text-[10px] text-white/45">Wischen</span>
                      <Toggle checked={settings.seam.wipe} onChange={(v) => patch({ seam: { wipe: v } })} />
                    </div>
                  </div>
                  <div className="mt-2 flex items-center justify-between rounded-lg border border-line/60 px-2 py-1.5">
                    <span className="text-[10px] text-white/45">Scarf-Naht</span>
                    <Toggle
                      checked={settings.seam.scarf.enabled}
                      onChange={(v) =>
                        patch({
                          seam: { scarf: { ...settings.seam.scarf, enabled: v } },
                        })
                      }
                    />
                  </div>
                </div>
                <div className="rounded-xl border border-line/70 bg-ink-900/40 p-2.5 sm:col-span-2">
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1 text-[10px] font-medium tracking-wider text-white/40 uppercase">
                      Glätten
                      <InfoDot label="Glätten" />
                    </span>
                    <Toggle checked={settings.ironing.enabled} onChange={(v) => patch({ ironing: { enabled: v } })} />
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <Stepper
                      label="Fluss"
                      value={settings.ironing.flow}
                      unit="×"
                      step={0.02}
                      min={0.02}
                      max={0.6}
                      onChange={(v) => patch({ ironing: { flow: v } })}
                    />
                    <Stepper
                      label="Tempo"
                      value={settings.ironing.speed}
                      unit="mm/s"
                      step={5}
                      min={5}
                      max={80}
                      onChange={(v) => patch({ ironing: { speed: v } })}
                    />
                    <Stepper
                      label="Abstand"
                      value={settings.ironing.spacing}
                      unit="mm"
                      step={0.02}
                      min={0.04}
                      max={0.4}
                      onChange={(v) => patch({ ironing: { spacing: v } })}
                    />
                    <Stepper
                      label="Einzug"
                      value={settings.ironing.inset}
                      unit="mm"
                      step={0.05}
                      min={0}
                      max={2}
                      onChange={(v) => patch({ ironing: { inset: v } })}
                    />
                  </div>
                </div>
              </>
            )}

            {tab === 'strength' && (
              <>
                <Stepper label="Wände" value={settings.walls} step={1} min={0} max={8} onChange={(v) => patch({ walls: v })} />
                <Stepper
                  label="Deckschichten"
                  value={settings.topLayers}
                  step={1}
                  min={1}
                  max={10}
                  onChange={(v) => patch({ topLayers: v })}
                />
                <Stepper
                  label="Bodenschichten"
                  value={settings.bottomLayers}
                  step={1}
                  min={1}
                  max={10}
                  onChange={(v) => patch({ bottomLayers: v })}
                />
                <div className="rounded-xl border border-line/60 bg-ink-900/40 p-2.5 text-[10px] leading-relaxed text-white/35 sm:col-span-3">
                  Mehr Wände bringen bei Schlagbeanspruchung meist mehr als mehr Füllung. Drei Wände sind ein guter
                  Kompromiss aus Festigkeit und Zeit.
                </div>
              </>
            )}

            {tab === 'infill' && (
              <>
                <Stepper
                  label="Dichte"
                  value={settings.infillDensity}
                  unit="%"
                  step={5}
                  min={0}
                  max={100}
                  onChange={(v) => patch({ infillDensity: v })}
                />
                <div className="sm:col-span-2">
                  <div className="mb-1 flex items-center gap-1 text-[10px] font-medium tracking-wider text-white/40 uppercase">
                    <span>Muster</span>
                    <InfoDot label="Muster" />
                  </div>
                  <Segmented
                    size="sm"
                    value={settings.infillPattern}
                    onChange={(v) => patch({ infillPattern: v })}
                    options={[
                      { value: 'grid', label: 'Grid' },
                      { value: 'lines', label: 'Linien' },
                      { value: 'triangles', label: 'Tri' },
                      { value: 'zigzag', label: 'Zickzack' },
                    ]}
                  />
                  <div className="mt-1">
                    <Segmented
                      size="sm"
                      value={settings.infillPattern}
                      onChange={(v) => patch({ infillPattern: v })}
                      options={[
                        { value: 'gyroid', label: 'Gyroid*' },
                        { value: 'honeycomb', label: 'Waben' },
                        { value: 'crosshatch', label: 'Kreuz' },
                        { value: 'cubic', label: 'Cubic' },
                        { value: 'octet', label: 'Octet' },
                        { value: 'concentric', label: 'Ringe' },
                      ]}
                    />
                  </div>
                </div>
                <Stepper
                  label="Füllwinkel"
                  value={settings.infillAngle ?? 45}
                  unit="°"
                  step={5}
                  min={0}
                  max={175}
                  onChange={(v) => patch({ infillAngle: v })}
                />
              </>
            )}

            {tab === 'material' && (
              <>
                <Stepper
                  label="Düse ⌀"
                  value={settings.nozzle}
                  unit="mm"
                  step={0.1}
                  min={0.2}
                  max={1.0}
                  onChange={(v) => patch({ nozzle: v })}
                />
                <Stepper
                  label="Filament ⌀"
                  value={settings.filamentDiameter}
                  unit="mm"
                  step={0.05}
                  min={1.5}
                  max={3}
                  onChange={(v) => patch({ filamentDiameter: v })}
                />
                <Stepper
                  label="Fluss"
                  value={settings.flow}
                  unit="×"
                  step={0.02}
                  min={0.5}
                  max={1.5}
                  onChange={(v) => patch({ flow: v })}
                />
                <Stepper
                  label="Düse"
                  value={settings.temps.nozzle}
                  unit="°C"
                  step={5}
                  min={150}
                  max={limits?.nozzleTemp ?? 300}
                  onChange={(v) => patch({ temps: { nozzle: v } })}
                />
                <Stepper
                  label="Düse erste Schicht"
                  value={settings.temps.firstLayerNozzle}
                  unit="°C"
                  step={5}
                  min={150}
                  max={limits?.nozzleTemp ?? 300}
                  onChange={(v) => patch({ temps: { firstLayerNozzle: v } })}
                />
                <Stepper
                  label="Bett"
                  value={settings.temps.bed}
                  unit="°C"
                  step={5}
                  min={0}
                  max={limits?.bed ?? 120}
                  onChange={(v) => patch({ temps: { bed: v } })}
                />
                <Stepper
                  label="Bett erste Schicht"
                  value={settings.temps.firstLayerBed}
                  unit="°C"
                  step={5}
                  min={0}
                  max={limits?.bed ?? 120}
                  onChange={(v) => patch({ temps: { firstLayerBed: v } })}
                />
                <Stepper
                  label="Max. Volumenstrom"
                  value={settings.maxVolumetricFlow}
                  unit="mm³/s"
                  step={1}
                  min={1}
                  max={60}
                  onChange={(v) => patch({ maxVolumetricFlow: v })}
                />
                {onNozzleMaterial && (
                  <div className="rounded-xl border border-line/70 bg-ink-900/40 p-2.5 sm:col-span-2">
                    <div className="flex items-center gap-1 text-[10px] font-medium tracking-wider text-white/40 uppercase">
                      <span>Düsenmaterial</span>
                      <InfoDot label="Düsenmaterial" />
                    </div>
                    <div className="mt-1.5 grid grid-cols-2 gap-1.5">
                      {NOZZLE_MATERIAL_OPTIONS.map((m) => (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => onNozzleMaterial(m.id)}
                          title={m.hint}
                          className={`rounded-lg border px-2.5 py-1.5 text-left text-[11px] transition ${
                            nozzleMaterial === m.id
                              ? 'border-amber/60 bg-amber/10 text-amber'
                              : 'border-line/70 text-white/60 hover:border-white/20 hover:text-white'
                          }`}
                        >
                          {m.label}
                        </button>
                      ))}
                    </div>
                    <p className="mt-1 text-[10px] leading-snug text-white/45">
                      {NOZZLE_MATERIAL_OPTIONS.find((m) => m.id === nozzleMaterial)?.hint}
                    </p>
                  </div>
                )}
                <div className="rounded-xl border border-line/70 bg-ink-900/40 p-2.5 sm:col-span-2">
                  <div className="flex items-center gap-1 text-[10px] font-medium tracking-wider text-white/40 uppercase">
                    <span>Schrumpfkompensation</span>
                    <InfoDot label="Schrumpfkompensation" />
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <Stepper
                      label="X/Y"
                      value={shrinkage.x}
                      unit="%"
                      step={0.1}
                      min={-5}
                      max={10}
                      onChange={(v) => patch({ shrinkage: { x: v, y: v } })}
                    />
                    <Stepper
                      label="Z"
                      value={shrinkage.z}
                      unit="%"
                      step={0.1}
                      min={-5}
                      max={10}
                      onChange={(v) => patch({ shrinkage: { z: v } })}
                    />
                  </div>
                  <p className="mt-1 text-[9px] leading-snug text-white/25">
                    0 = aus. Das Modell wird vor dem Slicen um diesen Prozentsatz größer gerechnet.
                  </p>
                </div>
                {onSaveFilament && (
                  <div className="rounded-xl border border-sky/25 bg-sky/5 p-2.5 sm:col-span-2 lg:col-span-3">
                    <div className="flex flex-wrap items-center justify-between gap-1">
                      <span className="text-[10px] font-medium tracking-wider text-sky/70 uppercase">
                        Mein Filament-Profil
                      </span>
                      <span className="text-[9px] text-white/30">
                        Temperatur, Kühlung, Retract und Schrumpfung speichern
                      </span>
                    </div>
                    <div className="mt-1.5 flex gap-1.5">
                      <input
                        value={profileName}
                        onChange={(e) => setProfileName(e.target.value)}
                        placeholder={currentFilamentName ? `z. B. ${currentFilamentName}` : 'Name des Profils'}
                        className="min-w-0 flex-1 rounded-lg border border-line/80 bg-ink-900/70 px-2 py-1.5 text-[11px] text-white/80 outline-none focus:border-sky/50"
                      />
                      <button
                        type="button"
                        onClick={() => onSaveFilament(profileName.trim() || currentFilamentName || 'Mein Filament')}
                        className="rounded-lg bg-sky/25 px-2.5 py-1.5 text-[10px] font-semibold text-sky transition hover:bg-sky/35"
                      >
                        Speichern
                      </button>
                    </div>
                    {(profiles ?? []).length > 0 && (
                      <div className="mt-1.5 space-y-1">
                        {(profiles ?? []).map((p) => (
                          <div key={p.id} className="flex items-center gap-1.5 rounded-lg border border-line/60 px-2 py-1">
                            <button
                              type="button"
                              onClick={() => onLoadFilament?.(p.id)}
                              className="min-w-0 flex-1 truncate text-left text-[10px] text-white/75 transition hover:text-mint"
                            >
                              laden · {p.name}
                            </button>
                            <button
                              type="button"
                              onClick={() => onDeleteFilament?.(p.id)}
                              className="text-[9px] text-rose/70 hover:text-rose"
                            >
                              löschen
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}

            {tab === 'speed' && (
              <>
                {limitedSpeeds.length > 0 && (
                  <div className="rounded-xl border border-amber/40 bg-amber/8 p-2.5 sm:col-span-2 lg:col-span-3">
                    <div className="text-[10px] font-semibold tracking-wider text-amber uppercase">
                      Volumenstrom begrenzt die Geschwindigkeit
                    </div>
                    <p className="mt-1 text-[10px] leading-relaxed text-white/55">
                      Bei {settings.lineWidth > 0 ? settings.lineWidth : settings.nozzle} mm Linienbreite,{' '}
                      {flowLayerLabel} mm Schicht und Fluss {settings.flow} sind mit{' '}
                      {settings.maxVolumetricFlow} mm³/s höchstens{' '}
                      <span className="font-semibold text-amber">
                        {speedFmt(maxSpeedAt(flowLayerHeight))} mm/s
                      </span>{' '}
                      möglich. Der Slicer kappt die betroffenen Bahnen automatisch auf diesen Wert.
                    </p>
                    <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[9px] text-white/40">
                      {limitedSpeeds.map((s) => (
                        <span key={s.label}>
                          {s.label}: {speedFmt(s.value)} → max. {speedFmt(s.max)} mm/s
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                <Stepper
                  label="Druck"
                  value={settings.speeds.print}
                  unit="mm/s"
                  step={5}
                  min={10}
                  max={limits?.speed ?? 200}
                  onChange={(v) => patch({ speeds: { print: v } })}
                />
                <Stepper
                  label="Außenwand"
                  value={settings.speeds.outerWall}
                  unit="mm/s"
                  step={5}
                  min={5}
                  max={limits?.speed ?? 120}
                  onChange={(v) => patch({ speeds: { outerWall: v } })}
                />
                <Stepper
                  label="Innenwand"
                  value={settings.speeds.innerWall}
                  unit="mm/s"
                  step={5}
                  min={5}
                  max={limits?.speed ?? 200}
                  onChange={(v) => patch({ speeds: { innerWall: v } })}
                />
                <Stepper
                  label="Füllung"
                  value={settings.speeds.infill}
                  unit="mm/s"
                  step={5}
                  min={5}
                  max={limits?.speed ?? 300}
                  onChange={(v) => patch({ speeds: { infill: v } })}
                />
                <Stepper
                  label="Deckfläche"
                  value={settings.speeds.solid}
                  unit="mm/s"
                  step={5}
                  min={5}
                  max={limits?.speed ?? 200}
                  onChange={(v) => patch({ speeds: { solid: v } })}
                />
                <Stepper
                  label="Überhang"
                  value={settings.speeds.overhang}
                  unit="mm/s"
                  step={5}
                  min={5}
                  max={limits?.speed ?? 120}
                  onChange={(v) => patch({ speeds: { overhang: v } })}
                />
                <Stepper
                  label="Stützen"
                  value={settings.speeds.support}
                  unit="mm/s"
                  step={5}
                  min={5}
                  max={limits?.speed ?? 150}
                  onChange={(v) => patch({ speeds: { support: v } })}
                />
                <Stepper
                  label="Reisen"
                  value={settings.speeds.travel}
                  unit="mm/s"
                  step={10}
                  min={30}
                  max={limits?.travel ?? 400}
                  onChange={(v) => patch({ speeds: { travel: v } })}
                />
                <Stepper
                  label="Erste Schicht"
                  value={settings.speeds.firstLayer}
                  unit="mm/s"
                  step={5}
                  min={5}
                  max={60}
                  onChange={(v) => patch({ speeds: { firstLayer: v } })}
                />
                <div className="rounded-xl border border-line/70 bg-ink-900/40 p-2.5 sm:col-span-2 lg:col-span-3">
                  <div className="mb-1.5 flex items-center gap-1 text-[10px] font-medium tracking-wider text-white/40 uppercase">
                    <span>Beschleunigung je Bahnart</span>
                    <InfoDot label="Beschleunigung" />
                  </div>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <Stepper
                      label="Druck"
                      value={settings.accelerations.print}
                      unit="mm/s²"
                      step={100}
                      min={100}
                      max={limits?.accel ?? 20000}
                      onChange={(v) => patch({ accelerations: { print: v } })}
                    />
                    <Stepper
                      label="Außenwand"
                      value={settings.accelerations.outerWall}
                      unit="mm/s²"
                      step={100}
                      min={100}
                      max={limits?.accel ?? 20000}
                      onChange={(v) => patch({ accelerations: { outerWall: v } })}
                    />
                    <Stepper
                      label="Innenwand"
                      value={settings.accelerations.innerWall}
                      unit="mm/s²"
                      step={100}
                      min={100}
                      max={limits?.accel ?? 20000}
                      onChange={(v) => patch({ accelerations: { innerWall: v } })}
                    />
                    <Stepper
                      label="Füllung"
                      value={settings.accelerations.infill}
                      unit="mm/s²"
                      step={100}
                      min={100}
                      max={limits?.accel ?? 20000}
                      onChange={(v) => patch({ accelerations: { infill: v } })}
                    />
                    <Stepper
                      label="Deckfläche"
                      value={settings.accelerations.solid}
                      unit="mm/s²"
                      step={100}
                      min={100}
                      max={limits?.accel ?? 20000}
                      onChange={(v) => patch({ accelerations: { solid: v } })}
                    />
                    <Stepper
                      label="Stützen"
                      value={settings.accelerations.support}
                      unit="mm/s²"
                      step={100}
                      min={100}
                      max={limits?.accel ?? 20000}
                      onChange={(v) => patch({ accelerations: { support: v } })}
                    />
                    <Stepper
                      label="Reisen"
                      value={settings.accelerations.travel}
                      unit="mm/s²"
                      step={100}
                      min={100}
                      max={limits?.accel ?? 20000}
                      onChange={(v) => patch({ accelerations: { travel: v } })}
                    />
                  </div>
                  <p className="mt-1 text-[9px] leading-snug text-white/25">
                    Wird im G-Code als M204 gesetzt; zu hohe Werte lassen Ecken auswaschen und den Rahmen vibrieren.
                  </p>
                </div>
              </>
            )}

            {tab === 'motion' && (
              <>
                <Stepper
                  label="Retract"
                  value={settings.retraction.distance}
                  unit="mm"
                  step={0.1}
                  min={0}
                  max={8}
                  onChange={(v) => patch({ retraction: { distance: v } })}
                />
                <Stepper
                  label="Retract-Tempo"
                  value={settings.retraction.speed}
                  unit="mm/s"
                  step={5}
                  min={10}
                  max={120}
                  onChange={(v) => patch({ retraction: { speed: v } })}
                />
                <Stepper
                  label="Retract ab Weg"
                  value={settings.retraction.minTravel}
                  unit="mm"
                  step={0.5}
                  min={0}
                  max={10}
                  onChange={(v) => patch({ retraction: { minTravel: v } })}
                />
                <Stepper
                  label="Z-Hop"
                  value={settings.zHop}
                  unit="mm"
                  step={0.1}
                  min={0}
                  max={2}
                  onChange={(v) => patch({ zHop: v })}
                />
                <div className="flex items-center justify-between rounded-lg border border-line/60 px-2 py-1.5 sm:col-span-2">
                  <span className="flex items-center gap-1 text-[10px] text-white/45">
                    Retract bei Schichtwechsel
                    <InfoDot label="Retract bei Schichtwechsel" />
                  </span>
                  <Toggle
                    checked={settings.retraction.onLayerChange !== false}
                    onChange={(v) => patch({ retraction: { onLayerChange: v } })}
                  />
                </div>

                <div className="rounded-xl border border-amber/25 bg-amber/5 p-2.5 sm:col-span-2 lg:col-span-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="flex items-center gap-1 text-[10px] font-medium tracking-wider text-amber/80 uppercase">
                      Pressure Advance / Linear Advance
                      <InfoDot label="Pressure Advance" />
                    </span>
                    <Toggle
                      checked={settings.pressureAdvance.enabled}
                      onChange={(v) => patch({ pressureAdvance: { enabled: v } })}
                    />
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <Stepper
                      label="Pressure Advance"
                      value={settings.pressureAdvance.value}
                      step={0.005}
                      min={0}
                      max={2}
                      precision={3}
                      onChange={(v) => patch({ pressureAdvance: { value: v } })}
                    />
                    <div className="rounded-lg border border-line/60 px-2 py-1.5 text-[10px] leading-snug text-white/35">
                      {settings.pressureAdvance.enabled
                        ? `Wird als ${settings.pressureAdvance.value.toFixed(3).replace('.', ',')} in den G-Code geschrieben.`
                        : 'Aus — der Wert bleibt gespeichert, wird aber nicht ausgegeben.'}
                    </div>
                  </div>
                  <p className="mt-1 text-[9px] leading-snug text-white/30">
                    Klipper: SET_PRESSURE_ADVANCE · Marlin: M900 K… — unabhängig vom Druckerprofil einschaltbar. Ohne
                    Firmware-Unterstützung ignoriert der Drucker die Zeile; der G-Code bleibt gültig.
                  </p>
                </div>

                <div className="rounded-xl border border-sky/25 bg-sky/5 p-2.5 sm:col-span-2 lg:col-span-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="flex items-center gap-1 text-[10px] font-medium tracking-wider text-sky/80 uppercase">
                      Input Shaper
                      <InfoDot label="Frequenz X" unit="Hz" />
                    </span>
                    <Toggle
                      checked={settings.inputShaper.enabled}
                      onChange={(v) => patch({ inputShaper: { enabled: v } })}
                    />
                  </div>
                  <div className="mt-2 grid grid-cols-3 gap-2">
                    <Stepper
                      label="Frequenz X"
                      value={settings.inputShaper.freqX}
                      unit="Hz"
                      step={1}
                      min={5}
                      max={200}
                      onChange={(v) => patch({ inputShaper: { freqX: v } })}
                    />
                    <Stepper
                      label="Frequenz Y"
                      value={settings.inputShaper.freqY}
                      unit="Hz"
                      step={1}
                      min={5}
                      max={200}
                      onChange={(v) => patch({ inputShaper: { freqY: v } })}
                    />
                    <Stepper
                      label="Dämpfung"
                      value={settings.inputShaper.damping}
                      step={0.01}
                      min={0.01}
                      max={0.5}
                      precision={3}
                      onChange={(v) => patch({ inputShaper: { damping: v } })}
                    />
                  </div>
                  <p className="mt-1 text-[9px] leading-snug text-white/30">
                    Klipper: SET_INPUT_SHAPER · Marlin: M593 X F… / Y F… — der Ringing-Test im Tab Kalibrieren hilft
                    beim Einstellen. Nur wirksam, wenn die Firmware Input Shaping unterstützt.
                  </p>
                </div>

                <div className="rounded-xl border border-mint/25 bg-mint/5 p-2.5 sm:col-span-2 lg:col-span-3">
                  <div className="mb-1 flex items-center gap-1 text-[10px] font-medium tracking-wider text-mint/80 uppercase">
                    <span>Fahrverhalten · Classic Jerk &amp; CE 6.2.2</span>
                    <InfoDot label="Classic Jerk" />
                  </div>
                  <p className="mb-2 text-[9px] leading-snug text-white/35">
                    Für jeden Drucker sichtbar und einstellbar. Marlin schreibt M205, Klipper SET_VELOCITY_LIMIT; was die
                    Firmware nicht kennt, wird als Kommentar ausgegeben und ignoriert.
                  </p>

                  <div className="rounded-lg border border-line/60 bg-ink-900/40 p-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] font-medium text-white/60">Classic Jerk</span>
                      <Toggle
                        checked={settings.classicJerk.enabled}
                        onChange={(v) => patch({ classicJerk: { enabled: v } })}
                      />
                    </div>
                    <div className="mt-1.5 grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                      <Stepper
                        label="Jerk X"
                        value={settings.classicJerk.x}
                        unit="mm/s"
                        step={1}
                        min={0}
                        max={50}
                        onChange={(v) => patch({ classicJerk: { x: v } })}
                      />
                      <Stepper
                        label="Jerk Y"
                        value={settings.classicJerk.y}
                        unit="mm/s"
                        step={1}
                        min={0}
                        max={50}
                        onChange={(v) => patch({ classicJerk: { y: v } })}
                      />
                      <Stepper
                        label="Jerk Z"
                        value={settings.classicJerk.z}
                        unit="mm/s"
                        step={0.1}
                        min={0}
                        max={10}
                        precision={2}
                        onChange={(v) => patch({ classicJerk: { z: v } })}
                      />
                      <Stepper
                        label="Jerk E"
                        value={settings.classicJerk.e}
                        unit="mm/s"
                        step={1}
                        min={0}
                        max={50}
                        onChange={(v) => patch({ classicJerk: { e: v } })}
                      />
                    </div>
                    <p className="mt-1 text-[9px] leading-snug text-white/25">
                      Marlin: M205 X/Y/Z/E. Klipper kennt kein Classic Jerk — dort wird der X-Wert als Square Corner
                      Velocity verwendet.
                    </p>
                  </div>

                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    <div className="rounded-lg border border-line/60 bg-ink-900/40 p-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[10px] font-medium text-white/60">Junction Deviation</span>
                        <Toggle
                          checked={settings.junctionDeviation.enabled}
                          onChange={(v) => patch({ junctionDeviation: { enabled: v } })}
                        />
                      </div>
                      <div className="mt-1.5">
                        <Stepper
                          label="Junction Deviation"
                          value={settings.junctionDeviation.value}
                          step={0.005}
                          min={0}
                          max={0.2}
                          precision={3}
                          onChange={(v) => patch({ junctionDeviation: { value: v } })}
                        />
                      </div>
                      <p className="mt-1 text-[9px] leading-snug text-white/25">
                        Marlin: M205 J… (Alternative zu Classic Jerk). Bei Klipper ohne Wirkung.
                      </p>
                    </div>

                    <div className="rounded-lg border border-line/60 bg-ink-900/40 p-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[10px] font-medium text-white/60">Square Corner Velocity</span>
                        <Toggle
                          checked={settings.squareCornerVelocity.enabled}
                          onChange={(v) => patch({ squareCornerVelocity: { enabled: v } })}
                        />
                      </div>
                      <div className="mt-1.5">
                        <Stepper
                          label="Square Corner Velocity"
                          value={settings.squareCornerVelocity.value}
                          unit="mm/s"
                          step={1}
                          min={0}
                          max={20}
                          onChange={(v) => patch({ squareCornerVelocity: { value: v } })}
                        />
                      </div>
                      <p className="mt-1 text-[9px] leading-snug text-white/25">
                        Klipper: SET_VELOCITY_LIMIT SQUARE_CORNER_VELOCITY=… Bei Marlin ohne Wirkung.
                      </p>
                    </div>
                  </div>
                </div>
              </>
            )}

            {tab === 'support' && (
              <>
                <div className="sm:col-span-2">
                  <div className="mb-1 flex items-center gap-1 text-[10px] font-medium tracking-wider text-white/40 uppercase">
                    <span>Stützstruktur</span>
                    <InfoDot label="Stützstruktur" />
                  </div>
                  <Segmented
                    size="sm"
                    value={support.kind}
                    onChange={(v) => patch({ support: { kind: v as PrintSettings['support']['kind'] } })}
                    options={[
                      { value: 'none', label: 'Aus' },
                      { value: 'normal', label: 'Normal' },
                      { value: 'tree', label: 'Baum' },
                    ]}
                  />
                </div>
                <Stepper
                  label="Überhangwinkel"
                  value={support.threshold}
                  unit="°"
                  step={5}
                  min={10}
                  max={80}
                  onChange={(v) => patch({ support: { threshold: v } })}
                />
                <Stepper
                  label="Stützdichte"
                  value={support.density}
                  unit="%"
                  step={5}
                  min={5}
                  max={100}
                  onChange={(v) => patch({ support: { density: v } })}
                />
                <Stepper
                  label="Z-Abstand"
                  value={support.zDistance}
                  unit="mm"
                  step={0.05}
                  min={0}
                  max={1}
                  onChange={(v) => patch({ support: { zDistance: v } })}
                />
                <Stepper
                  label="XY-Abstand"
                  value={support.xyDistance}
                  unit="mm"
                  step={0.1}
                  min={0.2}
                  max={3}
                  onChange={(v) => patch({ support: { xyDistance: v } })}
                />
                <Stepper
                  label="Kontaktlagen"
                  value={support.interfaceLayers}
                  step={1}
                  min={0}
                  max={8}
                  onChange={(v) => patch({ support: { interfaceLayers: Math.round(v) } })}
                />
                <Stepper
                  label="Kontaktdichte"
                  value={support.interfaceDensity}
                  unit="%"
                  step={5}
                  min={20}
                  max={100}
                  onChange={(v) => patch({ support: { interfaceDensity: v } })}
                />
                <div className="sm:col-span-2">
                  <div className="mb-1 flex items-center gap-1 text-[10px] font-medium tracking-wider text-white/40 uppercase">
                    <span>Stützmuster</span>
                    <InfoDot label="Stützmuster" />
                  </div>
                  <Segmented
                    size="sm"
                    value={support.pattern}
                    onChange={(v) => patch({ support: { pattern: v as PrintSettings['support']['pattern'] } })}
                    options={[
                      { value: 'grid', label: 'Gitter' },
                      { value: 'lines', label: 'Linien' },
                      { value: 'zigzag', label: 'Zickzack' },
                    ]}
                  />
                </div>
                {support.kind === 'tree' && (
                  <Stepper
                    label="Baumwinkel"
                    value={support.branchAngle}
                    unit="°"
                    step={5}
                    min={0}
                    max={70}
                    onChange={(v) => patch({ support: { branchAngle: v } })}
                  />
                )}
                <div className="rounded-xl border border-line/60 bg-ink-900/40 p-2.5 text-[10px] leading-relaxed text-white/35 sm:col-span-2">
                  Stützen entstehen aus den Überhängen des Modells. „Normal“ zieht senkrechte Säulen, „Baum“ weitet sie
                  nach unten auf und spart Material. Die Kontaktlagen unter dem Bauteil werden dichter gedruckt.
                </div>
              </>
            )}

            {tab === 'cooling' && (
              <>
                <Stepper
                  label="Bauteilkühlung"
                  value={settings.fanSpeed}
                  unit="%"
                  step={10}
                  min={0}
                  max={100}
                  onChange={(v) => patch({ fanSpeed: v })}
                />
                <Stepper
                  label="Lüfter aus – erste Schichten"
                  value={cooling.fanOffLayers}
                  step={1}
                  min={0}
                  max={6}
                  onChange={(v) => patch({ cooling: { fanOffLayers: Math.round(v) } })}
                />
                <Stepper
                  label="Mindestschichtzeit"
                  value={cooling.minLayerTime}
                  unit="s"
                  step={1}
                  min={0}
                  max={120}
                  onChange={(v) => patch({ cooling: { minLayerTime: v } })}
                />
                <div className="rounded-xl border border-line/60 bg-ink-900/40 p-2.5 text-[10px] leading-relaxed text-white/35 sm:col-span-3">
                  PLA braucht volle Kühlung, PETG etwa 60 %, ABS/ASA fast keine. Zu viel Kühlung bei ABS führt zu
                  Rissen zwischen den Schichten.
                </div>
              </>
            )}

            {tab === 'bed' && (
              <>
                <div className="sm:col-span-1">
                  <div className="mb-1 flex items-center gap-1 text-[10px] font-medium tracking-wider text-white/40 uppercase">
                    <span>Haftung</span>
                    <InfoDot label="Haftung" />
                  </div>
                  <Segmented
                    size="sm"
                    value={settings.adhesion}
                    onChange={(v) => patch({ adhesion: v })}
                    options={[
                      { value: 'none', label: 'Aus' },
                      { value: 'skirt', label: 'Skirt' },
                      { value: 'brim', label: 'Brim' },
                    ]}
                  />
                </div>
                <div className="rounded-xl border border-mint/25 bg-mint/5 p-2.5 sm:col-span-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] font-medium tracking-wider text-mint/80 uppercase">
                      Düsenreinigung · Prime-Linie
                    </span>
                    <Toggle checked={primeLine.enabled} onChange={(v) => patch({ primeLine: { enabled: v } })} />
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <Stepper
                      label="Länge"
                      value={primeLine.length}
                      unit="mm"
                      step={10}
                      onChange={(v) => patch({ primeLine: { length: v } })}
                    />
                    <Stepper
                      label="Tempo"
                      value={primeLine.speed}
                      unit="mm/s"
                      step={5}
                      onChange={(v) => patch({ primeLine: { speed: v } })}
                    />
                  </div>
                  <p className="mt-1.5 text-[9px] leading-snug text-white/25">
                    Wird vor der ersten Schicht automatisch in eine freie Randspur neben dem Modell gelegt — nicht in
                    das Modell oder den Brim. Ist kein Platz frei, wird sie ausgelassen und im Slice-Bericht gemeldet.
                  </p>
                </div>
                <div className="sm:col-span-2">
                  <div className="mb-1 flex items-center gap-1 text-[10px] font-medium tracking-wider text-white/40 uppercase">
                    <span>Bett-Mesh</span>
                    <InfoDot label="Bett-Mesh" />
                  </div>
                  <Segmented
                    size="sm"
                    value={settings.meshCompensation}
                    onChange={(v) => patch({ meshCompensation: v as MeshCompensation })}
                    options={[
                      { value: 'off', label: 'Aus' },
                      { value: 'software', label: 'Im G-Code' },
                    ]}
                  />
                </div>
                <div className="rounded-xl border border-line/70 bg-ink-900/40 p-2.5 text-[10px] leading-relaxed text-white/35 sm:col-span-2">
                  Das gemessene Mesh wird beim Slicen fest in die Z-Werte geschrieben. Der Druck braucht danach keine
                  Verbindung mehr — G-Code auf die SD-Karte und dort starten. Eine laufende Firmware-Kompensation (M420 /
                  BED_MESH_PROFILE) ist nicht mehr nötig und war über USB zu langsam.
                </div>
                <div className="rounded-xl border border-line/70 bg-ink-900/40 p-2.5 sm:col-span-2">
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1 text-[10px] font-medium tracking-wider text-white/40 uppercase">
                      Adaptiv vor dem Start
                      <InfoDot label="Adaptiv vor dem Start" />
                    </span>
                    <Toggle
                      checked={settings.adaptiveMesh.enabled}
                      onChange={(v) => patch({ adaptiveMesh: { enabled: v } })}
                    />
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <Stepper
                      label="Rand"
                      value={settings.adaptiveMesh.margin}
                      unit="mm"
                      step={5}
                      min={0}
                      max={60}
                      onChange={(v) => patch({ adaptiveMesh: { margin: v } })}
                    />
                    <Stepper
                      label="Raster"
                      value={settings.adaptiveMesh.grid}
                      step={1}
                      min={2}
                      max={11}
                      onChange={(v) => patch({ adaptiveMesh: { grid: Math.round(v) } })}
                    />
                  </div>
                </div>
                <div className="rounded-xl border border-line/70 bg-ink-900/40 p-2.5 sm:col-span-2">
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1 text-[10px] font-medium tracking-wider text-white/40 uppercase">
                      Z-Offset nachführen
                      <InfoDot label="Z-Offset nachführen" />
                    </span>
                    <Toggle checked={settings.autoZ.enabled} onChange={(v) => patch({ autoZ: { enabled: v } })} />
                  </div>
                  <p className="mt-1 text-[9px] leading-snug text-white/25">
                    Braucht eine gespeicherte Referenz aus dem Drucker-Tab.
                  </p>
                </div>
              </>
            )}

            {tab === 'advanced' && (
              <>
                <div className="rounded-xl border border-line/60 bg-ink-900/40 p-2.5 text-[10px] leading-relaxed text-white/35 sm:col-span-3">
                  Werte in Klammern stammen aus dem Druckerprofil und werden bei der Auswahl angewendet. Abweichungen
                  meldet das Studio oben als Warnung.
                </div>
                <div className="flex items-end">
                  <button
                    type="button"
                    onClick={onReset}
                    title="Alle Werte auf das gewählte Qualitätsprofil zurücksetzen"
                    className="w-full rounded-xl border border-line/80 px-2 py-2 text-[10px] text-white/40 transition hover:border-amber/40 hover:text-amber"
                  >
                    Auf Profilwerte zurücksetzen
                  </button>
                </div>
              </>
            )}
          </div>

          {limits && (
            <p className="mt-2 text-[9px] text-white/20">
              Grenzen: {limits.layer[0]}–{limits.layer[1]} mm Schicht · {limits.speed} mm/s · {limits.nozzleTemp} °C Düse ·{' '}
              {limits.bed} °C Bett · Düsen {limits.nozzle.join(' / ')} mm
            </p>
          )}
        </div>
        </SettingsResetContext.Provider>
      )}
    </div>
  )
}
