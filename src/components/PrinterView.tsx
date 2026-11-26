import { useEffect, useMemo, useRef, useState } from 'react'
import type {
  BedMesh,
  BedMeshRecord,
  ConsoleLine,
  CustomGcode,
  DetectedDevice,
  PrintSettings,
  PrinterProfile,
  PrinterStatus,
  ZMeasurement,
} from '../../shared/types.ts'
import type { Catalog, ProbeLog } from '../api.ts'
import * as api from '../api.ts'
import type { MoonrakerHost } from '../../shared/types.ts'
import type { PrinterLimits, Setup } from '../setup.ts'
import { loadConnMode, loadWebTarget, loadZRef, saveConnMode, saveZRef, type ConnMode } from '../setup.ts'
import { Chip, Panel, Segmented } from './ui.tsx'
import { MeshDiff } from './MeshDiff.tsx'
import { meshTrend } from '../../shared/meshTrend.ts'
import { buildPrinterTestGcode, type TestPrintVariant } from '../testPrint.ts'
import { GCODE_FLAVORS, flavorLabel } from '../../shared/gcode-flavors.ts'
import { saveGcodeAs } from '../saveGcode.ts'

type Props = {
  status: PrinterStatus
  mesh: BedMesh | null
  log: ConsoleLine[]
  profile: PrinterProfile
  setup: Setup
  catalog: Catalog
  settings: PrintSettings
  devices: DetectedDevice[]
  deviceHint: string | null
  gcode: string | null
  jobName: string
  modelId: string | null
  modelSize: { x: number; y: number } | null
  onSettings: (next: PrintSettings) => void
  onError: (msg: string | null) => void
  onScan: () => void
  onClearMesh: () => void
  probeProgress: { done: number; total: number } | null
  /** Drucker des Arbeitsplatzes für den Schnellwechsel */
  printers: { id: string; name: string; brand: string; control: string; active: boolean; detail: string }[]
  onSwitchPrinter: (id: string) => void
  onAddPrinter: () => void
  /** Vom Nutzer gesetzte Druckergrenzen */
  limits: PrinterLimits
  /** Anzahl gespeicherter Druckerstände für die Gesamtsicherung */
  profileCount: number
  onExportAllProfiles: () => void
  onImportAllProfiles: (file: File) => void
}

