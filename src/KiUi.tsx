import { useEffect, useRef, useState, type ReactNode } from 'react'

type TabId = 'studio' | 'calibration' | 'printer' | 'gcode'
type ViewMode = 'perspective' | 'top'
type IconName =
  | 'studio'
  | 'target'
  | 'printer'
  | 'code'
  | 'cube'
  | 'layers'
  | 'play'
  | 'check'
  | 'monitor'
  | 'sparkle'
  | 'chevron'
  | 'plus'
  | 'minus'
  | 'upload'
  | 'download'
  | 'arrow'
  | 'clock'
  | 'scale'
  | 'sliders'
  | 'thermometer'
  | 'droplet'
  | 'fan'
  | 'grid'
  | 'more'
  | 'send'
  | 'pause'
  | 'stop'
  | 'wrench'
  | 'info'
  | 'maximize'
  | 'power'

const ICON_PATHS: Record<IconName, string[]> = {
  studio: ['M4 4h6v6H4z', 'M14 4h6v6h-6z', 'M4 14h6v6H4z', 'M14 14h6v6h-6z'],
  target: ['M12 3a9 9 0 1 0 0 18a9 9 0 0 0 0-18', 'M12 7v10', 'M7 12h10'],
  printer: ['M7 8V4h10v4', 'M6 8h12a2 2 0 0 1 2 2v6h-4v4H8v-4H4v-6a2 2 0 0 1 2-2z', 'M8 16h8'],
  code: ['m9 8-5 4 5 4', 'M15 8l5 4-5 4'],
  cube: ['M12 3 3 8v8l9 5 9-5V8z', 'M3 8l9 5 9-5', 'M12 13v8'],
  layers: ['M12 3 3 8l9 5 9-5z', 'M3 12l9 5 9-5', 'M3 16l9 5 9-5'],
  play: ['M8 5v14l11-7z'],
  check: ['m5 12 4 4L19 6'],
  monitor: ['M3 4h18v12H3z', 'M8 20h8', 'M12 16v4'],
  sparkle: ['M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z'],
  chevron: ['m6 9 6 6 6-6'],
  plus: ['M12 5v14', 'M5 12h14'],
  minus: ['M5 12h14'],
  upload: ['M12 16V4', 'm7 9 5-5 5 5', 'M5 20h14'],
  download: ['M12 4v12', 'm7 11 5 5 5-5', 'M5 20h14'],
  arrow: ['M5 12h14', 'm13 6 6 6-6 6'],
  clock: ['M12 3a9 9 0 1 0 0 18a9 9 0 0 0 0-18', 'M12 7v5l3 2'],
  scale: ['M12 3v18', 'M5 7h14', 'M5 7 2 13h6z', 'M19 7l-3 6h6z'],
  sliders: ['M4 7h10', 'M18 7h2', 'M4 17h2', 'M10 17h10', 'M14 4v6', 'M10 14v6'],
  thermometer: ['M14 14.8V6a2 2 0 0 0-4 0v8.8a4 4 0 1 0 4 0z', 'M12 10v5'],
  droplet: ['M12 3s6 6.2 6 10a6 6 0 0 1-12 0c0-3.8 6-10 6-10z'],
  fan: ['M12 12c-1-5-4-7-6-6s-1 5 4 6c1 .2 2 0 2 0z', 'M12 12c5-1 7-4 6-6s-5-1-6 4c-.2 1 0 2 0 2z', 'M12 12c1 5 4 7 6 6s1-5-4-6c-1-.2-2 0-2 0z', 'M12 12c-5 1-7 4-6 6s5 1 6-4c.2-1 0-2 0-2z'],
  grid: ['M4 4h16v16H4z', 'M4 10h16', 'M10 4v16'],
  more: ['M5 12h.01', 'M12 12h.01', 'M19 12h.01'],
  send: ['M4 4l16 8-16 8 3-8z'],
  pause: ['M8 5v14', 'M16 5v14'],
  stop: ['M6 6h12v12H6z'],
  wrench: ['M14.7 6.3a4 4 0 0 0-5-5L7 1.3', 'm4 4 4 4', 'M4 4 2 6l4 4 2-2', 'm9 9 11 11', 'm18 14 2 2'],
  info: ['M12 3a9 9 0 1 0 0 18a9 9 0 0 0 0-18', 'M12 11v5', 'M12 8h.01'],
  maximize: ['M8 3H3v5', 'M16 3h5v5', 'M8 21H3v-5', 'M16 21h5v-5'],
  power: ['M12 3v9', 'M6.3 6.3a8 8 0 1 0 11.4 0'],
}

function Icon({ name, size = 18, filled = false }: { name: IconName; size?: number; filled?: boolean }) {
  return (
    <svg
      className="ki-icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke={filled ? 'none' : 'currentColor'}
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {ICON_PATHS[name].map((path, index) => (
        <path key={index} d={path} />
      ))}
    </svg>
  )
}

const MODELS = [
  {
    id: 'flow',
    object: 'Flowwürfel',
    file: 'Flowwürfel.stl',
    size: '30 × 30 × 15 mm',
    tag: 'Fluss',
    layers: 75,
    description: 'Einwandig, offen · 0,42 mm Wand',
  },
  {
    id: 'temperature',
    object: 'TempTest',
    file: 'TempTest.stl',
    size: '18 × 18 × 48 mm',
    tag: 'Temperatur',
    layers: 244,
    description: 'Sechs Temperaturstufen · 0,20 mm',
  },
  {
    id: 'pressure',
    object: 'PA-Turm',
    file: 'PA-Turm.stl',
    size: '22 × 22 × 56 mm',
    tag: 'Pressure Advance',
    layers: 112,
    description: 'Pressure Advance · 0,020–0,080',
  },
] as const

const NAV_ITEMS: { id: TabId; label: string; detail: string; icon: IconName }[] = [
  { id: 'studio', label: 'Studio', detail: 'Vorbereiten', icon: 'studio' },
  { id: 'calibration', label: 'Kalibrieren', detail: 'Werkzeuge', icon: 'target' },
  { id: 'printer', label: 'Drucker', detail: 'Vyper · live', icon: 'printer' },
  { id: 'gcode', label: 'G-Code', detail: 'Prüfen & senden', icon: 'code' },
]

const TAB_TITLES: Record<TabId, string> = {
  studio: 'Studio',
  calibration: 'Kalibrieren',
  printer: 'Drucker',
  gcode: 'G-Code',
}

