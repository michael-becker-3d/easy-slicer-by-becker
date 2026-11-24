import { useEffect, useMemo, useState } from 'react'
import type {
  BuildPlate,
  DetectedDevice,
  FilamentProfile,
  KlipperMeshProfiles,
  PlateFilamentTemps,
  PlateProfile,
  PrintSettings,
  PrinterProfile,
} from '../../shared/types.ts'
import { applyPlateProfile } from '../../shared/types.ts'
import { applyPrinterLimits, settingsForFilament } from '../../shared/catalog.ts'
import { injectBedTemperatureMesh, injectMeshName, renderStartGcodeLine } from '../../shared/gcode-templates.ts'
import * as api from '../api.ts'
import type { Catalog } from '../api.ts'
import { loadSnapshot } from '../printers.ts'
import { effectivePrinterLimits, loadBrandModels, rememberBrandModel, type Setup } from '../setup.ts'

type Props = {
  open: boolean
  catalog: Catalog
  setup: Setup
  settings: PrintSettings
  devices: DetectedDevice[]
  onClose: () => void
  onApply: (setup: Setup) => void
  onScan: () => void
  onUseDevice: (device: DetectedDevice) => void
  /** Katalog neu laden, nachdem ein eigener Drucker angelegt/gelöscht wurde */
  onReload: () => void
  /** Katalog- und eigene Filamentprofile */
  filaments?: FilamentProfile[]
  onDeleteFilament?: (id: string) => void
}

const NOZZLE_MATERIALS: { id: Setup['nozzleMaterial']; label: string; hint: string }[] = [
  {
    id: 'brass',
    label: 'Messing',
    hint: 'Standard: sehr gute Wärmeleitung, aber weich — nicht für CF/GF-Filament.',
  },
  {
    id: 'hardened-steel',
    label: 'Gehärteter Stahl',
    hint: 'Für Kohle-/Glasfaser und abrasives Material. Etwas schlechtere Wärmeleitung, meist 5–10 °C heißer fahren.',
  },
  {
    id: 'stainless',
    label: 'Edelstahl',
    hint: 'Robust und lebensmittelecht; für die meisten Filamente geeignet, abrasiv nur bedingt.',
  },
  {
    id: 'unknown',
    label: 'Unbekannt',
    hint: 'Wenn du es nicht weißt: bei abrasivem Filament vorsichtig und mit niedrigerem Volumenstrom drucken.',
  },
]

const controlLabel: Record<string, string> = {
  'marlin-serial': 'USB',
  'klipper-moonraker': 'Klipper',
  manual: 'manuell',
}