export function PrinterView({
  status,
  mesh,
  log,
  profile,
  setup,
  catalog,
  settings,
  devices,
  deviceHint,
  gcode,
  jobName,
  modelId,
  modelSize,
  onSettings,
  onError,
  onScan,
  onClearMesh,
  probeProgress,
  printers,
  onSwitchPrinter,
  onAddPrinter,
  limits,
  profileCount,
  onExportAllProfiles,
  onImportAllProfiles,
}: Props) {
  const [mode, setMode] = useState<'simulation' | 'serial' | 'klipper'>(() => {
    const saved = loadConnMode(profile.id)
    if (saved === 'serial' || saved === 'klipper' || saved === 'simulation') return saved
    return profile.control === 'klipper-moonraker' ? 'klipper' : 'simulation'
  })
  const [port, setPort] = useState('')
  const [baud, setBaud] = useState(profile.baud)
  const [url, setUrl] = useState(() => {
    const target = loadWebTarget()
    if (target?.client === 'moonraker' && target.host) return `http://${target.host}:${target.port}`
    return 'http://klipper.local:7125'
  })
  const [finding, setFinding] = useState(false)
  const [found, setFound] = useState<MoonrakerHost[]>([])
  const [searched, setSearched] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [gridN, setGridN] = useState(5)
  const [offset, setOffset] = useState(0)
  const [nozzleTarget, setNozzleTarget] = useState(settings.temps.nozzle)
  const [bedTarget, setBedTarget] = useState(settings.temps.bed)
  const [zMeasure, setZMeasure] = useState<ZMeasurement | null>(null)
  const [zRef, setZRef] = useState(() => loadZRef(profile.id))
  const [confirmClear, setConfirmClear] = useState(false)
  const [probeLog, setProbeLog] = useState<ProbeLog | null>(null)
  const [copied, setCopied] = useState(false)
  const [history, setHistory] = useState<BedMeshRecord[]>([])

  const online = status.connection === 'connected'
  const printState = status.print

  useEffect(() => {
    setBaud(profile.baud)
    setMode(profile.control === 'klipper-moonraker' ? 'klipper' : 'simulation')
  }, [profile.baud, profile.control])

  useEffect(() => {
    setZRef(loadZRef(profile.id))
    setZMeasure(null)
  }, [profile.id])

  useEffect(() => {
    let alive = true
    api
      .fetchMeshHistory(profile.id)
      .then((data) => {
        if (alive) setHistory(data.records)
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [profile.id, mesh?.capturedAt])

  // Rohantworten der letzten Messung — nur für dieses Modell
  useEffect(() => {
    if (!mesh) {
      setProbeLog(null)
      return
    }
    let alive = true
    api
      .fetchProbeLog()
      .then((log) => {
        if (alive) setProbeLog(log && log.printerId === profile.id ? log : null)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [mesh?.capturedAt, profile.id, mesh])

  // Verbindungsart je Drucker wiederherstellen: ein Vyper mit Klipper-Mod
  // bleibt bei „Klipper“, statt bei jedem Öffnen auf USB zurückzufallen.
  useEffect(() => {
    const saved = loadConnMode(profile.id)
    if (saved === 'serial' || saved === 'klipper' || saved === 'simulation') setMode(saved)
    else setMode(profile.control === 'klipper-moonraker' ? 'klipper' : 'simulation')
    const target = loadWebTarget()
    setUrl(target?.client === 'moonraker' && target.host ? `http://${target.host}:${target.port}` : 'http://klipper.local:7125')
  }, [profile.id, profile.control])

  const probeLogText = probeLog
    ? [
        '# Easy-Slicer by Becker — Messprotokoll',
        `# ${profile.brand} ${profile.name} (${profile.id})`,
        `# ${new Date(probeLog.at).toLocaleString('de-DE')} · ${probeLog.mode}`,
        '',
        ...probeLog.lines,
      ].join('\n')
    : ''

  const copyProbeLog = async () => {
    try {
      await navigator.clipboard.writeText(probeLogText)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      onError('Kopieren nicht möglich — Text im Protokoll bitte markieren und selbst kopieren.')
    }
  }

  const saveProbeLog = () => {
    const blob = new Blob([probeLogText], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${profile.id}-messprotokoll.txt`
    a.click()
    URL.revokeObjectURL(url)
  }

  useEffect(() => {
    if (deviceHint) {
      setMode('serial')
      setPort(deviceHint)
    }
  }, [deviceHint])

  useEffect(() => {
    if (!online) onScan()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online])

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key)
    onError(null)
    try {
      await fn()
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Aktion fehlgeschlagen.')
    } finally {
      setBusy(null)
    }
  }

  const fan = (pct: number) => run('fan', async () => { await api.sendCommand(`M106 S${Math.round(pct * 2.55)}`) })

  return (
    <div className="grid min-h-0 flex-1 gap-3 overflow-y-auto p-3 xl:grid-cols-[350px_minmax(0,1fr)_360px] xl:overflow-hidden">
      <div className="space-y-3 xl:overflow-y-auto xl:pr-1">
        <Panel
          title="Meine Drucker"
          hint={printers.length > 1 ? 'Wechseln lädt die gespeicherten Einstellungen' : 'Zweites Gerät hinzufügen'}
          collapsible
          right={
            <button
              type="button"
              onClick={onAddPrinter}
              className="rounded-lg border border-mint/40 bg-mint/10 px-2 py-1 text-[10px] font-medium text-mint transition hover:bg-mint/20"
            >
              + Drucker
            </button>
          }
        >
          <div className="space-y-1">
            {printers.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => onSwitchPrinter(p.id)}
                className={`flex w-full items-center justify-between gap-2 rounded-lg border px-2 py-1.5 text-left transition ${
                  p.active
                    ? 'border-mint/50 bg-mint/10'
                    : 'border-line/70 bg-ink-900/40 hover:border-white/20'
                }`}
              >
                <span className="min-w-0">
                  <span className={`block truncate text-[11px] font-medium ${p.active ? 'text-mint' : 'text-white/80'}`}>
                    {p.name}
                  </span>
                  <span className="block truncate text-[9px] text-white/35">
                    {p.brand} ·{' '}
                    {p.control === 'marlin-serial'
                      ? 'USB/Marlin'
                      : p.control === 'klipper-moonraker'
                        ? 'Klipper'
                        : 'manuell'}
                  </span>
                  <span className="block truncate text-[9px] text-white/25">{p.detail}</span>
                </span>
                {p.active && <span className="shrink-0 text-[9px] tracking-wider text-mint uppercase">aktiv</span>}
              </button>
            ))}
          </div>
          <p className="mt-2 text-[9px] leading-snug text-white/25">
            „+ Drucker“ öffnet Marke/Modell. Beim Wechsel werden Filament, Platte, Düse und alle Einstellungen des
            jeweiligen Geräts geladen; Bett-Mesh und Messungen bleiben pro Modell getrennt.
          </p>
        </Panel>

        <PrinterProfilesBackupPanel
          profileCount={profileCount}
          onExport={onExportAllProfiles}
          onImport={onImportAllProfiles}
        />

        <PrinterTestPanel profile={profile} limits={limits} collapsible />

        <Panel title="Verbindung" hint="USB, Klipper im Netz oder Simulation" collapsible>
          <Segmented
            value={mode}
            onChange={(v) => {
              setMode(v)
              saveConnMode(profile.id, v as ConnMode)
            }}
            options={[
              { value: 'simulation', label: 'Simulation' },
              { value: 'serial', label: 'USB' },
              { value: 'klipper', label: 'Klipper' },
            ]}
          />

          <p className="mt-2 text-[9px] leading-snug text-white/30">
            {profile.control === 'marlin-serial' ? (
              <>
                <span className="text-sky/70">{profile.name} mit Klipper-Mod?</span> Dann „Klipper“ wählen und die
                Moonraker-Adresse des Hosts (Raspberry Pi, Sonic Pad …) eintragen. Bettgröße, Kinematik und Profil bleiben
                gleich — nur der Weg zum Drucker ändert sich. Die Wahl wird je Drucker gemerkt.
              </>
            ) : (
              <>
                <span className="text-sky/70">{profile.name} läuft ab Werk mit Klipper.</span> Für den Rückweg auf Marlin
                „USB“ wählen und den seriellen Port eintragen; die Profilwerte bleiben erhalten. Die Wahl wird je Drucker
                gemerkt.
              </>
            )}
          </p>

          {mode === 'serial' && (
            <div className="mt-2.5 space-y-2">
              {devices.length > 0 && (
                <div className="space-y-1">
                  {devices.map((d) => (
                    <button
                      key={d.path}
                      type="button"
                      onClick={() => setPort(d.path)}
                      className={`w-full rounded-lg border px-2 py-1.5 text-left transition ${
                        port === d.path ? 'border-mint/50 bg-mint/10' : 'border-line/70 hover:border-white/20'
                      }`}
                    >
                      <div className="truncate text-[10px] text-white/80">{d.path}</div>
                      <div className="truncate text-[9px] text-white/35">
                        {d.chip} · {d.guess}
                      </div>
                      {d.hint && <div className="text-[9px] leading-snug text-amber/60">{d.hint}</div>}
                    </button>
                  ))}
                </div>
              )}
              <div className="flex gap-1.5">
                <input
                  value={port}
                  onChange={(e) => setPort(e.target.value)}
                  placeholder="/dev/ttyUSB0"
                  className="min-w-0 flex-1 rounded-lg border border-line/80 bg-ink-900/70 px-2 py-1.5 text-[11px] text-white/75 outline-none"
                />
                <button
                  type="button"
                  onClick={onScan}
                  className="rounded-lg border border-line/80 px-2 text-[10px] text-white/45 hover:text-white"
                >
                  ⟳
                </button>
              </div>
              {portKindHint(port) && (
                <p
                  className={`text-[9px] leading-snug ${
                    portKind(port) === 'usb-cdc' ? 'text-amber/70' : 'text-sky/60'
                  }`}
                >
                  {portKindHint(port)}
                </p>
              )}
              <select
                value={baud}
                onChange={(e) => setBaud(Number(e.target.value))}
                className="w-full rounded-lg border border-line/80 bg-ink-900/70 px-2 py-1.5 text-[11px] text-white/75 outline-none"
              >
                <option value={0}>Baudrate automatisch (CH340/CH341)</option>
                {[115200, 250000, 500000, 1000000].map((b) => (
                  <option key={b} value={b}>
                    {b} Baud
                  </option>
                ))}
              </select>
              <p className="text-[9px] leading-snug text-white/25">{profile.transportNote}</p>
              <p className="text-[9px] leading-snug text-white/25">
                Bei „keine Antwort“: CH341SER-Treiber (gilt für CH340 und CH341) installieren, Port in Cura/OctoPrint
                schließen und Baudrate automatisch testen. Vyper und Ender-3 nutzen 115200.
              </p>
            </div>
          )}

          {mode === 'klipper' && (
            <div className="mt-2.5 space-y-2">
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="192.168.1.50 oder voron.local"
                className="w-full rounded-lg border border-line/80 bg-ink-900/70 px-2 py-1.5 text-[11px] text-white/75 outline-none"
              />
              <div className="flex gap-1.5">
                <button
                  type="button"
                  disabled={finding}
                  onClick={async () => {
                    setFinding(true)
                    try {
                      const res = await api.discoverMoonrakerHosts()
                      setFound(res.hosts)
                      setSearched(true)
                    } finally {
                      setFinding(false)
                    }
                  }}
                  className="flex-1 rounded-lg border border-line/80 py-1.5 text-[10px] text-white/60 transition hover:border-mint/40 hover:text-white disabled:opacity-40"
                >
                  {finding ? 'Suche im Netzwerk …' : 'Im Netzwerk suchen'}
                </button>
              </div>
              {found.length > 0 && (
                <div className="space-y-1">
                  {found.map((h) => (
                    <button
                      key={h.url}
                      type="button"
                      onClick={() => setUrl(h.url)}
                      className={`w-full rounded-lg border px-2 py-1.5 text-left transition ${
                        url === h.url ? 'border-mint/50 bg-mint/10' : 'border-line/70 hover:border-white/20'
                      }`}
                    >
                      <div className="truncate text-[10px] text-white/80">{h.url}</div>
                      <div className="truncate text-[9px] text-white/35">
                        {h.name ?? h.host} · Klipper {h.klippyState ?? 'unbekannt'}
                      </div>
                    </button>
                  ))}
                </div>
              )}
              {searched && found.length === 0 && !finding && (
                <p className="text-[9px] leading-snug text-amber/60">
                  Kein Moonraker auf Port 7125 gefunden. Host eingeschaltet und im selben WLAN? Sonst Adresse von Hand
                  eintragen.
                </p>
              )}
              <p className="text-[9px] leading-snug text-white/25">
                Moonraker-Adresse. Port 7125 wird automatisch ergänzt. Bett-Mesh, Temperaturen und Druckjobs laufen über
                die Klipper-API.
              </p>

              <details className="rounded-lg border border-line/70 bg-ink-900/40 px-2 py-1.5">
                <summary className="cursor-pointer text-[10px] text-white/55">
                  Klipper-Mod einrichten (Vyper, Ender-3 …)
                </summary>
                <ol className="mt-1.5 list-decimal space-y-1 pl-4 text-[9px] leading-snug text-white/40">
                  <li>
                    Host besorgen: Raspberry Pi (Zero 2 W reicht), Sonic Pad, BTT CB1 oder ein Linux-PC — per USB am
                    Druckerboard.
                  </li>
                  <li>
                    Klipper und Moonraker auf dem Host installieren; printer.cfg mit Bettgröße und Kinematik aus diesem
                    Profil füllen (Vyper 245×245×260).
                  </li>
                  <li>Moonraker im Browser testen: http://&lt;host&gt;:7125 muss die Moonraker-Seite zeigen.</li>
                  <li>Hier „Klipper“ wählen, Adresse eintragen oder „Im Netzwerk suchen“ drücken.</li>
                  <li>Bett einmal messen und das Mesh übernehmen — danach rechnet der Slicer das Raster in den G-Code ein.</li>
                  <li>
                    Der USB-Anschluss am Board gehört jetzt dem Host, nicht mehr dem PC: Gedruckt wird über Moonraker.
                  </li>
                </ol>
              </details>
            </div>
          )}

          <div className="mt-3 flex gap-2">
            {online ? (
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => run('disc', async () => { await api.disconnectPrinter() })}
                className="flex-1 rounded-xl border border-rose/40 bg-rose/10 py-2 text-xs font-medium text-rose transition hover:bg-rose/20 disabled:opacity-40"
              >
                Trennen
              </button>
            ) : (
              <button
                type="button"
                disabled={busy !== null}
                onClick={() =>
                  run('conn', async () => {
                    await api.connectPrinter({ mode, path: port, baud, profileId: profile.id, url })
                  })
                }
                className="flex-1 rounded-xl bg-gradient-to-r from-mint to-[#8ef0c8] py-2 text-xs font-semibold text-ink-950 transition hover:brightness-110 disabled:opacity-40"
              >
                {busy === 'conn' ? 'Verbinde …' : 'Verbinden'}
              </button>
            )}
            <button
              type="button"
              onClick={() => run('estop', async () => { await api.emergencyStop() })}
              disabled={!online}
              className="rounded-xl border border-rose/50 px-3 py-2 text-xs font-semibold text-rose transition hover:bg-rose/15 disabled:opacity-25"
            >
              NOT-AUS
            </button>
          </div>

          <dl className="mt-3 space-y-1 text-[10px]">
            <Row k="Status" v={online ? (status.mode === 'simulation' ? 'Simulation aktiv' : 'verbunden') : status.connection} />
            <Row k="Port" v={status.port ?? '—'} />
            <Row k="Firmware" v={status.firmware ?? '—'} />
            <Row
              k="Temps"
              v={`${status.temps.nozzle.toFixed(0)}→${status.temps.nozzleTarget.toFixed(0)}°C · ${status.temps.bed.toFixed(0)}→${status.temps.bedTarget.toFixed(0)}°C`}
            />
            <Row k="Position" v={`${status.position.x.toFixed(1)} / ${status.position.y.toFixed(1)} / ${status.position.z.toFixed(1)}`} />
          </dl>
          {status.message && (
            <p className="mt-2 rounded-lg border border-line/70 bg-ink-900/60 px-2 py-1 text-[10px] text-white/45">
              {status.message}
            </p>
          )}
        </Panel>

        <Panel title="Steuerung" hint="Achsen, Temperaturen, Lüfter" collapsible defaultOpen={false}>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={!online || busy !== null}
              onClick={() => run('home', async () => { await api.homeAxes() })}
              className="rounded-lg border border-line/80 py-1.5 text-[10px] text-white/65 transition hover:border-mint/40 hover:text-mint disabled:opacity-30"
            >
              Homen (G28)
            </button>
            <button
              type="button"
              disabled={!online || busy !== null}
              onClick={() => run('motors', async () => { await api.motorsOff() })}
              className="rounded-lg border border-line/80 py-1.5 text-[10px] text-white/65 transition hover:border-rose/40 hover:text-rose disabled:opacity-30"
            >
              Motoren aus
            </button>
          </div>

          <div className="mt-2.5 grid grid-cols-3 gap-1.5">
            {(['X', 'Y', 'Z'] as const).map((axis) => (
              <div key={axis} className="rounded-lg border border-line/70 p-1">
                <div className="mb-1 text-center text-[9px] text-white/35">{axis}</div>
                <div className="flex gap-1">
                  <button
                    type="button"
                    disabled={!online}
                    onClick={() => run(`jog${axis}-`, async () => { await api.jog(axis, -10, axis === 'Z' ? 300 : 2400) })}
                    className="flex-1 rounded bg-white/5 py-1 text-[10px] text-white/60 hover:bg-white/10 disabled:opacity-25"
                  >
                    −10
                  </button>
                  <button
                    type="button"
                    disabled={!online}
                    onClick={() => run(`jog${axis}+`, async () => { await api.jog(axis, 10, axis === 'Z' ? 300 : 2400) })}
                    className="flex-1 rounded bg-white/5 py-1 text-[10px] text-white/60 hover:bg-white/10 disabled:opacity-25"
                  >
                    +10
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-2.5 grid grid-cols-2 gap-2">
            <label className="block">
              <span className="mb-1 block text-[9px] tracking-wider text-white/35 uppercase">Düse</span>
              <div className="flex gap-1">
                <input
                  type="number"
                  value={nozzleTarget}
                  onChange={(e) => setNozzleTarget(Number(e.target.value))}
                  className="tabular w-full rounded-lg border border-line/80 bg-ink-900/70 px-2 py-1 text-[11px] text-white/80 outline-none"
                />
                <button
                  type="button"
                  disabled={!online}
                  onClick={() => run('tnoz', async () => { await api.setTemp('nozzle', nozzleTarget) })}
                  className="rounded-lg border border-line/80 px-2 text-[10px] text-white/55 hover:text-amber disabled:opacity-30"
                >
                  set
                </button>
              </div>
            </label>
            <label className="block">
              <span className="mb-1 block text-[9px] tracking-wider text-white/35 uppercase">Bett</span>
              <div className="flex gap-1">
                <input
                  type="number"
                  value={bedTarget}
                  onChange={(e) => setBedTarget(Number(e.target.value))}
                  className="tabular w-full rounded-lg border border-line/80 bg-ink-900/70 px-2 py-1 text-[11px] text-white/80 outline-none"
                />
                <button
                  type="button"
                  disabled={!online}
                  onClick={() => run('tbed', async () => { await api.setTemp('bed', bedTarget) })}
                  className="rounded-lg border border-line/80 px-2 text-[10px] text-white/55 hover:text-amber disabled:opacity-30"
                >
                  set
                </button>
              </div>
            </label>
          </div>

          <div className="mt-2.5 flex gap-1.5">
            {[0, 50, 100].map((p) => (
              <button
                key={p}
                type="button"
                disabled={!online}
                onClick={() => fan(p)}
                className="flex-1 rounded-lg border border-line/80 py-1 text-[10px] text-white/55 hover:text-sky disabled:opacity-30"
              >
                Lüfter {p} %
              </button>
            ))}
          </div>
        </Panel>
      </div>

      <div className="min-h-0 space-y-3 xl:overflow-y-auto">
        <Panel title="Druck" hint={printState.file ?? 'kein laufender Job'}>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={!online || !gcode || printState.state === 'printing' || printState.state === 'paused'}
              onClick={() =>
                run('print', async () => {
                  if (!gcode) return
                  const res = await api.startPrint(gcode, jobName, {
                    modelId,
                    settings,
                    profileId: profile.id,
                    zRef: settings.autoZ.enabled && zRef ? { mean: zRef.mean } : undefined,
                  })
                  const prep = res.prep
                  if (prep?.adaptive) {
                    const size = prep.size as { w: number; h: number }
                    onError(
                      `Adaptiv gemessen: ${size.w}×${size.h} mm, ${prep.grid}×${prep.grid} Punkte, Kompensation über ${
                        'den G-Code'
                      }.`,
                    )
                  }
                })
              }
              className="rounded-xl bg-gradient-to-r from-amber to-[#ff9f45] px-4 py-2 text-[11px] font-semibold text-ink-950 transition hover:brightness-110 disabled:opacity-30"
            >
              {status.mode === 'klipper' || status.mode === 'octoprint'
                ? 'Hochladen & starten'
                : 'Druck starten (Streaming)'}
            </button>
            <button
              type="button"
              disabled={!online || printState.state !== 'printing'}
              onClick={() => run('pause', async () => { await api.pausePrint() })}
              className="rounded-xl border border-line/80 px-3 py-2 text-[11px] text-white/65 disabled:opacity-30"
            >
              Pause
            </button>
            <button
              type="button"
              disabled={!online || printState.state !== 'paused'}
              onClick={() => run('resume', async () => { await api.resumePrint() })}
              className="rounded-xl border border-line/80 px-3 py-2 text-[11px] text-white/65 disabled:opacity-30"
            >
              Weiter
            </button>
            <button
              type="button"
              disabled={!online || (printState.state !== 'printing' && printState.state !== 'paused')}
              onClick={() => run('cancel', async () => { await api.cancelPrint() })}
              className="rounded-xl border border-rose/40 px-3 py-2 text-[11px] text-rose disabled:opacity-30"
            >
              Abbrechen
            </button>
          </div>

          <div className="mt-3 rounded-xl border border-line/70 bg-ink-900/40 p-2.5">
            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                checked={settings.adaptiveMesh.enabled}
                disabled={profile.control === 'manual'}
                onChange={(e) =>
                  onSettings({ ...settings, adaptiveMesh: { ...settings.adaptiveMesh, enabled: e.target.checked } })
                }
                className="mt-0.5 accent-amber"
              />
              <span>
                <span className="block text-[10px] font-medium text-white/75">Vor dem Start adaptiv vermessen</span>
                <span className="block text-[9px] leading-snug text-white/35">
                  Nur der Modellbereich wird gemessen — heiß, direkt vor dem Druck.
                </span>
              </span>
            </label>

            {settings.adaptiveMesh.enabled && (
              <>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <label className="block">
                    <span className="mb-0.5 block text-[9px] text-white/30">Rand (mm)</span>
                    <input
                      type="number"
                      min={0}
                      max={50}
                      value={settings.adaptiveMesh.margin}
                      onChange={(e) =>
                        onSettings({
                          ...settings,
                          adaptiveMesh: { ...settings.adaptiveMesh, margin: Math.max(0, Number(e.target.value) || 0) },
                        })
                      }
                      className="tabular w-full rounded-lg border border-line/80 bg-ink-900/70 px-2 py-1 text-[11px] text-white/80 outline-none"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-0.5 block text-[9px] text-white/30">Raster</span>
                    <select
                      value={settings.adaptiveMesh.grid}
                      onChange={(e) =>
                        onSettings({
                          ...settings,
                          adaptiveMesh: { ...settings.adaptiveMesh, grid: Number(e.target.value) },
                        })
                      }
                      className="w-full rounded-lg border border-line/80 bg-ink-900/70 px-2 py-1 text-[11px] text-white/80 outline-none"
                    >
                      {[3, 4, 5, 7, 9].map((n) => (
                        <option key={n} value={n}>
                          {n}×{n}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <p className="mt-1.5 text-[9px] leading-snug text-white/30">
                  {!modelId
                    ? 'Kein Modell geladen — es wird das ganze Bett gemessen.'
                    : modelSize
                      ? `Bereich ca. ${Math.round(modelSize.x + 2 * settings.adaptiveMesh.margin)} × ${Math.round(modelSize.y + 2 * settings.adaptiveMesh.margin)} mm`
                      : 'Bereich wird aus dem Modell berechnet.'}
                  {status.mode === 'klipper'
                    ? ' Klipper: AREA_START/AREA_END, das frische Mesh gilt sofort.'
                    : status.mode === 'octoprint'
                      ? ' OctoPrint liefert keine Messwerte zurück — dafür Moonraker oder USB nutzen.'
                      : ' Marlin: G30-Raster im Modellbereich, Kompensation im G-Code (wird vor dem Start neu geslict).'}
                </p>
              </>
            )}
          </div>

          {!gcode && (
            <p className="mt-2 text-[10px] text-white/30">
              Noch kein G-Code im Studio erzeugt — erst slicen, dann hier starten.
            </p>
          )}

          {gcode && (status.mode === 'serial' || status.mode === 'simulation') && (
            <p className="mt-2 text-[9px] leading-snug text-white/25">
              USB-Streaming mit vier Zeilen Vorlauf: Pause stoppt den Vorlauf, Weiter setzt fort, Abbruch schickt
              Heizung aus und Motoren frei.
            </p>
          )}

          <div className="mt-3">
            <div className="flex items-center justify-between gap-2 text-[10px] text-white/40">
              <span className={stateTone(printState.state)}>{stateLabel(printState.state)}</span>
              <span className="tabular">
                {printState.lines ? `${printState.lines.sent} / ${printState.lines.total} Zeilen · ` : ''}
                {Math.round(printState.progress * 100)} %
                {printState.etaSeconds !== null && printState.etaSeconds > 0
                  ? ` · noch ${
                      printState.etaSeconds < 60
                        ? `${printState.etaSeconds} s`
                        : `${Math.round(printState.etaSeconds / 60)} min`
                    }`
                  : ''}
              </span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-line">
              <div
                className="h-full rounded-full bg-gradient-to-r from-mint to-amber transition-all"
                style={{ width: `${Math.min(100, Math.max(0, printState.progress * 100))}%` }}
              />
            </div>
          </div>
        </Panel>

        <Panel
          title="Bettvermessung"
          hint={
            mesh
              ? `${mesh.rows}×${mesh.cols} Raster · ${
                  mesh.source === 'simulation'
                    ? 'Simulation'
                    : mesh.source === 'manual'
                      ? 'manuell (G30)'
                      : mesh.source === 'klipper'
                        ? 'Klipper'
                        : 'Firmware (G29)'
                }`
              : 'Noch keine Messung'
          }
          right={
            <div className="flex gap-1.5">
              <Chip tone={online ? 'mint' : 'neutral'}>{online ? 'bereit' : 'offline'}</Chip>
              {probeProgress && (
                <Chip tone="amber">
                  {probeProgress.done}/{probeProgress.total}
                </Chip>
              )}
            </div>
          }
        >
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={!online || busy !== null || status.mode === 'octoprint'}
              onClick={() => run('probe', async () => { await api.probeBed('auto') })}
              className="rounded-xl bg-amber px-3 py-1.5 text-[11px] font-semibold text-ink-950 transition hover:brightness-110 disabled:opacity-30"
            >
              {busy === 'probe'
                ? 'Messe …'
                : status.mode === 'klipper'
                  ? 'BED_MESH_CALIBRATE'
                  : status.mode === 'octoprint'
                    ? 'nur Moonraker/USB'
                    : 'Automatisch (G29)'}
            </button>
            <div className="flex items-center gap-1.5">
              <select
                value={gridN}
                onChange={(e) => setGridN(Number(e.target.value))}
                className="rounded-lg border border-line/80 bg-ink-900/70 px-2 py-1.5 text-[11px] text-white/70 outline-none"
              >
                {[3, 5, 7, 9].map((n) => (
                  <option key={n} value={n}>
                    {n}×{n}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={!online || busy !== null || status.mode === 'klipper' || status.mode === 'octoprint'}
                onClick={() => run('probe2', async () => { await api.probeBed('manual', gridN, gridN) })}
                className="rounded-xl border border-line/80 px-3 py-1.5 text-[11px] text-white/65 transition hover:border-sky/50 hover:text-sky disabled:opacity-30"
              >
                Manuell (G30)
              </button>
              <button
                type="button"
                disabled={!online || !modelId || busy !== null}
                onClick={() =>
                  run('probeAdaptive', async () => {
                    await api.probeBed('auto', settings.adaptiveMesh.grid, settings.adaptiveMesh.grid, modelId, settings.adaptiveMesh.margin)
                  })
                }
                className="rounded-xl border border-amber/40 px-3 py-1.5 text-[11px] text-amber transition hover:bg-amber/10 disabled:opacity-30"
              >
                {busy === 'probeAdaptive' ? 'Messe …' : 'Adaptiv (Modell)'}
              </button>
            </div>
            <div className="ml-auto flex gap-1.5">
              <button
                type="button"
                disabled={!online || busy !== null || status.mode === 'klipper' || status.mode === 'octoprint'}
                onClick={() => run('importMesh', async () => { await api.importPrinterMesh() })}
                title="Gespeichertes Firmware-Mesh per USB lesen (M420 V) und beim Slicen einrechnen"
                className="rounded-lg border border-mint/40 px-2 py-1 text-[10px] text-mint/85 transition hover:bg-mint/10 disabled:opacity-30"
              >
                {busy === 'importMesh' ? 'Lese …' : 'Vom Drucker'}
              </button>
              <button
                type="button"
                disabled={!online || !mesh}
                onClick={() => run('enable', async () => { await api.enableMesh() })}
                className="rounded-lg border border-line/80 px-2 py-1 text-[10px] text-white/55 transition hover:text-white disabled:opacity-30"
              >
                Mesh aktivieren
              </button>
              <button
                type="button"
                disabled={!online}
                onClick={() => run('save', async () => { await api.saveEeprom() })}
                className="rounded-lg border border-line/80 px-2 py-1 text-[10px] text-white/55 transition hover:text-white disabled:opacity-30"
              >
                Speichern
              </button>
            </div>
          </div>

          <div className="mt-3">
            {mesh ? (
              <>
                <MeshHeatmap mesh={mesh} />
                <MeshStats mesh={mesh} />
                <div className="mt-2 rounded-xl border border-line/70 bg-ink-900/40 px-2.5 py-2">
                  <div className="grid gap-1 text-[10px] text-white/35 sm:grid-cols-2">
                    <div>
                      Gemessen:{' '}
                      <span className="tabular text-white/70">
                        {new Date(mesh.capturedAt).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })}
                      </span>
                    </div>
                    <div>
                      Raster:{' '}
                      <span className="tabular text-white/70">
                        {mesh.cols}×{mesh.rows}
                      </span>
                      <span className="text-white/25">
                        {' '}
                        · Abstand {mesh.dx.toFixed(1)} × {mesh.dy.toFixed(1)} mm
                      </span>
                    </div>
                    <div className="sm:col-span-2">
                      Herkunft: <span className="text-white/70">{meshSourceLabel(mesh.source)}</span> · gespeichert für{' '}
                      <span className="text-white/70">{profile.name}</span>
                    </div>
                  </div>
                  <div className="mt-1.5 flex items-center justify-between gap-2">
                    <span className="text-[9px] leading-snug text-white/25">
                      Beim Wechsel auf ein anderes Modell wird dieses Mesh nicht verwendet — dort wird neu gemessen.
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        if (!confirmClear) {
                          setConfirmClear(true)
                          return
                        }
                        setConfirmClear(false)
                        onClearMesh()
                      }}
                      onBlur={() => setConfirmClear(false)}
                      className="shrink-0 rounded-lg border border-rose/40 px-2 py-1 text-[10px] text-rose/80 transition hover:bg-rose/10"
                    >
                      {confirmClear ? 'Wirklich löschen?' : 'Mesh löschen'}
                    </button>
                  </div>
                </div>
                {probeLog && (
                  <div className="mt-1.5 rounded-xl border border-line/60 bg-ink-900/30 px-2.5 py-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <details className="min-w-0 flex-1">
                        <summary className="cursor-pointer text-[10px] text-white/40">
                          Messprotokoll · {probeLog.mode} · {probeLog.lines.length} Zeilen
                        </summary>
                        <pre className="mt-1 max-h-40 overflow-auto text-[9px] leading-snug whitespace-pre-wrap text-white/35">
                          {probeLog.lines.join('\n')}
                        </pre>
                      </details>
                      <div className="flex shrink-0 gap-1">
                        <button
                          type="button"
                          onClick={() => void copyProbeLog()}
                          className="rounded-lg border border-line/80 px-2 py-1 text-[10px] text-white/55 transition hover:border-mint/50 hover:text-mint"
                        >
                          {copied ? 'Kopiert' : 'Kopieren'}
                        </button>
                        <button
                          type="button"
                          onClick={saveProbeLog}
                          className="rounded-lg border border-line/80 px-2 py-1 text-[10px] text-white/55 transition hover:border-sky/50 hover:text-sky"
                        >
                          Speichern
                        </button>
                      </div>
                    </div>
                  </div>
                )}
                <MeshHistory
                  history={history}
                  onClear={() =>
                    run('clearHist', async () => {
                      await api.clearMeshHistory(profile.id)
                      setHistory([])
                    })
                  }
                />
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => onSettings({ ...settings, meshCompensation: 'software' })}
                    className="rounded-lg border border-mint/40 bg-mint/10 px-2.5 py-1 text-[10px] font-medium text-mint transition hover:bg-mint/20"
                  >
                    Mesh in G-Code einrechnen
                  </button>
                  <button
                    type="button"
                    onClick={() => onSettings({ ...settings, meshCompensation: 'off' })}
                    className="rounded-lg border border-line/80 px-2.5 py-1 text-[10px] text-white/55 transition hover:text-white"
                  >
                    Ohne Kompensation
                  </button>
                  <span className="text-[9px] text-white/25">
                    aktiv: {settings.meshCompensation === 'software' ? 'im G-Code' : 'aus'}
                  </span>
                </div>
                <p className="mt-1.5 text-[9px] leading-snug text-white/25">
                  {profile.control === 'klipper-moonraker'
                    ? 'Klipper misst in einer eigenen Nullage: die Zahlen oben sind relativ zum Sensor-Nullpunkt und taugen nicht als Z-Koordinate. Den Bettausgleich macht der Drucker selbst (START_PRINT/KAMP), der G-Code bleibt auf der nominellen Höhe.'
                    : 'Die Messwerte landen fest in den Z-Werten der Datei. Der Druck läuft damit auch von SD-Karte, ohne laufende USB-Verbindung — M420 und das Firmware-Mesh werden nicht mehr gebraucht.'}
                </p>
              </>
            ) : (
              <div className="grid place-items-center rounded-2xl border border-dashed border-line/80 bg-ink-900/30 py-12 text-center">
                <div>
                  <div className="text-xs text-white/40">Kein Mesh vorhanden</div>
                  <div className="mt-1 max-w-sm text-[10px] leading-relaxed text-white/25">
                    Verbinden und vermessen. Marlin liefert das Raster über G29/M420 V, Klipper über bed_mesh, ältere
                    Geräte werden per G30 Punkt für Punkt angetastet.
                  </div>
                </div>
              </div>
            )}
          </div>
        </Panel>
      </div>

      <div className="min-h-0 space-y-3 xl:overflow-y-auto xl:pl-1">
        <Panel title="Z-Korrektur" hint="Live während des Drucks oder dauerhaft">
          <div className="rounded-xl border border-line/70 bg-ink-900/50 p-3 text-center">
            <div className="text-[9px] tracking-[0.2em] text-white/30 uppercase">Babystep</div>
            <div className="tabular mt-0.5 text-2xl font-semibold text-amber">
              {status.babystep >= 0 ? '+' : ''}
              {status.babystep.toFixed(3)}
              <span className="ml-1 text-[11px] font-normal text-white/35">mm</span>
            </div>
          </div>
          <div className="mt-2 flex items-center justify-between text-[9px] text-white/30">
            <span>Grobe Schritte · 0,25–1 mm</span>
            <span>wirkt auch während des Drucks</span>
          </div>
          <div className="mt-1 grid grid-cols-3 gap-1.5">
            {[-1, -0.5, -0.25, 0.25, 0.5, 1].map((d) => (
              <button
                key={d}
                type="button"
                disabled={!online || busy !== null}
                onClick={() => run(`baby${d}`, async () => { await api.babystep(d) })}
                title={`Z-Offset um ${d > 0 ? '+' : ''}${d} mm verändern`}
                className={`tabular rounded-lg border py-1.5 text-[11px] font-medium transition disabled:opacity-30 ${
                  Math.abs(d) >= 0.5
                    ? 'border-amber/40 bg-amber/5 text-amber/80 hover:bg-amber/10'
                    : 'border-line/80 text-white/70 hover:border-amber/50 hover:text-amber'
                }`}
              >
                {d > 0 ? '+' : '−'}
                {Math.abs(d).toFixed(2).replace('.', ',')}
              </button>
            ))}
          </div>
          <div className="mt-2 text-[9px] text-white/30">Feine Schritte · 0,05 mm</div>
          <div className="mt-1 grid grid-cols-4 gap-1.5">
            {[-0.05, -0.01, 0.01, 0.05].map((d) => (
              <button
                key={d}
                type="button"
                disabled={!online || busy !== null}
                onClick={() => run('baby', async () => { await api.babystep(d) })}
                className="tabular rounded-lg border border-line/80 py-1.5 text-[11px] text-white/70 transition hover:border-amber/50 hover:text-amber disabled:opacity-30"
              >
                {d > 0 ? '+' : ''}
                {d.toFixed(2)}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-[9px] leading-snug text-amber/60">
            1 mm ist ein großer Schritt: bei laufendem Druck zuerst 0,25 mm testen und die erste Schicht beobachten.
          </p>
          <button
            type="button"
            disabled={!online}
            onClick={() => run('babyreset', async () => { await api.resetBabystep() })}
            className="mt-1.5 w-full rounded-lg border border-line/70 py-1 text-[10px] text-white/40 transition hover:text-white/80 disabled:opacity-30"
          >
            Babystep zurücksetzen
          </button>

          <div className="mt-3 border-t border-line/50 pt-3">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-[10px] tracking-wider text-white/40 uppercase">Automatische Korrektur</span>
              <label className="flex items-center gap-1 text-[9px] text-white/35">
                <input
                  type="checkbox"
                  checked={settings.autoZ.enabled}
                  onChange={(e) => onSettings({ ...settings, autoZ: { ...settings.autoZ, enabled: e.target.checked } })}
                  className="accent-amber"
                />
                vor jedem Druck
              </label>
            </div>

            <div className="flex gap-1.5">
              <button
                type="button"
                disabled={!online || busy !== null}
                onClick={() =>
                  run('zmeasure', async () => {
                    setZMeasure(await api.measureZ(settings.autoZ.samples))
                  })
                }
                className="flex-1 rounded-lg border border-amber/40 py-1.5 text-[10px] text-amber transition hover:bg-amber/10 disabled:opacity-30"
              >
                {busy === 'zmeasure' ? 'Messe …' : `Messen (${settings.autoZ.samples}×)`}
              </button>
              <button
                type="button"
                disabled={!zMeasure}
                onClick={() => {
                  if (!zMeasure) return
                  const ref = { printerId: profile.id, mean: zMeasure.mean, offset: zMeasure.offset, at: Date.now() }
                  saveZRef(ref)
                  setZRef(ref)
                }}
                className="rounded-lg border border-line/80 px-2 py-1.5 text-[10px] text-white/55 transition hover:text-white disabled:opacity-30"
              >
                Als Referenz
              </button>
            </div>

            {zMeasure && (
              <div className="mt-1.5 rounded-lg border border-line/70 bg-ink-900/50 px-2 py-1 text-[9px] leading-relaxed text-white/45">
                Trigger <span className="tabular text-white/80">{zMeasure.mean.toFixed(3)} mm</span> · Streuung{' '}
                <span className="tabular">{zMeasure.spread.toFixed(3)}</span>
                <br />
                {zMeasure.inherent
                  ? 'Die Nozzle tastet den Nullpunkt — der Offset ist bauartbedingt fast null.'
                  : `Abtastung: ${zMeasure.probe}`}
                {zMeasure.spread > 0.05 && (
                  <div className="mt-1 text-amber/90">Streuung über 0,05 mm — Abtastung oder Bett prüfen.</div>
                )}
              </div>
            )}

            {zRef && (
              <div className="mt-1.5 flex items-center justify-between gap-2 rounded-lg border border-line/70 bg-ink-900/50 px-2 py-1 text-[9px] text-white/45">
                <span>
                  Referenz <span className="tabular text-white/75">{zRef.mean.toFixed(3)} mm</span>
                </span>
                <button
                  type="button"
                  disabled={!zMeasure || !online || busy !== null}
                  onClick={() =>
                    run('zapply', async () => {
                      if (!zMeasure) return
                      await api.applyZDelta(Math.round((zMeasure.mean - zRef.mean) * 1000) / 1000)
                    })
                  }
                  className="rounded border border-line/80 px-1.5 py-0.5 text-white/60 transition hover:text-amber disabled:opacity-30"
                >
                  Korrektur anwenden
                </button>
              </div>
            )}

            <p className="mt-1.5 text-[9px] leading-snug text-white/25">
              Ein absoluter Düsenabstand ist ohne Referenz nicht messbar: erste Schicht einmal mit Papier oder Babystep
              einstellen, „Als Referenz“ drücken — danach gleicht der Slicer die Drift vor jedem Druck aus (Klipper
              SET_GCODE_OFFSET, Marlin M290).
            </p>
          </div>

          <div className="mt-3 border-t border-line/50 pt-3">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-[10px] tracking-wider text-white/40 uppercase">Düsen-Nullpunkt</span>
              <span className="tabular text-[10px] text-white/35">{status.zOffset.toFixed(3)} mm</span>
            </div>
            <div className="flex gap-1.5">
              <input
                type="number"
                step={0.01}
                value={offset}
                onChange={(e) => setOffset(parseFloat(e.target.value) || 0)}
                className="tabular w-20 rounded-lg border border-line/80 bg-ink-900/70 px-2 py-1.5 text-[11px] text-white/80 outline-none"
              />
              <button
                type="button"
                disabled={!online}
                onClick={() => run('zoff', async () => { await api.setZOffset(offset, true) })}
                className="flex-1 rounded-lg border border-line/80 px-2 py-1.5 text-[10px] text-white/65 transition hover:border-mint/50 hover:text-mint disabled:opacity-30"
              >
                Setzen + speichern
              </button>
            </div>
            <p className="mt-1.5 text-[9px] leading-snug text-white/25">
              Marlin: M290 wirkt sofort, M206 + M500 speichert. Klipper: SET_GCODE_OFFSET und SAVE_CONFIG.
            </p>
          </div>
        </Panel>

        <ConsolePanel log={log} online={online} onError={onError} />
      </div>
    </div>
  )
}

const stateLabel = (s: PrinterStatus['print']['state']) =>
  s === 'printing'
    ? 'druckt'
    : s === 'paused'
      ? 'pausiert'
      : s === 'complete'
        ? 'fertig'
        : s === 'error'
          ? 'Fehler'
          : s === 'cancelled'
            ? 'abgebrochen'
            : 'bereit'

const stateTone = (s: PrinterStatus['print']['state']) =>
  s === 'printing'
    ? 'text-mint'
    : s === 'paused'
      ? 'text-amber'
      : s === 'complete'
        ? 'text-sky'
        : s === 'error'
          ? 'text-rose'
          : s === 'cancelled'
            ? 'text-rose/80'
            : 'text-white/40'

function PrinterProfilesBackupPanel({
  profileCount,
  onExport,
  onImport,
}: {
  profileCount: number
  onExport: () => void
  onImport: (file: File) => void
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  return (
    <Panel title="Alle Drucker sichern" hint={`${profileCount} gespeicherte Druckerstände`} collapsible defaultOpen={false}>
      <p className="text-[10px] leading-relaxed text-white/35">
        Eine Datei mit allen Druckern: Filament, Platte, Düse, Grenzen, eigener G-Code und sämtliche Tempo-,
        Beschleunigungs- und Materialwerte. Eigene Drucker werden mit ihren Bettmaßen wieder angelegt.
      </p>
      <div className="mt-2 flex gap-1.5">
        <button
          type="button"
          onClick={onExport}
          className="flex-1 rounded-lg border border-sky/40 bg-sky/10 py-1.5 text-[10px] font-medium text-sky transition hover:bg-sky/20"
        >
          Alle exportieren
        </button>
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="flex-1 rounded-lg border border-line/80 py-1.5 text-[10px] font-medium text-white/60 transition hover:border-mint/40 hover:text-mint"
        >
          Alle importieren
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) onImport(file)
            e.currentTarget.value = ''
          }}
        />
      </div>
    </Panel>
  )
}

function PrinterTestPanel({
  profile,
  limits,
  collapsible = false,
}: {
  profile: PrinterProfile
  limits: PrinterLimits
  collapsible?: boolean
}) {
  const [variant, setVariant] = useState<TestPrintVariant>(profile.flavor)
  const [saveInfo, setSaveInfo] = useState<string | null>(null)

  useEffect(() => {
    setVariant(profile.flavor)
  }, [profile.flavor])

  const download = async () => {
    const gcode = buildPrinterTestGcode({ profile, limits, variant })
    const outcome = await saveGcodeAs(gcode, `easy-slicer-pruefsatz-${variant}.gcode`)
    if (outcome.status === 'saved') setSaveInfo(`Prüfsatz gespeichert als „${outcome.name}“.`)
    else if (outcome.status === 'downloaded') setSaveInfo('Ohne Speicherort-Abfrage im Download-Ordner gespeichert.')
    else if (outcome.status === 'cancelled') setSaveInfo('Speichern abgebrochen — es wurde keine Datei abgelegt.')
    else setSaveInfo(outcome.message)
  }

  return (
    <Panel
      title="G-Code-Prüfsatz"
      hint="Grenzen · Classic Jerk · Input Shaper · PA"
      collapsible={collapsible}
      defaultOpen={!collapsible}
    >
      <p className="text-[10px] leading-relaxed text-white/35">
        Kleiner Testdruck für die gewählte Firmware: Rahmen, Tempo- und Beschleunigungsstufen, fünf Jerk-Quadrate,
        ein Ringing-Turm und PA-Linien. Die Werte stammen aus den aktuellen Druckergrenzen; Temperaturen sind auf
        205 °C Düse und 60 °C Bett begrenzt.
      </p>
      <div className="mt-2">
        <Segmented
          value={variant}
          onChange={(v) => setVariant(v as TestPrintVariant)}
          options={GCODE_FLAVORS.map((flavor) => ({ value: flavor.id, label: flavor.short }))}
        />
      </div>
      <p className="mt-1 text-[9px] leading-snug text-white/30">{flavorLabel(variant)} · passend zum Druckerprofil.</p>
      <button
        type="button"
        onClick={() => void download()}
        className="mt-2 w-full rounded-lg border border-amber/40 bg-amber/10 py-1.5 text-[10px] font-semibold text-amber transition hover:bg-amber/20"
      >
        Prüfsatz speichern…
      </button>
      {saveInfo && <p className="mt-1.5 text-[9px] leading-snug text-amber/80">{saveInfo}</p>}
      <p className="mt-1.5 text-[9px] leading-snug text-white/25">
        Speicherort wird beim Speichern abgefragt. Nur eine vorbereitete Testdatei — sie wurde hier nicht auf Hardware gedruckt. Vor dem Start Bett und Düse prüfen.
      </p>
    </Panel>
  )
}

export function PrinterLimitsPanel({
  value,
  factory,
  onSave,
  printerName,
  collapsible = false,
  defaultOpen = true,
}: {
  value: PrinterLimits
  factory: PrinterLimits
  onSave: (next: PrinterLimits) => void
  printerName: string
  collapsible?: boolean
  defaultOpen?: boolean
}) {
  const [draft, setDraft] = useState(value)

  useEffect(() => {
    setDraft(value)
  }, [value.maxPrintSpeed, value.maxAccel, value.maxTravel, value.maxNozzleTemp, value.maxBedTemp])

  const fields = [
    {
      key: 'maxPrintSpeed',
      label: 'Max. Drucktempo',
      unit: 'mm/s',
      step: 10,
      hint: 'Obergrenze für das Projekt-Tempo. Höher = schneller, aber mehr Risiko für Schrittverluste und Vibrationen.',
    },
    {
      key: 'maxAccel',
      label: 'Max. Beschleunigung',
      unit: 'mm/s²',
      step: 100,
      hint: 'Obergrenze für alle Beschleunigungswerte. Sehr hohe Werte können Riemen, Lager und Rahmen überlasten.',
    },
    {
      key: 'maxTravel',
      label: 'Max. Reisetempo',
      unit: 'mm/s',
      step: 10,
      hint: 'Obergrenze für Fahrten ohne Extrusion. Zu hoch = Schrittverluste oder umgestoßene Teile.',
    },
    {
      key: 'maxNozzleTemp',
      label: 'Max. Düsentemperatur',
      unit: '°C',
      step: 5,
      hint: 'Höher als das Hotend freigegeben ist kann PTFE, Düse oder Heizpatrone beschädigen.',
    },
    {
      key: 'maxBedTemp',
      label: 'Max. Betttemperatur',
      unit: '°C',
      step: 5,
      hint: 'Zu hoch kann Bett, Magnete, Kleber oder Bauteile beschädigen.',
    },
  ] as const

  const save = () => {
    const safe = (n: number, fallback: number) =>
      Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : fallback
    onSave({
      maxPrintSpeed: safe(draft.maxPrintSpeed, factory.maxPrintSpeed),
      maxAccel: safe(draft.maxAccel, factory.maxAccel),
      maxTravel: safe(draft.maxTravel, factory.maxTravel),
      maxNozzleTemp: safe(draft.maxNozzleTemp, factory.maxNozzleTemp),
      maxBedTemp: safe(draft.maxBedTemp, factory.maxBedTemp),
    })
  }

  return (
    <Panel
      title="Druckergrenzen"
      hint={`Eigene Maximalwerte für ${printerName}`}
      collapsible={collapsible}
      defaultOpen={defaultOpen}
      right={
        <button
          type="button"
          onClick={() => setDraft(factory)}
          className="text-[9px] text-white/30 transition hover:text-amber"
        >
          Werkswerte
        </button>
      }
    >
      <div className="space-y-2">
        <div className="rounded-lg border border-rose/35 bg-rose/8 px-2.5 py-2 text-[9px] leading-relaxed text-rose/80">
          <strong className="font-semibold">Änderung auf eigene Gefahr.</strong> Diese Grenzen sind keine Garantie für
          sicheren Betrieb. Zu hohe Geschwindigkeiten, Beschleunigungen oder Temperaturen können Drucker, Hotend,
          Bett und Bauteile beschädigen. Herstellerangaben und mechanische Reserven beachten — es wird keine Haftung
          für Schäden oder Folgeschäden übernommen.
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          {fields.map((f) => (
            <label key={f.key} className="block">
              <span className="mb-1 block text-[9px] tracking-wider text-white/40 uppercase">{f.label}</span>
              <div className="flex items-center gap-1 rounded-lg border border-line/80 bg-ink-900/70 px-2 py-1">
                <input
                  type="number"
                  min={1}
                  step={f.step}
                  value={draft[f.key]}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, [f.key]: Number(e.target.value) }))
                  }
                  className="tabular min-w-0 flex-1 bg-transparent text-[11px] text-white/85 outline-none"
                />
                <span className="shrink-0 text-[9px] text-white/30">{f.unit}</span>
              </div>
              <span className="mt-0.5 block text-[8px] leading-snug text-white/20">{f.hint}</span>
            </label>
          ))}
        </div>
        <p className="text-[9px] leading-snug text-white/30">
          Diese Werte dürfen bewusst über den Werkswerten liegen (Modding). Die Projektwerte im Studio werden immer auf
          die hier eingetragenen Grenzen geklemmt — höher geht es dort nicht. Für einen Werksreset den Knopf oben nutzen.
        </p>
        <button
          type="button"
          onClick={save}
          className="w-full rounded-lg border border-amber/40 bg-amber/10 py-1.5 text-[10px] font-semibold text-amber transition hover:bg-amber/20"
        >
          Grenzen für {printerName} speichern
        </button>
      </div>
    </Panel>
  )
}

export function CustomGcodePanel({
  value,
  onSave,
  printerName,
}: {
  value: CustomGcode
  onSave: (next: CustomGcode) => void
  printerName: string
}) {
  const [draft, setDraft] = useState(value)
  const [saved, setSaved] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setDraft(value)
  }, [value.start, value.end, value.layerChange, value.pause, value.fullMachineGcode])

  const change = (key: keyof CustomGcode, text: string) => {
    setDraft((d) => ({ ...d, [key]: text }))
    setSaved(false)
  }

  const save = () => {
    onSave(draft)
    setSaved(true)
  }

  const exportFile = () => {
    const payload = JSON.stringify(
      { format: 'easy-slicer-custom-gcode', printer: printerName, customGcode: draft },
      null,
      2,
    )
    const url = URL.createObjectURL(new Blob([payload], { type: 'application/json' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `${printerName.replace(/[^a-z0-9_-]+/gi, '-').toLowerCase()}-gcode.json`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  const importFile = async (file: File) => {
    try {
      const parsed = JSON.parse(await file.text()) as
        | { customGcode?: Partial<CustomGcode> }
        | Partial<CustomGcode>
      const src = ('customGcode' in parsed && parsed.customGcode ? parsed.customGcode : parsed) as Partial<CustomGcode>
      const next: CustomGcode = {
        start: typeof src.start === 'string' ? src.start : '',
        end: typeof src.end === 'string' ? src.end : '',
        layerChange: typeof src.layerChange === 'string' ? src.layerChange : '',
        pause: typeof src.pause === 'string' ? src.pause : '',
        fullMachineGcode: src.fullMachineGcode === true,
      }
      setDraft(next)
      setSaved(false)
    } catch {
      /* Die Datei bleibt unverändert; der Nutzer sieht den unveränderten Editor. */
    }
  }

  return (
    <Panel
      title="Eigener G-Code"
      hint={`Nur für ${printerName}`}
      right={
        <button
          type="button"
          onClick={() => {
            setDraft((d) => ({ ...d, start: '', end: '', layerChange: '', pause: '' }))
            setSaved(false)
          }}
          className="inline-flex min-h-6 items-center rounded px-1.5 text-[9px] text-white/30 transition hover:bg-white/5 hover:text-rose"
        >
          leeren
        </button>
      }
    >
      <div className="space-y-2">
        {(
          [
            {
              key: 'start',
              label: 'Start-G-code',
              hint: 'Vollständiger Startblock. Leer = automatisch erzeugter Standard.',
              placeholder: '; Standard-Start wird beim Druckerwechsel eingesetzt',
            },
            {
              key: 'end',
              label: 'End-G-code',
              hint: 'Vollständiger Endblock. Leer = automatisch erzeugter Standard.',
              placeholder: '; Standard-Ende wird beim Druckerwechsel eingesetzt',
            },
            {
              key: 'layerChange',
              label: 'Schichtwechsel',
              hint: 'Am Anfang jeder Schicht. {layer} und {z} werden ersetzt.',
              placeholder: 'M117 Schicht {layer} · Z {z}',
            },
            {
              key: 'pause',
              label: 'Pause / Filamentwechsel',
              hint: 'Wird vor M600 beim Mehrfarbdruck eingefügt.',
              placeholder: 'M117 Filament wechseln',
            },
          ] as const
        ).map((f) => (
          <label key={f.key} className="block">
            <span className="mb-1 flex items-baseline justify-between gap-2">
              <span className="text-[10px] tracking-wider text-white/45 uppercase">{f.label}</span>
            </span>
            <textarea
              value={draft[f.key]}
              onChange={(e) => change(f.key, e.target.value)}
              rows={f.key === 'start' || f.key === 'end' ? 8 : f.key === 'pause' ? 2 : 3}
              spellCheck={false}
              placeholder={f.placeholder}
              className="w-full resize-y rounded-lg border border-line/80 bg-ink-900/70 px-2 py-1.5 font-mono text-[10px] leading-relaxed text-white/80 outline-none focus:border-mint/50"
            />
            <span className="mt-1 block text-[9px] leading-snug text-white/25">{f.hint}</span>
          </label>
        ))}
        <p className="text-[9px] leading-snug text-white/25">
          Platzhalter: {'{nozzle}'}, {'{firstLayerNozzle}'}, {'{bed}'}, {'{firstLayerBed}'}, {'{layer}'}, {'{z}'}.
          Orca-Schreibweise wie {'[nozzle_temperature_initial_layer]'} und{' '}
          {'[bed_temperature_initial_layer_single]'} wird ebenfalls ersetzt. Beim AD5X mit Z-Mod setzt die App ein
          vorhandenes MESH automatisch auf die Betttemperatur der ersten Schicht, z. B. bei 65 °C auf MESH=65; im Setup kann
          stattdessen ein gespeichertes Klipper-Meshprofil gewählt werden. Zahlen sind als Profilnamen zulässig.
          Beim Laden eines Druckers werden die Standardblöcke eingesetzt; bearbeitete Blöcke bleiben erhalten.
        </p>
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={exportFile}
            className="flex-1 rounded-lg border border-sky/40 bg-sky/10 py-1.5 text-[10px] font-medium text-sky transition hover:bg-sky/20"
          >
            Exportieren
          </button>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="flex-1 rounded-lg border border-line/80 py-1.5 text-[10px] font-medium text-white/60 transition hover:border-white/25 hover:text-white"
          >
            Importieren
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) void importFile(file)
              e.currentTarget.value = ''
            }}
          />
        </div>
        <button
          type="button"
          onClick={save}
          className="w-full rounded-lg border border-mint/40 bg-mint/10 py-1.5 text-[10px] font-semibold text-mint transition hover:bg-mint/20"
        >
          {saved ? 'Gespeichert ✓' : `Für ${printerName} speichern`}
        </button>
      </div>
    </Panel>
  )
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-white/30">{k}</dt>
      <dd className="tabular max-w-[62%] truncate text-right text-white/65">{v}</dd>
    </div>
  )
}

function MeshHeatmap({ mesh }: { mesh: BedMesh }) {
  const maxAbs = useMemo(() => {
    const flat = mesh.z.flat()
    return Math.max(0.08, ...flat.map(Math.abs))
  }, [mesh])

  const cell = 38
  const w = mesh.cols * cell
  const h = mesh.rows * cell

  return (
    <div className="rounded-2xl border border-line/70 bg-ink-950/50 p-3">
      <svg viewBox={`0 0 ${w} ${h}`} className="h-auto w-full" style={{ maxHeight: 320 }}>
        {mesh.z.map((row, r) =>
          row.map((v, c) => {
            const cx = c * cell
            const cy = h - (r + 1) * cell
            return (
              <g key={`${r}-${c}`}>
                <rect x={cx + 1} y={cy + 1} width={cell - 2} height={cell - 2} rx={4} fill={heatColor(v, maxAbs)} opacity={0.9} />
                {mesh.cols <= 9 && (
                  <text
                    x={cx + cell / 2}
                    y={cy + cell / 2 + 3}
                    textAnchor="middle"
                    className="tabular"
                    fontSize={9}
                    fill="rgba(0,0,0,0.7)"
                    fontWeight={600}
                  >
                    {v.toFixed(2)}
                  </text>
                )}
              </g>
            )
          }),
        )}
      </svg>
      <div className="mt-2 flex items-center justify-between text-[9px] text-white/30">
        <span>
          X → {mesh.x0.toFixed(0)} … {(mesh.x0 + mesh.dx * (mesh.cols - 1)).toFixed(0)} mm
        </span>
        <span>
          Y ↑ {mesh.y0.toFixed(0)} … {(mesh.y0 + mesh.dy * (mesh.rows - 1)).toFixed(0)} mm
        </span>
      </div>
    </div>
  )
}

const historyStamp = (at: number) =>
  new Date(at).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

function MeshHistory({ history, onClear }: { history: BedMeshRecord[]; onClear: () => void }) {
  const [selA, setSelA] = useState<number | null>(null)
  const [selB, setSelB] = useState<number | null>(null)
  // Neueste Messung ist A, die Messung davor B
  const aIdx = Math.max(0, Math.min(history.length - 1, selA ?? history.length - 1))
  const bIdx = Math.max(0, Math.min(history.length - 1, selB ?? history.length - 2))

  const drift = useMemo(() => {
    if (history.length < 2) return null
    const means = history.map((h) => h.mean)
    let maxStep = 0
    for (let i = 1; i < means.length; i++) maxStep = Math.max(maxStep, Math.abs(means[i] - means[i - 1]))
    return {
      delta: means[means.length - 1] - means[0],
      maxStep,
      min: Math.min(...means),
      max: Math.max(...means),
    }
  }, [history])

  // V-19: Verlauf bewerten — Drift, Wölbung, Alter und ein Satz für den
  // nächsten Auftrag. Die Schwellen liegen in `shared/meshTrend.ts`.
  const trend = useMemo(() => meshTrend(history), [history])

  const spark = useMemo(() => {
    if (history.length < 2) return null
    const vals = history.map((h) => h.mean)
    const min = Math.min(...vals)
    const max = Math.max(...vals)
    const span = Math.max(0.01, max - min)
    const w = 260
    const h = 46
    const pts = vals.map((v, i) => `${(i / (vals.length - 1)) * w},${h - 4 - ((v - min) / span) * (h - 10)}`)
    return { w, h, pts: pts.join(' ') }
  }, [history])

  return (
    <div className="mt-2 rounded-2xl border border-line/70 bg-ink-950/50 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-medium tracking-wider text-white/40 uppercase">
          Verlauf · {history.length} Messung{history.length === 1 ? '' : 'en'}
        </span>
        {history.length > 0 && (
          <button
            type="button"
            onClick={onClear}
            className="text-[9px] text-white/25 transition hover:text-rose"
          >
            löschen
          </button>
        )}
      </div>

      {history.length === 0 ? (
        <p className="mt-1 text-[10px] leading-relaxed text-white/25">
          Jede Messung wird pro Drucker gespeichert — auch über Neustarts hinweg. Ab zwei Messungen siehst du hier die
          Drift.
        </p>
      ) : (
        <>
          {spark && (
            <svg viewBox={`0 0 ${spark.w} ${spark.h}`} className="mt-2 h-14 w-full">
              <polyline points={spark.pts} fill="none" stroke="currentColor" className="text-amber/80" strokeWidth={1.6} />
              {spark.pts.split(' ').map((p, i) => {
                const [x, y] = p.split(',').map(Number)
                return <circle key={i} cx={x} cy={y} r={2} className="fill-amber" />
              })}
            </svg>
          )}

          {drift && (
            <div className="mt-1 grid grid-cols-3 gap-2">
              {[
                { k: 'Δ seit erster', v: `${drift.delta >= 0 ? '+' : ''}${drift.delta.toFixed(3)}` },
                { k: 'größter Sprung', v: `${drift.maxStep.toFixed(3)}` },
                { k: 'Band', v: `${(drift.max - drift.min).toFixed(3)}` },
              ].map((s) => (
                <div key={s.k} className="rounded-lg border border-line/60 bg-ink-900/50 px-2 py-1">
                  <div className="text-[9px] text-white/30">{s.k}</div>
                  <div className="tabular text-[11px] font-semibold text-white/80">{s.v} mm</div>
                </div>
              ))}
            </div>
          )}

          <div className="mt-2 rounded-xl border border-line/60 bg-ink-900/40 p-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[9px] font-semibold tracking-wider text-white/45 uppercase">Bewertung für den Auftrag</span>
              <span className="text-[9px] text-white/30">
                {trend.ageDays === null ? 'Zeit unbekannt' : `zuletzt vor ${trend.ageDays} Tag${trend.ageDays === 1 ? '' : 'en'}`}
              </span>
            </div>
            <p className="mt-0.5 text-[9px] leading-snug text-white/35">
              {trend.latest
                ? `Aktuell ${trend.spreadNow.toFixed(2).replace('.', ',')} mm Streuung, Mittel ${trend.latest.mean.toFixed(3).replace('.', ',')} mm. ${
                    trend.warnings.length === 0
                      ? 'Der Verlauf ist unauffällig — das Mesh taugt für den nächsten Auftrag.'
                      : 'Vor dem nächsten Auftrag die Hinweise unten prüfen.'
                  }`
                : 'Noch keine Messung — der Slicer gleicht dann keine Unebenheiten aus.'}
            </p>
            {trend.warnings.length > 0 && (
              <ul className="mt-1.5 space-y-1">
                {trend.warnings.map((warning) => (
                  <li
                    key={warning.id}
                    className={`rounded-lg border px-2 py-1 text-[9px] leading-snug ${
                      warning.severity === 'critical'
                        ? 'border-rose/35 bg-rose/[0.06] text-rose/85'
                        : warning.severity === 'warn'
                          ? 'border-amber/30 bg-amber/[0.05] text-amber/85'
                          : 'border-sky/25 bg-sky/[0.04] text-sky/75'
                    }`}
                  >
                    <span className="font-semibold">{warning.title}: </span>
                    {warning.detail}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {history.length >= 2 && (
            <div className="mt-2 rounded-xl border border-line/60 bg-ink-900/40 p-2">
              <div className="grid grid-cols-2 gap-2">
                <label className="min-w-0">
                  <span className="mb-1 block text-[9px] tracking-wide text-white/30 uppercase">A · neu</span>
                  <select
                    value={aIdx}
                    onChange={(e) => setSelA(Number(e.target.value))}
                    className="w-full rounded-lg border border-line/80 bg-ink-900/70 px-2 py-1 text-[10px] text-white/70 outline-none"
                  >
                    {history.map((h, i) => (
                      <option key={h.at} value={i}>
                        {historyStamp(h.at)} · {h.mean.toFixed(3)} mm
                      </option>
                    ))}
                  </select>
                </label>
                <label className="min-w-0">
                  <span className="mb-1 block text-[9px] tracking-wide text-white/30 uppercase">B · Vergleich</span>
                  <select
                    value={bIdx}
                    onChange={(e) => setSelB(Number(e.target.value))}
                    className="w-full rounded-lg border border-line/80 bg-ink-900/70 px-2 py-1 text-[10px] text-white/70 outline-none"
                  >
                    {history.map((h, i) => (
                      <option key={h.at} value={i}>
                        {historyStamp(h.at)} · {h.mean.toFixed(3)} mm
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              {aIdx === bIdx ? (
                <p className="mt-2 text-[9px] text-white/25">
                  Für die Differenz zwei verschiedene Messungen wählen — A ist die neuere.
                </p>
              ) : (
                <MeshDiff a={history[aIdx]} b={history[bIdx]} />
              )}
            </div>
          )}

          <div className="mt-2 flex items-center justify-between gap-2 text-[8px] tracking-wider text-white/20 uppercase">
            <span>Datum</span>
            <span>Raster · Mittel · Streuung</span>
            <span>Δ</span>
          </div>
          <ul className="mt-1 space-y-1">
            {history
              .slice(-12)
              .reverse()
              .map((h, i, arr) => {
                const prev = arr[i + 1]
                const delta = prev ? h.mean - prev.mean : null
                return (
                  <li key={h.at} className="flex items-center justify-between gap-2 text-[9px] text-white/40">
                    <span className="tabular text-white/30">
                      {new Date(h.at).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                    </span>
                    <span className="tabular">
                      {h.rows}×{h.cols} · Mittel {h.mean.toFixed(3)} · Streuung {h.spread.toFixed(3)}
                    </span>
                    <span
                      className={`tabular w-14 text-right ${
                        delta === null ? 'text-white/20' : Math.abs(delta) > 0.03 ? 'text-amber' : 'text-white/35'
                      }`}
                    >
                      {delta === null ? '—' : `${delta >= 0 ? '+' : ''}${delta.toFixed(3)}`}
                    </span>
                  </li>
                )
              })}
          </ul>

          {drift && drift.maxStep > 0.05 && (
            <p className="mt-2 rounded-lg border border-amber/30 bg-amber/8 px-2 py-1 text-[9px] leading-snug text-amber/90">
              Sprung über 0,05 mm zwischen zwei Messungen — Bett oder Sensor prüfen, bevor du weiterdruckst.
            </p>
          )}
        </>
      )}
    </div>
  )
}

type PortKind = 'com' | 'usb-cdc' | 'usb-serial' | 'unknown'

/** Port-Art am Namen erkennen: ACM/USBModem = natives USB, ttyUSB/COM = Adapter. */
function portKind(path: string): PortKind {
  const p = path.trim().toLowerCase()
  if (/^com\d+$/.test(p)) return 'com'
  if (/ttyacm|usbmodem|acm\d+/.test(p)) return 'usb-cdc'
  if (/ttyusb|usbserial|cu\./.test(p)) return 'usb-serial'
  return 'unknown'
}

function portKindHint(path: string): string | null {
  switch (portKind(path)) {
    case 'com':
      return 'Seriell (COM): USB-Adapter — passt zu Marlin.'
    case 'usb-serial':
      return 'USB-Serial-Adapter (CH340/CP2102/FTDI) — passt zu Marlin.'
    case 'usb-cdc':
      return 'Natives USB (ACM/USBModem). Hängt dort ein Klipper-Host oder eine Klipper-MCU, oben „Klipper“ wählen und die Moonraker-Adresse eintragen.'
    default:
      return null
  }
}

function meshSourceLabel(source: BedMesh['source']): string {
  return source === 'simulation'
    ? 'Simulation'
    : source === 'manual'
      ? 'manuell (G30)'
      : source === 'klipper'
        ? 'Klipper (bed_mesh)'
        : 'Firmware (G29)'
}

function MeshStats({ mesh }: { mesh: BedMesh }) {
  const flat = mesh.z.flat()
  const min = Math.min(...flat)
  const max = Math.max(...flat)
  const mean = flat.reduce((a, b) => a + b, 0) / flat.length
  const spread = max - min
  return (
    <div className="mt-2 grid grid-cols-4 gap-2">
      {[
        { k: 'min', v: min },
        { k: 'max', v: max },
        { k: 'mittel', v: mean },
        { k: 'spanne', v: spread },
      ].map((s) => (
        <div key={s.k} className="rounded-xl border border-line/60 bg-ink-900/50 px-2 py-1.5">
          <div className="text-[9px] tracking-wider text-white/30 uppercase">{s.k}</div>
          <div className="tabular text-[11px] font-semibold text-white/80">{s.v.toFixed(3)} mm</div>
        </div>
      ))}
      {spread > 0.3 && (
        <div className="col-span-4 rounded-lg border border-amber/30 bg-amber/8 px-2 py-1 text-[10px] text-amber/90">
          Spanne {spread.toFixed(2)} mm — deutlich verzogen. Software-Kompensation glättet das im G-Code.
        </div>
      )}
    </div>
  )
}

function heatColor(v: number, maxAbs: number): string {
  const t = Math.max(-1, Math.min(1, v / maxAbs))
  if (t >= 0) return `hsl(${44 - t * 26} 92% ${40 + t * 22}%)`
  return `hsl(${205 - t * 18} 82% ${40 + -t * 22}%)`
}

function ConsolePanel({ log, online, onError }: { log: ConsoleLine[]; online: boolean; onError: (m: string | null) => void }) {
  const [input, setInput] = useState('')
  const [live, setLive] = useState(false)
  const scroller = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = scroller.current
    if (el) el.scrollTop = el.scrollHeight
  }, [log])

  const send = async () => {
    if (!input.trim()) return
    try {
      await api.sendCommand(input.trim(), live)
      setInput('')
      onError(null)
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Kommando fehlgeschlagen.')
    }
  }

  return (
    <Panel title="Konsole" hint="Firmware direkt ansprechen" className="flex flex-col">
      <div className="flex min-h-0 flex-col">
        <div
          ref={scroller}
          className="h-[260px] flex-1 overflow-y-auto rounded-xl border border-line/60 bg-ink-950/70 p-2 font-mono text-[10px] leading-relaxed"
        >
          {log.length === 0 && <div className="text-white/20">Noch keine Kommunikation.</div>}
          {log.map((l, i) => (
            <div
              key={`${l.t}-${i}`}
              className={
                l.dir === 'out'
                  ? 'text-sky/80'
                  : l.dir === 'info'
                    ? 'text-mint/80'
                    : /error|!!|unknown/i.test(l.text)
                      ? 'text-rose/90'
                      : 'text-white/45'
              }
            >
              <span className="mr-1 text-white/15">{l.dir === 'out' ? '›' : l.dir === 'info' ? '•' : '‹'}</span>
              {l.text}
            </div>
          ))}
        </div>

        <div className="mt-2 flex gap-1.5">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void send()
            }}
            placeholder={online ? 'z. B. M503' : 'nicht verbunden'}
            disabled={!online}
            className="min-w-0 flex-1 rounded-lg border border-line/80 bg-ink-900/70 px-2 py-1.5 font-mono text-[10px] text-white/80 outline-none focus:border-sky/50 disabled:opacity-40"
          />
          <button
            type="button"
            onClick={() => void send()}
            disabled={!online}
            className="rounded-lg border border-line/80 px-2.5 py-1.5 text-[10px] text-white/60 transition hover:text-white disabled:opacity-30"
          >
            Senden
          </button>
        </div>
        <label className="mt-1.5 flex items-center gap-1.5 text-[9px] text-white/30">
          <input type="checkbox" checked={live} onChange={(e) => setLive(e.target.checked)} className="accent-sky" />
          live senden (ohne auf „ok“ zu warten)
        </label>
      </div>
    </Panel>
  )
}