const WIN_MENUS = [
  {
    label: 'Datei',
    items: [
      { id: 'load', label: 'Modell laden …', shortcut: 'Strg+O' },
      { id: 'save', label: 'Projekt speichern', shortcut: 'Strg+S' },
      { id: 'sep' },
      { id: 'slice', label: 'Slicen', shortcut: 'Strg+R' },
      { id: 'sep' },
      { id: 'close', label: 'Schließen' },
    ],
  },
  {
    label: 'Bearbeiten',
    items: [
      { id: 'undo', label: 'Rückgängig', shortcut: 'Strg+Z' },
      { id: 'redo', label: 'Wiederholen', shortcut: 'Strg+Y' },
      { id: 'sep' },
      { id: 'settings', label: 'Einstellungen …' },
    ],
  },
  {
    label: 'Ansicht',
    items: [
      { id: 'ki-design', label: 'KI-Design', shortcut: 'F6' },
      { id: 'classic-design', label: 'Windows Klassisch', shortcut: 'F7' },
      { id: 'sep' },
      { id: 'fit', label: 'Ansicht einpassen' },
    ],
  },
  {
    label: 'Modell',
    items: [
      { id: 'center', label: 'Auf Platte zentrieren' },
      { id: 'scale', label: 'Skalieren …' },
      { id: 'repair', label: 'Mesh prüfen' },
    ],
  },
  {
    label: 'Drucken',
    items: [
      { id: 'preview', label: 'Druckvorschau' },
      { id: 'send', label: 'An Drucker senden …' },
    ],
  },
  {
    label: 'Hilfe',
    items: [{ id: 'about', label: 'Über diesen KI-UI-Test' }],
  },
] as const

function LogoMark({ small = false }: { small?: boolean }) {
  return (
    <span className={`logo-mark${small ? ' logo-mark--small' : ''}`} aria-hidden="true">
      <svg viewBox="0 0 40 40">
        <rect x="1" y="1" width="38" height="38" rx="10" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <path d="M9 25.5 20 20l11 5.5L20 31z" fill="currentColor" opacity=".92" />
        <path d="M9 19.5 20 14l11 5.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" opacity=".68" />
        <path d="M14 10h12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" opacity=".4" />
        <path d="m9 32 22-24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" opacity=".58" />
      </svg>
    </span>
  )
}

function Panel({
  title,
  hint,
  action,
  children,
  className = '',
}: {
  title: string
  hint?: ReactNode
  action?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={`panel ${className}`}>
      <div className="panel-head">
        <div className="panel-heading">
          <span className="panel-title">{title}</span>
          {hint && <span className="panel-hint">{hint}</span>}
        </div>
        {action}
      </div>
      <div className="panel-body">{children}</div>
    </section>
  )
}

function MiniCube() {
  return (
    <svg className="mini-cube" viewBox="0 0 80 80" aria-hidden="true">
      <path d="m40 10 26 14v31L40 70 14 55V24z" fill="currentColor" opacity=".1" />
      <path d="m40 10 26 14-26 14-26-14z" fill="currentColor" opacity=".24" />
      <path d="M14 24v31l26 15V38z" fill="currentColor" opacity=".15" />
      <path d="M66 24v31L40 70V38z" fill="currentColor" opacity=".29" />
      <path d="m40 10 26 14v31L40 70 14 55V24zM14 24l26 14 26-14M40 38v32" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="m40 16 18 10-18 10-18-10z" fill="none" stroke="currentColor" strokeWidth="1.2" opacity=".7" />
    </svg>
  )
}

