import { useEffect, useMemo, useState } from 'react'
import type { ModelObjectInfo } from '../../shared/types.ts'
import * as api from '../api.ts'
import { PanelPortal } from './PanelPortal.tsx'
import {
  assessScan,
  planHollow,
  planScale,
  scanSummary,
  type HollowDetail,
  type ScaleAxis,
  type ScanInfo,
  type ScanSeverity,
} from '../../shared/scanPrep.ts'

const field =
  'w-full rounded-lg border border-line/80 bg-ink-900/70 px-2 py-1.5 text-[11px] text-white/80 outline-none focus:border-amber/60'
const labelClass = 'mb-1 block text-[9px] tracking-wider text-white/40 uppercase'

const SEVERITY_STYLE: Record<ScanSeverity, string> = {
  critical: 'border-rose-500/35 bg-rose-500/[0.07] text-rose-200',
  warn: 'border-amber/35 bg-amber/[0.06] text-amber/90',
  hint: 'border-sky-500/25 bg-sky-500/[0.05] text-sky-200/90',
  ok: 'border-mint/30 bg-mint/[0.05] text-mint/90',
}

const AXES: { id: ScaleAxis; label: string }[] = [
  { id: 'longest', label: 'längste Kante' },
  { id: 'x', label: 'X' },
  { id: 'y', label: 'Y' },
  { id: 'z', label: 'Z' },
]

const DETAILS: { value: HollowDetail; label: string }[] = [
  { value: 0.1, label: 'Fein · 0,1 mm' },
  { value: 0.2, label: 'Mittel · 0,2 mm' },
  { value: 0.4, label: 'Grob · 0,4 mm' },
]

function number(value: string): number | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  const parsed = Number(trimmed.replace(',', '.'))
  return Number.isFinite(parsed) ? parsed : null
}

const fmt = (value: number, digits = 1) => value.toFixed(digits).replace('.', ',')

/**
 * Scan-zu-Druck (V-22).
 *
 * Bewertet ein Fotogrammetrie-Mesh, bringt es über ein bekanntes Ist-Maß auf
 * Millimeter, repariert offene Ränder und höhlt es mit Abflusslöchern aus.
 * Das Aushöhlen ist bewusst kein Live-Vorgang: manifold rechnet je nach Netz
 * Sekunden bis über eine Minute.
 */
