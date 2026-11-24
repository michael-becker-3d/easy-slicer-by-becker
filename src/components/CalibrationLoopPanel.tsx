import { useMemo, useState } from 'react'
import type { PrintSettings } from '../../shared/types.ts'
import {
  applyCalibrationCorrections,
  calibrationCorrections,
  calibrationValues,
  compareCalibrationValues,
  type CalibrationVersion,
} from '../../shared/calibrationLoop.ts'
import { Panel } from './ui.tsx'
import { clearCalibrationVersions, loadCalibrationVersions, saveCalibrationVersion } from '../calibrationLoopStore.ts'

const field =
  'w-full rounded-lg border border-line/80 bg-ink-900/70 px-2 py-1.5 text-[11px] text-white/80 outline-none focus:border-amber/60'

function number(value: string): number | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  const parsed = Number(trimmed.replace(',', '.'))
  return Number.isFinite(parsed) ? parsed : null
}

function fmt(value: number, digits: number): string {
  return value.toFixed(digits).replace('.', ',')
}

function stamp(at: number): string {
  return new Date(at).toLocaleString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/**
 * Kalibrier-Kreislauf (V-18).
 *
 * Die Messwerte werden sofort zu Korrekturen gerechnet. Erst „Übernehmen“
 * verändert das Profil; optional entsteht dabei eine Version mit Drucker,
 * Spule und Datum. Die Vorher/Nachher-Tabelle bleibt dauerhaft nachlesbar.
 */
export function CalibrationLoopPanel({
  printerId,
  printerName,
  filamentName,
  settings,
  onApply,
  disabled,
}: {
  printerId: string
  printerName: string
  filamentName: string
  settings: PrintSettings
  onApply: (next: PrintSettings) => void
  disabled?: boolean
}) {
  const [wall, setWall] = useState('')
  const [foot, setFoot] = useState('')
  const [targetFoot, setTargetFoot] = useState('20')
  const [measuredX, setMeasuredX] = useState('')
  const [targetX, setTargetX] = useState('20')
  const [measuredY, setMeasuredY] = useState('')
  const [targetY, setTargetY] = useState('20')
  const [pa, setPa] = useState('')
  const [fitPlay, setFitPlay] = useState('')
  const [spool, setSpool] = useState('')
  const [versions, setVersions] = useState<CalibrationVersion[]>(() => loadCalibrationVersions())
  const [notice, setNotice] = useState('')

  const corrections = useMemo(
    () =>
      calibrationCorrections(
        {
          wallThickness: number(wall),
          footWidth: number(foot),
          targetFootWidth: number(targetFoot),
          measuredX: number(measuredX),
          targetX: number(targetX),
          measuredY: number(measuredY),
          targetY: number(targetY),
          pressureAdvance: number(pa),
        },
        settings,
      ),
    [wall, foot, targetFoot, measuredX, targetX, measuredY, targetY, pa, settings],
  )

  const next = useMemo(
    () => applyCalibrationCorrections(settings, corrections),
    [settings, corrections],
  )

  const tolerance = number(fitPlay)

  const apply = (withVersion: boolean) => {
    if (!corrections.length && tolerance === null) return
    const before = calibrationValues(settings)
    const after = calibrationValues(next)
    onApply(next)
    if (withVersion) {
      const version: CalibrationVersion = {
        id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
        at: Date.now(),
        printerId,
        printerName,
        filament: filamentName,
        spool: spool.trim(),
        before,
        after,
        tolerance: tolerance ?? undefined,
        note: [...corrections.map((correction) => correction.label), tolerance !== null ? 'Passungsspiel' : '']
          .filter(Boolean)
          .join(' · '),
      }
      setVersions(saveCalibrationVersion(version))
      setNotice(`Als Version gespeichert — ${corrections.length} Wert${corrections.length === 1 ? '' : 'e'} übernommen.`)
    } else {
      setNotice(`${corrections.length} Wert${corrections.length === 1 ? '' : 'e'} übernommen.`)
    }
  }

  const history = versions.filter((version) => version.printerId === printerId).slice(0, 5)

  return (
    <Panel
      title="Kalibrier-Kreislauf"
      hint="Gemessen → gerechnet → im Profil. Jede Korrektur nennt Formel und Grund; optional als Version mit Spule und Datum ablegen."
      right={<span className="text-[9px] text-white/30">{printerName}</span>}
    >
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <label className="block">
          <span className="mb-1 block text-[9px] tracking-wider text-white/40 uppercase">Wandstärke (mm)</span>
          <input value={wall} onChange={(e) => setWall(e.target.value)} placeholder="0,44" className={field} inputMode="decimal" />
        </label>
        <label className="block">
          <span className="mb-1 block text-[9px] tracking-wider text-white/40 uppercase">Fußbreite (mm)</span>
          <input value={foot} onChange={(e) => setFoot(e.target.value)} placeholder="20,4" className={field} inputMode="decimal" />
        </label>
        <label className="block">
          <span className="mb-1 block text-[9px] tracking-wider text-white/40 uppercase">Sollbreite Fuß (mm)</span>
          <input value={targetFoot} onChange={(e) => setTargetFoot(e.target.value)} className={field} inputMode="decimal" />
        </label>
        <label className="block">
          <span className="mb-1 block text-[9px] tracking-wider text-white/40 uppercase">PA vom Turm</span>
          <input value={pa} onChange={(e) => setPa(e.target.value)} placeholder="0,042" className={field} inputMode="decimal" />
        </label>
        <label className="block">
          <span className="mb-1 block text-[9px] tracking-wider text-white/40 uppercase">Passungsspiel (mm)</span>
          <input value={fitPlay} onChange={(e) => setFitPlay(e.target.value)} placeholder="0,10" className={field} inputMode="decimal" />
        </label>
        <label className="block">
          <span className="mb-1 block text-[9px] tracking-wider text-white/40 uppercase">Ist X (mm)</span>
          <input value={measuredX} onChange={(e) => setMeasuredX(e.target.value)} placeholder="19,92" className={field} inputMode="decimal" />
        </label>
        <label className="block">
          <span className="mb-1 block text-[9px] tracking-wider text-white/40 uppercase">Soll X (mm)</span>
          <input value={targetX} onChange={(e) => setTargetX(e.target.value)} className={field} inputMode="decimal" />
        </label>
        <label className="block">
          <span className="mb-1 block text-[9px] tracking-wider text-white/40 uppercase">Ist Y (mm)</span>
          <input value={measuredY} onChange={(e) => setMeasuredY(e.target.value)} placeholder="19,94" className={field} inputMode="decimal" />
        </label>
        <label className="block">
          <span className="mb-1 block text-[9px] tracking-wider text-white/40 uppercase">Soll Y (mm)</span>
          <input value={targetY} onChange={(e) => setTargetY(e.target.value)} className={field} inputMode="decimal" />
        </label>
      </div>

      <div className="mt-2 flex flex-wrap items-end gap-2">
        <label className="min-w-[160px] flex-1">
          <span className="mb-1 block text-[9px] tracking-wider text-white/40 uppercase">Spule / Charge</span>
          <input
            value={spool}
            onChange={(e) => setSpool(e.target.value)}
            placeholder="z. B. PLA schwarz, Charge 24-11"
            className={field}
          />
        </label>
        <button
          type="button"
          disabled={(!corrections.length && tolerance === null) || disabled}
          onClick={() => apply(false)}
          className="rounded-lg border border-line/80 px-2.5 py-1.5 text-[10px] text-white/60 transition hover:border-white/30 hover:text-white disabled:opacity-30"
        >
          Nur übernehmen
        </button>
        <button
          type="button"
          disabled={(!corrections.length && tolerance === null) || disabled}
          onClick={() => apply(true)}
          className="rounded-lg border border-amber/50 bg-amber/15 px-2.5 py-1.5 text-[10px] font-semibold text-amber transition hover:bg-amber/25 disabled:opacity-30"
        >
          Übernehmen &amp; Version sichern
        </button>
      </div>

      {notice && <p className="mt-2 text-[9px] text-mint/80">{notice}</p>}

      {corrections.length === 0 ? (
        <p className="mt-2 rounded-lg border border-line/60 bg-ink-950/40 px-2 py-1.5 text-[9px] leading-snug text-white/30">
          Trage einen Messwert ein. Fluss, Schrumpfung, Elefantenfuß und PA werden getrennt gerechnet — ein unveränderter
          Wert erzeugt bewusst keine Korrektur. Das Passungsspiel allein lässt sich als Version für den Montage-Assistenten
          sichern.
        </p>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {corrections.map((correction) => (
            <li key={correction.id} className="rounded-xl border border-line/60 bg-ink-950/40 px-2 py-1.5">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="text-[11px] font-semibold text-white/85">{correction.label}</span>
                <span className="tabular text-[10px] text-white/40">
                  {correction.before} → <span className="font-semibold text-amber">{correction.after}</span>
                </span>
              </div>
              <div className="mt-0.5 font-mono text-[9px] text-white/35">{correction.formula}</div>
              <p className="mt-1 text-[9px] leading-snug text-white/45">{correction.why}</p>
            </li>
          ))}
        </ul>
      )}

      {history.length > 0 && (
        <div className="mt-3 rounded-xl border border-line/60 bg-ink-950/40 p-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[9px] font-semibold tracking-wider text-white/45 uppercase">
              Versionen · {history.length}
            </span>
            <button
              type="button"
              onClick={() => setVersions(clearCalibrationVersions(printerId))}
              className="text-[9px] text-white/25 transition hover:text-rose"
            >
              Verlauf dieses Druckers löschen
            </button>
          </div>
          <ul className="mt-1.5 space-y-2">
            {history.map((version) => (
              <li key={version.id} className="rounded-lg border border-line/50 bg-ink-900/50 px-2 py-1.5">
                <div className="flex flex-wrap items-baseline justify-between gap-1">
                  <span className="text-[10px] font-medium text-white/70">{stamp(version.at)}</span>
                  <span className="text-[9px] text-white/30">
                    {version.filament}
                    {version.spool ? ` · ${version.spool}` : ''}
                  </span>
                </div>
                <table className="mt-1 w-full text-[9px]">
                  <thead>
                    <tr className="text-white/25">
                      <th className="text-left font-normal">Wert</th>
                      <th className="text-right font-normal">vorher</th>
                      <th className="text-right font-normal">nachher</th>
                      <th className="text-right font-normal">Δ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {compareCalibrationValues(version.before, version.after).map((row) => (
                      <tr key={row.key} className="text-white/55">
                        <td>{row.label}</td>
                        <td className="tabular text-right">{fmt(row.before, row.digits)}</td>
                        <td className="tabular text-right text-white/80">{fmt(row.after, row.digits)}</td>
                        <td
                          className={`tabular text-right ${
                            Math.abs(row.delta) < 1e-9 ? 'text-white/25' : row.delta > 0 ? 'text-mint' : 'text-amber'
                          }`}
                        >
                          {row.delta > 0 ? '+' : ''}
                          {fmt(row.delta, row.digits)}
                          {row.unit ? ` ${row.unit}` : ''}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Panel>
  )
}