function FlowCube({ layer, layers, topView }: { layer: number; layers: number; topView: boolean }) {
  const fraction = Math.max(0, Math.min(1, layer / Math.max(1, layers - 1)))
  const highlighted = Math.round(fraction * 17)

  const bedLines = Array.from({ length: 9 }, (_, index) => {
    const t = index / 8
    return {
      left: { x: -220 + t * 220, y: 40 + t * 110 },
      right: { x: 220 - t * 220, y: 40 + t * 110 },
      back: { x: -220 + t * 220, y: 40 - t * 110 },
      front: { x: 220 - t * 220, y: 40 - t * 110 },
    }
  })

  if (topView) {
    return (
      <svg className="cube-svg" viewBox="0 0 700 500" role="img" aria-label="Draufsicht auf den offenen Flowwürfel">
        <defs>
          <linearGradient id="topRim" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#a6ead8" />
            <stop offset=".5" stopColor="#42b99e" />
            <stop offset="1" stopColor="#167e6e" />
          </linearGradient>
          <radialGradient id="topGlow" cx=".5" cy=".45" r=".7">
            <stop offset="0" stopColor="#3dd9b6" stopOpacity=".18" />
            <stop offset="1" stopColor="#3dd9b6" stopOpacity="0" />
          </radialGradient>
        </defs>
        <rect width="700" height="500" fill="#10221e" />
        <circle cx="350" cy="250" r="250" fill="url(#topGlow)" />
        <g transform="translate(350 255)">
          <path d="M0-145 240 0 0 145-240 0z" fill="#18332c" stroke="#517b6d" strokeWidth="1.2" />
          <path d="M0-110 185 0 0 110-185 0z" fill="#0c1b18" stroke="#7bb5a4" strokeWidth="1.4" />
          <path d="M0-145 240 0 0 145-240 0z M0-110 185 0 0 110-185 0z" fill="#4fd0b0" fillRule="evenodd" opacity=".44" />
          <path d="M0-145 240 0 0 145-240 0z M0-110 185 0 0 110-185 0z" fill="none" stroke="#a9f1de" strokeWidth="1.2" />
          <path d="M0-122 212 0 0 122-212 0z" fill="none" stroke="#ffb36b" strokeWidth="1.5" strokeDasharray="4 5" opacity=".75" />
          <text x="0" y="4" textAnchor="middle" fill="#dffbf2" fontSize="13" fontFamily="ui-monospace, SFMono-Regular, monospace">30 × 30 mm</text>
          <text x="0" y="25" textAnchor="middle" fill="#77a89a" fontSize="10" fontFamily="ui-monospace, SFMono-Regular, monospace">0,42 mm WAND</text>
        </g>
        <g fill="#6d9f90" fontSize="9" fontFamily="ui-monospace, SFMono-Regular, monospace">
          <text x="70" y="426">DRAUFSICHT · FLOWWÜRFEL</text>
          <text x="618" y="426">75 SCHICHTEN</text>
        </g>
      </svg>
    )
  }

  return (
    <svg className="cube-svg" viewBox="0 0 700 500" role="img" aria-label="Isometrische Vorschau des offenen Flowwürfels">
      <defs>
        <linearGradient id="bed" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1d3c33" />
          <stop offset="1" stopColor="#0d201c" />
        </linearGradient>
        <linearGradient id="leftWall" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#43bea3" />
          <stop offset="1" stopColor="#196b5d" />
        </linearGradient>
        <linearGradient id="rightWall" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#2d9a86" />
          <stop offset="1" stopColor="#0e5148" />
        </linearGradient>
        <radialGradient id="sceneGlow" cx=".5" cy=".46" r=".62">
          <stop offset="0" stopColor="#41d7b2" stopOpacity=".2" />
          <stop offset="1" stopColor="#41d7b2" stopOpacity="0" />
        </radialGradient>
        <filter id="lineGlow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="2.4" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <clipPath id="bedClip">
          <path d="M0-76 230 42 0 160-230 42z" />
        </clipPath>
      </defs>

      <rect width="700" height="500" fill="#10221e" />
      <circle cx="352" cy="230" r="260" fill="url(#sceneGlow)" />

      <g transform="translate(350 204)">
        <ellipse cx="0" cy="142" rx="220" ry="58" fill="#06120f" opacity=".55" />
        <path d="M0-76 230 42 0 160-230 42z" fill="url(#bed)" stroke="#3f7567" strokeWidth="1" />
        <g clipPath="url(#bedClip)" stroke="#35665a" strokeWidth=".7" opacity=".42">
          {bedLines.map((line, index) => (
            <path key={`x-${index}`} d={`M${line.left.x} ${line.left.y} L${line.right.x} ${line.right.y}`} />
          ))}
          {bedLines.map((line, index) => (
            <path key={`y-${index}`} d={`M${line.back.x} ${line.back.y} L${line.front.x} ${line.front.y}`} />
          ))}
        </g>

        {/* Brim außen um die offene Hülle */}
        <path d="M0-104 254 34 0 178-254 34z" fill="none" stroke="#7ba99b" strokeWidth="3" opacity=".55" />
        <path d="M0-92 246 37 0 168-246 37z" fill="none" stroke="#ffae69" strokeWidth="1.2" strokeDasharray="3 5" opacity=".7" />

        {/* offene Hülle: Außenwände */}
        <path d="M-130-16 0 48 0 148-130 84z" fill="url(#leftWall)" />
        <path d="M0 48 130-16 130 84 0 148z" fill="url(#rightWall)" />

        {/* Innenwände, sichtbar durch die offene Oberseite */}
        <path d="M0-58 105-8 105 92 0 42z" fill="#0e3d35" stroke="#62b7a5" strokeWidth="1" />
        <path d="M-105-8 0-58 0 42-105 92z" fill="#0a302a" stroke="#62b7a5" strokeWidth="1" />

        {/* einzelne Wandlinien */}
        {Array.from({ length: 18 }, (_, index) => {
          const t = (index + 1) / 19
          const y = t * 100
          const active = index === highlighted
          return (
            <g key={index}>
              <path d={`M-130 ${-16 + y} L0 ${48 + y}`} fill="none" stroke={active ? '#ffc080' : '#9be4d1'} strokeWidth={active ? 2.2 : 0.7} opacity={active ? 1 : 0.34} />
              <path d={`M0 ${48 + y} L130 ${-16 + y}`} fill="none" stroke={active ? '#ffb36b' : '#9be4d1'} strokeWidth={active ? 2.2 : 0.7} opacity={active ? 1 : 0.27} />
            </g>
          )
        })}

        {/* aktuelle Schicht als leuchtende Bahn */}
        {(() => {
          const y = (highlighted + 1) / 19 * 100
          return (
            <g filter="url(#lineGlow)">
              <path d={`M-130 ${-16 + y} L0 ${48 + y} L130 ${-16 + y}`} fill="none" stroke="#ffb36b" strokeWidth="2.8" />
            </g>
          )
        })()}

        {/* oberer Rand */}
        <path d="M0-80 130-16 0 48-130-16z" fill="#60d2b6" opacity=".2" />
        <path d="M0-80 130-16 0 48-130-16z M0-58 105-8 0 42-105-8z" fill="#b7f3e4" fillRule="evenodd" />
        <path d="M0-80 130-16 0 48-130-16z M0-58 105-8 0 42-105-8z" fill="none" stroke="#c5faed" strokeWidth="1.2" />
        <path d="M0-80 130-16 0 48-130-16z" fill="none" stroke="#e2fff7" strokeWidth="1.3" opacity=".75" />

        {/* offene Oberseite andeuten */}
        <path d="M0-58 105-8 0 42-105-8z" fill="#091814" opacity=".6" />
        <path d="M-105-8 0 42 0 92-105 42z" fill="none" stroke="#6ccab6" strokeWidth="1" opacity=".55" />
        <path d="M0 42 105-8 105 42 0 92z" fill="none" stroke="#6ccab6" strokeWidth="1" opacity=".55" />

        {/* Maßhilfslinien */}
        <g stroke="#8bc7b8" strokeWidth="1" opacity=".65">
          <path d="M-158 62v44" />
          <path d="M-158 62h12" />
          <path d="M-158 106h12" />
        </g>
        <text x="-174" y="89" fill="#bcefe2" fontSize="10" textAnchor="middle" transform="rotate(-90 -174 89)" fontFamily="ui-monospace, SFMono-Regular, monospace">15 mm</text>
        <path d="M-64 159h128" stroke="#8bc7b8" strokeWidth="1" opacity=".45" strokeDasharray="3 4" />
        <text x="0" y="179" fill="#bcefe2" fontSize="10" textAnchor="middle" fontFamily="ui-monospace, SFMono-Regular, monospace">30 mm</text>
      </g>

      <g transform="translate(622 396)" fill="none" strokeWidth="1.3">
        <path d="M0 0 42 21" stroke="#ef7c45" />
        <path d="M0 0 0-42" stroke="#6fe3b0" />
        <path d="M0 0-32 30" stroke="#7ca9ff" />
        <circle cx="0" cy="0" r="2.5" fill="#effbf7" stroke="none" />
      </g>
      <g fill="#8eb7a9" fontSize="9" fontFamily="ui-monospace, SFMono-Regular, monospace">
        <text x="56" y="450">FLOWWÜRFEL · EINWANDIG · OFFEN</text>
        <text x="570" y="450">DRAG = DREHEN</text>
      </g>
    </svg>
  )
}

