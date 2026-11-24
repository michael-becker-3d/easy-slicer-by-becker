import { useMemo } from 'react'
import type { BedMeshRecord } from '../../shared/types.ts'
import { diffBedMeshes } from '../../shared/mesh-diff.ts'

const fmt = (v: number) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(3)}`

const stamp = (at: number) =>
  new Date(at).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

/** Divergierend: blau = A liegt tiefer, rot = A liegt höher, neutral = unverändert. */
function diffColor(v: number, scale: number): string {
  const t = scale > 1e-6 ? Math.max(-1, Math.min(1, v / scale)) : 0
  if (Math.abs(t) < 0.04) return 'rgba(255,255,255,0.07)'
  const alpha = (0.12 + 0.82 * Math.abs(t)).toFixed(3)
  return t > 0 ? `rgba(229, 72, 77, ${alpha})` : `rgba(47, 143, 239, ${alpha})`
}

/** Differenz zweier Messungen A − B als Heatmap mit Kennwerten. */
export function MeshDiff({ a, b }: { a: BedMeshRecord; b: BedMeshRecord }) {
  const diff = useMemo(() => diffBedMeshes(a, b), [a, b])

  // Farbskala auf runde Millimeterwerte, damit kleine Änderungen sichtbar bleiben
  const scale = useMemo(() => {
    const step = diff.maxAbs > 0.2 ? 0.1 : diff.maxAbs > 0.05 ? 0.05 : diff.maxAbs > 0.02 ? 0.02 : 0.01
    return Math.max(step, Math.ceil((diff.maxAbs || step) / step) * step)
  }, [diff.maxAbs])

  return (
    <div className="mt-2 rounded-2xl border border-line/70 bg-ink-950/50 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-medium tracking-wider text-white/40 uppercase">Differenz A − B</span>
        <span className="tabular text-[9px] text-white/25">
          {diff.rows}×{diff.cols}
        </span>
      </div>

      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[9px] text-white/35">
        <span>
          <span className="font-semibold text-mint">A</span> {stamp(a.at)} · Mittel {a.mean.toFixed(3)} mm
        </span>
        <span>
          <span className="font-semibold text-sky">B</span> {stamp(b.at)} · Mittel {b.mean.toFixed(3)} mm
        </span>
      </div>

      <div
        className="mt-2 grid gap-[2px] rounded-xl border border-line/60 bg-ink-900/60 p-1"
        style={{ gridTemplateColumns: `repeat(${diff.cols}, minmax(0, 1fr))` }}
      >
        {diff.d.map((row, r) =>
          row.map((v, c) => (
            <div
              key={`${r}-${c}`}
              className="aspect-square rounded-[2px]"
              style={{ background: diffColor(v, scale) }}
              title={`Feld ${r + 1}/${c + 1}: ${fmt(v)} mm`}
            />
          )),
        )}
      </div>

      <div className="mt-2 flex items-center gap-2">
        <span className="tabular text-[9px] text-sky">{fmt(-scale)}</span>
        <div
          className="h-1.5 flex-1 rounded-full"
          style={{
            background:
              'linear-gradient(90deg, rgba(47,143,239,0.9), rgba(255,255,255,0.12), rgba(229,72,77,0.9))',
          }}
        />
        <span className="tabular text-[9px] text-rose">{fmt(scale)}</span>
      </div>
      <div className="mt-0.5 flex justify-between text-[8px] tracking-wide text-white/25 uppercase">
        <span>tiefer</span>
        <span>unverändert</span>
        <span>höher</span>
      </div>

      <div className="mt-2 grid grid-cols-4 gap-2">
        {[
          { k: 'max +', v: `${fmt(diff.maxRise)} mm`, tone: 'text-rose/90' },
          { k: 'max −', v: `${fmt(diff.maxDrop)} mm`, tone: 'text-sky/90' },
          { k: 'Mittel |Δ|', v: `${diff.meanAbs.toFixed(3)} mm`, tone: 'text-white/80' },
          { k: 'RMS', v: `${diff.rms.toFixed(3)} mm`, tone: 'text-white/80' },
        ].map((s) => (
          <div key={s.k} className="rounded-lg border border-line/60 bg-ink-900/50 px-2 py-1">
            <div className="text-[9px] text-white/30">{s.k}</div>
            <div className={`tabular text-[11px] font-semibold ${s.tone}`}>{s.v}</div>
          </div>
        ))}
      </div>

      {diff.resampled && (
        <p className="mt-2 text-[9px] leading-snug text-white/25">
          Unterschiedliche Raster ({a.rows}×{a.cols} gegenüber {b.rows}×{b.cols}) — B wurde bilinear auf das Raster von A
          umgerechnet.
        </p>
      )}

      {diff.maxAbs > 0.05 ? (
        <p className="mt-2 rounded-lg border border-amber/30 bg-amber/8 px-2 py-1 text-[9px] leading-snug text-amber/90">
          Bis zu {diff.maxAbs.toFixed(3)} mm Veränderung an einer Stelle — Bett reinigen bzw. neu vermessen, bevor du
          weiterdruckst.
        </p>
      ) : (
        <p className="mt-2 text-[9px] leading-snug text-white/25">
          Unter 0,05 mm: das Bett liegt praktisch unverändert.
        </p>
      )}
    </div>
  )
}
