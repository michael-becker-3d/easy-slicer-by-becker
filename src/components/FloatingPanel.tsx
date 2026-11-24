import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import { currentUiScale } from '../uiScale.ts'

type Offset = { x: number; y: number }

type Bounds = {
  minX: number
  maxX: number
  minY: number
  maxY: number
}

type DragState = {
  pointerId: number
  startX: number
  startY: number
  origin: Offset
  bounds: Bounds
  zoom: number
}

type FloatingPanelContextValue = {
  dragging: boolean
  moved: boolean
  reset: () => void
  handleProps: {
    onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => void
    onPointerMove: (event: ReactPointerEvent<HTMLButtonElement>) => void
    onPointerUp: (event: ReactPointerEvent<HTMLButtonElement>) => void
    onPointerCancel: (event: ReactPointerEvent<HTMLButtonElement>) => void
    onDoubleClick: () => void
  }
}

const FloatingPanelContext = createContext<FloatingPanelContextValue | null>(null)
const STORAGE_PREFIX = 'kepler.floating-panel.'
const EDGE_MARGIN = 8

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function loadOffset(storageKey: string): Offset {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + storageKey)
    if (!raw) return { x: 0, y: 0 }
    const parsed = JSON.parse(raw) as Partial<Offset>
    const x = Number(parsed.x)
    const y = Number(parsed.y)
    if (!Number.isFinite(x) || !Number.isFinite(y)) return { x: 0, y: 0 }
    return { x: clamp(x, -4000, 4000), y: clamp(y, -4000, 4000) }
  } catch {
    return { x: 0, y: 0 }
  }
}

function saveOffset(storageKey: string, offset: Offset): void {
  try {
    localStorage.setItem(STORAGE_PREFIX + storageKey, JSON.stringify(offset))
  } catch {
    /* Privater Modus oder voller Speicher — Verschieben funktioniert trotzdem. */
  }
}

/**
 * Freiraum in CSS-Pixeln, den das Panel ab seiner aktuellen Position noch
 * innerhalb der Vorschaufläche hat. getBoundingClientRect() liefert durch den
 * CSS-Zoom bereits Gerätepixel, deshalb wird der Wert wieder durch den
 * Zoomfaktor geteilt.
 */
function measureBounds(panel: HTMLElement): Bounds | null {
  const stage = panel.closest('[data-preview-stage]')
  if (!(stage instanceof HTMLElement)) return null
  const panelRect = panel.getBoundingClientRect()
  const stageRect = stage.getBoundingClientRect()
  const zoom = currentUiScale()
  return {
    minX: (stageRect.left + EDGE_MARGIN - panelRect.left) / zoom,
    maxX: (stageRect.right - EDGE_MARGIN - panelRect.right) / zoom,
    minY: (stageRect.top + EDGE_MARGIN - panelRect.top) / zoom,
    maxY: (stageRect.bottom - EDGE_MARGIN - panelRect.bottom) / zoom,
  }
}

function clampDelta(value: number, min: number, max: number): number {
  const lower = Math.min(min, max)
  const upper = Math.max(min, max)
  return clamp(value, lower, upper)
}

/**
 * Overlay, das sich über einen Griff in seinem Inhalt verschieben lässt.
 * Die Position bleibt relativ zur eingebauten Ecke gespeichert und wird bei
 * jeder Bewegung innerhalb der Vorschaufläche gehalten.
 */