function StudioView({
  activeModel,
  setModelId,
  viewMode,
  setViewMode,
  layer,
  setLayer,
  showAll,
  setShowAll,
  layerHeight,
  setLayerHeight,
  walls,
  setWalls,
  infill,
  setInfill,
  speed,
  setSpeed,
  slicing,
  runSlice,
  setTab,
  notify,
}: {
  activeModel: (typeof MODELS)[number]
  setModelId: (id: string) => void
  viewMode: ViewMode
  setViewMode: (mode: ViewMode) => void
  layer: number
  setLayer: (layer: number) => void
  showAll: boolean
  setShowAll: (show: boolean) => void
  layerHeight: number
  setLayerHeight: (value: number) => void
  walls: number
  setWalls: (value: number) => void
  infill: number
  setInfill: (value: number) => void
  speed: number
  setSpeed: (value: number) => void
  slicing: boolean
  runSlice: () => void
  setTab: (tab: TabId) => void
  notify: (message: string) => void
}) {
  return (
    <>
      <div className="view-head">
        <div>
          <div className="eyebrow">Projekt / Vorbereitung</div>
          <div className="title-row">
            <h1>{activeModel.object}</h1>
            <span className="head-tag">{activeModel.tag}</span>
          </div>
          <div className="head-meta">
            <span>{activeModel.file}</span>
            <span className="meta-dot" />
            <span>{activeModel.size}</span>
            <span className="meta-dot" />
            <span>PLA Basic · 0,4 mm Düse</span>
          </div>
        </div>
        <div className="view-actions">
          <button className="btn btn-ghost" type="button" onClick={() => notify('Modellwahl ist in diesem UI-Test eine Demo.')}>
            <Icon name="upload" size={16} />
            Modell laden
          </button>
          <button className="btn btn-primary" type="button" onClick={runSlice} disabled={slicing}>
            <Icon name={slicing ? 'clock' : 'play'} size={16} filled={!slicing} />
            {slicing ? 'Wird geslict …' : 'Slicen'}
          </button>
        </div>
      </div>

      <div className="studio-grid">
        <div className="stack">
          <Panel title="Modell" hint="1 Objekt">
            <div className="model-file">
              <div className="model-thumb">
                <MiniCube />
              </div>
              <div className="model-file-copy">
                <strong>{activeModel.file}</strong>
                <span>{activeModel.description}</span>
              </div>
              <button className="icon-btn" type="button" title="Objektoptionen" onClick={() => notify('Objektoptionen: Demo-Ansicht.')}>
                <Icon name="more" size={18} />
              </button>
            </div>

            <div className="object-list" aria-label="Modell wählen">
              {MODELS.map((model) => (
                <button
                  key={model.id}
                  type="button"
                  className={`object-row${model.id === activeModel.id ? ' is-selected' : ''}`}
                  onClick={() => {
                    setModelId(model.id)
                    notify(`${model.object} ausgewählt.`)
                  }}
                >
                  <span className="object-mark">
                    <Icon name={model.id === 'flow' ? 'cube' : model.id === 'temperature' ? 'thermometer' : 'sliders'} size={14} />
                  </span>
                  <span className="object-copy">
                    <strong>{model.object}</strong>
                    <span>{model.size}</span>
                  </span>
                  {model.id === activeModel.id && <Icon name="check" size={14} />}
                </button>
              ))}
            </div>

            <button className="upload-row" type="button" onClick={() => notify('Datei-Upload ist in diesem UI-Test deaktiviert.')}>
              <Icon name="plus" size={16} />
              <span>STL oder 3MF hinzufügen</span>
              <kbd>Strg I</kbd>
            </button>
          </Panel>

          <Panel title="Material">
            <div className="material-row">
              <span className="filament-dot" />
              <div className="material-copy">
                <strong>PLA Basic</strong>
                <span>Generic · 1,75 mm</span>
              </div>
              <span className="soft-badge">0,95 Flow</span>
            </div>
            <dl className="spec-list">
              <div>
                <dt>Düse</dt>
                <dd>0,4 mm · Messing</dd>
              </div>
              <div>
                <dt>Temperatur</dt>
                <dd>195 / 65 °C</dd>
              </div>
              <div>
                <dt>Platte</dt>
                <dd>Textured PEI</dd>
              </div>
            </dl>
            <button className="text-btn" type="button" onClick={() => notify('Materialprofil öffnen: Demo-Ansicht.')}>
              Profil bearbeiten
              <Icon name="arrow" size={14} />
            </button>
          </Panel>

          <div className="tip-card">
            <div className="tip-icon">
              <Icon name="layers" size={17} />
            </div>
            <div>
              <strong>Einwandiger Test</strong>
              <p>Kein Boden, kein Deckel und nur eine Wand. So misst du den Fluss ohne Füllung.</p>
            </div>
          </div>
        </div>

        <div className="viewport-card">
          <div className="viewport-toolbar">
            <div className="segmented segmented-dark" role="group" aria-label="Ansicht">
              <button
                type="button"
                className={viewMode === 'perspective' ? 'is-active' : ''}
                onClick={() => setViewMode('perspective')}
              >
                Perspektive
              </button>
              <button type="button" className={viewMode === 'top' ? 'is-active' : ''} onClick={() => setViewMode('top')}>
                Draufsicht
              </button>
            </div>
            <div className="viewport-tools">
              <span className="viewport-count">{activeModel.layers} Schichten</span>
              <button className="dark-icon-btn" type="button" title="Ansicht einpassen" onClick={() => notify('Ansicht wurde eingepasst.')}>
                <Icon name="maximize" size={16} />
              </button>
            </div>
          </div>

          <div className={`viewport-canvas${showAll ? ' show-all' : ''}`}>
            <FlowCube layer={layer} layers={activeModel.layers} topView={viewMode === 'top'} />
            <div className="viewport-watermark">
              <span className="live-dot" />
              Live-Vorschau
            </div>
            <div className="viewport-info">
              <span>Ansicht</span>
              <strong>{viewMode === 'top' ? 'Draufsicht' : 'Isometrie'}</strong>
            </div>
            {slicing && (
              <div className="slice-overlay">
                <div className="slice-spinner" />
                <strong>Schichten werden berechnet</strong>
                <span>Werkzeugweg · 75 Schichten</span>
                <div className="slice-progress">
                  <span />
                </div>
              </div>
            )}
          </div>

          <div className="layer-bar">
            <button
              className={`layer-play${slicing ? ' is-busy' : ''}`}
              type="button"
              onClick={() => notify('Schichtvorschau: Demo.')}
              aria-label="Schichtvorschau abspielen"
            >
              <Icon name={slicing ? 'clock' : 'play'} size={13} filled={!slicing} />
            </button>
            <div className="layer-slider-wrap">
              <div className="layer-slider-label">
                <span>Schicht</span>
                <strong>
                  {Math.min(activeModel.layers, layer + 1)} <em>/ {activeModel.layers}</em>
                </strong>
              </div>
              <input
                className="range range-dark"
                type="range"
                min={0}
                max={activeModel.layers - 1}
                value={Math.min(layer, activeModel.layers - 1)}
                onChange={(event) => setLayer(Number(event.target.value))}
                aria-label="Schicht auswählen"
              />
            </div>
            <button
              type="button"
              className={`show-all${showAll ? ' is-active' : ''}`}
              aria-pressed={showAll}
              onClick={() => setShowAll(!showAll)}
            >
              Alle
            </button>
          </div>
        </div>

        <div className="stack">
          <Panel
            title="Druckprofil"
            action={
              <button className="text-btn text-btn-muted" type="button" onClick={() => notify('Profilwerte zurückgesetzt: Demo.')}>
                Zurücksetzen
              </button>
            }
          >
            <button className="quality-tile" type="button" onClick={() => notify('Qualitätsprofil wechseln: Demo-Ansicht.')}>
              <div>
                <span>Qualität</span>
                <strong>Ausgewogen</strong>
                <small>0,20 mm · feine Oberfläche</small>
              </div>
              <span className="quality-change">
                Ändern <Icon name="chevron" size={13} />
              </span>
            </button>

            <div className="profile-metrics">
              <div>
                <strong>{layerHeight.toFixed(2)}</strong>
                <span>mm</span>
                <small>Schicht</small>
              </div>
              <div>
                <strong>{walls}</strong>
                <span>×</span>
                <small>Wand</small>
              </div>
              <div>
                <strong>{infill}</strong>
                <span>%</span>
                <small>Füllung</small>
              </div>
            </div>

            <div className="section-label">Feinabstimmung</div>

            <div className="range-row">
              <div className="range-top">
                <span>Schichthöhe</span>
                <strong>{layerHeight.toFixed(2)} mm</strong>
              </div>
              <input
                className="range"
                type="range"
                min="0.12"
                max="0.28"
                step="0.02"
                value={layerHeight}
                onChange={(event) => setLayerHeight(Number(event.target.value))}
                aria-label="Schichthöhe"
              />
            </div>

            <div className="control-row">
              <span>Wände</span>
              <div className="stepper">
                <button type="button" onClick={() => setWalls(Math.max(1, walls - 1))} aria-label="Wand reduzieren">
                  <Icon name="minus" size={12} />
                </button>
                <strong>{walls}</strong>
                <button type="button" onClick={() => setWalls(Math.min(6, walls + 1))} aria-label="Wand erhöhen">
                  <Icon name="plus" size={12} />
                </button>
              </div>
            </div>

            <div className="range-row">
              <div className="range-top">
                <span>Füllung</span>
                <strong>{infill} %</strong>
              </div>
              <input
                className="range"
                type="range"
                min="0"
                max="50"
                step="5"
                value={infill}
                onChange={(event) => setInfill(Number(event.target.value))}
                aria-label="Füllung"
              />
            </div>

            <div className="range-row">
              <div className="range-top">
                <span>Außenwand-Tempo</span>
                <strong>{speed} mm/s</strong>
              </div>
              <input
                className="range"
                type="range"
                min="20"
                max="100"
                step="5"
                value={speed}
                onChange={(event) => setSpeed(Number(event.target.value))}
                aria-label="Außenwand-Tempo"
              />
            </div>

            <div className={`slice-result${slicing ? ' is-slicing' : ''}`}>
              <div className="result-top">
                <span className="result-status">
                  <span className="result-dot" />
                  {slicing ? 'Wird berechnet …' : 'Bereit zum Drucken'}
                </span>
                <span className="result-layers">{activeModel.layers} Schichten</span>
              </div>
              <div className="result-stats">
                <div>
                  <strong>24</strong>
                  <span>min</span>
                </div>
                <div>
                  <strong>3,2</strong>
                  <span>g</span>
                </div>
                <div>
                  <strong>1,8</strong>
                  <span>m</span>
                </div>
              </div>
              <button className="result-link" type="button" onClick={() => setTab('gcode')}>
                G-Code ansehen
                <Icon name="arrow" size={14} />
              </button>
            </div>
          </Panel>

          <Panel title="Kalibrierwerte" hint="PLA Basic">
            <div className="calib-mini-grid">
              <div>
                <span>Flow</span>
                <strong>0,95</strong>
                <em>geprüft</em>
              </div>
              <div>
                <span>Pressure Advance</span>
                <strong>0,025</strong>
                <em>gesetzt</em>
              </div>
              <div>
                <span>Temperatur</span>
                <strong>195 °C</strong>
                <em>optimal</em>
              </div>
            </div>
            <button className="text-btn calib-link" type="button" onClick={() => setTab('calibration')}>
              Kalibrierung öffnen
              <Icon name="arrow" size={14} />
            </button>
          </Panel>
        </div>
      </div>
    </>
  )
}