export function SetupDialog({
  open,
  catalog,
  setup,
  settings,
  devices,
  onClose,
  onApply,
  onScan,
  onUseDevice,
  onReload,
  filaments,
  onDeleteFilament,
}: Props) {
  const filamentList = filaments ?? catalog.filaments
  const [draft, setDraft] = useState<Setup>(setup)
  const [query, setQuery] = useState('')
  const [brand, setBrand] = useState<string>(() => {
    const current = catalog.printers.find((p) => p.id === setup.printerId)
    return current?.brand ?? 'alle'
  })

  // Eigener Drucker (No-Name)
  const [customName, setCustomName] = useState('')
  const [bedX, setBedX] = useState(220)
  const [bedY, setBedY] = useState(220)
  const [bedZ, setBedZ] = useState(250)
  const [customBaud, setCustomBaud] = useState(0)
  const [saving, setSaving] = useState(false)
  const [customError, setCustomError] = useState<string | null>(null)
  const [meshProfiles, setMeshProfiles] = useState<KlipperMeshProfiles>({
    profiles: [],
    current: null,
    available: false,
  })
  const [meshProfilesLoading, setMeshProfilesLoading] = useState(false)
  const [meshProfilesError, setMeshProfilesError] = useState<string | null>(null)
  const [meshProfilesRefresh, setMeshProfilesRefresh] = useState(0)

  const pickPrinter = (id: string, defaultPlate: string) => {
    const target = loadSnapshot(id)
    setDraft((d) => ({
      ...d,
      printerId: id,
      plateId: defaultPlate,
      plateProfiles: target?.setup.printerId === id ? target.setup.plateProfiles : undefined,
    }))
  }

  const createCustom = async () => {
    setSaving(true)
    setCustomError(null)
    try {
      const profile = await api.saveCustomPrinter({
        name: customName.trim() || 'Eigener Drucker',
        bed: { x: bedX, y: bedY, z: bedZ },
        baud: customBaud,
      })
      setCustomName('')
      pickPrinter(profile.id, profile.defaultPlate)
      onReload()
    } catch (err) {
      setCustomError(err instanceof Error ? err.message : 'Speichern fehlgeschlagen.')
    } finally {
      setSaving(false)
    }
  }

  const removeCustom = async (id: string) => {
    setCustomError(null)
    try {
      await api.deleteCustomPrinter(id)
      onReload()
    } catch (err) {
      setCustomError(err instanceof Error ? err.message : 'Löschen fehlgeschlagen.')
    }
  }

  useEffect(() => {
    if (open) {
      setDraft(setup)
      const current = catalog.printers.find((p) => p.id === setup.printerId)
      setBrand(current?.brand ?? 'alle')
      onScan()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEffect(() => {
    if (!open) return
    const supportsZmod =
      (catalog.printers.find((p) => p.id === draft.printerId) ?? catalog.printers[0])?.zmodMesh === true
    if (!supportsZmod) return
    let cancelled = false
    setMeshProfilesLoading(true)
    setMeshProfilesError(null)
    api
      .fetchMeshProfiles()
      .then((result) => {
        if (!cancelled) setMeshProfiles(result)
      })
      .catch((err) => {
        if (cancelled) return
        setMeshProfiles({ profiles: [], current: null, available: false })
        setMeshProfilesError(err instanceof Error ? err.message : 'Meshprofile konnten nicht gelesen werden.')
      })
      .finally(() => {
        if (!cancelled) setMeshProfilesLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, meshProfilesRefresh, draft.printerId, catalog.printers])

  const brands = useMemo(() => ['alle', ...new Set(catalog.printers.map((p) => p.brand))], [catalog.printers])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return catalog.printers.filter(
      (p) =>
        (brand === 'alle' || p.brand === brand) &&
        (!q || `${p.brand} ${p.name}`.toLowerCase().includes(q)),
    )
  }, [catalog.printers, brand, query])

  const printer: PrinterProfile = catalog.printers.find((p) => p.id === draft.printerId) ?? catalog.printers[0]
  const zmodMesh = printer.zmodMesh === true
  const limits = effectivePrinterLimits(printer, draft.limits)
  const filament: FilamentProfile = filamentList.find((f) => f.id === draft.filamentId) ?? filamentList[0]
  const plate: BuildPlate = catalog.plates.find((p) => p.id === draft.plateId) ?? catalog.plates[0]
  const plateProfile: PlateProfile = draft.plateProfiles?.[draft.plateId] ?? {}
  const plateTemps: PlateFilamentTemps = plateProfile.filamentTemps?.[draft.filamentId] ?? {}
  const updatePlateMesh = (meshName: string) => {
    setDraft((d) => {
      const profile = d.plateProfiles?.[d.plateId] ?? {}
      const next: PlateProfile = { ...profile }
      const name = meshName.trim()
      if (name) next.meshProfile = name
      else delete next.meshProfile
      const plateProfiles = { ...(d.plateProfiles ?? {}) }
      if (Object.keys(next).length) plateProfiles[d.plateId] = next
      else delete plateProfiles[d.plateId]
      return { ...d, plateProfiles }
    })
  }
  const meshOptions = useMemo(() => {
    const names = [...meshProfiles.profiles]
    if (meshProfiles.current && !names.includes(meshProfiles.current)) names.push(meshProfiles.current)
    const selected = plateProfile.meshProfile?.trim()
    if (selected && !names.includes(selected)) names.push(selected)
    return names
  }, [meshProfiles, plateProfile.meshProfile])
  const previewSettings = applyPrinterLimits(
    { ...printer, ...limits },
    applyPlateProfile(settingsForFilament(settings, filament, plate, draft.nozzle), plateProfile, draft.filamentId),
  )
  const selectedMeshProfile = plateProfile.meshProfile?.trim() ?? ''
  const autoMeshName = String(Math.round(previewSettings.temps.firstLayerBed))
  const autoMeshMissing =
    zmodMesh &&
    !selectedMeshProfile &&
    meshProfiles.available &&
    meshProfiles.profiles.length > 0 &&
    !meshProfiles.profiles.includes(autoMeshName)
  const selectedProfileMissing =
    zmodMesh &&
    Boolean(selectedMeshProfile) &&
    meshProfiles.available &&
    meshProfiles.profiles.length > 0 &&
    !meshProfiles.profiles.includes(selectedMeshProfile)
  const previewMeshName = selectedMeshProfile || autoMeshName
  const previewWithMesh = zmodMesh
    ? selectedMeshProfile
      ? injectMeshName(draft.customGcode.start, selectedMeshProfile)
      : injectBedTemperatureMesh(draft.customGcode.start, previewSettings.temps.firstLayerBed)
    : draft.customGcode.start
  const startPreview = renderStartGcodeLine(previewWithMesh, {
    nozzle: previewSettings.temps.nozzle,
    firstLayerNozzle: previewSettings.temps.firstLayerNozzle,
    bed: previewSettings.temps.bed,
    firstLayerBed: previewSettings.temps.firstLayerBed,
    layerHeight: previewSettings.layerHeight,
    firstLayerHeight: previewSettings.firstLayerHeight,
    nozzleDiameter: previewSettings.nozzle,
    filamentDiameter: previewSettings.filamentDiameter,
    printerName: printer.name,
  })
  const startHasMesh = /^\s*START_PRINT\b[^\n]*\bMESH\s*=/im.test(draft.customGcode.start)
  const updatePlateTemps = (patch: Partial<PlateFilamentTemps>) => {
    setDraft((d) => {
      const profile = d.plateProfiles?.[d.plateId] ?? {}
      const filamentTemps = { ...(profile.filamentTemps ?? {}) }
      const next = { ...(filamentTemps[d.filamentId] ?? {}), ...patch }
      if (next.bedTemp == null && next.firstLayerBed == null) delete filamentTemps[d.filamentId]
      else filamentTemps[d.filamentId] = next
      return {
        ...d,
        plateProfiles: {
          ...(d.plateProfiles ?? {}),
          [d.plateId]: { ...profile, filamentTemps },
        },
      }
    })
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-ink-950/80 p-3 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Drucker einrichten"
        className="ui-max-h-92 flex w-full max-w-6xl flex-col overflow-hidden rounded-3xl border border-line/80 bg-ink-900 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-3 border-b border-line/60 px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold text-white/90">Drucker einrichten</h2>
            <p className="mt-1 text-[11px] text-white/40">
              Profil, Material und Platte wählen — der Rest ist danach schon vorkonfiguriert.
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg px-2 py-1 text-white/35 hover:text-white">
            ✕
          </button>
        </div>

        <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto p-5 lg:grid-cols-[minmax(0,1fr)_360px] lg:grid-rows-1 lg:overflow-hidden">
          {/* Druckerliste */}
          <div className="flex flex-col lg:min-h-0">
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Drucker suchen …"
                className="min-w-0 flex-1 rounded-xl border border-line/80 bg-ink-850 px-3 py-2 text-xs text-white/80 outline-none focus:border-amber/50"
              />
              <select
                value={brand}
                onChange={(e) => {
                  const next = e.target.value
                  setBrand(next)
                  if (next === 'alle') return
                  // Zuletzt gewähltes Modell dieser Marke, sonst das erste
                  const remembered = loadBrandModels()[next]
                  const first =
                    catalog.printers.find((p) => p.id === remembered && p.brand === next) ??
                    catalog.printers.find((p) => p.brand === next)
                  if (first) pickPrinter(first.id, first.defaultPlate)
                }}
                aria-label="Hersteller"
                className="rounded-xl border border-line/80 bg-ink-850 px-2 py-2 text-xs text-white/70 outline-none"
              >
                {brands.map((b) => (
                  <option key={b} value={b}>
                    {b === 'alle' ? 'Alle Hersteller' : b}
                  </option>
                ))}
              </select>
              {brand !== 'alle' && (
                <select
                  value={filtered.some((p) => p.id === draft.printerId) ? draft.printerId : ''}
                  onChange={(e) => {
                    const picked = catalog.printers.find((p) => p.id === e.target.value)
                    if (picked) {
                      rememberBrandModel(picked.brand, picked.id)
                      pickPrinter(picked.id, picked.defaultPlate)
                    }
                  }}
                  aria-label="Modell"
                  className="max-w-[15rem] rounded-xl border border-line/80 bg-ink-850 px-2 py-2 text-xs text-white/70 outline-none"
                >
                  {!filtered.some((p) => p.id === draft.printerId) && <option value="">Modell wählen …</option>}
                  {filtered.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              )}
            </div>

            <div className="mt-2 lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:pr-1">
              <div className="grid gap-1.5 sm:grid-cols-2">
                {filtered.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    data-testid={`printer-option-${p.id}`}
                    onClick={() => {
                      rememberBrandModel(p.brand, p.id)
                      pickPrinter(p.id, p.defaultPlate)
                    }}
                    className={`rounded-xl border px-3 py-2 text-left transition ${
                      draft.printerId === p.id
                        ? 'border-amber/60 bg-amber/10'
                        : 'border-line/60 bg-ink-850/60 hover:border-white/15'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-[11px] font-semibold text-white/85">{p.name}</span>
                      <span
                        className={`shrink-0 rounded px-1.5 py-0.5 text-[8px] tracking-wide uppercase ${
                          p.control === 'klipper-moonraker'
                            ? 'bg-sky/15 text-sky'
                            : p.control === 'manual'
                              ? 'bg-rose/15 text-rose'
                              : 'bg-mint/15 text-mint'
                        }`}
                      >
                        {controlLabel[p.control]}
                      </span>
                    </div>
                    <div className="mt-0.5 text-[9px] text-white/35">
                      {p.brand} · {p.bed.x}×{p.bed.y}×{p.bed.z} mm
                    </div>
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-3 rounded-xl border border-sky/25 bg-sky/5 p-2.5">
              <div className="flex items-center justify-between">
                <span className="text-[10px] tracking-wider text-sky/70 uppercase">Eigener Drucker (No-Name)</span>
                <span className="text-[9px] text-white/25">Bettmaß eintragen</span>
              </div>
              <input
                value={customName}
                onChange={(e) => setCustomName(e.target.value)}
                placeholder="Name, z. B. Eigenbau 300"
                className="mt-1.5 w-full rounded-lg border border-line/80 bg-ink-900/70 px-2 py-1.5 text-[11px] text-white/80 outline-none focus:border-sky/50"
              />
              <div className="mt-1.5 grid grid-cols-3 gap-1.5">
                <input
                  type="number"
                  min={30}
                  max={1000}
                  value={bedX}
                  onChange={(e) => setBedX(Number(e.target.value))}
                  aria-label="Bettbreite X"
                  placeholder="X"
                  className="tabular rounded-lg border border-line/80 bg-ink-900/70 px-2 py-1.5 text-[11px] text-white/80 outline-none"
                />
                <input
                  type="number"
                  min={30}
                  max={1000}
                  value={bedY}
                  onChange={(e) => setBedY(Number(e.target.value))}
                  aria-label="Bettiefe Y"
                  placeholder="Y"
                  className="tabular rounded-lg border border-line/80 bg-ink-900/70 px-2 py-1.5 text-[11px] text-white/80 outline-none"
                />
                <input
                  type="number"
                  min={30}
                  max={1000}
                  value={bedZ}
                  onChange={(e) => setBedZ(Number(e.target.value))}
                  aria-label="Bauhöhe Z"
                  placeholder="Z"
                  className="tabular rounded-lg border border-line/80 bg-ink-900/70 px-2 py-1.5 text-[11px] text-white/80 outline-none"
                />
              </div>
              <div className="mt-1.5 flex gap-1.5">
                <select
                  value={customBaud}
                  onChange={(e) => setCustomBaud(Number(e.target.value))}
                  className="min-w-0 flex-1 rounded-lg border border-line/80 bg-ink-900/70 px-2 py-1.5 text-[11px] text-white/70 outline-none"
                >
                  <option value={0}>Baudrate automatisch</option>
                  <option value={115200}>115200</option>
                  <option value={250000}>250000</option>
                  <option value={500000}>500000</option>
                </select>
                <button
                  type="button"
                  onClick={() => void createCustom()}
                  disabled={saving}
                  className="rounded-lg bg-sky/25 px-3 py-1.5 text-[10px] font-semibold text-sky disabled:opacity-40"
                >
                  {saving ? '…' : 'Anlegen'}
                </button>
              </div>
              {customError && <p className="mt-1 text-[9px] text-rose">{customError}</p>}
              {catalog.printers.some((p) => p.custom) && (
                <div className="mt-1.5 space-y-1">
                  {catalog.printers
                    .filter((p) => p.custom)
                    .map((p) => (
                      <div key={p.id} className="flex items-center gap-2 rounded-lg border border-line/60 px-2 py-1">
                        <button
                          type="button"
                          onClick={() => setDraft((d) => ({ ...d, printerId: p.id, plateId: p.defaultPlate }))}
                          className="min-w-0 flex-1 truncate text-left text-[10px] text-white/75"
                        >
                          {p.name} · {p.bed.x}×{p.bed.y}×{p.bed.z} mm
                        </button>
                        <button
                          type="button"
                          onClick={() => void removeCustom(p.id)}
                          className="text-[9px] text-rose/70 hover:text-rose"
                        >
                          löschen
                        </button>
                      </div>
                    ))}
                </div>
              )}
            </div>

            <div className="mt-3 rounded-xl border border-line/70 bg-ink-850/60 p-2.5">
              <div className="flex items-center justify-between">
                <span className="text-[10px] tracking-wider text-white/40 uppercase">Erkannte Geräte</span>
                <button type="button" onClick={onScan} className="text-[10px] text-white/40 hover:text-white">
                  neu suchen
                </button>
              </div>
              {devices.length === 0 ? (
                <p className="mt-1.5 text-[10px] text-white/25">
                  Kein USB-Drucker gefunden. Kabel prüfen oder Klipper über die Netzwerkadresse verbinden.
                </p>
              ) : (
                <div className="mt-1.5 space-y-1.5">
                  {devices.map((d) => (
                    <div key={d.path} className="flex items-center gap-2 rounded-lg border border-mint/25 bg-mint/5 px-2 py-1.5">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[10px] text-white/80">{d.path}</div>
                        <div className="truncate text-[9px] text-white/35">
                          {d.chip} · {d.guess}
                        </div>
                        {d.hint && <div className="text-[9px] leading-snug text-amber/60">{d.hint}</div>}
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          if (d.suggestedPrinter) setDraft((s) => ({ ...s, printerId: d.suggestedPrinter! }))
                          onUseDevice(d)
                        }}
                        className="rounded-lg bg-mint/20 px-2 py-1 text-[9px] font-medium text-mint"
                      >
                        verbinden
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Material & Platte */}
          <div className="space-y-3 lg:min-h-0 lg:overflow-y-auto lg:pr-1">
            <div>
              <div className="mb-1.5 text-[10px] tracking-[0.16em] text-white/40 uppercase">Filament</div>
              <div className="grid gap-1.5">
                {filamentList.map((f) => (
                  <div
                    key={f.id}
                    className={`flex items-center gap-1 rounded-lg border px-2 py-1 transition ${
                      draft.filamentId === f.id ? 'border-mint/60 bg-mint/10' : 'border-line/60 hover:border-white/15'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => setDraft((d) => ({ ...d, filamentId: f.id }))}
                      className="min-w-0 flex-1 px-0.5 py-0.5 text-left"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-[11px] text-white/80">
                          {f.name}
                          {f.custom && <span className="ml-1 rounded bg-sky/20 px-1 text-[8px] text-sky">eigenes</span>}
                        </span>
                        <span className="tabular shrink-0 text-[9px] text-white/35">
                          {f.nozzle}° / {f.bed}°
                        </span>
                      </div>
                      <div className="text-[9px] text-white/30">
                        max. {f.maxVolumetricFlow} mm³/s · {f.density} g/cm³
                      </div>
                    </button>
                    {f.custom && onDeleteFilament && (
                      <button
                        type="button"
                        onClick={() => onDeleteFilament(f.id)}
                        title="Eigenes Filamentprofil löschen"
                        className="px-1 text-[9px] text-rose/60 hover:text-rose"
                      >
                        löschen
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div>
              <div className="mb-1.5 text-[10px] tracking-[0.16em] text-white/40 uppercase">Druckplatte</div>
              <div className="grid gap-1.5">
                {catalog.plates.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setDraft((d) => ({ ...d, plateId: p.id }))}
                    className={`rounded-lg border px-2.5 py-1.5 text-left transition ${
                      draft.plateId === p.id ? 'border-amber/60 bg-amber/10' : 'border-line/60 hover:border-white/15'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] text-white/80">{p.name}</span>
                      {p.bedTempOffset !== 0 && (
                        <span className="tabular text-[9px] text-amber/70">
                          {p.bedTempOffset > 0 ? '+' : ''}
                          {p.bedTempOffset} °C
                        </span>
                      )}
                    </div>
                    <div className="text-[9px] leading-snug text-white/30">{p.hint}</div>
                  </button>
                ))}
              </div>
            </div>

            <div className="rounded-xl border border-line/70 bg-ink-850/60 p-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] tracking-wider text-white/40 uppercase">Plattenprofil</span>
                <span className="truncate text-[9px] text-white/30">{plate.name}</span>
              </div>
              <div className="mt-1.5 grid grid-cols-2 gap-1.5">
                <label className="text-[9px] text-white/35">
                  Bett °C
                  <input
                    type="number"
                    min={1}
                    max={limits.maxBedTemp}
                    value={plateTemps.bedTemp ?? ''}
                    onChange={(e) =>
                      updatePlateTemps({ bedTemp: e.target.value === '' ? undefined : Number(e.target.value) })
                    }
                    placeholder={`${filament.bed + (filament.custom ? 0 : plate.bedTempOffset)}`}
                    className="tabular mt-1 w-full rounded-lg border border-line/80 bg-ink-900/70 px-2 py-1.5 text-[11px] text-white/80 outline-none focus:border-amber/50"
                  />
                </label>
                <label className="text-[9px] text-white/35">
                  Erste Schicht °C
                  <input
                    type="number"
                    min={1}
                    max={limits.maxBedTemp}
                    value={plateTemps.firstLayerBed ?? ''}
                    onChange={(e) =>
                      updatePlateTemps({
                        firstLayerBed: e.target.value === '' ? undefined : Number(e.target.value),
                      })
                    }
                    placeholder={`${filament.firstLayerBed + (filament.custom ? 0 : plate.bedTempOffset)}`}
                    className="tabular mt-1 w-full rounded-lg border border-line/80 bg-ink-900/70 px-2 py-1.5 text-[11px] text-white/80 outline-none focus:border-amber/50"
                  />
                </label>
              </div>
              <div className="mt-1 text-[9px] leading-snug text-white/25">
                {plate.name} · {filament.name}: leer = Filamentwert + Plattenoffset.
              </div>

              {zmodMesh && (
                <div className="mt-2">
                  <div className="flex items-center justify-between gap-2">
                    <label htmlFor="mesh-profile" className="text-[9px] tracking-wide text-white/35">
                    Klipper-Meshprofil
                  </label>
                  <button
                    type="button"
                    onClick={() => setMeshProfilesRefresh((n) => n + 1)}
                    className="text-[9px] text-sky/60 hover:text-sky"
                  >
                    neu laden
                  </button>
                </div>
                <select
                  id="mesh-profile"
                  value={plateProfile.meshProfile ?? ''}
                  onChange={(e) => updatePlateMesh(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-line/80 bg-ink-900/70 px-2 py-1.5 text-[11px] text-white/80 outline-none focus:border-amber/50"
                >
                  <option value="">Automatisch: Erste-Schicht-Bett ({Math.round(previewSettings.temps.firstLayerBed)} °C)</option>
                  {meshOptions.map((name) => (
                    <option key={name} value={name}>
                      {name}
                      {name === meshProfiles.current ? ' (aktuell)' : ''}
                    </option>
                  ))}
                </select>
                <div className="mt-1 flex items-start justify-between gap-2 text-[9px] leading-snug">
                  <span className={meshProfilesError ? 'text-rose/80' : 'text-white/30'}>
                    {meshProfilesLoading
                      ? 'Lade Meshprofile vom Drucker …'
                      : meshProfilesError
                        ? meshProfilesError
                        : meshProfiles.available
                          ? meshProfiles.profiles.length
                            ? `${meshProfiles.profiles.length} gespeicherte Profile vom verbundenen Drucker.`
                            : 'Der Drucker meldet keine gespeicherten Profile.'
                          : (meshProfiles.reason ?? 'Klipper ist nicht verbunden.')}
                  </span>
                  {!meshProfiles.available && !meshProfilesError && (
                    <span className="shrink-0 text-white/20">Auswahl nur bei Verbindung</span>
                  )}
                </div>
                {autoMeshMissing && (
                  <div className="mt-1 text-[9px] leading-snug text-amber/80">
                    Für {autoMeshName} °C (erste Schicht) meldet der Drucker kein Meshprofil. Bitte ein vorhandenes
                    Profil wählen.
                  </div>
                )}
                {selectedProfileMissing && (
                  <div className="mt-1 text-[9px] leading-snug text-amber/80">
                    Das gespeicherte Profil „{selectedMeshProfile}“ ist nicht mehr auf dem Drucker. Bitte neu wählen.
                  </div>
                )}
              </div>
              )}

              <div className="mt-2 rounded-lg border border-line/70 bg-ink-900/70 px-2 py-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[9px] tracking-[0.14em] text-white/35 uppercase">Vorschau START_PRINT</span>
                  {zmodMesh && (
                    <span className="tabular text-[9px] text-sky/65">
                      {startHasMesh ? `MESH=${previewMeshName}` : 'kein MESH im Startblock'}
                    </span>
                  )}
                </div>
                <code className="mt-1 block overflow-x-auto whitespace-pre-wrap break-all font-mono text-[9px] leading-relaxed text-mint/80">
                  {startPreview || 'Kein START_PRINT im Start-G-code gefunden.'}
                </code>
                {zmodMesh && !startHasMesh && (
                  <div className="mt-1 text-[9px] leading-snug text-amber/70">
                    Der Startblock enthält kein MESH; die Auswahl wird dort nicht eingesetzt.
                  </div>
                )}
              </div>

              {zmodMesh && (
                <div className="mt-2 rounded-lg border border-sky/20 bg-sky/5 px-2 py-1.5 text-[9px] leading-snug text-sky/70">
                  Z-Mod: Automatisch setzt ein vorhandenes <span className="text-sky">MESH=</span> auf die
                  Betttemperatur der ersten Schicht (65 °C → <span className="text-sky">MESH=65</span>). Ein
                  ausgewähltes Profil wird stattdessen eingesetzt.
                </div>
              )}
              <p className="mt-1 text-[9px] leading-snug text-white/25">
                Düsen-Temperaturen stellst du im Studio unter Material ein.
              </p>
            </div>

            <div>
              <div className="mb-1.5 text-[10px] tracking-[0.16em] text-white/40 uppercase">Düsendurchmesser</div>
              <div className="flex flex-wrap gap-1.5">
                {catalog.nozzles.map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setDraft((d) => ({ ...d, nozzle: n }))}
                    className={`tabular rounded-lg border px-2.5 py-1 text-[11px] transition ${
                      draft.nozzle === n
                        ? 'border-amber bg-amber/15 text-amber'
                        : 'border-line/70 text-white/50 hover:text-white/80'
                    }`}
                  >
                    {n.toFixed(1)}
                  </button>
                ))}
              </div>
              <div className="mt-1 text-[9px] leading-snug text-white/30">
                Werksangabe: {(printer.nozzleOptions ?? [printer.nozzle]).join(' / ')} mm. Größere Düsen bis 1,0 mm
                nur mit passendem Hotend und angepasstem Volumenstrom.
              </div>
            </div>

            <div>
              <div className="mb-1.5 text-[10px] tracking-[0.16em] text-white/40 uppercase">Düsenmaterial</div>
              <div className="grid grid-cols-2 gap-1.5">
                {NOZZLE_MATERIALS.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setDraft((d) => ({ ...d, nozzleMaterial: m.id }))}
                    className={`rounded-lg border px-2.5 py-1.5 text-left text-[11px] transition ${
                      draft.nozzleMaterial === m.id
                        ? 'border-amber/60 bg-amber/10 text-amber'
                        : 'border-line/70 text-white/50 hover:text-white/80'
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
              <div className="mt-1 text-[9px] leading-snug text-white/30">
                {NOZZLE_MATERIALS.find((m) => m.id === draft.nozzleMaterial)?.hint}
              </div>
            </div>

            <div className="rounded-xl border border-line/60 bg-ink-850/60 p-2.5 text-[10px] leading-relaxed text-white/35">
              <div className="mb-1 text-[9px] tracking-[0.16em] text-white/30 uppercase">Grenzen</div>
              <div className="tabular">
                {limits.maxPrintSpeed} mm/s Druck · {limits.maxTravel} mm/s Travel · {limits.maxAccel} mm/s²
              </div>
              <div className="tabular">
                {limits.maxNozzleTemp} °C Düse · {limits.maxBedTemp} °C Bett · Schicht {printer.layerRange[0]}–
                {printer.layerRange[1]} mm
              </div>
              <div className="tabular">Düsen: {(printer.nozzleOptions ?? [printer.nozzle]).join(' / ')} mm</div>
              {printer.ifs && (
                <div className="mt-1.5 rounded-lg border border-sky/25 bg-sky/5 px-2 py-1 text-sky/80">
                  {printer.ifs.name} · {printer.ifs.slots} Plätze — {printer.ifs.note}
                </div>
              )}
            </div>

            <div className="rounded-xl border border-line/60 bg-ink-850/60 p-2.5 text-[10px] leading-relaxed text-white/35">
              <span className="text-white/60">{printer.name}</span> ·{' '}
              {printer.kinematics === 'delta'
                ? `Ø ${printer.bed.x} × ${printer.bed.z} mm (rund)`
                : `${printer.bed.x}×${printer.bed.y}×${printer.bed.z} mm`}
              <br />
              {filament.name} auf {plate.name}
              <br />
              <span className="text-white/25">{printer.transportNote}</span>
              {printer.note && <div className="mt-1 text-amber/70">{printer.note}</div>}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-line/60 px-5 py-3">
          <span className="text-[10px] text-white/25">Auswahl wird lokal gespeichert</span>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="rounded-xl border border-line/80 px-3 py-2 text-xs text-white/50">
              Abbrechen
            </button>
            <button
              type="button"
              data-testid="setup-apply"
              onClick={() => onApply(draft)}
              className="rounded-xl bg-gradient-to-r from-amber to-[#ff9f45] px-4 py-2 text-xs font-semibold text-ink-950"
            >
              Übernehmen
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