export function FloatingPanel({
  storageKey,
  className = '',
  children,
}: {
  storageKey: string
  className?: string
  children: ReactNode
}) {
  const [offset, setOffset] = useState<Offset>(() => loadOffset(storageKey))
  const [dragging, setDragging] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const offsetRef = useRef(offset)
  const dragRef = useRef<DragState | null>(null)

  const commitOffset = useCallback((next: Offset) => {
    offsetRef.current = next
    setOffset(next)
  }, [])

  const reset = useCallback(() => {
    const zero = { x: 0, y: 0 }
    commitOffset(zero)
    saveOffset(storageKey, zero)
  }, [commitOffset, storageKey])

  // Beim Start und nach Fenster-/Inhaltsänderungen wieder in die Vorschau
  // schieben. Die Messung erfolgt nach dem Layout, damit die Panelgröße schon
  // der neuen Breite entspricht.
  useEffect(() => {
    const panel = panelRef.current
    if (!panel) return
    const keepVisible = () => {
      const bounds = measureBounds(panel)
      if (!bounds) return
      const current = offsetRef.current
      const next = {
        x: current.x + clampDelta(0, bounds.minX, bounds.maxX),
        y: current.y + clampDelta(0, bounds.minY, bounds.maxY),
      }
      if (next.x !== current.x || next.y !== current.y) commitOffset(next)
    }
    keepVisible()
    window.addEventListener('resize', keepVisible)
    const observer =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(keepVisible)
    observer?.observe(panel)
    return () => {
      window.removeEventListener('resize', keepVisible)
      observer?.disconnect()
    }
  }, [commitOffset])

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return
    const panel = panelRef.current
    if (!panel) return
    const bounds = measureBounds(panel)
    if (!bounds) return
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      origin: offsetRef.current,
      bounds,
      zoom: currentUiScale(),
    }
    setDragging(true)
  }, [])

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      const drag = dragRef.current
      if (!drag || drag.pointerId !== event.pointerId) return
      event.preventDefault()
      const dx = (event.clientX - drag.startX) / drag.zoom
      const dy = (event.clientY - drag.startY) / drag.zoom
      commitOffset({
        x: drag.origin.x + clampDelta(dx, drag.bounds.minX, drag.bounds.maxX),
        y: drag.origin.y + clampDelta(dy, drag.bounds.minY, drag.bounds.maxY),
      })
    },
    [commitOffset],
  )

  const finishDrag = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      const drag = dragRef.current
      if (!drag || drag.pointerId !== event.pointerId) return
      dragRef.current = null
      setDragging(false)
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId)
      }
      saveOffset(storageKey, offsetRef.current)
    },
    [storageKey],
  )

  const moved = Math.abs(offset.x) > 0.5 || Math.abs(offset.y) > 0.5
  const context: FloatingPanelContextValue = {
    dragging,
    moved,
    reset,
    handleProps: {
      onPointerDown,
      onPointerMove,
      onPointerUp: finishDrag,
      onPointerCancel: finishDrag,
      onDoubleClick: reset,
    },
  }

  return (
    <div
      ref={panelRef}
      className={`pointer-events-auto ${className}`}
      style={{ transform: `translate3d(${offset.x}px, ${offset.y}px, 0)` }}
    >
      <FloatingPanelContext.Provider value={context}>{children}</FloatingPanelContext.Provider>
    </div>
  )
}

/** Griff für die Kopfzeile eines Panels; ohne FloatingPanel unsichtbar. */
export function FloatingPanelHandle({ label }: { label: string }) {
  const context = useContext(FloatingPanelContext)
  if (!context) return null
  return (
    <>
      <button
        type="button"
        {...context.handleProps}
        onClick={(event) => event.stopPropagation()}
        title="Ziehen zum Verschieben · Doppelklick setzt die Position zurück"
        aria-label={`${label} verschieben. Doppelklick setzt die Position zurück.`}
        className={`grid h-5 w-5 shrink-0 touch-none place-items-center rounded text-[13px] leading-none transition hover:bg-white/10 ${
          context.dragging
            ? 'cursor-grabbing bg-white/10 text-amber'
            : context.moved
              ? 'cursor-grab text-amber/80'
              : 'cursor-grab text-white/35 hover:text-white'
        }`}
      >
        ⠿
      </button>
      {context.moved && (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation()
            context.reset()
          }}
          title="Panel an die Ausgangsposition zurücksetzen"
          aria-label={`${label} an die Ausgangsposition zurücksetzen`}
          className="grid h-5 w-5 shrink-0 place-items-center rounded text-[12px] leading-none text-white/35 transition hover:bg-white/10 hover:text-amber"
        >
          ↺
        </button>
      )}
    </>
  )
}
