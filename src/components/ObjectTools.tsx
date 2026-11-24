import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { PanelPortal } from './PanelPortal.tsx'
import type {
  LithophaneShape,
  ModelAnalysis,
  ModelObjectInfo,
  ModelPlacement,
} from '../../shared/types.ts'
import * as api from '../api.ts'
import type { UploadedModel } from '../api.ts'
import { sameVec3, transformBase, transformFields, transformPatch, type ObjectTransformPatch } from '../../shared/objectTransform.ts'
import { currentUiScale } from '../uiScale.ts'
import { SHAPE_CATEGORIES, SHAPE_LIBRARY, type ShapeCategory, type ShapePreview } from '../../shared/shapes.ts'
import { Stepper } from './ui.tsx'

export { SHAPE_LIBRARY }

export type ToolId =
  | 'transform'
  | 'cut'
  | 'text'
  | 'litho'
  | 'assembly'
  | 'scan'
  | 'scanimport'
  | 'scanstart'

export type MenuAction =
  | 'add'
  | 'load'
  | 'litho'
  | 'transform'
  | 'text'
  | 'cut'
  | 'undo'
  | 'redo'
  | 'duplicate'
  | 'delete'
  | 'clear'
  | 'merge'
  | 'arrange'
  | 'orient'
  | 'center'
  | 'bed'
  | 'repair'
  | 'separate'
  | 'addplate'
  | 'removeplate'
  | 'assembly'
  | 'scan'
  | 'scanimport'
  | 'scanstart'

type MenuEntry = { id: MenuAction; label: string; hint?: string; needsModel?: boolean }
type MenuGroup = { label: string; items: MenuEntry[] }

type ShapeTab = keyof typeof SHAPE_LIBRARY

/** Kleine, einheitliche Vorschausymbole für die Extra-Formen. */
function ShapeGlyph({ kind }: { kind: ShapePreview }) {
  const stroke = {
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.5,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  }
  return (
    <svg viewBox="0 0 32 32" className="h-7 w-7 shrink-0 text-amber/80" aria-hidden="true">
      {kind === 'cube' && (
        <>
          <path d="M6 11l10-5 10 5v10l-10 5-10-5z" {...stroke} />
          <path d="M6 11l10 5 10-5M16 16v10" {...stroke} />
        </>
      )}
      {kind === 'cube-top' && (
        <>
          <path d="M6 11l10-5 10 5v10l-10 5-10-5z" {...stroke} />
          <path d="M6 11l10 5 10-5M16 16v10M11 8.5l5 2.5 5-2.5M16 11v5" {...stroke} />
        </>
      )}
      {kind === 'boat' && (
        <>
          <path d="M4 20h24l-4 6H8z" {...stroke} />
          <path d="M10 20v-7h8v7M15 13V9h5" {...stroke} />
        </>
      )}
      {kind === 'bridge' && (
        <>
          <path d="M5 27V12h5v15M22 27V12h5v15M5 12h22M5 27h22" {...stroke} />
          <path d="M10 17h12" {...stroke} />
        </>
      )}
      {kind === 'tower' && (
        <>
          <path d="M12 28V7h8v21M9 28h14M14 4h4" {...stroke} />
          <path d="M12 16h8M12 22h8" {...stroke} />
        </>
      )}
      {kind === 'clip' && (
        <>
          <path d="M8 27V11h4v10h8V11h4v16" {...stroke} />
          <path d="M12 11h3M17 11h3" {...stroke} />
        </>
      )}
      {kind === 'hook' && (
        <>
          <path d="M7 27V7h7v5h-3v9h7v6" {...stroke} />
          <path d="M11 9h7" {...stroke} />
        </>
      )}
      {kind === 'tag' && (
        <>
          <circle cx="10" cy="16" r="6" {...stroke} />
          <circle cx="10" cy="16" r="2" {...stroke} />
          <path d="M16 12h11v8H16" {...stroke} />
        </>
      )}
      {kind === 'coaster' && (
        <>
          <circle cx="16" cy="16" r="11" {...stroke} />
          <circle cx="16" cy="16" r="7" {...stroke} />
        </>
      )}
    </svg>
  )
}

const MENU: MenuGroup[] = [
  {
    label: 'Datei',
    items: [
      { id: 'add', label: 'Objekt hinzufügen …', hint: 'zum Werkstück', needsModel: true },
      { id: 'load', label: 'Objekt laden …', hint: 'neues Werkstück' },
      { id: 'litho', label: 'Lithophan-Lampe …', hint: 'Bild → Lampenschirm' },
      { id: 'scanstart', label: 'Scan starten …', hint: 'Fotos oder Video → druckbares Mesh' },
      { id: 'scanimport', label: 'Scan-Ordner laden …', hint: 'Meshroom, COLMAP, openMVS, MicMac' },
    ],
  },
  {
    label: 'Objekt',
    items: [
      { id: 'transform', label: 'Größe / Position …', needsModel: true },
      { id: 'text', label: 'Text aufbringen …', hint: 'erhaben auf die Oberseite', needsModel: true },
      { id: 'duplicate', label: 'Duplizieren', needsModel: true },
      { id: 'delete', label: 'Löschen', needsModel: true },
      { id: 'clear', label: 'Alles löschen', hint: 'Platte komplett leeren', needsModel: true },
    ],
  },
  {
    label: 'Anordnen',
    items: [
      { id: 'bed', label: 'Auf Platte legen', needsModel: true },
      { id: 'center', label: 'Auf Bettmitte zentrieren', needsModel: true },
      { id: 'orient', label: 'Automatisch ausrichten', hint: 'größte Auflagefläche', needsModel: true },
      { id: 'arrange', label: 'Alle Objekte anordnen', needsModel: true },
      { id: 'merge', label: 'Zusammenbauen', hint: 'ausgewählte Teile verbinden', needsModel: true },
    ],
  },
  {
    label: 'Bearbeiten',
    items: [
      { id: 'separate', label: 'In Einzelteile trennen', hint: 'mehrere Körper zu eigenen Objekten', needsModel: true },
      { id: 'repair', label: 'Mesh reparieren', hint: 'offene Kanten und Löcher schließen', needsModel: true },
      { id: 'cut', label: 'Teilen …', hint: 'in Stücke mit Verbindern', needsModel: true },
      { id: 'assembly', label: 'Montage-Assistent …', hint: 'Schnitt, Verbinder, Passung', needsModel: true },
      { id: 'scan', label: 'Scan-Assistent …', hint: 'Scan prüfen, Maßstab, aushöhlen', needsModel: true },
    ],
  },
  {
    label: 'Platte',
    items: [
      { id: 'addplate', label: 'Platte hinzufügen', hint: 'leere Platte rechts anlegen', needsModel: true },
      { id: 'removeplate', label: 'Platte löschen', hint: 'mit allen Objekten darauf', needsModel: true },
    ],
  },
]