function CalibrationView({ notify, prepareCalibration }: { notify: (message: string) => void; prepareCalibration: (name: string, modelId: string) => void }) {
  const cards = [
    {
      index: '02',
      title: 'Temperatur',
      text: 'Sechs Stufen. Die niedrigste Temperatur mit sauberer Oberfläche gewinnt.',
      value: '210 → 185 °C',
      icon: 'thermometer' as IconName,
      model: 'temperature',
    },
    {
      index: '03',
      title: 'Pressure Advance',
      text: 'Der Turm zeigt, bei welchem Wert Ecken und Nähte sauber schließen.',
      value: '0,020 → 0,080',
      icon: 'sliders' as IconName,
      model: 'pressure',
    },
    {
      index: '04',
      title: 'Retract',
      text: 'Die kleinste Distanz ohne Fäden. Zwei Türme, ein sauberer Weg.',
      value: '0,2 → 1,4 mm',
      icon: 'arrow' as IconName,
      model: 'flow',
    },
    {
      index: '05',
      title: 'Max. Volumenstrom',
      text: 'Ab welchem Durchfluss bricht die Extrusion ab? Der Turm zeigt es.',
      value: '5 → 20 mm³/s',
      icon: 'droplet' as IconName,
      model: 'flow',
    },
  ]

  return (
    <>
      <div className="view-head">
        <div>
          <div className="eyebrow">Kalibrierung / Werkzeuge</div>
          <h1>Dein Filament. Deine Werte.</h1>
          <p className="head-description">Ein klarer Weg statt zehn Schrauben. Jeder Test misst genau eine Sache.</p>
        </div>
        <div className="cal-progress">
          <div className="cal-progress-ring">
            <span>1</span>
            <small>/ 5</small>
          </div>
          <div>
            <strong>Grundlage steht</strong>
            <span>Flow ist der nächste Schritt</span>
          </div>
        </div>
      </div>

      <div className="cal-top">
        <section className="cal-hero">
          <div className="cal-hero-copy">
            <span className="step-badge">01 · ZUERST</span>
            <h2>Flowwürfel</h2>
            <p>
              Ein offener Würfel mit genau einer Wand. Kein Boden, kein Deckel, keine Füllung — damit die Wandstärke
              wirklich den Fluss zeigt.
            </p>
            <div className="cal-facts">
              <span>
                <strong>30 mm</strong> Kantenlänge
              </span>
              <span>
                <strong>0,42 mm</strong> Wand
              </span>
              <span>
                <strong>75</strong> Schichten
              </span>
            </div>
            <button className="btn btn-primary" type="button" onClick={() => prepareCalibration('Flowwürfel', 'flow')}>
              <Icon name="play" size={15} filled />
              Flowwürfel vorbereiten
            </button>
          </div>
          <div className="cal-hero-art">
            <FlowCube layer={42} layers={75} topView={false} />
            <span className="art-label">EINWANDIG · OFFEN</span>
          </div>
        </section>

        <aside className="cal-checklist panel">
          <div className="panel-head">
            <div className="panel-heading">
              <span className="panel-title">Dein Fortschritt</span>
              <span className="panel-hint">Profil: PLA Basic</span>
            </div>
          </div>
          <div className="panel-body">
            <div className="check-item is-done">
              <span className="check-dot">
                <Icon name="check" size={11} />
              </span>
              <div>
                <strong>Düse &amp; Bett</strong>
                <span>195 / 65 °C</span>
              </div>
              <em>passt</em>
            </div>
            <div className="check-item is-current">
              <span className="check-dot">1</span>
              <div>
                <strong>Fluss</strong>
                <span>Wandstärke messen</span>
              </div>
              <em>jetzt</em>
            </div>
            <div className="check-item">
              <span className="check-dot">2</span>
              <div>
                <strong>Temperatur</strong>
                <span>Oberfläche prüfen</span>
              </div>
            </div>
            <div className="check-item">
              <span className="check-dot">3</span>
              <div>
                <strong>Pressure Advance</strong>
                <span>Ecken &amp; Nähte</span>
              </div>
            </div>
            <button className="text-btn checklist-link" type="button" onClick={() => notify('Kalibrierprofil öffnen: Demo-Ansicht.')}>
              Werte als Profil speichern
              <Icon name="arrow" size={14} />
            </button>
          </div>
        </aside>
      </div>

      <div className="section-head">
        <div>
          <span className="section-label">Weitere Tests</span>
          <span className="section-sub">Der Reihe nach, nicht alles auf einmal.</span>
        </div>
        <span className="soft-badge">4 Werkzeuge</span>
      </div>

      <div className="cal-grid">
        {cards.map((card) => (
          <button
            key={card.index}
            className="cal-card"
            type="button"
            onClick={() => prepareCalibration(card.title, card.model)}
          >
            <span className="cal-card-top">
              <span className="cal-card-icon">
                <Icon name={card.icon} size={18} />
              </span>
              <span className="cal-card-index">{card.index}</span>
            </span>
            <strong>{card.title}</strong>
            <span className="cal-card-text">{card.text}</span>
            <span className="cal-card-foot">
              <span>{card.value}</span>
              <Icon name="arrow" size={15} />
            </span>
          </button>
        ))}
      </div>
    </>
  )
}

