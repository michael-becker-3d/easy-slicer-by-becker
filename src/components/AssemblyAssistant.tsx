import { useMemo, useState } from 'react'
import { PanelPortal } from './PanelPortal.tsx'
import type { ModelObjectInfo } from '../../shared/types.ts'
import {
  planAssembly,
  type AssemblyLoad,
  type AssemblyMaterial,
  type AssemblyPlan,
} from '../../shared/assembly.ts'

const MATERIALS: { id: AssemblyMaterial; label: string }[] = [
  { id: 'pla', label: 'PLA' },
  { id: 'petg', label: 'PETG' },
  { id: 'abs', label: 'ABS' },
  { id: 'asa', label: 'ASA' },
  { id: 'tpu', label: 'TPU' },
]

const LOADS: { id: AssemblyLoad; label: string; hint: string }[] = [
  { id: 'light', label: 'Leicht', hint: 'Deko, Abdeckung, Halter ohne Zug' },
  { id: 'normal', label: 'Normal', hint: 'Gehäuse, Griff, Alltagsteil' },
  { id: 'heavy', label: 'Hoch', hint: 'Trägt Gewicht oder wird oft belastet' },
]

const CONNECTOR_LABEL: Record<AssemblyPlan['connector'], string> = {
  none: 'kein Verbinder',
  pin: 'Zapfen',
  dovetail: 'Schwalbenschwanz',
  puzzle: 'Puzzle / T-Nut',
  tongue: 'Nut / Feder',
  bayonet: 'Bajonett',
  thread: 'Schraubgewinde',
  undercut: 'Hinterschnitt / Rastnase',
}

function Explosion({ plan, size }: { plan: AssemblyPlan; size: { x: number; y: number; z: number } }) {
  const total = Math.max(1, plan.eachExtent * plan.pieces)
  const scale = 250 / total
  const pieceW = Math.max(6, plan.eachExtent * scale)
  const gap = Math.max(3, plan.explodeGap * scale)
  const width = pieceW * plan.pieces + gap * (plan.pieces - 1)
  const height = 96
  const rectH = Math.max(14, Math.min(54, (plan.axis === 'z' ? size.x : size.z) * 1.8))
  const top = (height - rectH) / 2

  return (
    <svg viewBox={`0 0 ${Math.max(280, width + 20)} ${height}`} className="h-24 w-full" role="img" aria-label="Explosionsansicht der Teile">
      {Array.from({ length: plan.pieces }, (_, index) => {
        const x = 10 + index * (pieceW + gap)
        return (
          <g key={index}>
            <rect
              x={x}
              y={top}
              width={pieceW}
              height={rectH}
              rx={2}
              className="fill-amber/15 stroke-amber/70"
              strokeWidth={1}
            />
            <text x={x + pieceW / 2} y={top + rectH / 2 + 3} textAnchor="middle" className="fill-white/60 text-[8px]">
              {index + 1}
            </text>
          </g>
        )
      })}
      <line x1={10} y1={height - 7} x2={10 + width} y2={height - 7} className="stroke-white/20" strokeWidth={0.8} />
      <text x={10 + width / 2} y={height - 1} textAnchor="middle" className="fill-white/30 text-[7px]">
        {plan.pieces === 1
          ? 'ungeteilt'
          : `${plan.pieces} Teile · je ${plan.eachExtent.toFixed(1).replace('.', ',')} mm · Explosion ${plan.explodeGap.toFixed(0)} mm`}
      </text>
    </svg>
  )
}

/**
 * Montage-Assistent (V-20): Schnittachse, Teilung, Verbinder und Passung aus
 * Bettgröße, Belastung und Werkstoff. Das Ergebnis lässt sich direkt in den
 * Teilen-Dialog übernehmen; die Passung stammt aus dem Kalibrier-Kreislauf.
 */