/** Rechtsklick-Menü in der Slicer-Mitte — wie bei OrcaSlicer. */
export function ObjectContextMenu({
  x,
  y,
  hasModel,
  plates,
  onPick,
  onShape,
  onClose,
}: {
  x: number
  y: number
  hasModel: boolean
  /** Anzahl der Platten — „Platte löschen“ nur bei mehreren anbieten. */
  plates: number
  onPick: (action: MenuAction) => void
  /** Form direkt auf die angeklickte Platte legen. */
  onShape?: (shapeId: string) => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [shapeTab, setShapeTab] = useState<ShapeTab>('standard')
  const [extraCategory, setExtraCategory] = useState<ShapeCategory>('Testkörper')
  const shapes =
    shapeTab === 'extra'
      ? SHAPE_LIBRARY.extra.filter((shape) => shape.category === extraCategory)
      : SHAPE_LIBRARY.standard
  const scale = currentUiScale()
  const [position, setPosition] = useState(() => ({
    left: Math.max(8, Math.min(x / scale, window.innerWidth / scale - 272)),
    top: Math.max(8, Math.min(y / scale, window.innerHeight / scale - 520)),
  }))

  // Erst nach dem Rendern kennen wir die echte Höhe. Das Menü bleibt so
  // vollständig im Fenster und scrollt bei kleinen Viewports innerlich.
  useLayoutEffect(() => {
    const place = () => {
      const el = ref.current
      if (!el) return
      const margin = 8
      const rect = el.getBoundingClientRect()
      setPosition({
        left: Math.max(
          margin,
          Math.min(x / scale, window.innerWidth / scale - rect.width / scale - margin),
        ),
        top: Math.max(
          margin,
          Math.min(y / scale, window.innerHeight / scale - rect.height / scale - margin),
        ),
      })
    }
    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [scale, x, y])

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  return (
    <div
      ref={ref}
      className="ui-max-h-menu fixed z-50 flex w-[264px] flex-col overflow-hidden rounded-xl border border-line/80 bg-ink-900/95 text-left shadow-2xl backdrop-blur-xl"
      style={position}
      role="menu"
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
      }}
    >
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
      {MENU.map((group, gi) => (
        <div key={group.label} className={gi ? 'border-t border-line/60' : ''}>
          <div className="px-2.5 pt-2 pb-1 text-[8px] font-semibold tracking-[0.18em] text-white/25 uppercase">
            {group.label}
          </div>
          {group.items
            .filter((item) => item.id !== 'removeplate' || plates > 1)
            .map((item) => {
              const disabled = Boolean(item.needsModel) && !hasModel
              return (
                <button
                  key={item.id}
                  type="button"
                  role="menuitem"
                  disabled={disabled}
                  onClick={() => {
                    onClose()
                    onPick(item.id)
                  }}
                  className="flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-left text-[11px] text-white/75 transition hover:bg-amber/10 hover:text-amber disabled:cursor-not-allowed disabled:text-white/20 disabled:hover:bg-transparent"
                >
                  <span>{item.label}</span>
                  {item.hint && <span className="truncate text-[8px] text-white/25">{item.hint}</span>}
                </button>
              )
            })}
        </div>
      ))}
      </div>
      {onShape && (
        <div className="shrink-0 border-t border-line/60 bg-ink-950/35 px-2 py-2">
          <div className="mb-1.5 flex items-center gap-1.5">
            <span className="text-[8px] font-semibold tracking-[0.16em] text-white/25 uppercase">Formen</span>
            <div className="ml-auto flex rounded-md border border-line/70 p-0.5">
              {(['standard', 'extra'] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setShapeTab(tab)}
                  className={`rounded px-1.5 py-0.5 text-[9px] transition ${
                    shapeTab === tab ? 'bg-amber/20 text-amber' : 'text-white/40 hover:text-white'
                  }`}
                >
                  {tab === 'standard' ? 'Standard' : 'Extra'}
                </button>
              ))}
            </div>
          </div>
          {shapeTab === 'extra' && (
            <div className="mt-1 flex gap-1" role="tablist" aria-label="Kategorie der Extra-Formen">
              {SHAPE_CATEGORIES.map((category) => (
                <button
                  key={category}
                  type="button"
                  role="tab"
                  aria-selected={extraCategory === category}
                  onClick={() => setExtraCategory(category)}
                  className={`flex-1 rounded px-1 py-0.5 text-[8px] transition ${
                    extraCategory === category
                      ? 'bg-white/10 text-white/75'
                      : 'text-white/30 hover:text-white/60'
                  }`}
                >
                  {category}
                </button>
              ))}
            </div>
          )}
          <div className="mt-1 grid grid-cols-2 gap-1">
            {shapes.map((shape) => (
              <button
                key={shape.id}
                type="button"
                onClick={() => {
                  onClose()
                  onShape(shape.id)
                }}
                title={`${shape.label}: ${shape.detail}`}
                aria-label={`${shape.label}: ${shape.detail}`}
                className={
                  shapeTab === 'extra'
                    ? 'flex min-h-[58px] min-w-0 flex-col items-center justify-center gap-0.5 rounded-md border border-line/60 bg-ink-900/60 px-1 py-1 text-white/65 transition hover:border-amber/50 hover:text-amber'
                    : 'truncate rounded-md border border-line/60 bg-ink-900/60 px-1.5 py-1 text-left text-[10px] text-white/65 transition hover:border-amber/50 hover:text-amber'
                }
              >
                {shapeTab === 'extra' && shape.preview ? (
                  <>
                    <ShapeGlyph kind={shape.preview} />
                    <span className="w-full truncate text-center text-[9px] leading-tight">{shape.label}</span>
                    <span className="w-full truncate text-center text-[7px] leading-tight text-white/25">{shape.detail}</span>
                  </>
                ) : (
                  <span className="truncate">{shape.label}</span>
                )}
              </button>
            ))}
          </div>
          <p className="mt-1 text-[8px] leading-snug text-white/25">
            Wird auf die aktuelle Platte gelegt. Extra-Formen sind eigene Testkörper und praktische Kleinteile.
          </p>
        </div>
      )}
      <div className="shrink-0 border-t border-line/60 bg-ink-950/60 px-2.5 py-1.5 text-[8px] leading-snug text-white/25">
        Rechtsklick auf die 3D-Ansicht oder eine Platte öffnet dieses Menü jederzeit wieder.
      </div>
    </div>
  )
}

function Dialog({
  title,
  subtitle,
  onClose,
  wide,
  side,
  children,
  footer,
}: {
  title: string
  subtitle: string
  onClose: () => void
  wide?: boolean
  /** Seitliche Leiste statt Modal — die 3D-Ansicht bleibt sichtbar. */
  side?: boolean
  children: React.ReactNode
  footer: React.ReactNode
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  if (side) {
    return (
      <PanelPortal>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="fixed inset-y-0 right-0 z-50 flex w-[440px] max-w-full flex-col border-l border-line/80 bg-ink-900/97 shadow-2xl backdrop-blur-xl"
      >
        <div className="flex items-start justify-between gap-3 border-b border-line/60 px-4 py-3">
          <div>
            <h3 className="text-sm font-semibold text-white/85">{title}</h3>
            <p className="mt-0.5 text-[10px] leading-snug text-white/35">{subtitle}</p>
          </div>
          <button type="button" onClick={onClose} className="text-white/30 transition hover:text-white/70">
            ✕
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">{children}</div>
        <div className="flex items-center justify-end gap-2 border-t border-line/60 px-4 py-3">{footer}</div>
      </div>
      </PanelPortal>
    )
  }

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-ink-950/75 p-4 backdrop-blur-sm" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`mx-auto mt-8 w-full ${wide ? 'max-w-2xl' : 'max-w-lg'} rounded-2xl border border-line/70 bg-ink-900 p-4 shadow-2xl`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-white/85">{title}</h3>
            <p className="mt-0.5 text-[10px] leading-snug text-white/35">{subtitle}</p>
          </div>
          <button type="button" onClick={onClose} className="text-white/30 transition hover:text-white/70">
            ✕
          </button>
        </div>
        <div className="mt-3">{children}</div>
        <div className="mt-4 flex items-center justify-end gap-2 border-t border-line/60 pt-3">{footer}</div>
      </div>
    </div>
  )
}

const fieldClass =
  'w-full rounded-lg border border-line/80 bg-ink-900/70 px-2 py-1.5 text-[11px] text-white/80 outline-none focus:border-amber/60'
const labelClass = 'text-[9px] font-medium tracking-[0.12em] text-white/35 uppercase'

function ObjectPicker({
  objects,
  value,
  onChange,
}: {
  objects: ModelObjectInfo[]
  value: string
  onChange: (id: string) => void
}) {
  if (objects.length < 2) return null
  return (
    <label className="mb-2 block">
      <span className={labelClass}>Objekt</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className={`mt-1 ${fieldClass}`}>
        {objects.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name} · {o.size.x.toFixed(0)}×{o.size.y.toFixed(0)}×{o.size.z.toFixed(0)} mm
          </option>
        ))}
      </select>
    </label>
  )
}

function BusyButton({
  busy,
  label,
  busyLabel,
  onClick,
  disabled,
}: {
  busy: boolean
  label: string
  busyLabel: string
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      disabled={busy || disabled}
      onClick={onClick}
      className="rounded-lg bg-gradient-to-r from-amber to-[#ffcf7a] px-3 py-1.5 text-[10px] font-semibold text-ink-950 transition hover:brightness-110 disabled:opacity-40"
    >
      {busy ? busyLabel : label}
    </button>
  )
}