function PrinterView({ notify }: { notify: (message: string) => void }) {
  return (
    <>
      <div className="view-head">
        <div>
          <div className="eyebrow">Drucker / Live</div>
          <div className="title-row">
            <h1>Anycubic Vyper</h1>
            <span className="status-badge">
              <span className="live-dot" />
              Verbunden
            </span>
          </div>
          <div className="head-meta">
            <span>192.168.178.41</span>
            <span className="meta-dot" />
            <span>Klipper</span>
            <span className="meta-dot" />
            <span>Bett 220 × 220 mm</span>
          </div>
        </div>
        <div className="view-actions">
          <button className="btn btn-ghost" type="button" onClick={() => notify('Druckereinstellungen: Demo-Ansicht.')}>
            <Icon name="sliders" size={16} />
            Einstellungen
          </button>
          <button className="btn btn-primary" type="button" onClick={() => notify('Demo: Es wurde kein Druck gestartet.')}>
            <Icon name="power" size={15} />
            Verbindung trennen
          </button>
        </div>
      </div>

      <div className="printer-grid">
        <section className="printer-hero">
          <div className="printer-hero-head">
            <div>
              <span className="eyebrow">Aktueller Auftrag</span>
              <h2>Flowwürfel.gcode</h2>
              <p>PLA Basic · 0,20 mm · 75 Schichten</p>
            </div>
            <span className="printer-state">Druckt</span>
          </div>
          <div className="print-progress-copy">
            <strong>38 %</strong>
            <span>12:18 min verbleibend</span>
          </div>
          <div className="print-progress">
            <span />
          </div>
          <div className="print-meta">
            <span>
              <Icon name="layers" size={14} /> Schicht 29 / 75
            </span>
            <span>
              <Icon name="thermometer" size={14} /> Düse 195 °C
            </span>
            <span>
              <Icon name="clock" size={14} /> 24 min gesamt
            </span>
          </div>
          <div className="printer-actions">
            <button className="btn btn-ghost" type="button" onClick={() => notify('Demo: Pause würde den Druck anhalten.')}>
              <Icon name="pause" size={15} />
              Pause
            </button>
            <button className="btn btn-danger" type="button" onClick={() => notify('Demo: Der Druck wurde nicht abgebrochen.')}>
              <Icon name="stop" size={14} />
              Abbrechen
            </button>
          </div>
        </section>

        <div className="printer-side">
          <Panel title="Temperaturen" hint="Live">
            <div className="temp-row">
              <div className="temp-icon temp-icon--nozzle">
                <Icon name="thermometer" size={18} />
              </div>
              <div className="temp-copy">
                <span>Düse</span>
                <strong>195 <small>°C</small></strong>
              </div>
              <div className="temp-target">Ziel 195°</div>
            </div>
            <div className="temp-meter">
              <span style={{ width: '76%' }} />
            </div>
            <div className="temp-row">
              <div className="temp-icon temp-icon--bed">
                <Icon name="grid" size={18} />
              </div>
              <div className="temp-copy">
                <span>Bett</span>
                <strong>65 <small>°C</small></strong>
              </div>
              <div className="temp-target">Ziel 65°</div>
            </div>
            <div className="temp-meter temp-meter--bed">
              <span style={{ width: '54%' }} />
            </div>
          </Panel>
          <Panel title="Schnellzugriff">
            <div className="quick-grid">
              <button type="button" onClick={() => notify('Demo: Düse auf 200 °C heizen.')}>
                <Icon name="thermometer" size={16} />
                Aufheizen
              </button>
              <button type="button" onClick={() => notify('Demo: Bett auf 60 °C heizen.')}>
                <Icon name="grid" size={16} />
                Bett heizen
              </button>
              <button type="button" onClick={() => notify('Demo: Achsen werden nicht bewegt.')}>
                <Icon name="cube" size={16} />
                Achsen
              </button>
              <button type="button" onClick={() => notify('Demo: Datei würde auf den Drucker geladen.')}>
                <Icon name="upload" size={16} />
                Datei senden
              </button>
            </div>
          </Panel>
        </div>
      </div>

      <div className="printer-lower">
        <Panel title="Letzte Meldungen" action={<span className="soft-badge">Live</span>}>
          <div className="log-list">
            <div>
              <span className="log-time">12:42:08</span>
              <span>Druck gestartet · Flowwürfel.gcode</span>
            </div>
            <div>
              <span className="log-time">12:42:04</span>
              <span>Bett-Mesh geladen · 65 Punkte</span>
            </div>
            <div>
              <span className="log-time">12:41:57</span>
              <span>Düse und Bett erreichen Zieltemperatur</span>
            </div>
            <div>
              <span className="log-time">12:41:38</span>
              <span>Verbindung zu Klipper hergestellt</span>
            </div>
          </div>
        </Panel>
        <Panel title="Wartung" hint="Alles im grünen Bereich">
          <div className="maintenance-row">
            <span className="maintenance-icon">
              <Icon name="wrench" size={17} />
            </span>
            <div>
              <strong>Düse prüfen</strong>
              <span>zuletzt vor 2 Tagen</span>
            </div>
            <span className="status-mini status-mini--ok">OK</span>
          </div>
          <div className="maintenance-row">
            <span className="maintenance-icon">
              <Icon name="fan" size={17} />
            </span>
            <div>
              <strong>Lüfter reinigen</strong>
              <span>in 12 Betriebsstunden</span>
            </div>
            <span className="status-mini">bald</span>
          </div>
          <div className="maintenance-row">
            <span className="maintenance-icon">
              <Icon name="scale" size={17} />
            </span>
            <div>
              <strong>Bett nivellieren</strong>
              <span>Mesh vom 12.11. · 65 Punkte</span>
            </div>
            <span className="status-mini status-mini--ok">OK</span>
          </div>
        </Panel>
      </div>
    </>
  )
}

