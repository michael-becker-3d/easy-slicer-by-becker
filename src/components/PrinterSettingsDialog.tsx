import { useEffect, useRef, useState } from 'react'
import type {
  CustomGcode,
  FilamentSlot,
  GcodeFlavor,
  NozzleMaterial,
  PostProcessingScript,
  PrinterProfile,
  PrinterOverrides,
  PrintSettings,
} from '../../shared/types.ts'
import { GCODE_FLAVORS, flavorLabel } from '../../shared/gcode-flavors.ts'
import type { PrinterLimits, Setup } from '../setup.ts'
import { Chip, InfoDot } from './ui.tsx'
import { CustomGcodePanel, PrinterLimitsPanel } from './PrinterView.tsx'
import { PostProcessingPanel } from './PostProcessingPanel.tsx'

type Props = {
  open: boolean
  onClose: () => void
  printer: PrinterProfile
  /** Werksprofil ohne lokale Overrides — für den Rücksetz-Knopf. */
  factoryPrinter: PrinterProfile
  printerOverrides?: PrinterOverrides
  onPrinterOverrides: (next?: PrinterOverrides) => void
  setup: Setup
  limits: PrinterLimits
  factoryLimits: PrinterLimits
  onLimits: (next: PrinterLimits) => void
  customGcode: CustomGcode
  onCustomGcode: (next: CustomGcode) => void
  onFlavor: (flavor: GcodeFlavor) => void
  /** Projektwerte für Rückzug, Z-Hop und Bewegungsprofil. */
  settings: PrintSettings
  onSettings: (next: PrintSettings) => void
  postProcessing: PostProcessingScript
  onPostProcessing: (next: PostProcessingScript) => void
  slots: FilamentSlot[]
  profiles: { id: string; name: string }[]
  nozzleMaterial: NozzleMaterial
  onNozzleMaterial: (material: NozzleMaterial) => void
  onNozzle: (nozzle: number) => void
  onSetup: () => void
  profileCount: number
  onExportAllProfiles: () => void
  onImportAllProfiles: (file: File) => void
}

type TabId = 'general' | 'limits' | 'gcode' | 'extruder' | 'multi' | 'maintenance'

const TABS: { id: TabId; label: string; hint: string }[] = [
  { id: 'general', label: 'Allgemein', hint: 'Drucker, Bauraum und Ausstattung' },
  { id: 'limits', label: 'Bewegung & Grenzen', hint: 'Maximalwerte dieses Geräts' },
  { id: 'gcode', label: 'G-Code', hint: 'Start, Ende, Schicht, Pause und Post-Processing' },
  { id: 'extruder', label: 'Extruder', hint: 'Düse, Rückzug, Z-Hop und Bewegung' },
  { id: 'multi', label: 'Mehrfarbig', hint: 'AMS/ACE/IFS-Slots' },
  { id: 'maintenance', label: 'Wartung', hint: 'Sichern, laden und wechseln' },
]

const NOZZLE_MATERIALS: { id: NozzleMaterial; label: string }[] = [
  { id: 'brass', label: 'Messing' },
  { id: 'hardened-steel', label: 'Gehärteter Stahl' },
  { id: 'stainless', label: 'Edelstahl' },
  { id: 'unknown', label: 'Unbekannt' },
]

const CONTROL_LABEL: Record<PrinterProfile['control'], string> = {
  'marlin-serial': 'USB / Marlin',
  'klipper-moonraker': 'Klipper / Moonraker',
  manual: 'Manuell',
}