/** Größe in mm je Achse, gleichmäßig oder einzeln, plus Drehung und Position. */
export function TransformDialog({
  modelId,
  objects,
  initialId,
  onEdit,
  onPreview,
  onClose,
}: {
  modelId: string
  objects: ModelObjectInfo[]
  initialId?: string
  onEdit: (res: api.ModelEditResult) => Promise<void> | void
  /** Live-Vorschau beim Ändern — ohne den Dialog zu schließen */
  onPreview?: (res: api.ModelEditResult) => Promise<void> | void
  onClose: () => void
}) {
  const [objectId, setObjectId] = useState(initialId ?? objects[0]?.id ?? '')
  const object = objects.find((o) => o.id === objectId) ?? objects[0] ?? null

  const base = useMemo(() => transformBase(object), [object])

  const [uniform, setUniform] = useState(true)
  const [sizes, setSizes] = useState(() => transformFields(object).sizes)
  const [rot, setRot] = useState(() => transformFields(object).rot)
  const [pos, setPos] = useState(() => transformFields(object).pos)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [touched, setTouched] = useState(false)
  const initial = useRef(object ? { ...object.placement } : null)

  // Das Gizmo und die Live-Vorschau ändern das Objekt auf dem Server. Die
  // Felder müssen dieser Änderung folgen, sonst wird beim nächsten Tastendruck
  // mit alten Maßen gegen eine bereits gedrehte Bounding-Box skaliert. Die
  // Vergleiche verhindern, dass die Server-Antwort erneut eine Vorschau auslöst.
  useEffect(() => {
    if (!object) return
    const next = transformFields(object)
    setRot((prev) => (sameVec3(prev, next.rot) ? prev : next.rot))
    setSizes((prev) => (sameVec3(prev, next.sizes) ? prev : next.sizes))
    setPos((prev) => (sameVec3(prev, next.pos) ? prev : next.pos))
  }, [object])

  // Beim Wechsel des Objekts Felder neu befüllen.
  const select = (id: string) => {
    const next = objects.find((o) => o.id === id)
    setObjectId(id)
    if (!next) return
    initial.current = { ...next.placement }
    const fields = transformFields(next)
    setTouched(false)
    setSizes(fields.sizes)
    setRot(fields.rot)
    setPos(fields.pos)
  }

  const changeSize = (axis: 'x' | 'y' | 'z', value: number) => {
    setTouched(true)
    const v = Math.max(0.5, Math.min(2000, value))
    if (!uniform) {
      setSizes((prev) => ({ ...prev, [axis]: v }))
      return
    }
    const factor = v / Math.max(0.01, sizes[axis])
    setSizes((prev) => ({
      x: Math.max(0.5, prev.x * factor),
      y: Math.max(0.5, prev.y * factor),
      z: Math.max(0.5, prev.z * factor),
    }))
  }

  const payload = () => transformPatch(object, { sizes, rot, pos }, base)

  // Live-Vorschau: gedrosselt und streng nacheinander. Beim Tippen entstehen
  // viele Zwischenlagen; vorher liefen mehrere Anfragen gleichzeitig und eine
  // ältere Antwort konnte die neuere Anzeige überschreiben. Jetzt läuft
  // höchstens eine Anfrage, und danach zählt nur die zuletzt eingegebene Lage.
  const previewPending = useRef<ObjectTransformPatch | null>(null)
  const previewBusy = useRef(false)
  const previewFlush = useRef<() => void>(() => {})
  previewFlush.current = () => {
    if (previewBusy.current || !onPreview) return
    const patch = previewPending.current
    if (!patch) return
    previewPending.current = null
    previewBusy.current = true
    void (async () => {
      try {
        const res = await api.setObjects(modelId, [patch])
        // Kam während der Anfrage eine neuere Eingabe, ist diese Antwort
        // veraltet und wird verworfen; die nächste Runde zeigt den neuen Stand.
        if (!previewPending.current) await onPreview(res)
      } catch {
        /* Vorschau ist nur Komfort */
      } finally {
        previewBusy.current = false
        if (previewPending.current) previewFlush.current()
      }
    })()
  }

  // Kurz entprellt, damit nicht jede Tasteneingabe einen Serverlauf auslöst.
  // Die Kamera bleibt dabei stehen.
  useEffect(() => {
    if (!touched || !onPreview) return
    const timer = setTimeout(() => {
      previewPending.current = payload()
      previewFlush.current()
    }, 280)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sizes, rot, pos, touched])

  const apply = async () => {
    const patch = payload()
    if (!patch) return
    // Eine noch wartende Vorschau darf das Übernehmen nicht überholen.
    previewPending.current = null
    setBusy(true)
    setError(null)
    try {
      const res = await api.setObjects(modelId, [patch])
      await onEdit(res)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Größe konnte nicht übernommen werden.')
    } finally {
      setBusy(false)
    }
  }

  /** Abbrechen stellt die Lage vor dem Öffnen wieder her. */
  const cancel = async () => {
    // Wartende Vorschau verwerfen — sonst überschreibt sie das Zurücksetzen.
    previewPending.current = null
    const patch = initial.current
    if (touched && object && patch && onPreview) {
      try {
        await onPreview(await api.setObjects(modelId, [{ id: object.id, ...patch }]))
      } catch {
        /* Zurücksetzen ist nur Komfort */
      }
    }
    onClose()
  }

  return (
    <Dialog
      title="Größe, Drehung und Position"
      subtitle="Änderungen erscheinen sofort in der 3D-Ansicht. Alle Achsen gemeinsam oder einzeln skalieren — Werte in mm."
      onClose={cancel}
      side
      footer={
        <>
          <button type="button" onClick={() => void cancel()} className="text-[10px] text-white/40 hover:text-white/70">
            Abbrechen
          </button>
          <BusyButton busy={busy} label="Übernehmen" busyLabel="Rechne …" onClick={() => void apply()} />
        </>
      }
    >
      <ObjectPicker objects={objects} value={objectId} onChange={select} />
      {object && (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2">
            {(['x', 'y', 'z'] as const).map((axis) => (
              <label key={axis} className="block">
                <span className={labelClass}>{axis === 'x' ? 'Breite X' : axis === 'y' ? 'Tiefe Y' : 'Höhe Z'} (mm)</span>
                <input
                  type="number"
                  step="1"
                  min="0.5"
                  value={Math.round(sizes[axis] * 10) / 10}
                  onChange={(e) => changeSize(axis, Number(e.target.value))}
                  className={`mt-1 ${fieldClass}`}
                />
              </label>
            ))}
          </div>
          <label className="flex items-center gap-2 text-[10px] text-white/50">
            <input
              type="checkbox"
              checked={uniform}
              onChange={(e) => {
                setUniform(e.target.checked)
                setTouched(true)
              }}
              className="accent-amber"
            />
            Alle Achsen gleich skalieren (proportional)
          </label>
          <div className="grid grid-cols-3 gap-2 rounded-xl border border-line/60 bg-ink-950/40 p-2">
            {(['x', 'y', 'z'] as const).map((axis) => (
              <div key={axis} className="text-center">
                <div className="text-[9px] text-white/30 uppercase">{axis}</div>
                <label className="relative mt-0.5 block">
                  <input
                    type="number"
                    step="1"
                    min="1"
                    max="1000"
                    value={(() => {
                      const percent = (sizes[axis] / base[axis]) * 100
                      return Math.abs(percent - Math.round(percent)) < 0.15
                        ? Math.round(percent)
                        : Math.round(percent * 10) / 10
                    })()}
                    onChange={(e) => {
                      setTouched(true)
                      const pct = Math.max(1, Math.min(1000, Number(e.target.value) || 100))
                      if (uniform) {
                        setSizes({
                          x: Math.max(0.5, (base.x * pct) / 100),
                          y: Math.max(0.5, (base.y * pct) / 100),
                          z: Math.max(0.5, (base.z * pct) / 100),
                        })
                      } else {
                        setSizes((prev) => ({ ...prev, [axis]: Math.max(0.5, (base[axis] * pct) / 100) }))
                      }
                    }}
                    onFocus={(e) => e.currentTarget.select()}
                    aria-label={`Skalierung ${axis.toUpperCase()} in Prozent`}
                    className="tabular w-full rounded-md border border-line/70 bg-ink-900/80 py-0.5 pr-3 text-center text-[12px] font-semibold text-amber outline-none focus:border-amber/60"
                  />
                  <span className="pointer-events-none absolute top-1/2 right-1 -translate-y-1/2 text-[9px] text-white/35">%</span>
                </label>
              </div>
            ))}
          </div>
          <div className="mt-1 flex items-center justify-between gap-2">
            <span className={labelClass}>Schnell drehen</span>
            <span className="text-[9px] text-mint/70">
              {touched ? 'Vorschau wird live aktualisiert' : 'Änderungen erscheinen sofort in der Vorschau'}
            </span>
          </div>
          <div className="mt-1 grid grid-cols-3 gap-2">
            {(['x', 'y', 'z'] as const).map((axis) => (
              <button
                key={axis}
                type="button"
                data-testid={`transform-quick-${axis}`}
                disabled={busy}
                onClick={() => {
                  setTouched(true)
                  setRot((previous) => ({
                    ...previous,
                    [axis]: Math.round((previous[axis] + 90) * 10) / 10,
                  }))
                }}
                className="rounded-lg border border-line/80 bg-ink-900/60 px-2 py-1.5 text-[10px] font-medium text-white/60 transition hover:border-amber/50 hover:text-amber disabled:opacity-40"
              >
                +90° {axis.toUpperCase()}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-3 gap-2">
            <Stepper label="Drehung X" unit="°" value={rot.x} step={15} min={-360} max={360} onChange={(v) => { setTouched(true); setRot((p) => ({ ...p, x: v })) }} />
            <Stepper label="Drehung Y" unit="°" value={rot.y} step={15} min={-360} max={360} onChange={(v) => { setTouched(true); setRot((p) => ({ ...p, y: v })) }} />
            <Stepper label="Drehung Z" unit="°" value={rot.z} step={15} min={-360} max={360} onChange={(v) => { setTouched(true); setRot((p) => ({ ...p, z: v })) }} />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <Stepper label="Position X" unit="mm" value={pos.x} step={1} min={-400} max={400} onChange={(v) => { setTouched(true); setPos((p) => ({ ...p, x: v })) }} />
            <Stepper label="Position Y" unit="mm" value={pos.y} step={1} min={-400} max={400} onChange={(v) => { setTouched(true); setPos((p) => ({ ...p, y: v })) }} />
            <Stepper label="Position Z" unit="mm" value={pos.z} step={1} min={-400} max={400} onChange={(v) => { setTouched(true); setPos((p) => ({ ...p, z: v })) }} />
          </div>
          {error && <p className="text-[10px] text-rose">{error}</p>}
        </div>
      )}
    </Dialog>
  )
}

const SPLIT_MEMORY_KEY = 'kepler-slicer.split-memory.v1'

type ConnectorMode = 'pin' | 'dovetail' | 'puzzle' | 'tongue' | 'bayonet' | 'thread' | 'undercut'

export type SplitMemory = {
  axis: api.SplitAxis
  auto: boolean
  pieces: number
  mode: api.SplitProfile | 'pin' | 'rail' | 'puzzle' | 'tongue' | 'bayonet' | 'thread'
  combine: boolean
  extraPin: 'none' | ConnectorMode
  connectorSize: number
  count: number
  pinCount: number
  pinWidth: number
  pinLength: number
  pinHeight: number
  pinDepth: number
  pinTaper: number
  clearance: number
  connectorClearance: number
  arrange: boolean
  keep: 'both' | 'low' | 'high'
}

const SPLIT_DEFAULTS: SplitMemory = {
  axis: 'z',
  auto: true,
  pieces: 2,
  mode: 'wave',
  combine: false,
  extraPin: 'puzzle',
  connectorSize: 1.6,
  count: 2,
  pinCount: 2,
  pinWidth: 6,
  pinLength: 8,
  pinHeight: 4,
  pinDepth: 4,
  pinTaper: 0.08,
  clearance: 0.05,
  connectorClearance: 0.25,
  arrange: true,
  keep: 'both',
}

function splitNumber(value: unknown, min: number, max: number, fallback: number) {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback
}

/** Letzte Teilungs- und Zapfenwerte; ein defekter Eintrag fällt auf Standard zurück. */
function loadSplitMemory(): SplitMemory {
  if (typeof window === 'undefined') return { ...SPLIT_DEFAULTS }
  try {
    const raw = JSON.parse(localStorage.getItem(SPLIT_MEMORY_KEY) ?? 'null') as Partial<SplitMemory> | null
    if (!raw || typeof raw !== 'object') return { ...SPLIT_DEFAULTS }
    const modes: readonly string[] = [
      'wave',
      'zigzag',
      'step',
      'dovetail',
      'undercut',
      'flat',
      'pin',
      'rail',
      'puzzle',
      'tongue',
      'bayonet',
      'thread',
    ]
    const pins: readonly string[] = ['none', 'pin', 'dovetail', 'puzzle', 'tongue', 'bayonet', 'thread', 'undercut']
    return {
      axis: raw.axis === 'x' || raw.axis === 'y' || raw.axis === 'z' ? raw.axis : SPLIT_DEFAULTS.axis,
      auto: typeof raw.auto === 'boolean' ? raw.auto : SPLIT_DEFAULTS.auto,
      pieces: Math.round(splitNumber(raw.pieces, 2, 12, SPLIT_DEFAULTS.pieces)),
      mode: modes.includes(raw.mode ?? '') ? (raw.mode as SplitMemory['mode']) : SPLIT_DEFAULTS.mode,
      combine: typeof raw.combine === 'boolean' ? raw.combine : SPLIT_DEFAULTS.combine,
      extraPin: pins.includes(raw.extraPin ?? '') ? (raw.extraPin as SplitMemory['extraPin']) : SPLIT_DEFAULTS.extraPin,
      connectorSize: splitNumber(raw.connectorSize, 0.4, 6, SPLIT_DEFAULTS.connectorSize),
      count: Math.round(splitNumber(raw.count, 1, 8, SPLIT_DEFAULTS.count)),
      pinCount: Math.round(splitNumber(raw.pinCount, 0, 6, SPLIT_DEFAULTS.pinCount)),
      pinWidth: splitNumber(raw.pinWidth, 2, 30, SPLIT_DEFAULTS.pinWidth),
      pinLength: splitNumber(raw.pinLength, 2, 30, SPLIT_DEFAULTS.pinLength),
      pinHeight: splitNumber(raw.pinHeight, 1, 20, SPLIT_DEFAULTS.pinHeight),
      pinDepth: splitNumber(raw.pinDepth, 1, 20, SPLIT_DEFAULTS.pinDepth),
      pinTaper: splitNumber(raw.pinTaper, 0, 0.35, SPLIT_DEFAULTS.pinTaper),
      clearance: splitNumber(raw.clearance, -0.3, 0.5, SPLIT_DEFAULTS.clearance),
      connectorClearance: splitNumber(raw.connectorClearance, 0, 0.5, SPLIT_DEFAULTS.connectorClearance),
      arrange: typeof raw.arrange === 'boolean' ? raw.arrange : SPLIT_DEFAULTS.arrange,
      keep: raw.keep === 'low' || raw.keep === 'high' || raw.keep === 'both' ? raw.keep : SPLIT_DEFAULTS.keep,
    }
  } catch {
    return { ...SPLIT_DEFAULTS }
  }
}

function saveSplitMemory(memory: SplitMemory) {
  try {
    localStorage.setItem(SPLIT_MEMORY_KEY, JSON.stringify(memory))
  } catch {
    // Privater Modus oder voller Speicher: Teilen funktioniert trotzdem.
  }
}

function clearSplitMemory() {
  try {
    localStorage.removeItem(SPLIT_MEMORY_KEY)
  } catch {
    // Nichts zu löschen.
  }
}

/**
 * Teilen mit Verbindern: mehrere Schnitte auf einmal, freie Passung und auf
 * Wunsch direkt aufs Bett verteilt. Ersetzt den einfachen Einzelschnitt.
 */
export function SplitDialog({
  modelId,
  objects,
  bed,
  preset,
  onEdit,
  onGuideChange,
  onRegisterMove,
  onClose,
}: {
  modelId: string
  objects: ModelObjectInfo[]
  bed: { x: number; y: number; z: number }
  /** V-20: Vorschlag des Montage-Assistenten, der die gemerkten Werte überschreibt. */
  preset?: Partial<SplitMemory>
  onEdit: (res: api.ModelEditResult) => Promise<void> | void
  /** Schnittebene in der 3D-Ansicht anzeigen/aktualisieren (V-07). */
  onGuideChange?: (guide: { axis: api.SplitAxis; position: number; min: number; max: number } | null) => void
  /** 3D-Ziehen meldet die neue absolute Schnittlage an diesen Dialog. */
  onRegisterMove?: (move: ((position: number) => void) | null) => void
  onClose: () => void
}) {
  const [initial] = useState(() => ({ ...loadSplitMemory(), ...preset }))
  const [objectId, setObjectId] = useState(objects.find((o) => o.placement.visible)?.id ?? objects[0]?.id ?? '')
  const object = objects.find((o) => o.id === objectId) ?? objects[0] ?? null
  const [axis, setAxis] = useState<api.SplitAxis>(initial.axis)
  const [auto, setAuto] = useState(initial.auto)
  const [pieces, setPieces] = useState(initial.pieces)
  // Alle Formen in einer Liste; kombinieren nur, wenn ausdrücklich eingeschaltet.
  const [mode, setMode] = useState<api.SplitProfile | 'pin' | 'rail' | 'puzzle' | 'tongue' | 'bayonet' | 'thread'>(
    initial.mode,
  )
  const [combine, setCombine] = useState(initial.combine)
  const [extraPin, setExtraPin] = useState<'none' | ConnectorMode>(initial.extraPin)
  const [connectorSize, setConnectorSize] = useState(initial.connectorSize)
  const [count, setCount] = useState(initial.count)
  const [pinCount, setPinCount] = useState(initial.pinCount)
  const [pinWidth, setPinWidth] = useState(initial.pinWidth)
  const [pinLength, setPinLength] = useState(initial.pinLength)
  const [pinHeight, setPinHeight] = useState(initial.pinHeight)
  const [pinDepth, setPinDepth] = useState(initial.pinDepth)
  const [pinTaper, setPinTaper] = useState(initial.pinTaper)
  const primaryPin: 'none' | ConnectorMode =
    mode === 'pin'
      ? 'pin'
      : mode === 'rail'
        ? 'dovetail'
        : mode === 'puzzle' || mode === 'tongue' || mode === 'bayonet' || mode === 'thread'
          ? mode
          : 'none'
  const activePin = combine ? extraPin : primaryPin
  const connector = activePin !== 'none'
  // Beim Kombinieren zählt die Naht aus der Liste, sonst ist sie gerade.
  const seamProfile: api.SplitProfile = primaryPin === 'none' ? (mode as api.SplitProfile) : 'flat'
  const profile: api.SplitProfile = combine ? seamProfile : connector ? 'flat' : seamProfile
  const pinType: ConnectorMode =
    activePin === 'none' ? 'pin' : activePin
  const combineActive = combine && connector
  const [seamBusy, setSeamBusy] = useState(false)
  /** Spalt zwischen den Nahtflächen — bewusst getrennt von der Verbinderpassung. */
  const [clearance, setClearance] = useState(initial.clearance)
  /** Luft rund um Zapfen/Schiene; 0,25 mm ist der bewährte Füge-Standard. */
  const [connectorClearance, setConnectorClearance] = useState(initial.connectorClearance)
  const [arrange, setArrange] = useState(initial.arrange)
  const [keep, setKeep] = useState<'both' | 'low' | 'high'>(initial.keep)
  const [position, setPosition] = useState(0.5)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const extent = object
    ? axis === 'z'
      ? object.size.z
      : axis === 'x'
        ? object.size.x
        : object.size.y
    : 0
  // Der Platz auf dem Bett ist die Grenze: bei Z die Bauhöhe, sonst die
  // Grundfläche mit etwas Rand für Naht und Messungen.
  const room = axis === 'z' ? bed.z - 2 : (axis === 'x' ? bed.x : bed.y) - 8
  const needed = Math.max(2, Math.min(12, Math.ceil(extent / Math.max(20, room))))
  const parts = auto ? needed : pieces
  const low = object
    ? (axis === 'z' ? object.center.z : axis === 'x' ? object.center.x : object.center.y) - extent / 2
    : 0

  // Die 3D-Ansicht zeigt und zieht dieselbe Schnittlage wie der Regler.
  useEffect(() => {
    if (!object) {
      onGuideChange?.(null)
      return
    }
    onGuideChange?.({ axis, position: low + extent * position, min: low, max: low + extent })
  }, [axis, extent, low, object, onGuideChange, position])

  useEffect(() => {
    if (!onRegisterMove) return
    onRegisterMove((absolute) => {
      setPosition(Math.max(0.1, Math.min(0.9, (absolute - low) / Math.max(1, extent))))
    })
    return () => onRegisterMove(null)
  }, [extent, low, onRegisterMove])

  const select = (id: string) => {
    setObjectId(id)
    setPosition(0.5)
  }

  const apply = async () => {
    if (!object) return
    setBusy(true)
    setError(null)
    try {
      const low = (axis === 'z' ? object.center.z : axis === 'x' ? object.center.x : object.center.y) - extent / 2
      const res = await api.splitModel(modelId, {
        objectId: object.id,
        axis,
        pieces: parts,
        autoPieces: auto,
        profile,
        connectorSize,
        count,
        clearance,
        connectorClearance,
        position: parts === 2 ? low + extent * position : undefined,
        keep: parts === 2 ? keep : 'both',
        arrange,
        pinCount: connector ? pinCount : 0,
        combine: combineActive,
        pinWidth,
        pinLength,
        pinHeight,
        pinDepth,
        pinTaper,
        pinType,
        bed,
      })
      await onEdit(res)
      saveSplitMemory({
        axis,
        auto,
        pieces,
        mode,
        combine,
        extraPin,
        connectorSize,
        count,
        pinCount,
        pinWidth,
        pinLength,
        pinHeight,
        pinDepth,
        pinTaper,
        clearance,
        connectorClearance,
        arrange,
        keep,
      })
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Teilen fehlgeschlagen.')
    } finally {
      setBusy(false)
    }
  }

  const resetDefaults = () => {
    clearSplitMemory()
    setAxis(SPLIT_DEFAULTS.axis)
    setAuto(SPLIT_DEFAULTS.auto)
    setPieces(SPLIT_DEFAULTS.pieces)
    setMode(SPLIT_DEFAULTS.mode)
    setCombine(SPLIT_DEFAULTS.combine)
    setExtraPin(SPLIT_DEFAULTS.extraPin)
    setConnectorSize(SPLIT_DEFAULTS.connectorSize)
    setCount(SPLIT_DEFAULTS.count)
    setPinCount(SPLIT_DEFAULTS.pinCount)
    setPinWidth(SPLIT_DEFAULTS.pinWidth)
    setPinLength(SPLIT_DEFAULTS.pinLength)
    setPinHeight(SPLIT_DEFAULTS.pinHeight)
    setPinDepth(SPLIT_DEFAULTS.pinDepth)
    setPinTaper(SPLIT_DEFAULTS.pinTaper)
    setClearance(SPLIT_DEFAULTS.clearance)
    setConnectorClearance(SPLIT_DEFAULTS.connectorClearance)
    setArrange(SPLIT_DEFAULTS.arrange)
    setKeep(SPLIT_DEFAULTS.keep)
    setPosition(0.5)
    setError(null)
  }

  const autoSeam = async () => {
    if (!object) return
    setSeamBusy(true)
    setError(null)
    try {
      const res = await api.suggestSeam(modelId, { objectId: object.id, axis })
      const low = (axis === 'z' ? object.center.z : axis === 'x' ? object.center.x : object.center.y) - extent / 2
      setPosition(Math.max(0.1, Math.min(0.9, (res.position - low) / Math.max(1, extent))))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Schnittlage nicht gefunden.')
    } finally {
      setSeamBusy(false)
    }
  }

  const profileInfo: Record<api.SplitProfile, string> = {
    flat: 'Gerade Fläche — einfachste Naht, beide Teile liegen plan aufeinander.',
    zigzag: 'Zickzack über die ganze Breite — formschlüssig gegen Verrutschen.',
    step: 'Treppe mit senkrechten Stufen — greift formschlüssig und hält gegen Verrutschen und Verdrehen.',
    dovetail: 'Flach gedeckelter Keil — zentriert die Hälften beim Zusammenstecken.',
    wave: 'Weiche Welle — leicht zusammenzuführen, hält gegen Verdrehen.',
    undercut: 'Rastnase mit breitem Kopf hinter schmalem Hals — hält auch gegen Abheben, ohne Kleber.',
  }

  return (
    <Dialog
      title="Objekt teilen"
      subtitle="Ein Durchgang, alle Schnitte: Teilezahl wählen, Verbinder einstellen, fertig."
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={resetDefaults} className="mr-auto text-[10px] text-white/35 hover:text-white/70">
            Standardwerte
          </button>
          <button type="button" onClick={onClose} className="text-[10px] text-white/40 hover:text-white/70">
            Abbrechen
          </button>
          <BusyButton busy={busy} label="Teilen" busyLabel="Teile …" onClick={() => void apply()} />
        </>
      }
    >
      <ObjectPicker objects={objects} value={objectId} onChange={select} />
      <p className="text-[9px] leading-snug text-white/30">
        Zuletzt verwendete Teilungs- und Zapfenwerte sind vorbelegt — „Standardwerte“ setzt sie zurück.
      </p>
      {object && (
        <div className="space-y-3">
          <div>
            <span className={labelClass}>Schnittrichtung</span>
            <div className="mt-1 grid grid-cols-3 gap-1.5">
              {(
                [
                  ['z', 'Höhe (Z)'],
                  ['x', 'Breite (X)'],
                  ['y', 'Tiefe (Y)'],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setAxis(value)}
                  className={`rounded-lg border px-2 py-1.5 text-[10px] transition ${
                    axis === value ? 'border-amber/60 bg-amber/12 text-amber' : 'border-line/70 text-white/50 hover:border-white/20'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-[auto_1fr] items-end gap-2">
            <Stepper label="Teile" unit="×" value={parts} step={1} min={2} max={12} onChange={(v) => { setAuto(false); setPieces(v) }} />
            <button
              type="button"
              onClick={() => setAuto((a) => !a)}
              className={`rounded-lg border px-2 py-1.5 text-[10px] transition ${
                auto ? 'border-amber/60 bg-amber/12 text-amber' : 'border-line/70 text-white/50 hover:border-white/20'
              }`}
            >
              {auto ? `automatisch: ${needed} Teile` : 'automatisch nach Bettgröße'}
            </button>
          </div>
          <p className="text-[9px] leading-snug text-white/35">
            {extent.toFixed(1)} mm auf der Achse, {Math.max(1, Math.round(room))} mm Platz — bei {parts} Teilen je{' '}
            {(extent / parts).toFixed(1)} mm.
          </p>

          {parts === 2 && (
            <div className="grid grid-cols-[1fr_auto_auto] items-end gap-2">
              <label className="block">
                <span className={labelClass}>Schnittlage</span>
                <input
                  type="range"
                  min={0.1}
                  max={0.9}
                  step="0.01"
                  value={position}
                  onChange={(e) => setPosition(Number(e.target.value))}
                  className="mt-1 w-full accent-amber"
                />
              </label>
              <input
                type="number"
                step="1"
                value={Math.round(extent * position * 10) / 10}
                onChange={(e) => setPosition(Math.max(0.1, Math.min(0.9, Number(e.target.value) / Math.max(1, extent))))}
                className={`w-24 ${fieldClass}`}
              />
              <button
                type="button"
                onClick={() => void autoSeam()}
                disabled={seamBusy}
                title="Schnittlage mit dem kleinsten Querschnitt suchen — kleinere Naht, weniger Stützen"
                className="rounded-lg border border-line/70 px-2 py-1.5 text-[10px] text-white/50 transition hover:border-white/20 disabled:opacity-40"
              >
                {seamBusy ? '…' : 'dünnste Stelle'}
              </button>
            </div>
          )}

          {parts === 2 && (
            <div>
              <span className={labelClass}>Behalten</span>
              <div className="mt-1 grid grid-cols-3 gap-1.5">
                {(
                  [
                    ['both', 'Beide Teile'],
                    ['low', 'Nur unten'],
                    ['high', 'Nur oben'],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setKeep(value)}
                    className={`rounded-lg border px-2 py-1.5 text-[10px] transition ${
                      keep === value ? 'border-amber/60 bg-amber/12 text-amber' : 'border-line/70 text-white/50 hover:border-white/20'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}

          <label className="block">
            <span className={labelClass}>Naht & Verbinder</span>
            <select
              value={mode}
              onChange={(e) => {
                const value = e.target.value as typeof mode
                // Kombiniert: eine Verbinderwahl wandert in die Zusatzauswahl.
                if (combine && (value === 'pin' || value === 'rail' || value === 'puzzle')) {
                  setExtraPin(value === 'rail' ? 'dovetail' : value)
                  setMode('flat')
                  return
                }
                setMode(value)
              }}
              className={`mt-1 ${fieldClass}`}
            >
              <optgroup label="Nur Naht">
                <option value="wave">Welle (empfohlen)</option>
                <option value="zigzag">Zickzack</option>
                <option value="step">Treppe (Stufen)</option>
                <option value="dovetail">Keil (selbstzentrierend)</option>
                <option value="undercut">Hinterschnitt / Rastnase</option>
                <option value="flat">Gerade Fläche</option>
              </optgroup>
              <optgroup label="Naht gerade + Verbinder">
                <option value="pin">Zapfen (gesteckt)</option>
                <option value="rail">Schwalbenschwanz (eingeschoben)</option>
                <option value="puzzle">Puzzle (T-Nut, eingeschoben)</option>
                <option value="tongue">Nut/Feder (gerade Schiene)</option>
                <option value="bayonet">Bajonett (Kopfriegel)</option>
                <option value="thread">Schraubgewinde</option>
              </optgroup>
            </select>
          </label>
          <p className="rounded-lg border border-line/60 bg-ink-950/40 px-2 py-1.5 text-[9px] leading-snug text-white/40">
            {combineActive
              ? 'Naht und Verbinder kombiniert. Zum seitlichen Einschieben muss die Naht gerade sein — Treppe und Welle blockieren das Fügen.'
              : connector
                ? 'Die Naht bleibt gerade; gerechnet wird nur diese Verbinderart. So lassen sich die Teile seitlich zusammen- und auseinanderschieben.'
                : profileInfo[profile]}
          </p>
          <div className="rounded-xl border border-line/60 bg-ink-950/30 p-2">
            <button
              type="button"
              onClick={() =>
                setCombine((on) => {
                  const next = !on
                  if (next && primaryPin !== 'none') {
                    setExtraPin(primaryPin)
                    setMode('flat')
                  }
                  return next
                })
              }
              className={`flex w-full items-center gap-2 rounded-lg border px-2 py-1.5 text-[10px] transition ${
                combine ? 'border-amber/60 bg-amber/12 text-amber' : 'border-line/70 text-white/50 hover:border-white/20'
              }`}
            >
              <span className={`grid h-3.5 w-3.5 place-items-center rounded border ${combine ? 'border-amber/70 bg-amber/25' : 'border-line'}`}>
                {combine ? '✓' : ''}
              </span>
              Naht und Verbinder kombinieren
              <span className="ml-auto tabular text-[9px]">{combine ? 'Ein' : 'Aus'}</span>
            </button>
            {combine && (
              <label className="mt-2 block">
                <span className={labelClass}>Zusätzlicher Verbinder</span>
                <select
                  value={extraPin}
                  onChange={(e) => setExtraPin(e.target.value as typeof extraPin)}
                  className={`mt-1 ${fieldClass}`}
                >
                  <option value="none">Keine</option>
                  <option value="pin">Zapfen (gesteckt)</option>
                  <option value="dovetail">Schwalbenschwanz (eingeschoben)</option>
                  <option value="puzzle">Puzzle (T-Nut, eingeschoben)</option>
                  <option value="tongue">Nut/Feder (gerade Schiene)</option>
                  <option value="bayonet">Bajonett (Kopfriegel)</option>
                  <option value="thread">Schraubgewinde</option>
                  <option value="undercut">Hinterschnitt / Rastnase</option>
                </select>
              </label>
            )}
          </div>
          {profile !== 'flat' && (
            <p className="rounded-lg border border-mint/25 bg-mint/8 px-2 py-1.5 text-[9px] leading-snug text-mint/80">
              Die Naht wird als geschlossene Fläche gerechnet — beide Teile sind wasserdicht und ohne offene Konturen.
            </p>
          )}

          {profile !== 'flat' && (
            <div className="grid grid-cols-2 gap-2">
              <Stepper
                label="Tiefe"
                unit="mm"
                value={connectorSize}
                step={0.2}
                min={0.4}
                max={6}
                onChange={setConnectorSize}
              />
              <Stepper label="Anzahl" unit="×" value={count} step={1} min={1} max={8} onChange={setCount} />
            </div>
          )}

          {connector && (
          <div className="rounded-xl border border-line/60 bg-ink-950/30 p-2">
            <span className={labelClass}>Verbinder</span>
            <div className="mt-1 grid grid-cols-2 gap-2">
              <Stepper label="Breite" unit="mm" value={pinWidth} step={0.5} min={2} max={30} onChange={setPinWidth} />
              {activePin === 'pin' && (
                <Stepper label="Länge" unit="mm" value={pinLength} step={0.5} min={2} max={30} onChange={setPinLength} />
              )}
              {activePin === 'pin' ? (
                <Stepper label="Höhe" unit="mm" value={pinHeight} step={0.5} min={1} max={20} onChange={setPinHeight} />
              ) : (
                <Stepper
                  label="Überstand"
                  unit="mm"
                  value={pinDepth}
                  step={0.5}
                  min={1}
                  max={20}
                  onChange={setPinDepth}
                />
              )}
              {activePin === 'pin' && (
                <Stepper
                  label="Konus"
                  unit="%"
                  value={Math.round(pinTaper * 100)}
                  step={1}
                  min={0}
                  max={35}
                  onChange={(v) => setPinTaper(v / 100)}
                />
              )}
            </div>
            <div className="mt-2 grid grid-cols-[auto_1fr] items-start gap-2">
              <Stepper
                label={activePin === 'pin' ? 'Zapfen' : 'Schienen'}
                unit="×"
                value={pinCount}
                step={1}
                min={0}
                max={6}
                onChange={setPinCount}
              />
              <p className="text-[9px] leading-snug text-white/35">
                {activePin === 'dovetail'
                  ? 'Die Schiene läuft über die ganze Breite und wird seitlich eingeschoben. Der breite Kopf sitzt über der Naht — das obere Teil lässt sich danach nicht mehr abheben. Überstand = wie weit der Kopf ins Gegenstück ragt. 0 schaltet sie ab.'
                  : activePin === 'puzzle'
                    ? 'T-förmiger Riegel mit gerundetem Kopf: schmaler Hals in der Naht, breiter Kopf greift darüber. Seitlich einschieben — hält gegen Abheben und Verdrehen. Eigene Form, nicht von 3D Splitter übernommen. 0 schaltet ihn ab.'
                    : activePin === 'tongue'
                      ? 'Nut/Feder: eine gerade Schiene am unteren Teil, die passende Nut im oberen. Seitlich einschieben; ideal für lange, flache Nähte. Überstand bestimmt, wie tief die Feder greift.'
                      : activePin === 'bayonet'
                        ? 'Bajonett: breiter Kopf hinter schmalem Hals, seitlich einschieben. Der Kopf greift hinter die Schulter und hält gegen Abheben; die Passung sollte eher stramm sein.'
                        : activePin === 'thread'
                          ? 'Schraubgewinde: runder Zapfen mit umlaufender Helix. Das obere Teil bekommt das passende Gegengewinde; Breite ist der Nenndurchmesser, Höhe die Gewindelänge.'
                          : activePin === 'undercut'
                            ? 'Hinterschnitt/Rastnase: breiter Kopf hinter schmalem Hals. Der Riegel hält beim Hochheben formschlüssig — ohne Kleber, seitlich einschieben.'
                            : 'Der Zapfen sitzt am unteren Teil, das obere bekommt die Nut mit Passung. Unten ist er durch den Konus schmaler und rutscht leichter hinein. 0 schaltet ihn ab.'}
              </p>
            </div>
          </div>
          )}

          <div>
            <div className="flex items-baseline justify-between">
              <span className={labelClass}>Nahtspalt</span>
              <span className="tabular text-[11px] text-sky-300/80">{clearance.toFixed(2)} mm</span>
            </div>
            <input
              type="range"
              min={-0.3}
              max={0.5}
              step={0.05}
              value={clearance}
              onChange={(e) => setClearance(Number(e.target.value))}
              className="mt-1 w-full accent-amber"
            />
            <p className="text-[9px] leading-snug text-white/35">
              Abstand der beiden Nahtflächen. Positiv = Luft, null oder negativ = stramm.
            </p>
          </div>

          <div>
            <div className="flex items-baseline justify-between">
              <span className={labelClass}>Verbinder-Passung</span>
              <span className="tabular text-[11px] text-sky-300/80">
                {(connectorClearance * 2).toFixed(2)} mm Luft
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={0.5}
              step={0.05}
              value={connectorClearance}
              onChange={(e) => setConnectorClearance(Number(e.target.value))}
              className="mt-1 w-full accent-amber"
            />
            <p className="text-[9px] leading-snug text-white/35">
              Rundum-Luft an Zapfen und Nut, Standard 0,25 mm je Seite. Die Nut ist an der Naht zusätzlich
              mit einer 0,8-mm-Einführfase aufgeweitet; Schienen und Puzzle werden seitlich eingeschoben.
            </p>
          </div>

          <button
            type="button"
            onClick={() => setArrange((a) => !a)}
            className={`flex w-full items-center gap-2 rounded-lg border px-2 py-1.5 text-[10px] transition ${
              arrange ? 'border-amber/60 bg-amber/12 text-amber' : 'border-line/70 text-white/50 hover:border-white/20'
            }`}
          >
            <span className={`grid h-3.5 w-3.5 place-items-center rounded border ${arrange ? 'border-amber/70 bg-amber/25' : 'border-line'}`}>
              {arrange ? '✓' : ''}
            </span>
            Teile danach aufs Bett verteilen
          </button>

          <SplitPreview
            object={object}
            axis={axis}
            parts={parts}
            profile={profile}
            connectorSize={connectorSize}
            clearance={clearance}
            connectorClearance={connectorClearance}
          />

          {error && <p className="text-[10px] text-rose">{error}</p>}
        </div>
      )}
    </Dialog>
  )
}

/** Frontansicht mit allen Schnittlagen — zeigt live, wie die Teile aufgeteilt werden. */
function SplitPreview({
  object,
  axis,
  parts,
  profile,
  connectorSize,
  clearance,
  connectorClearance,
}: {
  object: ModelObjectInfo
  axis: api.SplitAxis
  parts: number
  profile: api.SplitProfile
  connectorSize: number
  clearance: number
  connectorClearance: number
}) {
  const tall = Math.max(1, axis === 'z' ? object.size.z : axis === 'x' ? object.size.x : object.size.y)
  const wide = Math.max(
    1,
    axis === 'z' ? Math.max(object.size.x, object.size.y) : Math.max(object.size.z, axis === 'x' ? object.size.y : object.size.x),
  )
  const boxH = 118
  const boxW = 224
  const scale = Math.min(boxH / tall, boxW / wide)
  const h = tall * scale
  const w = Math.max(10, Math.min(boxW, wide * scale))
  const left = (260 - w) / 2
  const bottom = 130
  const top = bottom - h
  const amp = Math.min(6, Math.max(1.5, connectorSize * scale * 1.2))
  const gap = Math.max(0, clearance) * scale

  const seams = Array.from({ length: Math.max(0, parts - 1) }, (_, i) => top + (h * (i + 1)) / parts)
  const seamPath = (y: number) => {
    if (profile === 'flat') return `M ${left} ${y} L ${left + w} ${y}`
    if (profile === 'zigzag') {
      const teeth = Math.max(2, Math.round(w / 18))
      const step = w / teeth
      let d = `M ${left} ${y}`
      for (let i = 0; i < teeth; i++) d += ` L ${(left + step * (i + 0.5)).toFixed(1)} ${(y - amp).toFixed(1)} L ${(left + step * (i + 1)).toFixed(1)} ${y.toFixed(1)}`
      return d
    }
    if (profile === 'step') {
      const teeth = Math.max(2, Math.round(w / 22))
      const step = w / teeth
      let d = `M ${left} ${y}`
      for (let i = 0; i < teeth; i++) {
        const a = left + step * i
        d += ` L ${a.toFixed(1)} ${(y - amp).toFixed(1)} L ${(a + step / 2).toFixed(1)} ${(y - amp).toFixed(1)} L ${(a + step / 2).toFixed(1)} ${y.toFixed(1)} L ${(a + step).toFixed(1)} ${y.toFixed(1)}`
      }
      return d
    }
    if (profile === 'dovetail') {
      const teeth = Math.max(1, Math.round(w / 54))
      const step = w / teeth
      let d = `M ${left} ${y}`
      for (let i = 0; i < teeth; i++) {
        const a = left + step * i
        d += ` L ${(a + step * 0.22).toFixed(1)} ${(y - amp).toFixed(1)} L ${(a + step * 0.78).toFixed(1)} ${(y - amp).toFixed(1)} L ${(a + step).toFixed(1)} ${y.toFixed(1)}`
      }
      return d
    }
    const waves = Math.max(1, Math.round(w / 58))
    const step = w / waves
    let d = `M ${left} ${y}`
    for (let i = 0; i < waves; i++) {
      d += ` Q ${(left + step * i + step / 2).toFixed(1)} ${(y - amp * 1.5).toFixed(1)} ${(left + step * (i + 1)).toFixed(1)} ${y.toFixed(1)}`
    }
    return d
  }

  return (
    <div className="rounded-xl border border-line/60 bg-ink-950/40 p-2">
      <div className="mb-1 flex items-center justify-between text-[9px] text-white/40">
        <span>Vorschau (Frontansicht, schematisch)</span>
        <span className="tabular">
          {parts} Teile · je {(tall / parts).toFixed(1)} mm
        </span>
      </div>
      <svg viewBox="0 0 260 142" className="w-full" role="img" aria-label="Vorschau der geteilten Teile">
        <rect x={left} y={top} width={w} height={h} fill="rgba(255,255,255,0.035)" stroke="rgba(255,255,255,0.14)" />
        {seams.map((y, i) => (
          <g key={i}>
            <path d={seamPath(y)} fill="none" stroke="#ffb545" strokeWidth="1.4" />
            {gap > 0 && <line x1={left} y1={y + gap / 2} x2={left + w} y2={y + gap / 2} stroke="#6fe3b0" strokeWidth="1" strokeDasharray="2 3" />}
          </g>
        ))}
        {Array.from({ length: parts }, (_, i) => (
          <text
            key={`t${i}`}
            x={left + w / 2}
            y={top + (h * (i + 0.5)) / parts + 3}
            textAnchor="middle"
            fontSize="9"
            fill="rgba(255,255,255,0.55)"
          >
            {i + 1}
          </text>
        ))}
        <line x1={left - 6} y1={bottom} x2={left + w + 6} y2={bottom} stroke="#2b3b4b" strokeWidth="2" />
        <text x={left} y={bottom + 11} fontSize="8" fill="#ffffff55">
          {tall.toFixed(0)} mm
        </text>
        {(clearance !== 0 || connectorClearance !== 0) && (
          <text x={left + w} y={bottom + 11} textAnchor="end" fontSize="8" fill="#6fe3b099">
            Naht {clearance > 0 ? '+' : ''}{clearance.toFixed(2)} · Verbinder ±{connectorClearance.toFixed(2)} mm
          </text>
        )}
      </svg>
    </div>
  )
}

/**
 * Text direkt auf das gewählte Objekt setzen und nachjustieren: Position auf
 * der Oberseite, Größe, Drehung sowie erhaben oder eingelassen.
 */
export function TextDialog({
  modelId,
  objects,
  initialId,
  onEdit,
  onClose,
}: {
  modelId: string
  objects: ModelObjectInfo[]
  initialId?: string
  onEdit: (res: api.ModelEditResult) => Promise<void> | void
  onClose: () => void
}) {
  const editing = objects.find((o) => o.id === initialId && o.text) ?? null
  const targets = objects.filter((o) => !o.text)
  const initialTarget =
    editing?.text?.targetId ??
    objects.find((o) => o.id === initialId && !o.text)?.id ??
    targets[0]?.id ??
    ''
  const [targetId, setTargetId] = useState(initialTarget)
  const [text, setText] = useState(editing?.text?.text ?? '')
  const [fontHeight, setFontHeight] = useState(editing?.text?.fontHeight ?? 10)
  const [depth, setDepth] = useState(editing?.text?.depth ?? 0.8)
  const [rotation, setRotation] = useState(editing?.text?.rotation ?? 0)
  const [mode, setMode] = useState<'emboss' | 'engrave'>(editing?.text?.mode ?? 'emboss')
  const [offsetX, setOffsetX] = useState(editing?.text?.offsetX ?? 0)
  const [offsetY, setOffsetY] = useState(editing?.text?.offsetY ?? 0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const target = objects.find((o) => o.id === targetId) ?? targets[0] ?? null
  const maxX = target ? Math.max(5, Math.round(target.size.x / 2)) : 100
  const maxY = target ? Math.max(5, Math.round(target.size.y / 2)) : 100

  const apply = async () => {
    if (!text.trim()) {
      setError('Bitte einen Text eingeben.')
      return
    }
    if (!target) {
      setError('Kein Zielobjekt gefunden — zuerst ein Objekt laden.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const res = await api.addText(modelId, {
        id: editing?.id,
        targetId: target.id,
        text,
        fontHeight,
        depth,
        rotation,
        mode,
        offsetX,
        offsetY,
      })
      await onEdit(res)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Text konnte nicht aufgebracht werden.')
    } finally {
      setBusy(false)
    }
  }

  // Schematische Draufsicht: Objektfläche und Textposition.
  const viewW = 240
  const viewH = 120
  const pad = 14
  const bw = Math.max(1, target?.size.x ?? 40)
  const bh = Math.max(1, target?.size.y ?? 40)
  const scale = Math.min((viewW - pad * 2) / bw, (viewH - pad * 2) / bh)
  const ow = bw * scale
  const oh = bh * scale
  const left = (viewW - ow) / 2
  const top = (viewH - oh) / 2
  const tw = Math.max(4, Math.min(bw, Math.max(4, text.trim().length * fontHeight * 0.62))) * scale
  const th = Math.max(1.5, fontHeight) * scale
  const tx = left + ow / 2 + offsetX * scale
  const ty = top + oh / 2 - offsetY * scale

  return (
    <Dialog
      title={editing ? 'Text kalibrieren' : 'Text aufbringen'}
      subtitle="Der Text sitzt auf dem gewählten Objekt. Position, Größe und Tiefe lassen sich hier nachjustieren."
      onClose={onClose}
      side
      footer={
        <>
          <button type="button" onClick={onClose} className="text-[10px] text-white/40 hover:text-white/70">
            Abbrechen
          </button>
          <BusyButton
            busy={busy}
            label={editing ? 'Übernehmen' : 'Aufbringen'}
            busyLabel="Baue Schrift …"
            onClick={() => void apply()}
          />
        </>
      }
    >
      <label className="block">
        <span className={labelClass}>Zielobjekt</span>
        <select
          value={targetId}
          onChange={(e) => {
            setTargetId(e.target.value)
            setOffsetX(0)
            setOffsetY(0)
          }}
          className={`mt-1 ${fieldClass}`}
        >
          {targets.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      </label>
      <label className="mt-2 block">
        <span className={labelClass}>Text</span>
        <input
          value={text}
          maxLength={40}
          onChange={(e) => setText(e.target.value)}
          placeholder="z. B. BECKER"
          className={`mt-1 ${fieldClass}`}
        />
      </label>
      <div className="mt-2">
        <span className={labelClass}>Auftrag</span>
        <div className="mt-1 grid grid-cols-2 gap-1.5">
          {(
            [
              ['emboss', 'Erhaben (aufgedruckt)'],
              ['engrave', 'Eingelassen (vertieft)'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setMode(value)}
              className={`rounded-lg border px-2 py-1.5 text-[10px] transition ${
                mode === value ? 'border-amber/60 bg-amber/12 text-amber' : 'border-line/70 text-white/50 hover:border-white/20'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="mt-2 grid grid-cols-3 gap-2">
        <Stepper label="Schrifthöhe" unit="mm" value={fontHeight} step={1} min={3} max={60} onChange={setFontHeight} />
        <Stepper
          label={mode === 'engrave' ? 'Tiefe' : 'Höhe'}
          unit="mm"
          value={depth}
          step={0.2}
          min={0.2}
          max={mode === 'engrave' ? 3 : 4}
          onChange={setDepth}
        />
        <Stepper label="Drehung" unit="°" value={rotation} step={15} min={-360} max={360} onChange={setRotation} />
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <Stepper label="Versatz X" unit="mm" value={offsetX} step={1} min={-maxX} max={maxX} onChange={setOffsetX} />
        <Stepper label="Versatz Y" unit="mm" value={offsetY} step={1} min={-maxY} max={maxY} onChange={setOffsetY} />
      </div>
      <div className="mt-2 rounded-xl border border-line/60 bg-ink-950/40 p-2">
        <div className="mb-1 flex items-center justify-between text-[9px] text-white/40">
          <span>Draufsicht auf das Objekt</span>
          <span className="tabular">{target ? `${bw.toFixed(0)} × ${bh.toFixed(0)} mm` : '—'}</span>
        </div>
        <svg viewBox={`0 0 ${viewW} ${viewH}`} className="w-full" role="img" aria-label="Textposition auf dem Objekt">
          <rect x={left} y={top} width={ow} height={oh} rx="4" fill="rgba(147,166,187,0.18)" stroke="rgba(147,166,187,0.6)" />
          <g transform={`rotate(${-rotation} ${tx} ${ty})`}>
            <rect
              x={tx - tw / 2}
              y={ty - th / 2}
              width={tw}
              height={th}
              rx="1.5"
              fill={mode === 'engrave' ? 'rgba(255,107,107,0.55)' : 'rgba(255,181,69,0.72)'}
              stroke={mode === 'engrave' ? '#ff6b6b' : '#ffb545'}
            />
            <text x={tx} y={ty + 2.5} textAnchor="middle" fontSize={Math.max(5, Math.min(10, th * 0.7))} fill="#0b0f14">
              {text.trim().slice(0, 12) || 'TEXT'}
            </text>
          </g>
          <circle cx={left + ow / 2} cy={top + oh / 2} r="1.6" fill="#93a2c9" />
        </svg>
      </div>
      <p className="mt-2 text-[9px] leading-snug text-white/30">
        {mode === 'engrave'
          ? 'Eingelassen: Der Textkörper wird beim Slicen aus dem Objekt ausgeschnitten — im G-Code entsteht eine echte Vertiefung. Im Bild erscheint er rot.'
          : 'Erhaben: Der Text wird auf die Oberseite aufgesetzt und mit dem Objekt verbunden gedruckt.'}
      </p>
      <p className="mt-1 text-[9px] leading-snug text-white/25">
        Großbuchstaben, Ziffern und gängige Zeichen aus 5×7-Pixeln. Später einfach das Textobjekt in der Objektliste
        wählen und das Textwerkzeug erneut öffnen — alle Werte bleiben erhalten.
      </p>
      {error && <p className="mt-2 text-[10px] text-rose">{error}</p>}
    </Dialog>
  )
}

type LoadedImage = { gray: number[]; cols: number; rows: number; preview: string; name: string }

/** Liest ein PNG/JPEG im Browser als Graustufen — der Server bekommt nur Zahlen. */
async function readImage(file: File): Promise<LoadedImage> {
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error('Bild konnte nicht gelesen werden (PNG oder JPEG wählen).'))
      img.src = url
    })
    const maxWidth = 360
    const scale = Math.min(1, maxWidth / Math.max(1, img.naturalWidth))
    const cols = Math.max(8, Math.round(img.naturalWidth * scale))
    const rows = Math.max(8, Math.round(img.naturalHeight * scale))
    const canvas = document.createElement('canvas')
    canvas.width = cols
    canvas.height = rows
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Bild konnte nicht verarbeitet werden.')
    ctx.drawImage(img, 0, 0, cols, rows)
    const data = ctx.getImageData(0, 0, cols, rows).data
    const gray = new Array<number>(cols * rows)
    for (let i = 0; i < gray.length; i++) {
      const o = i * 4
      gray[i] = (0.2126 * data[o] + 0.7152 * data[o + 1] + 0.0722 * data[o + 2]) / 255
    }
    return { gray, cols, rows, preview: canvas.toDataURL('image/png'), name: file.name }
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** Lithophan-Lampe: Bild, Form, Dicke, Höhe und Kontrast einstellen. */
export function LithophaneDialog({
  onCreated,
  onClose,
}: {
  onCreated: (res: UploadedModel) => Promise<void> | void
  onClose: () => void
}) {
  const [image, setImage] = useState<LoadedImage | null>(null)
  const [shape, setShape] = useState<LithophaneShape>('flat')
  const [width, setWidth] = useState(120)
  const [height, setHeight] = useState(120)
  const [minThickness, setMinThickness] = useState(0.8)
  const [maxThickness, setMaxThickness] = useState(3)
  const [contrast, setContrast] = useState(1.2)
  const [invert, setInvert] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const load = async (file: File | undefined) => {
    if (!file) return
    setError(null)
    try {
      const loaded = await readImage(file)
      setImage(loaded)
      setHeight(Math.max(20, Math.round(((width * loaded.rows) / loaded.cols) * 10) / 10))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Bild konnte nicht gelesen werden.')
    }
  }

  const apply = async () => {
    if (!image) {
      setError('Bitte zuerst ein Bild (PNG oder JPEG) wählen.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const res = await api.createLithophane({
        name: image.name,
        gray: image.gray,
        cols: image.cols,
        rows: image.rows,
        widthMm: width,
        heightMm: height,
        minThickness,
        maxThickness: Math.max(minThickness + 0.2, maxThickness),
        contrast,
        invert,
        shape,
      })
      await onCreated(res)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Lithophane konnte nicht erzeugt werden.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      title="Lithophan-Lampe erstellen"
      subtitle="Dunkle Bildstellen werden dick, helle dünn — das Licht zeichnet das Motiv."
      onClose={onClose}
      wide
      footer={
        <>
          <span className="mr-auto text-[9px] text-white/25">
            {image ? `${image.cols} × ${image.rows} Bildpunkte` : 'PNG oder JPEG'}
          </span>
          <button type="button" onClick={onClose} className="text-[10px] text-white/40 hover:text-white/70">
            Abbrechen
          </button>
          <BusyButton busy={busy} label="Erzeugen" busyLabel="Baue Mesh …" onClick={() => void apply()} />
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-[150px_minmax(0,1fr)]">
        <div>
          <div
            role="button"
            tabIndex={0}
            onClick={() => inputRef.current?.click()}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click()
            }}
            onDragOver={(e) => {
              e.preventDefault()
              setDragOver(true)
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault()
              setDragOver(false)
              void load(e.dataTransfer.files?.[0])
            }}
            className={`flex aspect-square w-full cursor-pointer flex-col items-center justify-center overflow-hidden rounded-xl border border-dashed text-center transition ${
              dragOver ? 'border-amber/70 bg-amber/8' : 'border-line/80 bg-ink-950/40 hover:border-white/25'
            }`}
          >
            {image ? (
              <img src={image.preview} alt="Bildvorschau" className="h-full w-full object-contain" />
            ) : (
              <div className="px-2">
                <div className="text-lg text-white/25">🖼</div>
                <div className="mt-1 text-[9px] leading-snug text-white/35">Bild hierher ziehen<br />oder klicken</div>
              </div>
            )}
          </div>
          <input
            ref={inputRef}
            type="file"
            accept="image/png,image/jpeg"
            className="hidden"
            onChange={(e) => {
              void load(e.target.files?.[0])
              e.target.value = ''
            }}
          />
          <p className="mt-1.5 text-center text-[8px] leading-snug text-white/25">
            {image ? 'Klicken, um ein anderes Bild zu wählen' : 'PNG · JPEG'}
          </p>
        </div>

        <div className="space-y-2">
          <div>
            <span className={labelClass}>Form</span>
            <div className="mt-1 grid grid-cols-2 gap-1.5">
              {(
                [
                  ['flat', 'Flach (Bild)'],
                  ['cylinder', 'Rund (Lampe)'],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setShape(value)}
                  className={`rounded-lg border px-2 py-1.5 text-[10px] transition ${
                    shape === value ? 'border-amber/60 bg-amber/12 text-amber' : 'border-line/70 text-white/50 hover:border-white/20'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Stepper label="Breite" unit="mm" value={width} step={5} min={20} max={400} onChange={(v) => setWidth(v)} />
            <Stepper label="Höhe" unit="mm" value={height} step={5} min={20} max={400} onChange={setHeight} />
            <Stepper label="Dünnste Stelle" unit="mm" value={minThickness} step={0.1} min={0.3} max={5} onChange={setMinThickness} />
            <Stepper label="Dickste Stelle" unit="mm" value={maxThickness} step={0.2} min={0.5} max={10} onChange={setMaxThickness} />
          </div>
          <div>
            <div className="flex items-center justify-between">
              <span className={labelClass}>Kontrast</span>
              <span className="tabular text-[10px] text-amber">{contrast.toFixed(1)}×</span>
            </div>
            <input
              type="range"
              min="0.4"
              max="3"
              step="0.1"
              value={contrast}
              onChange={(e) => setContrast(Number(e.target.value))}
              className="mt-1 w-full accent-amber"
            />
          </div>
          <label className="flex items-center gap-2 text-[10px] text-white/50">
            <input type="checkbox" checked={invert} onChange={(e) => setInvert(e.target.checked)} className="accent-amber" />
            Helligkeit umkehren (helle Stellen dick)
          </label>
          <p className="rounded-lg border border-line/60 bg-ink-950/40 px-2 py-1.5 text-[9px] leading-snug text-white/35">
            {shape === 'cylinder'
              ? 'Runder Schirm: Breite = Umfang. Für E14/E27-Lampen 100–160 mm Durchmesser, 0,6–3 mm Dicke, oben und unten offen.'
              : 'Flache Platte für Fenster oder LED-Panel: 0,8 mm dünn, 2,5–3,5 mm dick, Kontrast 1,2–1,6.'}
          </p>
        </div>
      </div>
      {error && <p className="mt-2 text-[10px] text-rose">{error}</p>}
    </Dialog>
  )
}

/** Wählt das aktive Objekt nach Modellwechsel gültig. */
export function pickActive(objects: ModelObjectInfo[]): ModelObjectInfo | null {
  return objects.find((o) => o.placement.visible) ?? objects[0] ?? null
}

export type { ModelAnalysis, ModelPlacement }