const GCODE_LINES: [number, string, string][] = [
  [1, '; Easy Slicer 0.2 · Flowwürfel · PLA Basic', 'comment'],
  [2, '; 0,20 mm · 75 Schichten · 30 × 30 × 15 mm', 'comment'],
  [3, 'M140 S65', 'command'],
  [4, 'M104 S195', 'command'],
  [5, 'G28 ; Home all axes', 'command'],
  [6, 'G1 Z5 F600', 'move'],
  [7, 'M190 S65', 'command'],
  [8, 'M109 S195', 'command'],
  [9, '; --- Layer 1 ---', 'comment'],
  [10, 'G1 X120 Y120 F6000', 'move'],
  [11, 'G1 Z0.20 F600', 'move'],
  [12, 'G1 E2.4 F1200', 'extrude'],
  [13, 'G1 X135 Y120 E3.05', 'extrude'],
  [14, 'G1 X135 Y135 E3.70', 'extrude'],
  [15, 'G1 X120 Y135 E4.36', 'extrude'],
  [16, 'G1 X120 Y120 E5.01', 'extrude'],
  [17, '; --- Layer 2 ---', 'comment'],
  [18, 'G1 Z0.40 F600', 'move'],
  [19, 'G1 X120.42 Y120.42 F9000', 'move'],
  [20, 'G1 X134.58 Y135.58 E0.91', 'extrude'],
  [21, 'G1 X135.58 Y134.58 E1.01', 'extrude'],
  [22, '; --- Layer 3 ---', 'comment'],
  [23, 'G1 Z0.60 F600', 'move'],
  [24, 'M106 S255 ; Bauteilkühlung', 'command'],
  [25, 'G1 X120.84 Y120.84 F9000', 'move'],
  [26, 'G1 X134.16 Y134.16 E0.94', 'extrude'],
  [27, '; ... 72 weitere Schichten ...', 'comment'],
  [28, 'M104 S0 ; Düse aus', 'command'],
  [29, 'M140 S0 ; Bett aus', 'command'],
  [30, 'G91', 'command'],
  [31, 'G1 Z10 F600', 'move'],
  [32, 'G90', 'command'],
  [33, 'M84 ; Motoren aus', 'command'],
]

function GcodeView({ notify }: { notify: (message: string) => void }) {
  return (
    <>
      <div className="view-head">
        <div>
          <div className="eyebrow">G-Code / Prüfen</div>
          <div className="title-row">
            <h1>Flowwürfel.gcode</h1>
            <span className="head-tag">Bereit</span>
          </div>
          <div className="head-meta">
            <span>157 KB</span>
            <span className="meta-dot" />
            <span>75 Schichten</span>
            <span className="meta-dot" />
            <span>24 min · 3,2 g</span>
          </div>
        </div>
        <div className="view-actions">
          <button className="btn btn-ghost" type="button" onClick={() => notify('Demo: Download würde die Datei speichern.')}>
            <Icon name="download" size={16} />
            Herunterladen
          </button>
          <button className="btn btn-primary" type="button" onClick={() => notify('Demo: Es wurde kein Druck gestartet.')}>
            <Icon name="send" size={16} />
            An Drucker senden
          </button>
        </div>
      </div>

      <div className="gcode-layout">
        <section className="code-panel">
          <div className="code-head">
            <div className="code-tabs">
              <span className="is-active">Vorschau</span>
              <span>Startcode</span>
              <span>Endcode</span>
            </div>
            <span className="code-language">G-Code</span>
          </div>
          <div className="code-body">
            <div className="code-gutter" aria-hidden="true">
              {GCODE_LINES.map(([line]) => (
                <span key={line}>{line}</span>
              ))}
            </div>
            <pre className="code-content">
              {GCODE_LINES.map(([line, text, kind]) => (
                <code key={line} className={`code-line code-line--${kind}`}>
                  {text}
                  {'\n'}
                </code>
              ))}
            </pre>
          </div>
          <div className="code-foot">
            <span>
              <span className="live-dot" /> Gültiger G-Code
            </span>
            <span>Zeilen 1–33 von 1.842</span>
          </div>
        </section>

        <aside className="gcode-side">
          <Panel title="Prüfung" hint="Alles bereit">
            <div className="check-list">
              <div>
                <span className="check-round">
                  <Icon name="check" size={11} />
                </span>
                <span>Modell vollständig</span>
              </div>
              <div>
                <span className="check-round">
                  <Icon name="check" size={11} />
                </span>
                <span>Druckerprofil passt</span>
              </div>
              <div>
                <span className="check-round">
                  <Icon name="check" size={11} />
                </span>
                <span>Temperatur im Fenster</span>
              </div>
              <div>
                <span className="check-round">
                  <Icon name="check" size={11} />
                </span>
                <span>Keine offenen Konturen</span>
              </div>
            </div>
          </Panel>
          <Panel title="Vorschau">
            <div className="mini-preview">
              <FlowCube layer={22} layers={75} topView />
              <span className="mini-preview-badge">Schicht 23</span>
            </div>
            <button className="text-btn" type="button" onClick={() => notify('Vorschau im Studio öffnen: Demo.')}>
              Im Studio öffnen
              <Icon name="arrow" size={14} />
            </button>
          </Panel>
        </aside>
      </div>
    </>
  )
}