export function ScanAssistant({
  modelId,
  objects,
  bed,
  initialId,
  onEdit,
  onClose,
}: {
  modelId: string
  objects: ModelObjectInfo[]
  bed: { x: number; y: number; z: number }
  initialId?: string
  onEdit: (res: api.ModelEditResult) => void
  onClose: () => void
}) {
  const [objectId, setObjectId] = useState(initialId ?? objects[0]?.id ?? '')
  const object = objects.find((entry) => entry.id === objectId) ?? objects[0] ?? null
  const [info, setInfo] = useState<ScanInfo | null>(null)
  const [infoError, setInfoError] = useState('')
  const [refresh, setRefresh] = useState(0)
  const [axis, setAxis] = useState<ScaleAxis>('longest')
  const [target, setTarget] = useState('')
  const [wall, setWall] = useState('2,0')
  const [holes, setHoles] = useState('2')
  const [diameter, setDiameter] = useState('3,0')
  const [detail, setDetail] = useState<HollowDetail>(0.2)
  const [busy, setBusy] = useState<'repair' | 'scale' | 'hollow' | null>(null)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    setInfo(null)
    setInfoError('')
    api
      .scanInfo(modelId, object?.id)
      .then((res) => {
        if (!cancelled) setInfo(res.scan)
      })
      .catch((err) => {
        if (!cancelled) setInfoError(err instanceof Error ? err.message : 'Scanprüfung fehlgeschlagen.')
      })
    return () => {
      cancelled = true
    }
  }, [modelId, object?.id, refresh])

  const findings = useMemo(
    () => (object ? assessScan({ ...(info ?? { triangles: object.triangles, openEdges: 0, components: 1 }), size: object.size }, bed) : []),
    [object, info, bed],
  )

  const targetMm = number(target)
  const scalePlan = useMemo(
    () => (object && targetMm !== null ? planScale(object.size, targetMm, axis, bed) : null),
    [object, targetMm, axis, bed],
  )

  const hollowPlan = useMemo(
    () =>
      object
        ? planHollow(
            object.size,
            {
              wall: number(wall) ?? 2,
              drainHoles: number(holes) ?? 0,
              drainDiameter: number(diameter) ?? 3,
              detail,
            },
            info?.triangles ?? object.triangles,
          )
        : null,
    [object, wall, holes, diameter, detail, info?.triangles],
  )

  const placement = object?.placement
  const scaledOutOfRange = Boolean(
    scalePlan &&
      placement &&
      (placement.scaleX * scalePlan.factor > 10 ||
        placement.scaleY * scalePlan.factor > 10 ||
        placement.scaleZ * scalePlan.factor < 0.05),
  )
  const rotated = Boolean(
    placement && (Math.abs(placement.rotationX) > 0.5 || Math.abs(placement.rotationY) > 0.5),
  )

  const run = async (kind: 'repair' | 'scale' | 'hollow', action: () => Promise<api.ModelEditResult>, done: string) => {
    setBusy(kind)
    setError('')
    setNotice('')
    try {
      const res = await action()
      onEdit(res)
      setNotice(done)
      setRefresh((value) => value + 1)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Vorgang fehlgeschlagen.')
    } finally {
      setBusy(null)
    }
  }

  const repair = () => {
    if (!object) return
    void run(
      'repair',
      async () => {
        const res = await api.objectTool(modelId, 'repair', { objectIds: [object.id] })
        return res
      },
      'Mesh repariert — offene Ränder geschlossen, soweit möglich.',
    )
  }

  const applyScale = () => {
    if (!object || !scalePlan || !scalePlan.feasible || scaledOutOfRange) return
    const p = object.placement
    void run(
      'scale',
      () =>
        api.setObjects(modelId, [
          {
            id: object.id,
            scaleX: p.scaleX * scalePlan.factor,
            scaleY: p.scaleY * scalePlan.factor,
            scaleZ: p.scaleZ * scalePlan.factor,
          },
        ]),
      `Maßstab gesetzt: ${fmt(scalePlan.from)} → ${fmt(scalePlan.to)} mm (Faktor ${fmt(scalePlan.factor, 2)}).`,
    )
  }

  const hollow = () => {
    if (!object || !hollowPlan) return
    setBusy('hollow')
    setError('')
    setNotice('')
    api
      .hollowScan(modelId, {
        objectId: object.id,
        wall: hollowPlan.wall,
        drainHoles: hollowPlan.drainHoles,
        drainDiameter: hollowPlan.drainDiameter,
        detail: hollowPlan.detail,
      })
      .then((res) => {
        onEdit(res)
        const h = res.hollow
        const opened =
          h.drainHoles === 0
            ? 'ohne Abflusslöcher'
            : `${h.openedHoles} von ${h.drainHoles} Abflussloch${h.drainHoles === 1 ? '' : 'löchern'} offen`
        setNotice(
          `Hohlkörper fertig: ${fmt(h.wall)} mm Wand, ${opened}, ${Math.round(h.savingPercent)} % Material gespart. ` +
            `${h.trianglesBefore.toLocaleString('de-DE')} → ${h.trianglesAfter.toLocaleString('de-DE')} Dreiecke in ${(h.durationMs / 1000).toFixed(1).replace('.', ',')} s.`,
        )
        if (h.drainHoles > 0 && h.openedHoles < h.drainHoles) {
          setError(
            'Nicht alle Abflusslöcher erreichen den Hohlraum. Meist liegt die Unterseite nicht eben auf oder das Teil ist dort massiv — bitte ausrichten oder Löcher woanders setzen.',
          )
        }
        setRefresh((value) => value + 1)
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Aushöhlen fehlgeschlagen.'))
      .finally(() => setBusy(null))
  }

  return (
    <PanelPortal>
      <div
      className="fixed inset-y-0 right-0 z-50 flex w-[460px] max-w-full flex-col border-l border-line/80 bg-ink-900/97 shadow-2xl backdrop-blur-xl"
      role="dialog"
      aria-modal="true"
      aria-label="Scan-Assistent"
    >
      <div className="flex items-start justify-between gap-3 border-b border-line/60 px-4 py-3">
        <div>
          <h3 className="text-sm font-semibold text-white/85">Scan-Assistent</h3>
          <p className="mt-0.5 text-[10px] leading-snug text-white/35">
            Scan prüfen, auf Maß bringen, reparieren und als Schale mit Abflusslöchern drucken.
          </p>
        </div>
        <button type="button" onClick={onClose} className="text-white/30 transition hover:text-white/70" aria-label="Schließen">
          ✕
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {object ? (
          <div className="space-y-3">
            {objects.length > 1 && (
              <label className="block">
                <span className={labelClass}>Objekt</span>
                <select value={objectId} onChange={(event) => setObjectId(event.target.value)} className={field}>
                  {objects.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.name} · {fmt(entry.size.x, 0)}×{fmt(entry.size.y, 0)}×{fmt(entry.size.z, 0)} mm
                    </option>
                  ))}
                </select>
              </label>
            )}

            <div className="rounded-xl border border-line/60 bg-ink-950/40 p-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[9px] font-semibold tracking-wider text-white/45 uppercase">Netzprüfung</span>
                <span className="text-[9px] text-white/30">
                  {fmt(object.size.x)} × {fmt(object.size.y)} × {fmt(object.size.z)} mm
                </span>
              </div>
              {info ? (
                <>
                  <div className="mt-1.5 grid grid-cols-3 gap-1.5 text-center">
                    {[
                      { k: 'Offene Kanten', v: info.openEdges.toLocaleString('de-DE') },
                      { k: 'Einzelkörper', v: String(info.components) },
                      { k: 'Dreiecke', v: info.triangles.toLocaleString('de-DE') },
                    ].map((entry) => (
                      <div key={entry.k} className="rounded-lg border border-line/60 bg-ink-900/50 px-1 py-1">
                        <div className="text-[8px] text-white/30">{entry.k}</div>
                        <div
                          className={`truncate text-[10px] font-semibold ${
                            entry.k === 'Offene Kanten' && info.openEdges > 0 ? 'text-rose-300' : 'text-white/80'
                          }`}
                        >
                          {entry.v}
                        </div>
                      </div>
                    ))}
                  </div>
                  <p className="mt-1.5 text-[9px] leading-snug text-white/40">{scanSummary(findings)}</p>
                </>
              ) : (
                <p className="mt-1.5 text-[10px] text-white/35">
                  {infoError || 'Prüfe Netz … bei großen Scans kann das ein paar Sekunden dauern.'}
                </p>
              )}
              {info && (
              <ul className="mt-2 space-y-1.5">
                {findings.map((finding) => (
                  <li key={finding.id} className={`rounded-lg border px-2 py-1.5 ${SEVERITY_STYLE[finding.severity]}`}>
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-[10px] font-semibold">{finding.title}</span>
                      <span className="shrink-0 text-[9px] opacity-70">{finding.detail}</span>
                    </div>
                    <p className="mt-0.5 text-[9px] leading-snug opacity-75">{finding.why}</p>
                  </li>
                ))}
              </ul>
              )}
            </div>

            <div className="rounded-xl border border-line/60 bg-ink-950/40 p-2">
              <span className="text-[9px] font-semibold tracking-wider text-white/45 uppercase">1 · Auf Maß bringen</span>
              <p className="mt-1 text-[9px] leading-snug text-white/35">
                Ein Foto-Scan kennt keine Millimeter. Miss eine bekannte Strecke am Teil (z. B. die Höhe) und trage sie hier ein.
              </p>
              <div className="mt-1.5 grid grid-cols-2 gap-1.5">
                <label>
                  <span className={labelClass}>Bezugsachse</span>
                  <select value={axis} onChange={(event) => setAxis(event.target.value as ScaleAxis)} className={field}>
                    {AXES.map((entry) => (
                      <option key={entry.id} value={entry.id}>
                        {entry.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span className={labelClass}>Ist-Maß (mm)</span>
                  <input
                    value={target}
                    onChange={(event) => setTarget(event.target.value)}
                    inputMode="decimal"
                    placeholder={fmt(axis === 'longest' ? Math.max(object.size.x, object.size.y, object.size.z) : object.size[axis], 1)}
                    className={field}
                  />
                </label>
              </div>
              {scalePlan && (
                <div className="mt-1.5 rounded-lg border border-line/60 bg-ink-900/50 px-2 py-1.5 text-[9px] text-white/50">
                  Faktor <span className="text-white/80">{fmt(scalePlan.factor, 3)}</span> · neu{' '}
                  <span className="text-white/80">
                    {fmt(scalePlan.newSize.x)} × {fmt(scalePlan.newSize.y)} × {fmt(scalePlan.newSize.z)} mm
                  </span>
                  {scaledOutOfRange && <div className="text-rose-300">Der Gesamtmaßstab überschreitet 0,05–10 — bitte anderes Maß wählen.</div>}
                  {scalePlan.warnings.map((warning, index) => (
                    <div key={index} className="text-amber/85">
                      {warning}
                    </div>
                  ))}
                </div>
              )}
              <div className="mt-1.5 flex justify-end">
                <button
                  type="button"
                  disabled={!scalePlan || !scalePlan.feasible || scaledOutOfRange || busy !== null}
                  onClick={applyScale}
                  className="rounded-lg border border-amber/50 bg-amber/10 px-2.5 py-1.5 text-[10px] font-semibold text-amber transition hover:bg-amber/15 disabled:opacity-40"
                >
                  {busy === 'scale' ? 'Setze Maßstab …' : 'Maßstab übernehmen'}
                </button>
              </div>
            </div>

            <div className="rounded-xl border border-line/60 bg-ink-950/40 p-2">
              <span className="text-[9px] font-semibold tracking-wider text-white/45 uppercase">2 · Netz reparieren</span>
              <p className="mt-1 text-[9px] leading-snug text-white/35">
                Schließt offene Ränder und entfernt doppelte Dreiecke. Nur übernehmen, wenn es die offenen Kanten wirklich verringert.
              </p>
              <div className="mt-1.5 flex justify-end">
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={repair}
                  className="rounded-lg border border-line/80 px-2.5 py-1.5 text-[10px] text-white/70 transition hover:border-white/25 disabled:opacity-40"
                >
                  {busy === 'repair' ? 'Repariere …' : 'Mesh reparieren'}
                </button>
              </div>
            </div>

            <div className="rounded-xl border border-line/60 bg-ink-950/40 p-2">
              <span className="text-[9px] font-semibold tracking-wider text-white/45 uppercase">3 · Hohl drucken</span>
              <p className="mt-1 text-[9px] leading-snug text-white/35">
                Erzeugt eine geschlossene Schale mit gleichmäßiger Wandstärke und Abflusslöchern auf der Unterseite. Das Netz wird vorher vereinfacht; das dauert je nach Modell {hollowPlan?.durationLabel ?? 'kurz'}.
              </p>
              <div className="mt-1.5 grid grid-cols-2 gap-1.5">
                <label>
                  <span className={labelClass}>Wandstärke (mm)</span>
                  <input value={wall} onChange={(event) => setWall(event.target.value)} inputMode="decimal" className={field} />
                </label>
                <label>
                  <span className={labelClass}>Abflusslöcher</span>
                  <input value={holes} onChange={(event) => setHoles(event.target.value)} inputMode="numeric" className={field} />
                </label>
                <label>
                  <span className={labelClass}>Lochdurchmesser (mm)</span>
                  <input value={diameter} onChange={(event) => setDiameter(event.target.value)} inputMode="decimal" className={field} />
                </label>
                <label>
                  <span className={labelClass}>Detailtreue</span>
                  <select value={detail} onChange={(event) => setDetail(Number(event.target.value) as HollowDetail)} className={field}>
                    {DETAILS.map((entry) => (
                      <option key={entry.value} value={entry.value}>
                        {entry.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              {hollowPlan && (
                <div className="mt-1.5 space-y-1 text-[9px] leading-snug text-white/45">
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                    <span>Wand im Druck {fmt(hollowPlan.wall)} mm</span>
                    <span>{hollowPlan.drainHoles} Loch{hollowPlan.drainHoles === 1 ? '' : 'er'} à {fmt(hollowPlan.drainDiameter)} mm</span>
                    <span>Schätzung {hollowPlan.durationLabel}</span>
                  </div>
                  {rotated && (
                    <div className="text-amber/85">
                      Das Objekt ist gedreht. Die Löcher werden in der lokalen Unterseite gebohrt — vorher mit Q ausrichten, sonst liegen sie an der Seite.
                    </div>
                  )}
                  {info && info.openEdges > 0 && (
                    <div className="text-amber/85">Offene Kanten können das Aushöhlen verhindern — Schritt 2 zuerst ausführen.</div>
                  )}
                  {hollowPlan.warnings.map((warning, index) => (
                    <div key={index} className="text-amber/85">
                      {warning}
                    </div>
                  ))}
                </div>
              )}
              <div className="mt-1.5 flex justify-end">
                <button
                  type="button"
                  disabled={!hollowPlan || hollowPlan.wall <= 0 || busy !== null}
                  onClick={hollow}
                  className="rounded-lg bg-gradient-to-r from-amber to-[#ffcf7a] px-3 py-1.5 text-[10px] font-semibold text-ink-950 transition hover:brightness-110 disabled:opacity-40"
                >
                  {busy === 'hollow' ? 'Höhle aus — Server beschäftigt …' : 'Aushöhlen'}
                </button>
              </div>
            </div>

            {notice && (
              <p className="rounded-lg border border-mint/30 bg-mint/[0.06] px-2 py-1.5 text-[9px] leading-snug text-mint/90">{notice}</p>
            )}
            {error && (
              <p className="rounded-lg border border-rose-500/35 bg-rose-500/[0.07] px-2 py-1.5 text-[9px] leading-snug text-rose-200">
                {error}
              </p>
            )}
            {infoError && !info && <p className="text-[9px] text-rose-300">{infoError}</p>}
          </div>
        ) : (
          <p className="text-[11px] text-white/35">Kein Objekt ausgewählt — zuerst ein Modell laden.</p>
        )}
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-line/60 px-4 py-3">
        <span className="text-[8px] leading-snug text-white/25">
          Nichts wird gedruckt oder hochgeladen. Aushöhlen ändert nur das Mesh und lässt sich rückgängig machen.
        </span>
        <button type="button" onClick={onClose} className="shrink-0 text-[10px] text-white/40 hover:text-white/70">
          Schließen
        </button>
      </div>
    </div>
    </PanelPortal>
  )
}