export function AssemblyAssistant({
  objects,
  bed,
  tolerance,
  initialId,
  onApply,
  onClose,
}: {
  objects: ModelObjectInfo[]
  bed: { x: number; y: number; z: number }
  /** Gemessene Passung aus V-18 in mm. */
  tolerance: number
  initialId?: string
  onApply: (plan: AssemblyPlan, object: ModelObjectInfo) => void
  onClose: () => void
}) {
  const [objectId, setObjectId] = useState(initialId ?? objects[0]?.id ?? '')
  const object = objects.find((entry) => entry.id === objectId) ?? objects[0] ?? null
  const [material, setMaterial] = useState<AssemblyMaterial>('pla')
  const [load, setLoad] = useState<AssemblyLoad>('normal')
  const [forceSplit, setForceSplit] = useState(false)

  const plan = useMemo(
    () =>
      object
        ? planAssembly({
            size: object.size,
            bed,
            material,
            load,
            tolerance,
            forceSplit,
          })
        : null,
    [object, bed, material, load, tolerance, forceSplit],
  )

  return (
    <PanelPortal>
      <div
      className="fixed inset-y-0 right-0 z-50 flex w-[460px] max-w-full flex-col border-l border-line/80 bg-ink-900/97 shadow-2xl backdrop-blur-xl"
      role="dialog"
      aria-modal="true"
      aria-label="Montage-Assistent"
    >
      <div className="flex items-start justify-between gap-3 border-b border-line/60 px-4 py-3">
        <div>
          <h3 className="text-sm font-semibold text-white/85">Montage-Assistent</h3>
          <p className="mt-0.5 text-[10px] leading-snug text-white/35">
            Schnittachse, Teilung und Verbinder aus Bett, Belastung und Werkstoff — mit Begründung und Explosionsschema.
          </p>
        </div>
        <button type="button" onClick={onClose} className="text-white/30 transition hover:text-white/70" aria-label="Schließen">
          ✕
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {object && plan ? (
          <div className="space-y-3">
            {objects.length > 1 && (
              <label className="block">
                <span className="mb-1 block text-[9px] tracking-wider text-white/40 uppercase">Objekt</span>
                <select
                  value={objectId}
                  onChange={(event) => setObjectId(event.target.value)}
                  className="w-full rounded-lg border border-line/80 bg-ink-900/70 px-2 py-1.5 text-[11px] text-white/80 outline-none focus:border-amber/60"
                >
                  {objects.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.name} · {entry.size.x.toFixed(0)}×{entry.size.y.toFixed(0)}×{entry.size.z.toFixed(0)} mm
                    </option>
                  ))}
                </select>
              </label>
            )}

            <div className="rounded-xl border border-line/60 bg-ink-950/40 p-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[9px] font-semibold tracking-wider text-white/45 uppercase">Explosion</span>
                <span className="text-[9px] text-white/30">
                  Achse {plan.axis.toUpperCase()} · {plan.pieces} Teil{plan.pieces === 1 ? '' : 'e'}
                </span>
              </div>
              <Explosion plan={plan} size={object.size} />
              <div className="grid grid-cols-3 gap-1.5 text-center">
                {[
                  { k: 'Verbinder', v: CONNECTOR_LABEL[plan.connector] },
                  { k: 'Passung', v: `${plan.clearance.toFixed(2).replace('.', ',')} mm` },
                  { k: 'Verbinderluft', v: `${plan.connectorClearance.toFixed(2).replace('.', ',')} mm` },
                ].map((entry) => (
                  <div key={entry.k} className="rounded-lg border border-line/60 bg-ink-900/50 px-1 py-1">
                    <div className="text-[8px] text-white/30">{entry.k}</div>
                    <div className="truncate text-[10px] font-semibold text-white/80">{entry.v}</div>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <span className="mb-1 block text-[9px] tracking-wider text-white/40 uppercase">Werkstoff</span>
              <select
                value={material}
                onChange={(event) => setMaterial(event.target.value as AssemblyMaterial)}
                className="w-full rounded-lg border border-line/80 bg-ink-900/70 px-2 py-1.5 text-[11px] text-white/80 outline-none focus:border-amber/60"
              >
                {MATERIALS.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <span className="mb-1 block text-[9px] tracking-wider text-white/40 uppercase">Belastung</span>
              <div className="grid grid-cols-3 gap-1.5">
                {LOADS.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    onClick={() => setLoad(entry.id)}
                    title={entry.hint}
                    className={`rounded-lg border px-1.5 py-1.5 text-[10px] transition ${
                      load === entry.id
                        ? 'border-amber/60 bg-amber/12 text-amber'
                        : 'border-line/70 text-white/50 hover:border-white/20'
                    }`}
                  >
                    {entry.label}
                  </button>
                ))}
              </div>
            </div>

            <label className="flex items-center gap-2 text-[10px] text-white/50">
              <input
                type="checkbox"
                checked={forceSplit}
                onChange={(event) => setForceSplit(event.target.checked)}
                className="accent-amber"
              />
              Auch ein passendes Teil teilen (kürzere Wege, weniger Verzug)
            </label>

            <p className="rounded-lg border border-line/60 bg-ink-950/40 px-2 py-1.5 text-[9px] leading-snug text-white/35">
              Passung aus dem Kalibrier-Kreislauf: {tolerance.toFixed(2).replace('.', ',')} mm
              {tolerance === 0 ? ' (noch keine Messung — Standardwert)' : ''}. Der Werkstoff schlägt zusätzlich Aufmaß auf.
            </p>

            <ul className="space-y-1">
              {plan.reasons.map((reason, index) => (
                <li key={index} className="flex gap-1.5 text-[10px] leading-snug text-white/60">
                  <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-mint/70" aria-hidden="true" />
                  <span>{reason}</span>
                </li>
              ))}
            </ul>

            {plan.warnings.length > 0 && (
              <ul className="space-y-1 rounded-lg border border-amber/30 bg-amber/[0.05] px-2 py-1.5">
                {plan.warnings.map((warning, index) => (
                  <li key={index} className="text-[9px] leading-snug text-amber/85">
                    {warning}
                  </li>
                ))}
              </ul>
            )}

            {plan.pieces > 1 && (
              <div className="grid grid-cols-3 gap-1.5 text-center">
                {[
                  { k: 'Zapfenbreite', v: `${plan.pinWidth.toFixed(1).replace('.', ',')} mm` },
                  { k: 'Zapfenlänge', v: `${plan.pinLength.toFixed(1).replace('.', ',')} mm` },
                  { k: 'Zapfen', v: `${plan.pinCount} × ${plan.pinHeight} mm` },
                ].map((entry) => (
                  <div key={entry.k} className="rounded-lg border border-line/60 bg-ink-900/50 px-1 py-1">
                    <div className="text-[8px] text-white/30">{entry.k}</div>
                    <div className="text-[10px] font-semibold text-white/80">{entry.v}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <p className="text-[11px] text-white/35">Kein Objekt ausgewählt — zuerst ein Modell laden.</p>
        )}
      </div>

      <div className="flex items-center justify-end gap-2 border-t border-line/60 px-4 py-3">
        <button type="button" onClick={onClose} className="text-[10px] text-white/40 hover:text-white/70">
          Abbrechen
        </button>
        <button
          type="button"
          disabled={!object || !plan || plan.pieces < 2}
          onClick={() => {
            if (object && plan) onApply(plan, object)
          }}
          className="rounded-lg bg-gradient-to-r from-amber to-[#ffcf7a] px-3 py-1.5 text-[10px] font-semibold text-ink-950 transition hover:brightness-110 disabled:opacity-40"
        >
          {plan && plan.pieces < 2 ? 'Kein Schnitt nötig' : 'In Teilen-Dialog übernehmen'}
        </button>
      </div>
    </div>
    </PanelPortal>
  )
}
