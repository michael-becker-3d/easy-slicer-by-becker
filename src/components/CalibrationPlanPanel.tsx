import { useMemo, useState } from 'react'
import type { CalibrationTool, PreviewLayer, PrintSettings } from '../../shared/types.ts'
import {
  buildCalibrationPlan,
  calibrationLayerRange,
  calibrationSpeedHint,
} from '../viewer/calibrationPlan.ts'

type Props = {
  tool: CalibrationTool
  result: { layers: PreviewLayer[]; stats: { layerCount: number } } | null
  layer: number
  settings?: PrintSettings
  /** SCV wirkt nur auf Klipper; auf anderen Firmwares bleibt der Hinweis bei der Geometrie. */
  scvActive?: boolean
  onLayer: (index: number) => void
  onClose: () => void
}

function statusClass(ok: boolean): string {
  return ok ? 'border-mint/40 bg-mint/10 text-mint' : 'border-amber/40 bg-amber/10 text-amber'
}

/**
 * Vollständiger Kalibrierplan in der Vorschau. Die aktive Stufe folgt der
 * aktuellen Schicht; ein Klick springt auf die erste Schicht der Stufe.
 */
export function CalibrationPlanPanel({
  tool,
  result,
  layer,
  settings,
  scvActive = false,
  onLayer,
  onClose,
}: Props) {
  const [open, setOpen] = useState(true)
  const plan = useMemo(
    () => buildCalibrationPlan(tool, result?.layers ?? [], layer, result?.stats.layerCount),
    [tool, result?.layers, result?.stats.layerCount, layer],
  )
  const speedHint = useMemo(
    () => calibrationSpeedHint(plan, tool.id, settings, scvActive),
    [plan, tool.id, settings, scvActive],
  )
  const active = plan.steps.find((step) => step.active)
  const hasSlice = Boolean(result)
  const neutralStatus = 'border-line/70 bg-ink-900/50 text-white/45'

  return (
    <div className="pointer-events-auto relative z-30 w-[260px] max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-xl border border-amber/35 bg-ink-950/92 shadow-2xl backdrop-blur-md">
      <div className="flex items-center gap-1.5 border-b border-amber/25 px-2.5 py-1.5">
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber shadow-[0_0_7px_rgba(245,190,90,0.8)]" />
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-semibold tracking-wide text-amber/90 uppercase">Kalibrierplan</div>
          <div className="truncate text-[8px] text-white/35" title={tool.label}>
            {tool.label}
          </div>
        </div>
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="grid h-5 w-5 place-items-center rounded text-[11px] text-white/40 transition hover:bg-white/10 hover:text-white"
          aria-label={open ? 'Kalibrierplan einklappen' : 'Kalibrierplan ausklappen'}
          aria-expanded={open}
        >
          {open ? '−' : '+'}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="grid h-5 w-5 place-items-center rounded text-[12px] text-white/35 transition hover:bg-white/10 hover:text-white"
          aria-label="Kalibrierplan schließen"
        >
          ×
        </button>
      </div>

      {open && (
        <>
          <div className="border-b border-line/50 px-2.5 py-2">
            <div className="flex flex-wrap gap-1">
              <span className={`rounded border px-1.5 py-0.5 text-[8px] ${hasSlice ? statusClass(plan.stagesOk) : neutralStatus}`}>
                {hasSlice ? `Stufen ${plan.stagesInSlice}/${plan.plannedStages}` : `${plan.plannedStages} Stufen geplant`}
              </span>
              <span className={`rounded border px-1.5 py-0.5 text-[8px] ${hasSlice ? statusClass(plan.layersOk) : neutralStatus}`}>
                {hasSlice
                  ? `Schichten ${plan.slicedLayers}/${plan.plannedLayers ?? '—'}`
                  : `${plan.plannedLayers ?? '—'} Schichten geplant`}
              </span>
            </div>
            <div className="mt-1.5 flex items-center justify-between gap-2 text-[8px] text-white/35">
              <span>{result ? 'Aktive Stufe' : 'Noch nicht geslict'}</span>
              <span className="truncate text-right text-amber/85" title={active?.label}>
                {result ? (active?.value ?? 'Vorstufe / Sockel') : '—'}
              </span>
            </div>
          </div>

          {speedHint && (
            <div
              className={`border-b px-2.5 py-2 text-[8px] leading-snug ${
                speedHint.limitedStages.length
                  ? 'border-amber/25 bg-amber/[0.06] text-amber/80'
                  : 'border-sky/20 bg-sky/[0.04] text-sky/70'
              }`}
            >
              <div className="font-semibold tracking-wide uppercase">Tempo-Hinweis</div>
              <p className="mt-0.5">{speedHint.text}</p>
              {speedHint.limitedStages.length > 0 && (
                <p className="mt-1 text-amber/85">
                  Im Slice:{
                    speedHint.limitedStages.slice(0, 3).map((stage) =>
                      ` Stufe ${stage.index + 1} ${Math.round(stage.observed)} statt ${Math.round(stage.expected)} mm/s`,
                    )
                  }
                  {speedHint.limitedStages.length > 3 ? ' …' : ''}
                </p>
              )}
            </div>
          )}

          {plan.steps.length ? (
            <div className="max-h-[260px] overflow-y-auto py-1">
              {plan.steps.map((step) => {
                const canJump = step.startLayer !== null
                return (
                  <button
                    key={`${step.index}-${step.label}`}
                    type="button"
                    disabled={!canJump}
                    onClick={() => canJump && onLayer(step.startLayer!)}
                    aria-current={step.active ? 'step' : undefined}
                    title={`${step.label} · ${step.value}${canJump ? ` · ${calibrationLayerRange(step)}` : ' · nicht im Slice'}`}
                    className={`flex w-full items-start gap-2 border-l-2 px-2 py-1 text-left transition ${
                      step.active
                        ? 'border-amber bg-amber/12'
                        : 'border-transparent hover:bg-white/[0.05] disabled:opacity-35'
                    }`}
                  >
                    <span
                      className={`tabular mt-0.5 w-4 shrink-0 text-right text-[8px] ${
                        step.active ? 'text-amber' : 'text-white/30'
                      }`}
                    >
                      {step.index + 1}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={`block text-[9px] font-medium ${step.active ? 'text-amber/95' : 'text-white/75'}`}>
                        {step.value}
                      </span>
                      <span className="mt-0.5 block break-words text-[8px] leading-snug text-white/35">
                        {step.label}
                      </span>
                      {step.expectedSpeed !== undefined &&
                        step.observedMaxSpeed !== null &&
                        step.observedMaxSpeed > 0 &&
                        step.observedMaxSpeed < step.expectedSpeed * 0.985 && (
                          <span className="mt-0.5 block text-[8px] leading-snug text-amber/80">
                            Im Slice {Math.round(step.observedMaxSpeed)} statt{' '}
                            {Math.round(step.expectedSpeed)} mm/s — Sollwert der Stufe
                          </span>
                        )}
                    </span>
                    <span className="tabular mt-0.5 shrink-0 text-[8px] text-white/40">
                      {calibrationLayerRange(step)}
                    </span>
                  </button>
                )
              })}
            </div>
          ) : (
            <p className="px-2.5 py-2 text-[9px] leading-snug text-white/35">
              Keine Stufen — dieser Test prüft eine einzelne Wand über alle Schichten.
            </p>
          )}
        </>
      )}
    </div>
  )
}