export function PrinterSettingsDialog({
  open,
  onClose,
  printer,
  factoryPrinter,
  printerOverrides,
  onPrinterOverrides,
  setup,
  limits,
  factoryLimits,
  onLimits,
  customGcode,
  onCustomGcode,
  onFlavor,
  settings,
  onSettings,
  postProcessing,
  onPostProcessing,
  slots,
  profiles,
  nozzleMaterial,
  onNozzleMaterial,
  onNozzle,
  onSetup,
  profileCount,
  onExportAllProfiles,
  onImportAllProfiles,
}: Props) {
  const [tab, setTab] = useState<TabId>('general')
  const fileRef = useRef<HTMLInputElement>(null)
  const [bedDraft, setBedDraft] = useState(() => ({
    x: String(printer.bed.x),
    y: String(printer.bed.y),
    z: String(printer.bed.z),
  }))
  const [materialsDraft, setMaterialsDraft] = useState(() => printer.materials?.join(', ') ?? '')

  // Beim Öffnen den aktuell gespeicherten Stand zeigen. Während des Tippens
  // bleiben die Entwürfe stehen, damit z. B. „2“ auf dem Weg zu „200“ nicht
  // sofort als fertiger Wert geschrieben wird.
  useEffect(() => {
    if (!open) return
    setBedDraft({ x: String(printer.bed.x), y: String(printer.bed.y), z: String(printer.bed.z) })
    setMaterialsDraft(printer.materials?.join(', ') ?? '')
  }, [open, printer.id])

  const updateOverrides = (patch: PrinterOverrides) => {
    onPrinterOverrides({ ...(printerOverrides ?? {}), ...patch })
  }

  const setBed = (axis: 'x' | 'y' | 'z', raw: string) => {
    setBedDraft((prev) => ({ ...prev, [axis]: raw }))
    const value = Number(raw)
    if (!Number.isFinite(value) || value <= 0) return
    updateOverrides({ bed: { ...printer.bed, [axis]: Math.min(2000, Math.max(20, Math.round(value))) } })
  }

  const setMaterials = (raw: string) => {
    setMaterialsDraft(raw)
    const materials = [...new Set(raw.split(',').map((item) => item.trim()).filter(Boolean))]
    const next: PrinterOverrides = { ...(printerOverrides ?? {}) }
    // Eine leere Liste ist ein bewusster „keine Einschränkung“-Override.
    next.materials = materials
    onPrinterOverrides(Object.keys(next).length ? next : undefined)
  }

  const resetMachine = () => {
    setBedDraft({ x: String(factoryPrinter.bed.x), y: String(factoryPrinter.bed.y), z: String(factoryPrinter.bed.z) })
    setMaterialsDraft(factoryPrinter.materials?.join(', ') ?? '')
    onPrinterOverrides(undefined)
  }

  const hasOverrides = !!printerOverrides && Object.keys(printerOverrides).length > 0

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[70] grid place-items-center bg-ink-950/75 p-3 backdrop-blur-sm">
      <div className="ui-max-h-92 flex w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-line/80 bg-ink-900 shadow-2xl">
        <header className="flex items-center justify-between gap-3 border-b border-line/70 px-4 py-3">
          <div className="min-w-0">
            <div className="text-[10px] font-semibold tracking-[0.18em] text-amber/80 uppercase">Druckereinstellungen</div>
            <h2 className="mt-0.5 truncate text-sm font-semibold text-white/90">
              {printer.brand} {printer.name}
            </h2>
            <p className="mt-0.5 text-[10px] text-white/35">
              {CONTROL_LABEL[printer.control]} · {printer.bed.x} × {printer.bed.y} × {printer.bed.z} mm
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Druckereinstellungen schließen"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-xl border border-line/70 text-white/45 transition hover:border-rose/40 hover:text-rose"
          >
            ✕
          </button>
        </header>

        <div className="grid min-h-0 flex-1 md:grid-cols-[210px_minmax(0,1fr)]">
          <nav className="flex gap-1 overflow-x-auto border-b border-line/60 p-2 md:flex-col md:overflow-y-auto md:border-r md:border-b-0">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={`shrink-0 rounded-xl px-2.5 py-2 text-left transition md:w-full ${
                  tab === t.id ? 'bg-amber/15 text-amber' : 'text-white/50 hover:bg-white/5 hover:text-white/80'
                }`}
              >
                <span className="block text-[11px] font-semibold">{t.label}</span>
                <span className="mt-0.5 hidden text-[9px] leading-snug text-white/25 md:block">{t.hint}</span>
              </button>
            ))}
          </nav>

          <div className="min-h-0 overflow-y-auto p-3">
            {tab === 'general' && (
              <div className="space-y-3">
                <section className="rounded-2xl border border-line/70 bg-ink-900/50 p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <h3 className="text-[10px] font-semibold tracking-[0.16em] text-white/40 uppercase">
                        Geräteprofil
                      </h3>
                      <p className="mt-0.5 text-[9px] leading-snug text-white/30">
                        Gilt nur für diesen Drucker und wird mit seinem Stand gespeichert. Der Katalog bleibt unverändert.
                      </p>
                    </div>
                    {hasOverrides && (
                      <button
                        type="button"
                        onClick={resetMachine}
                        className="shrink-0 rounded-xl border border-line/80 px-2.5 py-1.5 text-[10px] text-white/55 transition hover:border-amber/40 hover:text-amber"
                      >
                        ↺ Katalogwerte
                      </button>
                    )}
                  </div>

                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <div>
                      <div className="text-[9px] font-medium tracking-wider text-white/35 uppercase">Bauraum</div>
                      <div className="mt-1 grid grid-cols-3 gap-1.5">
                        {(['x', 'y', 'z'] as const).map((axis) => (
                          <label key={axis} className="block">
                            <span className="mb-0.5 block text-[8px] font-semibold tracking-wider text-white/25 uppercase">
                              {axis}
                            </span>
                            <div className="flex items-center gap-1 rounded-lg border border-line/80 bg-ink-900/70 px-1.5 py-1.5">
                              <input
                                type="number"
                                min={20}
                                max={2000}
                                step={1}
                                aria-label={`Bauraum ${axis.toUpperCase()}`}
                                value={bedDraft[axis]}
                                onChange={(e) => setBed(axis, e.target.value)}
                                onBlur={() => {
                                  const value = Number(bedDraft[axis])
                                  if (!Number.isFinite(value) || value <= 0) {
                                    setBedDraft((prev) => ({ ...prev, [axis]: String(printer.bed[axis]) }))
                                  }
                                }}
                                className="tabular min-w-0 flex-1 bg-transparent text-[11px] text-white/85 outline-none"
                              />
                              <span className="shrink-0 text-[8px] text-white/25">mm</span>
                            </div>
                          </label>
                        ))}
                      </div>
                    </div>

                    <div>
                      <div className="text-[9px] font-medium tracking-wider text-white/35 uppercase">Kinematik</div>
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        {([
                          ['cartesian', 'Kartesisch'],
                          ['corexy', 'CoreXY'],
                          ['delta', 'Delta'],
                        ] as const).map(([id, label]) => (
                          <button
                            key={id}
                            type="button"
                            onClick={() => updateOverrides({ kinematics: id })}
                            className={`rounded-lg border px-2 py-1.5 text-[10px] font-medium transition ${
                              (printer.kinematics ?? 'cartesian') === id
                                ? 'border-amber/60 bg-amber/10 text-amber'
                                : 'border-line/70 text-white/50 hover:border-white/25'
                            }`}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                      <p className="mt-1 text-[8px] leading-snug text-white/25">
                        Delta nutzt ein rundes Bett; Start- und Endwege werden beim Ändern angepasst, solange der
                        Standard-G-Code unverändert ist.
                      </p>
                    </div>
                  </div>

                  <label className="mt-3 block">
                    <span className="mb-1 block text-[9px] font-medium tracking-wider text-white/35 uppercase">
                      Unterstützte Materialien
                    </span>
                    <input
                      type="text"
                      value={materialsDraft}
                      onChange={(e) => setMaterials(e.target.value)}
                      placeholder="PLA, PETG, TPU"
                      className="w-full rounded-lg border border-line/80 bg-ink-900/70 px-2 py-1.5 text-[11px] text-white/85 outline-none placeholder:text-white/20 focus:border-amber/50"
                    />
                    <span className="mt-1 block text-[8px] leading-snug text-white/25">
                      Kommagetrennt, z. B. „PLA, PETG, TPU“. Leer bedeutet: keine Einschränkung.
                    </span>
                  </label>
                </section>

                <div className="grid gap-2 sm:grid-cols-2">
                  <Card label="Verbindung" value={CONTROL_LABEL[printer.control]} />
                  <Card label="G-Code-Flavor" value={flavorLabel(printer.flavor)} />
                  <Card label="Bettnivellierung" value={printer.hasBedLeveling ? 'vorhanden' : 'manuell'} />
                  <Card label="Sonde" value={printer.probe} />
                  <Card label="Schichthöhe" value={`${printer.layerRange[0]}–${printer.layerRange[1]} mm`} />
                  <Card label="Düse aktuell" value={`⌀ ${setup.nozzle} mm`} />
                  <Card label="Filament" value={profiles.find((p) => p.id === setup.filamentId)?.name ?? setup.filamentId} />
                  <Card label="Düsenmaterial" value={NOZZLE_MATERIALS.find((m) => m.id === nozzleMaterial)?.label ?? nozzleMaterial} />
                  <Card label="Mehrfachzuführung" value={printer.ifs ? `${printer.ifs.name} · ${printer.ifs.slots} Slots` : 'keine'} />
                </div>

                <section className="rounded-2xl border border-line/70 bg-ink-900/50 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h3 className="text-[10px] font-semibold tracking-[0.16em] text-white/40 uppercase">
                        G-Code-Flavor
                      </h3>
                      <p className="mt-0.5 text-[9px] leading-snug text-white/30">
                        Steuert Start-/Endbefehle, Pressure Advance und Input Shaping. Die Auswahl gilt nur für diesen
                        Drucker und wird mit seinem Stand gespeichert.
                      </p>
                    </div>
                    <span className="rounded-full border border-mint/30 bg-mint/10 px-2 py-0.5 text-[9px] font-semibold text-mint">
                      {flavorLabel(printer.flavor)}
                    </span>
                  </div>
                  <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
                    {GCODE_FLAVORS.map((flavor) => (
                      <button
                        key={flavor.id}
                        type="button"
                        onClick={() => onFlavor(flavor.id)}
                        className={`rounded-xl border px-2.5 py-2 text-left transition ${
                          printer.flavor === flavor.id
                            ? 'border-amber/60 bg-amber/10 text-amber'
                            : 'border-line/70 text-white/55 hover:border-white/25 hover:text-white/80'
                        }`}
                      >
                        <span className="block text-[10px] font-semibold">{flavor.label}</span>
                        <span className="mt-0.5 block text-[8px] leading-snug text-white/30">{flavor.hint}</span>
                      </button>
                    ))}
                  </div>
                  <p className="mt-2 text-[9px] leading-snug text-white/25">
                    Die Standard-Start-/Endblöcke im Tab „G-Code“ werden beim Laden des Druckers eingesetzt. Solange du
                    sie nicht bearbeitest, werden sie beim Flavor-Wechsel automatisch angepasst.
                  </p>
                </section>

                {printer.note && (
                  <p className="rounded-xl border border-sky/25 bg-sky/5 px-3 py-2 text-[10px] leading-relaxed text-sky/75">
                    {printer.note}
                  </p>
                )}
                {printer.transportNote && (
                  <p className="rounded-xl border border-line/70 bg-ink-900/50 px-3 py-2 text-[10px] leading-relaxed text-white/40">
                    {printer.transportNote}
                  </p>
                )}

                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      onClose()
                      onSetup()
                    }}
                    className="rounded-xl border border-amber/50 bg-amber/10 px-3 py-1.5 text-[11px] font-semibold text-amber transition hover:bg-amber/20"
                  >
                    Drucker / Filament / Platte wechseln
                  </button>
                  <button
                    type="button"
                    onClick={() => setTab('extruder')}
                    className="rounded-xl border border-line/80 px-3 py-1.5 text-[11px] text-white/60 transition hover:border-sky/40 hover:text-sky"
                  >
                    Düse einstellen
                  </button>
                </div>

                <p className="text-[9px] leading-snug text-white/25">
                  Verbindung, Sonde und Werksgrenzen kommen aus dem Katalog. Bauraum, Kinematik und Materialien werden als
                  eigene Gerätewerte getrennt pro Drucker gespeichert; die Projektwerte links gelten nur für das aktuelle
                  Modell.
                </p>
              </div>
            )}

            {tab === 'limits' && (
              <div className="space-y-2">
                <p className="rounded-xl border border-amber/30 bg-amber/8 px-3 py-2 text-[10px] leading-relaxed text-amber/80">
                  Diese Grenzen gelten für den Drucker und begrenzen jedes Projekt. Die Werte links im Studio sind
                  Projektwerte und dürfen darunterliegen.
                </p>
                <PrinterLimitsPanel
                  value={limits}
                  factory={factoryLimits}
                  onSave={onLimits}
                  printerName={printer.name}
                />
              </div>
            )}

            {tab === 'gcode' && (
              <div className="space-y-2">
                <p className="rounded-xl border border-line/70 bg-ink-900/50 px-3 py-2 text-[10px] leading-relaxed text-white/40">
                  Der eigene G-Code gehört zu diesem Drucker und wird mit seinen Einstellungen und Druckerständen
                  gesichert. Platzhalter werden beim Slicen ersetzt.
                </p>
                <CustomGcodePanel value={customGcode} onSave={onCustomGcode} printerName={printer.name} />
                <PostProcessingPanel
                  value={postProcessing}
                  onSave={onPostProcessing}
                  printerName={printer.name}
                />
              </div>
            )}

            {tab === 'extruder' && (
              <div className="space-y-3">
                <section className="rounded-2xl border border-line/70 bg-ink-900/50 p-3">
                  <h3 className="text-[10px] font-semibold tracking-[0.16em] text-white/40 uppercase">Düsendurchmesser</h3>
                  <p className="mt-1 text-[9px] leading-snug text-white/30">
                    Ändert die Projektberechnung und die Linienbreite. Nur Durchmesser wählen, die tatsächlich verbaut
                    sind.
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {printer.nozzleOptions.map((n) => (
                      <button
                        key={n}
                        type="button"
                        onClick={() => onNozzle(n)}
                        className={`rounded-xl border px-3 py-1.5 text-[11px] font-semibold transition ${
                          setup.nozzle === n
                            ? 'border-amber/60 bg-amber/15 text-amber'
                            : 'border-line/70 text-white/50 hover:border-white/25'
                        }`}
                      >
                        ⌀ {n} mm
                      </button>
                    ))}
                  </div>
                </section>

                <section className="rounded-2xl border border-line/70 bg-ink-900/50 p-3">
                  <h3 className="flex items-center gap-1 text-[10px] font-semibold tracking-[0.16em] text-white/40 uppercase">
                    Düsenmaterial <InfoDot label="Düsenmaterial" />
                  </h3>
                  <div className="mt-2 grid grid-cols-2 gap-1.5">
                    {NOZZLE_MATERIALS.map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => onNozzleMaterial(m.id)}
                        className={`rounded-xl border px-2 py-1.5 text-left text-[10px] transition ${
                          nozzleMaterial === m.id
                            ? 'border-amber/60 bg-amber/10 text-amber'
                            : 'border-line/70 text-white/55 hover:border-white/20'
                        }`}
                      >
                        {m.label}
                      </button>
                    ))}
                  </div>
                  <p className="mt-2 text-[9px] leading-relaxed text-white/30">
                    Gehärteter Stahl oder Edelstahl für CF/GF. Messing leitet Wärme besser, verschleißt aber bei
                    abrasivem Filament.
                  </p>
                </section>

                <section className="rounded-2xl border border-line/70 bg-ink-900/50 p-3">
                  <h3 className="text-[10px] font-semibold tracking-[0.16em] text-white/40 uppercase">Rückzug & Z-Hop</h3>
                  <p className="mt-1 text-[9px] leading-snug text-white/30">
                    Gilt für das aktuelle Projekt. Die Werkswerte des Druckerprofils bleiben unverändert.
                  </p>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    <NumField
                      label="Rückzugslänge"
                      unit="mm"
                      step={0.1}
                      min={0}
                      max={8}
                      value={settings.retraction.distance}
                      onChange={(value) =>
                        onSettings({ ...settings, retraction: { ...settings.retraction, distance: value } })
                      }
                    />
                    <NumField
                      label="Rückzugsgeschwindigkeit"
                      unit="mm/s"
                      step={5}
                      min={10}
                      max={120}
                      value={settings.retraction.speed}
                      onChange={(value) =>
                        onSettings({ ...settings, retraction: { ...settings.retraction, speed: value } })
                      }
                    />
                    <NumField
                      label="Rückzug ab Weg"
                      unit="mm"
                      step={0.5}
                      min={0}
                      max={10}
                      value={settings.retraction.minTravel}
                      onChange={(value) =>
                        onSettings({ ...settings, retraction: { ...settings.retraction, minTravel: value } })
                      }
                    />
                    <NumField
                      label="Z-Hop"
                      unit="mm"
                      step={0.1}
                      min={0}
                      max={2}
                      value={settings.zHop}
                      onChange={(value) => onSettings({ ...settings, zHop: value })}
                    />
                  </div>
                  <ToggleRow
                    label="Rückzug bei Schichtwechsel"
                    checked={settings.retraction.onLayerChange !== false}
                    onChange={(checked) =>
                      onSettings({ ...settings, retraction: { ...settings.retraction, onLayerChange: checked } })
                    }
                  />
                </section>

                <section className="rounded-2xl border border-line/70 bg-ink-900/50 p-3">
                  <h3 className="text-[10px] font-semibold tracking-[0.16em] text-white/40 uppercase">
                    Jerk & Junction
                  </h3>
                  <p className="mt-1 text-[9px] leading-snug text-white/30">
                    Eckgeschwindigkeit und Ruckbegrenzung. Die Beschleunigungsgrenzen stehen im Tab „Bewegung &
                    Grenzen“.
                  </p>
                  <ToggleRow
                    label="Classic Jerk"
                    checked={settings.classicJerk.enabled}
                    onChange={(checked) =>
                      onSettings({ ...settings, classicJerk: { ...settings.classicJerk, enabled: checked } })
                    }
                  />
                  <ToggleRow
                    label="Junction Deviation"
                    checked={settings.junctionDeviation.enabled}
                    onChange={(checked) =>
                      onSettings({ ...settings, junctionDeviation: { ...settings.junctionDeviation, enabled: checked } })
                    }
                  />
                  <ToggleRow
                    label="Square Corner Velocity"
                    checked={settings.squareCornerVelocity.enabled}
                    onChange={(checked) =>
                      onSettings({ ...settings, squareCornerVelocity: { ...settings.squareCornerVelocity, enabled: checked } })
                    }
                  />
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    <NumField
                      label="Jerk X"
                      unit="mm/s"
                      step={1}
                      min={0}
                      max={50}
                      value={settings.classicJerk.x}
                      onChange={(value) =>
                        onSettings({ ...settings, classicJerk: { ...settings.classicJerk, x: value } })
                      }
                    />
                    <NumField
                      label="Jerk Y"
                      unit="mm/s"
                      step={1}
                      min={0}
                      max={50}
                      value={settings.classicJerk.y}
                      onChange={(value) =>
                        onSettings({ ...settings, classicJerk: { ...settings.classicJerk, y: value } })
                      }
                    />
                    <NumField
                      label="Junction Deviation"
                      step={0.005}
                      min={0}
                      max={0.2}
                      value={settings.junctionDeviation.value}
                      onChange={(value) =>
                        onSettings({ ...settings, junctionDeviation: { ...settings.junctionDeviation, value } })
                      }
                    />
                    <NumField
                      label="Square Corner Velocity"
                      unit="mm/s"
                      step={1}
                      min={0}
                      max={20}
                      value={settings.squareCornerVelocity.value}
                      onChange={(value) =>
                        onSettings({ ...settings, squareCornerVelocity: { ...settings.squareCornerVelocity, value } })
                      }
                    />
                  </div>
                </section>
              </div>
            )}

            {tab === 'multi' && (
              <div className="space-y-3">
                <div className="rounded-2xl border border-sky/25 bg-sky/5 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <h3 className="text-[10px] font-semibold tracking-[0.16em] text-sky/80 uppercase">Mehrfachzuführung</h3>
                      <p className="mt-0.5 text-[10px] text-white/40">
                        {printer.ifs ? printer.ifs.name : 'Für diesen Drucker nicht hinterlegt'}
                      </p>
                    </div>
                    <Chip tone={printer.ifs ? 'sky' : 'neutral'}>{printer.ifs ? `${printer.ifs.slots} Slots` : 'keine'}</Chip>
                  </div>
                  {printer.ifs?.note && <p className="mt-2 text-[9px] leading-relaxed text-white/35">{printer.ifs.note}</p>}
                </div>

                {slots.length > 0 ? (
                  <div className="grid gap-2 sm:grid-cols-2">
                    {slots.map((slot, i) => (
                      <div key={slot.id} className="flex items-center gap-2 rounded-xl border border-line/70 bg-ink-900/50 px-2.5 py-2">
                        <span
                          className="h-3 w-3 shrink-0 rounded-full border border-white/25"
                          style={{ background: slot.color ?? '#94a3b8' }}
                        />
                        <div className="min-w-0">
                          <div className="text-[10px] font-medium text-white/75">
                            {slot.label} <span className="text-white/25">· Platz {i + 1}</span>
                          </div>
                          <div className="truncate text-[9px] text-white/30">
                            {profiles.find((p) => p.id === slot.profileId)?.name ?? slot.profileId}
                            {slot.present === false ? ' · nicht eingelegt' : ''}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="rounded-xl border border-line/70 bg-ink-900/40 px-3 py-2 text-[10px] leading-relaxed text-white/35">
                    Noch keine Slots angelegt. Beim ersten Öffnen des Druckers werden sie aus der Mehrfachzuführung
                    erzeugt.
                  </p>
                )}

                <p className="text-[9px] leading-relaxed text-white/30">
                  Farben und Profile werden in der linken Leiste unter „Mehrfarbig“ bearbeitet. Der Slicer druckt
                  unterschiedliche Slots aktuell als sequenzielle Objekte mit M600; echte Farbwechsel pro Schicht sind
                  noch nicht erzeugt.
                </p>
              </div>
            )}

            {tab === 'maintenance' && (
              <div className="space-y-3">
                <section className="rounded-2xl border border-line/70 bg-ink-900/50 p-3">
                  <h3 className="text-[10px] font-semibold tracking-[0.16em] text-white/40 uppercase">Druckerstände</h3>
                  <p className="mt-1 text-[10px] leading-relaxed text-white/40">
                    {profileCount} gespeicherte{profileCount === 1 ? 'r' : ''} Druckerstand
                    {profileCount === 1 ? '' : 'e'} auf diesem Rechner. Darin liegen Drucker, Filament, Platte,
                    Projektwerte und eigener G-Code.
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={onExportAllProfiles}
                      className="rounded-xl border border-sky/40 bg-sky/10 px-3 py-1.5 text-[10px] font-semibold text-sky transition hover:bg-sky/20"
                    >
                      Alle Stände sichern …
                    </button>
                    <button
                      type="button"
                      onClick={() => fileRef.current?.click()}
                      className="rounded-xl border border-line/80 px-3 py-1.5 text-[10px] text-white/60 transition hover:border-mint/40 hover:text-mint"
                    >
                      Sicherung laden …
                    </button>
                    <input
                      ref={fileRef}
                      type="file"
                      accept=".json,application/json"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0]
                        if (file) onImportAllProfiles(file)
                        e.currentTarget.value = ''
                      }}
                    />
                  </div>
                </section>

                <section className="rounded-2xl border border-line/70 bg-ink-900/50 p-3">
                  <h3 className="text-[10px] font-semibold tracking-[0.16em] text-white/40 uppercase">Gerät wechseln</h3>
                  <p className="mt-1 text-[10px] leading-relaxed text-white/40">
                    Ein Wechsel lädt den gespeicherten Stand des Zielgeräts. Der aktuelle Stand wird vorher gesichert.
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      onClose()
                      onSetup()
                    }}
                    className="mt-2 rounded-xl border border-amber/50 bg-amber/10 px-3 py-1.5 text-[10px] font-semibold text-amber"
                  >
                    Drucker / Filament / Platte wechseln
                  </button>
                </section>

                <p className="text-[9px] leading-relaxed text-white/25">
                  Sicherungen bleiben lokal. Es werden keine Drucker- oder Hardwareeinstellungen an einen Clouddienst
                  gesendet.
                </p>
              </div>
            )}
          </div>
        </div>

        <footer className="flex items-center justify-between gap-2 border-t border-line/70 px-4 py-2.5">
          <span className="truncate text-[9px] text-white/25">
            {printer.ifs ? `${printer.ifs.name} · ` : ''}
            {setup.nozzle} mm Düse · {NOZZLE_MATERIALS.find((m) => m.id === nozzleMaterial)?.label}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl bg-white/10 px-3 py-1.5 text-[10px] font-semibold text-white/75 transition hover:bg-white/15"
          >
            Schließen
          </button>
        </footer>
      </div>
    </div>
  )
}

