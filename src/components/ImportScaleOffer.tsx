const mm = (value: number) => `${value < 1 ? value.toFixed(2) : value.toFixed(1)} mm`.replace('.', ',')

/**
 * Ein-Klick-Maßstab direkt nach dem Import (V-25).
 *
 * GLB aus der Scan-App und Engine-Ausgaben rechnen offiziell in Metern: Ein
 * 200-mm-Teil kommt dann als 0,2 mm an. Statt nur zu warnen, bietet diese
 * Leiste zwei bekannte Größen an — gleichmäßig skaliert, ohne Umrechnung im
 * Hintergrund. Sie erscheint nur bei auffällig kleinen Modellen.
 */
export function ImportScaleOffer({
  largest,
  busy,
  onScale,
  onClose,
}: {
  largest: number
  busy: boolean
  onScale: (targetMm: number) => void
  onClose: () => void
}) {
  return (
    <div className="mx-3 mt-2 flex flex-wrap items-center gap-2 rounded-xl border border-amber/35 bg-amber/8 px-3 py-1.5">
      <p className="min-w-0 flex-1 text-[10px] leading-snug text-amber/90">
        Größte Kante nur <span className="text-amber">{mm(largest)}</span> — bei GLB und Scan-Ausgaben
        heißt das meist Meter statt Millimeter. Ein Klick skaliert gleichmäßig auf:
      </p>
      <button
        type="button"
        disabled={busy}
        onClick={() => onScale(100)}
        className="shrink-0 rounded-lg border border-amber/50 bg-amber/15 px-2 py-1 text-[10px] font-semibold text-amber transition hover:bg-amber/25 disabled:opacity-40"
      >
        100 mm
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => onScale(200)}
        className="shrink-0 rounded-lg border border-line/70 px-2 py-1 text-[10px] text-white/70 transition hover:border-white/25 disabled:opacity-40"
      >
        200 mm
      </button>
      <button
        type="button"
        onClick={onClose}
        aria-label="Skalierungsvorschlag schließen"
        className="shrink-0 text-white/25 hover:text-white/70"
      >
        ✕
      </button>
    </div>
  )
}