export function KiUi() {
  const [tab, setTab] = useState<TabId>('studio')
  const [classic, setClassic] = useState(false)
  const [viewMode, setViewMode] = useState<ViewMode>('perspective')
  const [modelId, setModelId] = useState('flow')
  const [layer, setLayer] = useState(38)
  const [showAll, setShowAll] = useState(false)
  const [layerHeight, setLayerHeight] = useState(0.2)
  const [walls, setWalls] = useState(1)
  const [infill, setInfill] = useState(0)
  const [speed, setSpeed] = useState(40)
  const [slicing, setSlicing] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [openMenu, setOpenMenu] = useState<string | null>(null)
  const sliceTimer = useRef<number | null>(null)
  const toastTimer = useRef<number | null>(null)

  const activeModel = MODELS.find((model) => model.id === modelId) ?? MODELS[0]

  useEffect(() => {
    const previous = document.title
    document.title = 'Easy Slicer · KI-UI Test'
    return () => {
      document.title = previous
    }
  }, [])

  const notify = (message: string) => {
    setToast(message)
    if (toastTimer.current) window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(null), 2800)
  }

  useEffect(() => {
    return () => {
      if (sliceTimer.current) window.clearTimeout(sliceTimer.current)
      if (toastTimer.current) window.clearTimeout(toastTimer.current)
    }
  }, [])

  useEffect(() => {
    if (!classic) setOpenMenu(null)
  }, [classic])

  useEffect(() => {
    if (!openMenu) return
    const close = () => setOpenMenu(null)
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [openMenu])

  const runSlice = () => {
    if (slicing) return
    setSlicing(true)
    if (sliceTimer.current) window.clearTimeout(sliceTimer.current)
    sliceTimer.current = window.setTimeout(() => {
      setSlicing(false)
      setLayer(Math.min(38, activeModel.layers - 1))
      notify(`${activeModel.object} neu geslict · ${activeModel.layers} Schichten`)
    }, 2200)
  }

  const prepareCalibration = (name: string, nextModelId: string) => {
    setModelId(nextModelId)
    setTab('studio')
    if (nextModelId === 'flow') {
      setLayerHeight(0.2)
      setWalls(1)
      setInfill(0)
    }
    notify(`${name} vorbereitet — im Studio prüfen.`)
  }

  const runWinAction = (action: string) => {
    setOpenMenu(null)
    if (action === 'slice') runSlice()
    else if (action === 'ki-design') {
      setClassic(false)
      notify('KI-Design ist aktiv.')
    } else if (action === 'classic-design') {
      setClassic(true)
      notify('Windows-Klassisch ist aktiv.')
    } else if (action === 'close') notify('Zum Schließen das Fenster schließen.')
    else if (action === 'about') notify('KI-UI-Test · Easy Slicer · Layoutstudie 2026')
    else notify('Dieser Befehl ist in der UI-Studie ohne Funktion.')
  }

  const renderView = () => {
    if (tab === 'calibration') return <CalibrationView notify={notify} prepareCalibration={prepareCalibration} />
    if (tab === 'printer') return <PrinterView notify={notify} />
    if (tab === 'gcode') return <GcodeView notify={notify} />
    return (
      <StudioView
        activeModel={activeModel}
        setModelId={setModelId}
        viewMode={viewMode}
        setViewMode={setViewMode}
        layer={layer}
        setLayer={setLayer}
        showAll={showAll}
        setShowAll={setShowAll}
        layerHeight={layerHeight}
        setLayerHeight={setLayerHeight}
        walls={walls}
        setWalls={setWalls}
        infill={infill}
        setInfill={setInfill}
        speed={speed}
        setSpeed={setSpeed}
        slicing={slicing}
        runSlice={runSlice}
        setTab={setTab}
        notify={notify}
      />
    )
  }

  return (
    <div className={`ki-app${classic ? ' is-classic' : ''}`}>
      {classic && (
        <div className="win-menubar" role="menubar" aria-label="Klassische Menüleiste">
          {WIN_MENUS.map((menu) => (
            <div
              className="win-menu-group"
              key={menu.label}
              onPointerDown={(event) => event.stopPropagation()}
            >
              <button
                type="button"
                className={`win-menu-button${openMenu === menu.label ? ' is-open' : ''}`}
                aria-expanded={openMenu === menu.label}
                onClick={() => setOpenMenu((current) => (current === menu.label ? null : menu.label))}
              >
                <u>{menu.label.slice(0, 1)}</u>
                {menu.label.slice(1)}
              </button>
              {openMenu === menu.label && (
                <div className="win-dropdown" role="menu">
                  {menu.items.map((item, index) =>
                    item.id === 'sep' ? (
                      <div className="win-drop-separator" key={`sep-${index}`} />
                    ) : (
                      <button
                        type="button"
                        className="win-drop-item"
                        key={item.id}
                        role="menuitem"
                        onClick={() => runWinAction(item.id)}
                      >
                        <span>{item.label}</span>
                        {'shortcut' in item && item.shortcut && <kbd>{item.shortcut}</kbd>}
                      </button>
                    ),
                  )}
                </div>
              )}
            </div>
          ))}
          <span className="win-menu-spacer" />
          <span className="win-menu-title">Easy Slicer · KI-UI</span>
        </div>
      )}

      <div className="ki-shell">
        <aside className="rail">
          <div className="brand">
            <LogoMark />
            <div className="brand-copy">
              <strong>Easy Slicer</strong>
              <span>Studio für 3D-Druck</span>
            </div>
            <span className="brand-version">0.2</span>
          </div>
          <div className="test-label">
            <span className="test-label-dot" />
            KI-UI · TESTBUILD
          </div>

          <nav className="nav" aria-label="Hauptnavigation">
            {NAV_ITEMS.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`nav-button${tab === item.id ? ' is-active' : ''}`}
                onClick={() => setTab(item.id)}
                aria-current={tab === item.id ? 'page' : undefined}
              >
                <span className="nav-icon">
                  <Icon name={item.icon} size={18} />
                </span>
                <span className="nav-copy">
                  <strong>{item.label}</strong>
                  <small>{item.detail}</small>
                </span>
                {tab === item.id && <span className="nav-active-mark" />}
              </button>
            ))}
          </nav>

          <div className="rail-printer">
            <div className="rail-printer-head">
              <span className="printer-dot" />
              <span>Vyper</span>
              <span className="rail-printer-live">live</span>
            </div>
            <div className="rail-printer-body">
              <div>
                <span>Düse</span>
                <strong>195°</strong>
              </div>
              <div>
                <span>Bett</span>
                <strong>65°</strong>
              </div>
              <div>
                <span>Job</span>
                <strong>38%</strong>
              </div>
            </div>
            <div className="rail-progress">
              <span />
            </div>
          </div>

          <div className="rail-note">
            <Icon name="info" size={15} />
            <span>UI-Studie mit Beispieldaten. Kein Druck, keine Druckerkonfiguration.</span>
          </div>
        </aside>

        <div className="ki-main">
          <header className="topline">
            <div className="crumbs">
              <span>Werkstatt</span>
              <Icon name="chevron" size={13} />
              <strong>{TAB_TITLES[tab]}</strong>
            </div>
            <div className="top-actions">
              <button className="printer-chip" type="button" onClick={() => setTab('printer')}>
                <span className="live-dot" />
                <span>Vyper</span>
                <em>195° / 65°</em>
              </button>
              <button
                type="button"
                className="mode-switch"
                onClick={() => setClassic((value) => !value)}
                aria-pressed={classic}
                title={classic ? 'Zurück zum KI-Design' : 'In die klassische Windows-Ansicht wechseln'}
              >
                <Icon name={classic ? 'sparkle' : 'monitor'} size={16} />
                <span>{classic ? 'KI-Design' : 'Klassisch'}</span>
              </button>
              <span className="top-avatar" title="Michael">
                MB
              </span>
            </div>
          </header>

          <main className="content">{renderView()}</main>

          <footer className="statusline">
            <span className="statusline-ok">
              <span className="result-dot" />
              Bereit
            </span>
            <span className="statusline-message">
              {slicing ? 'Werkzeugweg wird berechnet …' : `${activeModel.file} · G-Code aktuell`}
            </span>
            <span className="statusline-spacer" />
            <span>Schicht {Math.min(activeModel.layers, layer + 1)} / {activeModel.layers}</span>
            <span>PLA · 0,95 Flow</span>
            <span className="statusline-build">KI-UI · 0.2</span>
          </footer>
        </div>
      </div>

      {toast && (
        <div className="toast" role="status" aria-live="polite">
          <span className="toast-dot" />
          {toast}
        </div>
      )}
    </div>
  )
}