function Card({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-line/70 bg-ink-900/50 px-2.5 py-2">
      <div className="text-[9px] tracking-wider text-white/30 uppercase">{label}</div>
      <div className="mt-0.5 truncate text-[11px] font-medium text-white/75">{value}</div>
    </div>
  )
}

function NumField({
  label,
  unit,
  step,
  min,
  max,
  value,
  onChange,
}: {
  label: string
  unit?: string
  step: number
  min: number
  max: number
  value: number
  onChange: (value: number) => void
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[9px] font-medium tracking-wider text-white/35 uppercase">{label}</span>
      <div className="flex items-center gap-1.5 rounded-lg border border-line/80 bg-ink-900/70 px-2 py-1.5">
        <input
          type="number"
          min={min}
          max={max}
          step={step}
          value={Number.isFinite(value) ? value : 0}
          onChange={(e) => {
            const next = Number(e.target.value)
            if (Number.isFinite(next)) onChange(Math.min(max, Math.max(min, next)))
          }}
          className="tabular min-w-0 flex-1 bg-transparent text-[11px] text-white/85 outline-none"
        />
        {unit && <span className="shrink-0 text-[9px] text-white/30">{unit}</span>}
      </div>
    </label>
  )
}

function ToggleRow({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <label className="mt-2 flex items-center justify-between gap-2 rounded-lg border border-line/60 bg-ink-900/40 px-2.5 py-1.5 text-[10px] text-white/65">
      <span>{label}</span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-3.5 w-3.5 accent-amber"
      />
    </label>
  )
}
