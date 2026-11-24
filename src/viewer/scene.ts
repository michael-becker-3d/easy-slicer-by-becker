import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import {
  PLATE_GAP_MM,
  PREVIEW_STRIDE,
  type ModelObjectInfo,
  type PreviewFeatureKind,
  type PreviewLayer,
  type Vec3,
} from '../../shared/types.ts'
import { PREVIEW_CODE_KIND } from '../../shared/preview.ts'
import {
  colorForSegment,
  computePreviewRange,
  previewLayerHeight,
  previewLayerSeconds,
  type PreviewColorMode,
  type PreviewPalette,
  type PreviewRange,
} from './previewColors.ts'
import { segmentInsideFilter, type PreviewFilterBounds } from './previewFilters.ts'
import { surfaceTextureSwatch, type SurfaceTexturePattern } from '../../shared/surfaceTexture.ts'

/** Kantenlänge einer Texturkachel in Millimetern — derselbe Ausschnitt, den
 *  surfaceTextureSwatch abtastet. */
const TEXTURE_TILE_MM = 12

/**
 * STL und die meisten Importformate bringen keine UV-Koordinaten mit. Ohne
 * sie liest der Shader für jeden Eckpunkt denselben Texel (0,0), das Modell
 * bleibt einfarbig. Die Projektion wählt je Dreieck die dominante Normale und
 * legt die beiden anderen Achsen in Millimetern auf die Kachel — damit misst
 * ein Muster auf dem Modell so viel wie im G-code.
 */
function addProjectedUv(geometry: THREE.BufferGeometry) {
  if (geometry.attributes.uv) return
  const pos = geometry.attributes.position
  const index = geometry.index
  const uv = new Float32Array(pos.count * 2)
  const corners = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()]
  const ab = new THREE.Vector3()
  const ac = new THREE.Vector3()
  const n = new THREE.Vector3()
  const total = index ? index.count : pos.count
  for (let i = 0; i + 2 < total; i += 3) {
    const ids = index ? [index.getX(i), index.getX(i + 1), index.getX(i + 2)] : [i, i + 1, i + 2]
    for (let k = 0; k < 3; k++) corners[k].fromBufferAttribute(pos, ids[k])
    const [a, b, c] = corners
    ab.subVectors(b, a)
    ac.subVectors(c, a)
    n.crossVectors(ab, ac)
    const ax = Math.abs(n.x)
    const ay = Math.abs(n.y)
    const az = Math.abs(n.z)
    const axis = ax >= ay && ax >= az ? 0 : ay >= az ? 1 : 2
    for (let k = 0; k < 3; k++) {
      const p = corners[k]
      uv[ids[k] * 2] = (axis === 0 ? p.y : p.x) / TEXTURE_TILE_MM
      uv[ids[k] * 2 + 1] = (axis === 1 ? p.z : axis === 2 ? p.y : p.z) / TEXTURE_TILE_MM
    }
  }
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
}


export type MeasureInfo = { distance: number; a: Vec3; b: Vec3 | null; points: number }

export type PreviewSection = { axis: 'x' | 'y' | 'z'; position: number }

export type PreviewSegmentRef = { layerIndex: number; offset: number }

export class Scene3D {
  private renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private camera: THREE.PerspectiveCamera
  private controls: OrbitControls
  private bedGroup = new THREE.Group()
  private previewGroup = new THREE.Group()
  private compareGroup = new THREE.Group()
  private modelMesh: THREE.Mesh | null = null
  /** V-21: Vorschau der Oberflächentextur auf dem Modell. */
  private texturePreview: THREE.Texture | null = null
  private texturePreviewConfig:
    | { pattern: SurfaceTexturePattern; scale: number; angle: number; thickness: number }
    | null = null
  /** Verschiebung, die den Modellmittelpunkt auf die Bettmitte legt */
  private modelOffset = new THREE.Vector3()
  private previewGeom: THREE.BufferGeometry | null = null
  private previewLineMaterial: THREE.LineBasicMaterial | null = null
  private compareLineMaterial: THREE.LineBasicMaterial | null = null
  /** Segmente in Zeichenreihenfolge: erlaubt die 3D-Auswahl eines Bahnsegments. */
  private previewSegmentRefs: PreviewSegmentRef[] = []
  private previewPickEnabled = false
  private previewPickCallback: ((ref: PreviewSegmentRef | null) => void) | null = null
  private previewSection: PreviewSection | null = null
  private previewShowAll = false
  private previewFilter: PreviewFilterBounds | null = null
  private previewPalette: PreviewPalette = 'standard'
  private raf = 0
  private observer: ResizeObserver
  private bed = { x: 245, y: 245, z: 260 }
  private roundBed = false
  /** Anzahl der Platten einer Mehrplatten-3MF */
  private plateCount = 1
  private activePlate = 0
  private modelHeight = 40
  private hasPreview = false
  private previewColorMode: PreviewColorMode = 'kind'
  private hiddenPreviewFeatures = new Set<PreviewFeatureKind>()
  private previewLayersRef: PreviewLayer[] | null = null
  private previewRange: PreviewRange = {
    speed: [0, 1],
    flow: [0, 1],
    height: [0, 1],
    temperature: [0, 1],
    acceleration: [0, 1],
    width: [0, 1],
    fan: [0, 1],
    pressureAdvance: [0, 1],
    duration: [0, 1],
  }
  private measureGroup = new THREE.Group()
  private measureEnabled = false
  private measureStage: 0 | 1 | 2 = 0
  private measureA: THREE.Vector3 | null = null
  private measureHover: THREE.Mesh | null = null
  private measureCallback: ((info: MeasureInfo | null) => void) | null = null
  private downX = 0
  private downY = 0

  // Auswahl, Bettkoordinaten und Rotations-Gizmo
  private objects: ModelObjectInfo[] = []
  private selectedId: string | null = null
  /** Alle ausgewählten Objekte (Strg-Klick erweitert die Auswahl). */
  private selectedIds: string[] = []
  private selectCallback: ((id: string, additive: boolean) => void) | null = null
  private rotateMode = false
  private rotateCallback: ((rot: { x: number; y: number; z: number }, axis: 'x' | 'y' | 'z') => void) | null = null
  private rotateEndCallback: (() => void) | null = null
  private modelCenter = { x: 0, y: 0 }
  private selectionGroup = new THREE.Group()
  private gizmoGroup = new THREE.Group()
  private overlayMesh: THREE.Mesh | null = null
  private dragAxis: 'x' | 'y' | 'z' | null = null
  private dragCurrent = { x: 0, y: 0, z: 0 }
  private dragBaseQuat = new THREE.Quaternion()
  private dragCenter = new THREE.Vector3()
  private dragLastAngle = 0
  private dragAccum = 0
  private dragPointer = -1
  /** Ziehen des ausgewählten Objekts auf dem Bett */
  private moveEndCallback: ((id: string, dx: number, dy: number) => void) | null = null
  private movePending: { id: string; start: THREE.Vector3; active: boolean; dx: number; dy: number } | null = null

  // Taste L: Stützen auf die Oberfläche malen
  private paintGroup = new THREE.Group()
  private paintMode = false
  private paintBlock = false
  private paintCallback: ((id: string, point: Vec3, block: boolean) => void) | null = null

  // V-07: ziehbare Schnittebene im Teilen-Dialog
  private splitGroup = new THREE.Group()
  private splitPlane: { axis: 'x' | 'y' | 'z'; position: number; min: number; max: number } | null = null
  private splitCallback: ((position: number) => void) | null = null
  private splitDrag: {
    axis: 'x' | 'y' | 'z'
    start: THREE.Vector3
    startValue: number
    normal: THREE.Vector3
    center: THREE.Vector3
  } | null = null

  constructor(private canvas: HTMLCanvasElement) {
    // preserveDrawingBuffer hält das Bild, wenn der Browser ohne neuen Frame
    // neu zusammensetzt (z. B. beim Ziehen eines Auswahlrechtecks neben dem
    // Canvas). Sonst wird die 3D-Ansicht dabei kurz schwarz.
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    this.renderer.setClearColor(0x000000, 0)
    this.renderer.localClippingEnabled = true

    this.camera = new THREE.PerspectiveCamera(42, 1, 0.5, 6000)
    this.camera.up.set(0, 0, 1)
    this.camera.position.set(260, -320, 260)

    this.controls = new OrbitControls(this.camera, canvas)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.08
    this.controls.rotateSpeed = 0.8
    this.controls.maxDistance = 2000
    this.controls.minDistance = 30
    this.controls.target.set(0, 0, 30)

    const hemi = new THREE.HemisphereLight(0xdcecff, 0x0a0d12, 1.15)
    const key = new THREE.DirectionalLight(0xffffff, 1.5)
    key.position.set(180, -240, 320)
    const rim = new THREE.DirectionalLight(0x7ea8ff, 0.7)
    rim.position.set(-260, 180, 140)

    this.scene.add(
      hemi,
      key,
      rim,
      this.bedGroup,
      this.previewGroup,
      this.compareGroup,
      this.measureGroup,
      this.selectionGroup,
      this.gizmoGroup,
      this.paintGroup,
      this.splitGroup,
    )
    this.canvas.addEventListener('pointerdown', this.onMeasureDown)
    this.canvas.addEventListener('pointerup', this.onMeasureUp)
    this.canvas.addEventListener('pointermove', this.onMeasureMove)
    this.canvas.addEventListener('pointerdown', this.onGizmoDown)
    this.canvas.addEventListener('pointermove', this.onGizmoMove)
    this.canvas.addEventListener('pointerup', this.onGizmoUp)
    this.canvas.addEventListener('pointerup', this.onPaintUp)
    this.buildBed()

    this.observer = new ResizeObserver(() => this.resize())
    this.observer.observe(canvas.parentElement ?? canvas)
    this.resize()
    // Nach dem ersten Layoutdurchlauf erneut messen: Beim Einbau in ein Grid
    // kann der Parent im Konstruktor noch 0 px hoch sein.
    requestAnimationFrame(() => this.resize())
    this.loop()
  }

  setBedSize(x: number, y: number, z: number, round = false, plateCount = 1) {
    const plates = Math.max(1, Math.floor(plateCount))
    if (this.bed.x === x && this.bed.y === y && this.roundBed === round && this.plateCount === plates)
      return
    this.bed = { x, y, z }
    this.roundBed = round
    this.plateCount = plates
    this.buildBed()
    this.fit()
  }

  /** Hebt die Vorschau unter die gewählte Platte. */
  setActivePlate(plate: number) {
    const next = Math.max(0, Math.floor(plate))
    if (this.activePlate === next) return
    this.activePlate = next
    this.previewGroup.position.x = -this.bed.x / 2 + next * (this.bed.x + PLATE_GAP_MM)
    this.compareGroup.position.copy(this.previewGroup.position)
  }

  private buildBed() {
    for (const child of [...this.bedGroup.children]) {
      this.bedGroup.remove(child)
      disposeObject(child)
    }
    const w = this.bed.x
    const h = this.bed.y

    const round = this.roundBed
    const radius = Math.min(w, h) / 2
    const plate = new THREE.Mesh(
      round ? new THREE.CircleGeometry(radius, 96) : new THREE.PlaneGeometry(w, h),
      new THREE.MeshStandardMaterial({ color: 0x0f141a, roughness: 0.9, metalness: 0.15 }),
    )
    plate.position.z = -0.15
    this.bedGroup.add(plate)

    const pts: number[] = []
    if (round) {
      // Delta: konzentrische Ringe plus sechs Speichen
      for (let ring = 1; ring <= 4; ring++) {
        const rr = (radius * ring) / 4
        const segs = 72
        for (let i = 0; i < segs; i++) {
          const a0 = (i / segs) * Math.PI * 2
          const a1 = ((i + 1) / segs) * Math.PI * 2
          pts.push(Math.cos(a0) * rr, Math.sin(a0) * rr, 0, Math.cos(a1) * rr, Math.sin(a1) * rr, 0)
        }
      }
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2
        pts.push(0, 0, 0, Math.cos(a) * radius, Math.sin(a) * radius, 0)
      }
    } else {
      const step = 10
      for (let x = -w / 2; x <= w / 2 + 0.01; x += step) {
        pts.push(x, -h / 2, 0, x, h / 2, 0)
      }
      for (let y = -h / 2; y <= h / 2 + 0.01; y += step) {
        pts.push(-w / 2, y, 0, w / 2, y, 0)
      }
    }
    const gridGeo = new THREE.BufferGeometry()
    gridGeo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
    this.bedGroup.add(new THREE.LineSegments(gridGeo, new THREE.LineBasicMaterial({ color: 0x2a3646, transparent: true, opacity: 0.55 })))

    const borderPts: THREE.Vector3[] = []
    if (round) {
      for (let i = 0; i <= 96; i++) {
        const a = (i / 96) * Math.PI * 2
        borderPts.push(new THREE.Vector3(Math.cos(a) * radius, Math.sin(a) * radius, 0.05))
      }
    } else {
      borderPts.push(
        new THREE.Vector3(-w / 2, -h / 2, 0.05),
        new THREE.Vector3(w / 2, -h / 2, 0.05),
        new THREE.Vector3(w / 2, h / 2, 0.05),
        new THREE.Vector3(-w / 2, h / 2, 0.05),
        new THREE.Vector3(-w / 2, -h / 2, 0.05),
      )
    }
    const border = new THREE.BufferGeometry().setFromPoints(borderPts)
    this.bedGroup.add(new THREE.Line(border, new THREE.LineBasicMaterial({ color: 0x3d4b5d })))

    // Weitere Platten aus einer Mehrplatten-3MF liegen rechts daneben.
    for (let p = 1; p < this.plateCount; p++) {
      const ox = p * (w + PLATE_GAP_MM)
      const extra = new THREE.Mesh(
        round ? new THREE.CircleGeometry(radius, 96) : new THREE.PlaneGeometry(w, h),
        new THREE.MeshStandardMaterial({ color: 0x0d1218, roughness: 0.95, metalness: 0.12 }),
      )
      extra.position.set(ox, 0, -0.15)
      this.bedGroup.add(extra)
      const outline = round
        ? Array.from({ length: 97 }, (_, i) => {
            const a = (i / 96) * Math.PI * 2
            return new THREE.Vector3(ox + Math.cos(a) * radius, Math.sin(a) * radius, 0.05)
          })
        : [
            new THREE.Vector3(ox - w / 2, -h / 2, 0.05),
            new THREE.Vector3(ox + w / 2, -h / 2, 0.05),
            new THREE.Vector3(ox + w / 2, h / 2, 0.05),
            new THREE.Vector3(ox - w / 2, h / 2, 0.05),
            new THREE.Vector3(ox - w / 2, -h / 2, 0.05),
          ]
      this.bedGroup.add(
        new THREE.Line(
          new THREE.BufferGeometry().setFromPoints(outline),
          new THREE.LineBasicMaterial({ color: 0x3d4b5d }),
        ),
      )
    }

    if (this.plateCount > 1) {
      for (let p = 0; p < this.plateCount; p++) {
        const label = plateLabel(`${p + 1}`)
        label.position.set(p * (w + PLATE_GAP_MM), -h / 2 - 12, 0.4)
        this.bedGroup.add(label)
      }
    }

    this.previewGroup.position.set(-w / 2 + this.activePlate * (w + PLATE_GAP_MM), -h / 2, 0)
    this.compareGroup.position.copy(this.previewGroup.position)
    if (this.modelMesh) this.modelMesh.position.copy(this.modelOffset)
    this.buildBedAxes(w, h, round)
    this.buildSelection()
    this.buildGizmo()
  }

  /** X/Y/Z-Achsen, Nullpunkt und Maßtitel am Bett — wie im OrcaSlicer. */
  private buildBedAxes(w: number, h: number, round: boolean) {
    const ox = -w / 2
    const oy = -h / 2
    const len = Math.min(70, Math.min(w, h) * 0.26)
    const zLen = Math.min(45, Math.max(20, this.bed.z * 0.28))
    const arrow = (dir: THREE.Vector3, color: number, z: number, length: number) => {
      const head = Math.max(4, length * 0.16)
      this.bedGroup.add(
        new THREE.ArrowHelper(dir, new THREE.Vector3(ox, oy, z), length, color, head, head * 0.45),
      )
    }
    arrow(new THREE.Vector3(1, 0, 0), 0xff6b6b, 0.5, len)
    arrow(new THREE.Vector3(0, 1, 0), 0x6fe3b0, 0.5, len)
    arrow(new THREE.Vector3(0, 0, 1), 0x6aa8ff, 0.5, zLen)

    const xLabel = textLabel('X', '#ff6b6b', 8)
    xLabel.position.set(ox + len + 5, oy, 2)
    const yLabel = textLabel('Y', '#6fe3b0', 8)
    yLabel.position.set(ox, oy + len + 5, 2)
    const zLabel = textLabel('Z', '#6aa8ff', 8)
    zLabel.position.set(ox, oy, zLen + 6)
    const origin = textLabel('0', '#93a2c9', 4.5)
    origin.position.set(ox - 4, oy - 4, 1.2)
    this.bedGroup.add(xLabel, yLabel, zLabel, origin)

    if (round) return
    // Maßtitel alle 50 mm an der Vorder- und linken Bettkante.
    for (let x = 50; x < w; x += 50) {
      const t = textLabel(String(x), '#93a2c9', 3.4)
      t.position.set(ox + x, oy - 7, 1)
      this.bedGroup.add(t)
    }
    for (let y = 50; y < h; y += 50) {
      const t = textLabel(String(y), '#93a2c9', 3.4)
      t.position.set(ox - 7, oy + y, 1)
      this.bedGroup.add(t)
    }
  }

  /** Objektliste und Auswahl aus der Oberfläche übernehmen. */
  setObjects(
    objects: ModelObjectInfo[],
    selection: string[],
    onSelect?: ((id: string, additive: boolean) => void) | null,
  ) {
    const previous = this.selectedObject()
    const previousIds = this.selectedIds.join(',')
    this.objects = objects
    this.selectedIds = selection
    this.selectedId = selection.length ? selection[selection.length - 1] : null
    this.selectCallback = onSelect ?? null
    this.buildPaint()
    const current = this.selectedObject()
    // Während einer Drehung ändern sich nur die Euler-Winkel. Auswahlbox und
    // Gizmo hängen aber nicht davon ab — sie bei jeder Mausbewegung neu zu
    // bauen würde die Drehung sichtbar stocken lassen.
    const unchanged =
      previous &&
      current &&
      previous.id === current.id &&
      previous.name === current.name &&
      previous.placement.visible === current.placement.visible &&
      previous.center.x === current.center.x &&
      previous.center.y === current.center.y &&
      previous.center.z === current.center.z &&
      previous.size.x === current.size.x &&
      previous.size.y === current.size.y &&
      previous.size.z === current.size.z &&
      previousIds === selection.join(',')
    if (unchanged) return
    this.buildSelection()
    this.buildGizmo()
  }

  setRotateMode(on: boolean) {
    this.rotateMode = on
    if (!on) this.cancelGizmoDrag()
    this.buildGizmo()
  }

  setGizmoCallbacks(
    onRotate?: ((rot: { x: number; y: number; z: number }, axis: 'x' | 'y' | 'z') => void) | null,
    onEnd?: (() => void) | null,
  ) {
    this.rotateCallback = onRotate ?? null
    this.rotateEndCallback = onEnd ?? null
  }

  /** Ausgewähltes Objekt wurde mit der Maus auf dem Bett verschoben. */
  setMoveCallback(onMove?: ((id: string, dx: number, dy: number) => void) | null) {
    this.moveEndCallback = onMove ?? null
  }

  /** Bezugspunkt, mit dem Objektkoordinaten auf die 3D-Ansicht abgebildet werden. */
  setModelCenter(x: number, y: number) {
    if (this.modelCenter.x === x && this.modelCenter.y === y) return
    this.modelCenter = { x, y }
    this.applyModelOffset()
    this.buildSelection()
    this.buildGizmo()
  }

  /**
   * Setzt Mesh und Overlays auf denselben Bezugspunkt wie worldCenter().
   * Vorher nahm setModel den Bounding-Box-Mittelpunkt des frisch geladenen
   * Netzes, die Auswahl aber den festen Modell-Anker — nach Teilen/Anordnen
   * lag der Rahmen deshalb versetzt neben dem ausgewählten Teil.
   */
  private applyModelOffset() {
    const mesh = this.modelMesh
    if (!mesh) return
    const minZ = mesh.geometry.boundingBox?.min.z ?? 0
    this.modelOffset.set(
      this.plateCount > 1 ? -this.bed.x / 2 : -this.modelCenter.x,
      this.plateCount > 1 ? -this.bed.y / 2 : -this.modelCenter.y,
      -minZ,
    )
    mesh.position.copy(this.modelOffset)
    if (this.overlayMesh) this.overlayMesh.position.copy(this.modelOffset)
    this.buildSplitGuide()
  }

  private selectedObject(): ModelObjectInfo | null {
    return this.objects.find((o) => o.id === this.selectedId) ?? null
  }

  private worldCenter(o: ModelObjectInfo): THREE.Vector3 {
    return new THREE.Vector3(o.center.x - this.modelCenter.x, o.center.y - this.modelCenter.y, o.center.z)
  }

  private clearGroup(group: THREE.Group) {
    for (const child of [...group.children]) {
      group.remove(child)
      disposeObject(child)
    }
  }

  /** Amberfarbene Auswahlbox plus Beschriftung und Bettmarkierung. */
  /** Mal-Modus: Klick auf das Mesh setzt eine Stütze oder einen Blocker. */
  setPaintMode(enabled: boolean, block = false, cb?: ((id: string, point: Vec3, block: boolean) => void) | null) {
    this.paintMode = enabled
    this.paintBlock = block
    this.paintCallback = cb ?? null
    if (enabled) this.canvas.style.cursor = 'crosshair'
    else if (!this.measureEnabled && !this.previewPickEnabled) this.canvas.style.cursor = ''
  }

  /** Zeigt die Schnittebene und einen Griff, der entlang der Achse gezogen wird. */
  setSplitPlane(
    plane: { axis: 'x' | 'y' | 'z'; position: number; min: number; max: number } | null,
    cb?: ((position: number) => void) | null,
  ) {
    this.splitPlane = plane
    this.splitCallback = cb ?? null
    this.buildSplitGuide()
  }

  private buildSplitGuide() {
    this.clearGroup(this.splitGroup)
    const plane = this.splitPlane
    if (!plane || !this.modelMesh) return
    const o = this.selectedObject()
    const anchor = o ? this.worldCenter(o) : new THREE.Vector3(0, 0, this.modelHeight / 2)
    const spanX = Math.max(40, this.bed.x * 0.86)
    const spanY = Math.max(40, this.bed.y * 0.86)
    const spanZ = Math.max(20, this.modelHeight * 1.15)
    let center: THREE.Vector3
    let w = spanX
    let h = spanY
    let rotation = new THREE.Euler()
    if (plane.axis === 'z') {
      center = new THREE.Vector3(anchor.x, anchor.y, plane.position + this.modelOffset.z)
    } else if (plane.axis === 'x') {
      center = new THREE.Vector3(plane.position - this.modelCenter.x, anchor.y, spanZ / 2)
      w = spanZ
      h = spanY
      rotation = new THREE.Euler(0, Math.PI / 2, 0)
    } else {
      center = new THREE.Vector3(anchor.x, plane.position - this.modelCenter.y, spanZ / 2)
      w = spanX
      h = spanZ
      rotation = new THREE.Euler(Math.PI / 2, 0, 0)
    }
    const geo = new THREE.PlaneGeometry(w, h)
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffb545,
      transparent: true,
      opacity: 0.13,
      side: THREE.DoubleSide,
      depthWrite: false,
    })
    const face = new THREE.Mesh(geo, mat)
    face.position.copy(center)
    face.rotation.copy(rotation)
    face.renderOrder = 13
    this.splitGroup.add(face)
    const edge = new THREE.LineSegments(
      new THREE.EdgesGeometry(geo),
      new THREE.LineBasicMaterial({ color: 0xffb545, transparent: true, opacity: 0.75, depthTest: false }),
    )
    edge.position.copy(center)
    edge.rotation.copy(rotation)
    edge.renderOrder = 14
    this.splitGroup.add(edge)

    const handle = new THREE.Mesh(
      new THREE.SphereGeometry(6, 20, 14),
      new THREE.MeshBasicMaterial({ color: 0xffb545, depthTest: false }),
    )
    handle.position.copy(center)
    handle.renderOrder = 40
    handle.userData.splitHandle = true
    this.splitGroup.add(handle)

    const label = textLabel(`Naht ${plane.position.toFixed(1)} mm`, '#ffb545', 9)
    label.position.copy(center).add(new THREE.Vector3(0, 0, plane.axis === 'z' ? 10 : 8))
    label.renderOrder = 41
    this.splitGroup.add(label)
  }

  private splitHit(e: PointerEvent): boolean {
    return this.rayAt(e)
      .intersectObjects(this.splitGroup.children, true)
      .some((hit) => {
        let node: THREE.Object3D | null = hit.object
        while (node && !node.userData.splitHandle) node = node.parent
        return Boolean(node?.userData.splitHandle)
      })
  }

  private beginSplitDrag(e: PointerEvent) {
    if (!this.splitPlane) return
    const axis = this.splitPlane.axis
    const unit = this.axisUnit(axis)
    const handle = this.splitGroup.children.find((child) => child.userData.splitHandle)
    const center = new THREE.Vector3()
    handle?.getWorldPosition(center)
    const view = this.camera.getWorldDirection(new THREE.Vector3()).normalize()
    let normal = view.clone().cross(unit)
    if (normal.lengthSq() < 1e-6) normal = this.camera.up.clone().cross(unit)
    normal.normalize()
    const start = this.planePoint(e, normal, center)
    if (!start) return
    this.splitDrag = { axis, start, startValue: this.splitPlane.position, normal, center }
    this.controls.enabled = false
    this.dragPointer = e.pointerId
    try {
      this.canvas.setPointerCapture(e.pointerId)
    } catch {
      /* Zeiger-Capture ist nur Komfort */
    }
    e.preventDefault()
  }

  private onPaintUp = (e: PointerEvent) => {
    if (!this.paintMode || e.button !== 0 || !this.modelMesh) return
    if (Math.hypot(e.clientX - this.downX, e.clientY - this.downY) > 5) return
    const id = this.objectAt(e)
    if (!id) return
    const hit = this.rayAt(e).intersectObject(this.modelMesh, false)[0]
    if (!hit) return
    const block = e.shiftKey ? !this.paintBlock : this.paintBlock
    this.paintCallback?.(id, { x: hit.point.x, y: hit.point.y, z: hit.point.z }, block)
  }

  /** Markierungen als kleine Punkte: grün = Stütze, rot = Blocker. */
  private buildPaint() {
    this.clearGroup(this.paintGroup)
    for (const o of this.objects) {
      if (!o.paint?.length) continue
      const c = this.worldCenter(o)
      for (const m of o.paint) {
        const dot = new THREE.Mesh(
          new THREE.SphereGeometry(Math.max(0.7, Math.min(4, m.r * 0.45)), 12, 8),
          new THREE.MeshBasicMaterial({
            color: m.block ? 0xff6b6b : 0x6fe3b0,
            transparent: true,
            opacity: 0.6,
            depthTest: false,
          }),
        )
        dot.position.set(
          c.x + (m.fx - 0.5) * o.size.x,
          c.y + (m.fy - 0.5) * o.size.y,
          c.z + (m.fz - 0.5) * o.size.z,
        )
        dot.renderOrder = 17
        this.paintGroup.add(dot)
      }
    }
  }

  private buildSelection() {
    this.clearGroup(this.selectionGroup)
    for (const id of this.selectedIds) {
      const o = this.objects.find((x) => x.id === id)
      if (!o || !o.placement.visible) continue
      const primary = id === this.selectedId
      const c = this.worldCenter(o)
      const size = new THREE.Vector3(Math.max(0.5, o.size.x), Math.max(0.5, o.size.y), Math.max(0.5, o.size.z))
      const box = new THREE.Box3().setFromCenterAndSize(c, size)
      const helper = new THREE.Box3Helper(box, 0xffb545)
      const hm = helper.material as THREE.LineBasicMaterial
      hm.transparent = true
      // Mitausgewählte Teile etwas schwächer — das zuletzt gewählte bleibt führend.
      hm.opacity = primary ? 0.9 : 0.6
      hm.depthTest = false
      helper.renderOrder = 16
      this.selectionGroup.add(helper)

      if (primary) {
        const label = textLabel(o.name, '#ffb545', Math.min(22, Math.max(9, Math.max(size.x, size.y) * 0.4)))
        label.position.set(c.x, c.y, box.max.z + 6)
        this.selectionGroup.add(label)
      }

      const pts = [
        new THREE.Vector3(box.min.x, box.min.y, 0.35),
        new THREE.Vector3(box.max.x, box.min.y, 0.35),
        new THREE.Vector3(box.max.x, box.max.y, 0.35),
        new THREE.Vector3(box.min.x, box.max.y, 0.35),
      ]
      const loop = new THREE.LineLoop(
        new THREE.BufferGeometry().setFromPoints(pts),
        new THREE.LineBasicMaterial({ color: 0xffb545, transparent: true, opacity: primary ? 0.45 : 0.25, depthTest: false }),
      )
      loop.renderOrder = 14
      this.selectionGroup.add(loop)
    }
  }

  private gizmoRadius(o: ModelObjectInfo): number {
    return Math.max(
      14,
      Math.min(Math.max(o.size.x, o.size.y, o.size.z) * 0.72 + 9, Math.max(this.bed.x, this.bed.y) * 0.42),
    )
  }

  /** Drei farbige Drehringe mit Pfeilspitzen, wie im OrcaSlicer-Gizmo. */
  private buildGizmo() {
    this.clearGroup(this.gizmoGroup)
    const o = this.selectedObject()
    if (!this.rotateMode || !o || !o.placement.visible) return
    const center = this.worldCenter(o)
    const radius = this.gizmoRadius(o)
    const defs: { axis: 'x' | 'y' | 'z'; color: number; base: THREE.Quaternion; unit: THREE.Vector3 }[] = [
      { axis: 'x', color: 0xff6b6b, base: new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI / 2, 0)), unit: new THREE.Vector3(1, 0, 0) },
      { axis: 'y', color: 0x6fe3b0, base: new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0)), unit: new THREE.Vector3(0, 1, 0) },
      { axis: 'z', color: 0x6aa8ff, base: new THREE.Quaternion(), unit: new THREE.Vector3(0, 0, 1) },
    ]
    const tube = Math.max(0.5, radius * 0.02)
    for (const def of defs) {
      const mat = new THREE.MeshBasicMaterial({ color: def.color, transparent: true, opacity: 0.85, depthTest: false })
      const ring = new THREE.Mesh(new THREE.TorusGeometry(radius, tube, 8, 96), mat)
      ring.position.copy(center)
      // OrcaSlicer dreht standardmäßig im Welt-Koordinatensystem: Die Ringe
      // bleiben an den Bettachsen, auch wenn das Objekt bereits gedreht ist.
      ring.quaternion.copy(def.base)
      ring.renderOrder = 30
      ring.userData.axis = def.axis
      this.gizmoGroup.add(ring)

      // Unsichtbarer, dickerer Fangring — die dünne Linie allein ist mit der
      // Maus nur schwer zu treffen. Raycasting ignoriert die Deckkraft.
      const pick = new THREE.Mesh(
        new THREE.TorusGeometry(radius, Math.max(1.4, radius * 0.055), 6, 40),
        new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, colorWrite: false }),
      )
      pick.position.copy(center)
      pick.quaternion.copy(def.base)
      pick.renderOrder = 30
      pick.userData.axis = def.axis
      this.gizmoGroup.add(pick)

      for (const angle of [0, Math.PI]) {
        const arrow = new THREE.Mesh(new THREE.ConeGeometry(tube * 4.5, radius * 0.14, 12), mat)
        arrow.position.set(Math.cos(angle) * radius, Math.sin(angle) * radius, 0)
        arrow.rotation.z = angle
        arrow.renderOrder = 30
        ring.add(arrow)
      }

      const label = textLabel(def.axis.toUpperCase(), `#${def.color.toString(16).padStart(6, '0')}`, 6)
      label.position.set(radius + 4, 0, 0)
      ring.add(label)

      // Kreuz im Zentrum: kurze Achsenpfeile in Weltlage
      const dir = def.unit.clone()
      const head = Math.max(3, radius * 0.08)
      this.gizmoGroup.add(new THREE.ArrowHelper(dir, center, radius * 0.36, def.color, head, head * 0.45))
    }
  }

  /** Zeigt einen Negativkörper (eingelassenen Text) rot durchscheinend. */
  setOverlay(geometry: THREE.BufferGeometry | null) {
    if (this.overlayMesh) {
      this.scene.remove(this.overlayMesh)
      disposeObject(this.overlayMesh)
      this.overlayMesh = null
    }
    if (!geometry) return
    geometry.computeVertexNormals()
    const mesh = new THREE.Mesh(
      geometry,
      new THREE.MeshStandardMaterial({
        color: 0xff6b6b,
        roughness: 0.5,
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    )
    mesh.position.copy(this.modelOffset)
    this.overlayMesh = mesh
    this.scene.add(mesh)
  }

  setModel(geometry: THREE.BufferGeometry | null) {
    const hadModel = !!this.modelMesh
    if (this.modelMesh) {
      this.scene.remove(this.modelMesh)
      disposeObject(this.modelMesh)
      this.modelMesh = null
    }
    if (!geometry) return
    geometry.computeVertexNormals()
    geometry.computeBoundingBox()
    const size = new THREE.Vector3()
    geometry.boundingBox?.getSize(size)
    this.modelHeight = size.z

    // Undurchsichtig und einseitig: Ein geschlossenes Mesh zeigt so nur seine
    // Außenhaut. Durchscheinend/doppelseitig würden Innenwände und Nahtflächen
    // sichtbar und das geteilte Teil sähe innen hohl aus. Nur echte Öffnungen —
    // etwa die Dübellöcher — bleiben als Loch sichtbar.
    const mat = new THREE.MeshStandardMaterial({
      color: 0x93a6bb,
      roughness: 0.62,
      metalness: 0.08,
      transparent: Boolean(this.hasPreview),
      opacity: this.hasPreview ? 0.14 : 1,
      depthWrite: !this.hasPreview,
      side: this.hasPreview ? THREE.DoubleSide : THREE.FrontSide,
    })
    // Ohne gesetzten Anker (erster Frame) den Modellmittelpunkt nehmen; die
    // Oberfläche setzt kurz danach denselben Wert über setModelCenter.
    if (!this.modelCenter.x && !this.modelCenter.y) {
      const center = new THREE.Vector3()
      geometry.boundingBox?.getCenter(center)
      this.modelCenter = { x: center.x, y: center.y }
    }
    const mesh = new THREE.Mesh(geometry, mat)
    this.modelMesh = mesh
    this.applyTexturePreview()
    this.applySectionToModel()
    this.scene.add(mesh)
    this.applyModelOffset()
    // Nur beim ersten Modell automatisch einpassen. Die Live-Drehung und andere
    // Objektvorschauen ersetzen die Geometrie häufig — ein fit() würde dabei
    // jedes Mal die Kamera zurücksetzen und die Bearbeitung springen lassen.
    if (!hadModel) this.fit()
  }

  /**
   * V-21: zeigt das gewählte Oberflächenmuster als Kachel auf dem Modell.
   * Die Kachel entsteht aus derselben Funktion wie der Wand-G-code, damit
   * Vorschau und Druck dieselbe Struktur meinen. Ohne Muster wird die
   * ursprüngliche Materialfarbe wiederhergestellt.
   */
  setTexturePreview(
    pattern: SurfaceTexturePattern | null,
    scale = 3,
    angle = 0,
    thickness = 0.3,
  ) {
    this.texturePreviewConfig = pattern ? { pattern, scale, angle, thickness } : null
    this.applyTexturePreview()
  }

  private applyTexturePreview() {
    if (!this.modelMesh) return
    const mat = this.modelMesh.material as THREE.MeshStandardMaterial
    this.texturePreview?.dispose()
    this.texturePreview = null
    const config = this.texturePreviewConfig
    if (!config) {
      mat.map = null
      mat.bumpMap = null
      mat.color.setHex(0x93a6bb)
      mat.needsUpdate = true
      return
    }
    const cells = 24
    const field = surfaceTextureSwatch(config.pattern, config.scale, config.angle, cells)
    const canvas = document.createElement('canvas')
    canvas.width = cells
    canvas.height = cells
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const image = ctx.createImageData(cells, cells)
    field.forEach((value, index) => {
      const gray = Math.round(128 + Math.max(-1, Math.min(1, value)) * 96)
      const offset = index * 4
      image.data[offset] = gray
      image.data[offset + 1] = gray
      image.data[offset + 2] = gray
      image.data[offset + 3] = 255
    })
    ctx.putImageData(image, 0, 0)
    const texture = new THREE.CanvasTexture(canvas)
    texture.wrapS = THREE.RepeatWrapping
    texture.wrapT = THREE.RepeatWrapping
    addProjectedUv(this.modelMesh.geometry)
    texture.repeat.set(1, 1)
    texture.needsUpdate = true
    this.texturePreview = texture
    mat.map = texture
    mat.bumpMap = texture
    mat.bumpScale = Math.max(0.02, Math.min(0.5, config.thickness))
    mat.color.setHex(0xa9b8c9)
    mat.needsUpdate = true
  }

  private setGhost(on: boolean) {
    this.hasPreview = on
    if (!this.modelMesh) return
    const mat = this.modelMesh.material as THREE.MeshStandardMaterial
    mat.transparent = on
    mat.opacity = on ? 0.14 : 1
    mat.depthWrite = !on
    mat.side = on ? THREE.DoubleSide : THREE.FrontSide
    mat.needsUpdate = true
  }

  setPreview(
    layers: PreviewLayer[],
    upto: number,
    showAll: boolean,
    colorMode: PreviewColorMode = 'kind',
    hiddenFeatures: PreviewFeatureKind[] = [],
    compareLayers: PreviewLayer[] | null = null,
    flowLimit = 0,
    filter: PreviewFilterBounds | null = null,
    palette: PreviewPalette = 'standard',
  ) {
    // Nur wenn ausdrücklich alle Schichten gezeigt werden, wird das Modell
    // durchscheinend. Sonst bleibt es geschlossen und massiv — so wirkt ein
    // geteiltes Teil nie wie ein Hohlkörper.
    this.previewShowAll = showAll
    this.previewFilter = filter
    this.previewPalette = palette
    this.setGhost(layers.length > 0 && (showAll || Boolean(this.previewSection)))
    this.previewColorMode = colorMode
    this.hiddenPreviewFeatures = new Set(hiddenFeatures)
    if (layers !== this.previewLayersRef) {
      this.previewLayersRef = layers
      this.previewRange = computePreviewRange(layers)
    }
    if (this.previewGeom) {
      this.previewGeom.dispose()
      this.previewGeom = null
    }
    for (const child of [...this.previewGroup.children]) {
      this.previewGroup.remove(child)
      disposeObject(child)
    }
    for (const child of [...this.compareGroup.children]) {
      this.compareGroup.remove(child)
      disposeObject(child)
    }
    this.previewLineMaterial = null
    this.compareLineMaterial = null
    this.previewSegmentRefs = []
    if (!layers.length) return

    const clamp = Math.max(0, Math.min(layers.length - 1, upto))
    const from = showAll ? 0 : clamp
    const positions: number[] = []
    const colors: number[] = []

    for (let i = from; i <= clamp; i++) {
      const data = layers[i]?.data ?? []
      const z = (layers[i]?.z ?? 0) + 0.15
      const thickness = previewLayerHeight(layers, i)
      const layerSeconds = previewLayerSeconds(layers[i])
      for (let k = 0; k + PREVIEW_STRIDE - 1 < data.length; k += PREVIEW_STRIDE) {
        const kind = PREVIEW_CODE_KIND.get(data[k])
        if (kind && this.hiddenPreviewFeatures.has(kind)) continue
        if (!segmentInsideFilter(data, k, this.previewFilter)) continue
        const color = new THREE.Color(
          colorForSegment(
            data[k],
            data[k + 5],
            data[k + 6],
            data[k + 7],
            thickness,
            layerSeconds,
            data[k + 8],
            data[k + 9],
            data[k + 10],
            data[k + 11],
            this.previewColorMode,
            this.previewRange,
            flowLimit,
            palette,
          ),
        )
        positions.push(data[k + 1], data[k + 2], z, data[k + 3], data[k + 4], z)
        colors.push(color.r, color.g, color.b, color.r, color.g, color.b)
        this.previewSegmentRefs.push({ layerIndex: i, offset: k })
      }
    }
    if (!positions.length) return

    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
    this.previewGeom = geo
    const material = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.95 })
    this.previewLineMaterial = material
    this.applySectionMaterial(material)
    const lines = new THREE.LineSegments(geo, material)
    this.previewGroup.add(lines)

    // Vergleichsergebnis als kühle, transparente Kontur über der aktuellen
    // Vorschau. Beide Ansichten laufen über denselben Schichtindex.
    if (compareLayers?.length && (showAll || clamp < compareLayers.length)) {
      const compareClamp = Math.min(compareLayers.length - 1, clamp)
      const compareFrom = showAll ? 0 : compareClamp
      const comparePositions: number[] = []
      for (let i = compareFrom; i <= compareClamp; i++) {
        const data = compareLayers[i]?.data ?? []
        const z = (compareLayers[i]?.z ?? 0) + 0.22
        for (let k = 0; k + PREVIEW_STRIDE - 1 < data.length; k += PREVIEW_STRIDE) {
          const kind = PREVIEW_CODE_KIND.get(data[k])
          if (kind && this.hiddenPreviewFeatures.has(kind)) continue
          if (!segmentInsideFilter(data, k, this.previewFilter)) continue
          comparePositions.push(data[k + 1], data[k + 2], z, data[k + 3], data[k + 4], z)
        }
      }
      if (comparePositions.length) {
        const compareGeo = new THREE.BufferGeometry()
        compareGeo.setAttribute('position', new THREE.Float32BufferAttribute(comparePositions, 3))
        const compareMaterial = new THREE.LineBasicMaterial({
          color: 0x60a5fa,
          transparent: true,
          opacity: 0.45,
          depthWrite: false,
        })
        this.compareLineMaterial = compareMaterial
        this.applySectionMaterial(compareMaterial)
        this.compareGroup.add(new THREE.LineSegments(compareGeo, compareMaterial))
      }
    }
  }

  /** Schnittansicht: Materialschnitt statt Neuaufbau der Liniengeometrie. */
  setPreviewSection(section: PreviewSection | null) {
    this.previewSection = section
    this.setGhost(Boolean(this.previewLayersRef?.length) && (this.previewShowAll || Boolean(section)))
    if (this.previewLineMaterial) this.applySectionMaterial(this.previewLineMaterial)
    if (this.compareLineMaterial) this.applySectionMaterial(this.compareLineMaterial)
    this.applySectionToModel()
  }

  private sectionPlane(): THREE.Plane | null {
    const section = this.previewSection
    if (!section) return null
    if (section.axis === 'x') {
      return new THREE.Plane(new THREE.Vector3(-1, 0, 0), section.position - this.bed.x / 2)
    }
    if (section.axis === 'y') {
      return new THREE.Plane(new THREE.Vector3(0, -1, 0), section.position - this.bed.y / 2)
    }
    return new THREE.Plane(new THREE.Vector3(0, 0, -1), section.position)
  }

  private applySectionMaterial(material: THREE.Material) {
    const plane = this.sectionPlane()
    material.clippingPlanes = plane ? [plane] : null
    material.clipShadows = false
    material.needsUpdate = true
  }

  private applySectionToModel() {
    if (!this.modelMesh) return
    const material = this.modelMesh.material as THREE.MeshStandardMaterial
    this.applySectionMaterial(material)
  }

  /** Segmentauswahl: der nächste sichtbare Vorschau-Strich unter dem Zeiger. */
  setPreviewPick(enabled: boolean, callback?: ((ref: PreviewSegmentRef | null) => void) | null) {
    this.previewPickEnabled = enabled
    this.previewPickCallback = callback ?? null
    if (enabled) this.canvas.style.cursor = 'crosshair'
    else if (!this.measureEnabled && !this.paintMode) this.canvas.style.cursor = ''
  }

  private pickPreviewSegment(e: PointerEvent) {
    const lines = this.previewGroup.children.find(
      (child): child is THREE.LineSegments => child instanceof THREE.LineSegments,
    )
    const layers = this.previewLayersRef
    if (!lines || !layers || !this.previewSegmentRefs.length) {
      this.previewPickCallback?.(null)
      return
    }
    const raycaster = this.rayAt(e)
    raycaster.params.Line.threshold = 1.6
    const hit = raycaster.intersectObject(lines, false)[0]
    if (!hit) {
      this.previewPickCallback?.(null)
      return
    }
    const point = hit.point
    const offset = this.previewGroup.position
    let best: PreviewSegmentRef | null = null
    let bestDistance = Infinity
    for (const ref of this.previewSegmentRefs) {
      const layer = layers[ref.layerIndex]
      const data = layer?.data
      if (!data || ref.offset + PREVIEW_STRIDE - 1 >= data.length) continue
      const z = (layer?.z ?? 0) + 0.15
      const x1 = data[ref.offset + 1] + offset.x
      const y1 = data[ref.offset + 2] + offset.y
      const x2 = data[ref.offset + 3] + offset.x
      const y2 = data[ref.offset + 4] + offset.y
      const dx = x2 - x1
      const dy = y2 - y1
      const lengthSq = dx * dx + dy * dy
      const t =
        lengthSq > 1e-9
          ? Math.max(0, Math.min(1, ((point.x - x1) * dx + (point.y - y1) * dy) / lengthSq))
          : 0
      const distance = Math.hypot(point.x - (x1 + dx * t), point.y - (y1 + dy * t), point.z - z)
      if (distance < bestDistance) {
        bestDistance = distance
        best = ref
      }
    }
    this.previewPickCallback?.(best)
  }

  /** Messmodus: zwei Klicks auf das Modell liefern den Abstand in mm. */
  setMeasure(enabled: boolean, cb?: ((info: MeasureInfo | null) => void) | null) {
    this.measureEnabled = enabled
    this.measureCallback = cb ?? null
    if (enabled) this.canvas.style.cursor = 'crosshair'
    else if (!this.previewPickEnabled && !this.paintMode) this.canvas.style.cursor = ''
    if (!enabled) this.clearMeasure()
  }

  private onMeasureDown = (e: PointerEvent) => {
    this.downX = e.clientX
    this.downY = e.clientY
  }

  private onMeasureUp = (e: PointerEvent) => {
    if (!this.measureEnabled || e.button !== 0 || !this.modelMesh) return
    if (Math.hypot(e.clientX - this.downX, e.clientY - this.downY) > 5) return
    const snap = this.measureSnap(e)
    if (!snap) return
    const point = snap.point

    if (this.measureStage === 0) {
      this.clearMeasure()
      this.measureA = point
      this.measureStage = 1
      this.addMeasureMarker(point)
      this.measureCallback?.({
        distance: 0,
        a: { x: point.x, y: point.y, z: point.z },
        b: null,
        points: 1,
      })
      return
    }

    const a = this.measureA
    if (!a) return
    this.addMeasureMarker(point)
    const geo = new THREE.BufferGeometry().setFromPoints([a, point])
    this.measureGroup.add(
      new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffb545, depthTest: false })),
    )
    this.measureStage = 2
    this.measureCallback?.({
      distance: a.distanceTo(point),
      a: { x: a.x, y: a.y, z: a.z },
      b: { x: point.x, y: point.y, z: point.z },
      points: 2,
    })
  }

  /**
   * Punkt unter dem Cursor mit Rastung: zuerst Ecke (14 px), dann Kante
   * (10 px), sonst der Punkt auf der Fläche. Gemessen wird in Bildschirm-
   * pixeln — so fühlt sich die Rastung bei jedem Zoom gleich an.
   */
  private measureSnap(e: PointerEvent): { point: THREE.Vector3; kind: 'vertex' | 'edge' | 'face' } | null {
    const mesh = this.modelMesh
    if (!mesh) return null
    const hit = this.rayAt(e).intersectObject(mesh, false)[0]
    if (!hit) return null
    const fallback = { point: hit.point.clone(), kind: 'face' as const }
    if (!hit.face) return fallback
    const pos = mesh.geometry.getAttribute('position')
    const ids = [hit.face.a, hit.face.b, hit.face.c]
    const world = ids.map((i) =>
      new THREE.Vector3().fromBufferAttribute(pos as THREE.BufferAttribute, i).applyMatrix4(mesh.matrixWorld),
    )
    const rect = this.canvas.getBoundingClientRect()
    const screen = world.map((v) => {
      const p = v.clone().project(this.camera)
      return { x: (p.x * 0.5 + 0.5) * rect.width, y: (-p.y * 0.5 + 0.5) * rect.height }
    })
    const click = { x: e.clientX - rect.left, y: e.clientY - rect.top }

    let vi = -1
    let vd = Infinity
    for (let i = 0; i < 3; i++) {
      const d = Math.hypot(screen[i].x - click.x, screen[i].y - click.y)
      if (d < vd) {
        vd = d
        vi = i
      }
    }
    if (vi >= 0 && vd <= 14) return { point: world[vi].clone(), kind: 'vertex' }

    let ei = -1
    let et = 0
    let ed = Infinity
    for (let i = 0; i < 3; i++) {
      const a = screen[i]
      const b = screen[(i + 1) % 3]
      const dx = b.x - a.x
      const dy = b.y - a.y
      const len = dx * dx + dy * dy
      if (len < 1e-6) continue
      const t = Math.max(0, Math.min(1, ((click.x - a.x) * dx + (click.y - a.y) * dy) / len))
      const d = Math.hypot(a.x + dx * t - click.x, a.y + dy * t - click.y)
      if (d < ed) {
        ed = d
        ei = i
        et = t
      }
    }
    if (ei >= 0 && ed <= 10) {
      return { point: world[ei].clone().lerp(world[(ei + 1) % 3], et), kind: 'edge' }
    }
    return fallback
  }

  /** Kleiner Vorschau-Punkt an der Stelle, an der der Klick landen wird. */
  private onMeasureMove = (e: PointerEvent) => {
    if (!this.measureEnabled || !this.modelMesh) {
      if (this.measureHover) this.measureHover.visible = false
      return
    }
    const snap = this.measureSnap(e)
    if (!snap) {
      if (this.measureHover) this.measureHover.visible = false
      return
    }
    if (!this.measureHover) {
      this.measureHover = new THREE.Mesh(
        new THREE.SphereGeometry(0.3, 12, 8),
        new THREE.MeshBasicMaterial({ color: 0x6fe3b0, depthTest: false, transparent: true, opacity: 0.95 }),
      )
      this.measureHover.renderOrder = 30
      this.measureGroup.add(this.measureHover)
    }
    const distance = this.camera.position.distanceTo(snap.point)
    this.measureHover.scale.setScalar(Math.max(0.05, Math.min(0.4, distance * 0.0014)) / 0.3)
    this.measureHover.position.copy(snap.point)
    this.measureHover.visible = true
    const color = snap.kind === 'vertex' ? 0x6fe3b0 : snap.kind === 'edge' ? 0x7ec8ff : 0xffb545
    ;(this.measureHover.material as THREE.MeshBasicMaterial).color.setHex(color)
  }

  private addMeasureMarker(point: THREE.Vector3) {
    // Winziger Punkt: Radius nach Kameradistanz, nicht nach Bettgröße — sonst
    // verdeckt der Marker die Stelle, die man eigentlich messen will.
    const distance = this.camera.position.distanceTo(point)
    const dot = new THREE.Mesh(
      new THREE.SphereGeometry(Math.max(0.06, Math.min(0.4, distance * 0.0014)), 12, 8),
      new THREE.MeshBasicMaterial({ color: 0xffb545, depthTest: false }),
    )
    dot.position.copy(point)
    this.measureGroup.add(dot)
  }

  clearMeasure() {
    for (const child of [...this.measureGroup.children]) {
      if (child === this.measureHover) {
        child.visible = false
        continue
      }
      this.measureGroup.remove(child)
      disposeObject(child)
    }
    this.measureStage = 0
    this.measureA = null
  }

  // ---------- Rotations-Gizmo und Objektauswahl ----------

  private rayAt(e: PointerEvent): THREE.Raycaster {
    const rect = this.canvas.getBoundingClientRect()
    const ndc = new THREE.Vector2(
      ((e.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1,
      -((e.clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1,
    )
    const raycaster = new THREE.Raycaster()
    raycaster.setFromCamera(ndc, this.camera)
    return raycaster
  }

  private gizmoHit(e: PointerEvent): 'x' | 'y' | 'z' | null {
    const hits = this.rayAt(e).intersectObjects(this.gizmoGroup.children, true)
    for (const hit of hits) {
      let node: THREE.Object3D | null = hit.object
      while (node && !node.userData.axis) node = node.parent
      if (node?.userData.axis) return node.userData.axis as 'x' | 'y' | 'z'
    }
    return null
  }

  private axisUnit(axis: 'x' | 'y' | 'z'): THREE.Vector3 {
    return new THREE.Vector3(axis === 'x' ? 1 : 0, axis === 'y' ? 1 : 0, axis === 'z' ? 1 : 0)
  }

  private planePoint(e: PointerEvent, normal: THREE.Vector3, center: THREE.Vector3): THREE.Vector3 | null {
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, center)
    return this.rayAt(e).ray.intersectPlane(plane, new THREE.Vector3())
  }

  private axisAngle(point: THREE.Vector3, normal: THREE.Vector3, center: THREE.Vector3): number {
    const ref = Math.abs(normal.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0)
    const u = ref.clone().sub(normal.clone().multiplyScalar(ref.dot(normal))).normalize()
    const v = normal.clone().cross(u).normalize()
    const d = point.clone().sub(center)
    return Math.atan2(d.dot(v), d.dot(u))
  }

  /** Ausgewähltes Objekt greifen; verschoben wird erst ab 3 px Bewegung. */
  private beginMove(e: PointerEvent) {
    // Das getroffene Teil ziehen — auch wenn die Auswahl nach dem Teilen noch
    // auf einem alten Objekt steht. Vorher war Ziehen dann wirkungslos.
    const hit = this.objectAt(e)
    if (!hit) return
    const start = this.planePoint(e, new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, 0))
    if (!start) return
    this.movePending = { id: hit, start, active: false, dx: 0, dy: 0 }
  }

  private onGizmoDown = (e: PointerEvent) => {
    if (this.paintMode) return
    this.downX = e.clientX
    this.downY = e.clientY
    this.movePending = null
    if (this.previewPickEnabled) return
    if (e.button !== 0 || this.measureEnabled) return
    if (this.splitPlane && this.splitHit(e)) {
      this.beginSplitDrag(e)
      return
    }
    const axis = this.rotateMode ? this.gizmoHit(e) : null
    const o = this.selectedObject()
    if (!axis || !o) {
      this.beginMove(e)
      return
    }

    this.dragAxis = axis
    this.dragCurrent = { x: o.placement.rotationX, y: o.placement.rotationY, z: o.placement.rotationZ }
    this.dragBaseQuat.setFromEuler(
      new THREE.Euler(
        (o.placement.rotationX * Math.PI) / 180,
        (o.placement.rotationY * Math.PI) / 180,
        (o.placement.rotationZ * Math.PI) / 180,
        'ZYX',
      ),
    )
    this.dragCenter.copy(this.worldCenter(o))
    const normal = this.axisUnit(axis)
    const point = this.planePoint(e, normal, this.dragCenter)
    if (!point) return
    this.dragLastAngle = this.axisAngle(point, normal, this.dragCenter)
    this.dragAccum = 0
    this.controls.enabled = false
    this.dragPointer = e.pointerId
    try {
      this.canvas.setPointerCapture(e.pointerId)
    } catch {
      /* Zeiger-Capture ist nur Komfort */
    }
    e.preventDefault()
  }

  private onGizmoMove = (e: PointerEvent) => {
    if (this.splitDrag) {
      const drag = this.splitDrag
      const point = this.planePoint(e, drag.normal, drag.center)
      if (!point) return
      const unit = this.axisUnit(drag.axis)
      const delta = point.clone().sub(drag.start).dot(unit)
      const plane = this.splitPlane
      if (!plane) return
      const clamped = Math.max(plane.min + 0.5, Math.min(plane.max - 0.5, drag.startValue + delta))
      if (Math.abs(clamped - plane.position) > 0.01) this.splitCallback?.(Math.round(clamped * 10) / 10)
      e.preventDefault()
      return
    }
    const moving = this.movePending
    if (moving) {
      if (!moving.active) {
        if (Math.hypot(e.clientX - this.downX, e.clientY - this.downY) < 3) return
        moving.active = true
        this.controls.enabled = false
        this.dragPointer = e.pointerId
        try {
          this.canvas.setPointerCapture(e.pointerId)
        } catch {
          /* Zeiger-Capture ist nur Komfort */
        }
      }
      const p = this.planePoint(e, new THREE.Vector3(0, 0, 1), moving.start)
      if (!p) return
      moving.dx = p.x - moving.start.x
      moving.dy = p.y - moving.start.y
      // Nur die Auswahlbox folgt dem Zeiger; das Mesh springt erst beim Loslassen.
      this.selectionGroup.position.set(moving.dx, moving.dy, 0)
      e.preventDefault()
      return
    }
    const axis = this.dragAxis
    if (!axis) return
    const normal = this.axisUnit(axis)
    const point = this.planePoint(e, normal, this.dragCenter)
    if (!point) return
    const angle = this.axisAngle(point, normal, this.dragCenter)
    let delta = angle - this.dragLastAngle
    while (delta > Math.PI) delta -= Math.PI * 2
    while (delta < -Math.PI) delta += Math.PI * 2
    this.dragLastAngle = angle
    this.dragAccum += delta

    // Standardmäßig frei und dadurch weich drehen. Shift rastet bewusst
    // in 5°-Schritten ein — ohne die früheren, springenden Radiuszonen.
    let angleDeg = (this.dragAccum * 180) / Math.PI
    if (e.shiftKey) angleDeg = Math.round(angleDeg / 5) * 5
    angleDeg = Math.max(-360, Math.min(360, angleDeg))

    // Weltachsen-Drehung: Delta vor die Ausgangslage multiplizieren, dann in
    // die Euler-Reihenfolge des Servers (ZYX = X, dann Y, dann Z) zerlegen.
    const spin = new THREE.Quaternion().setFromAxisAngle(normal, (angleDeg * Math.PI) / 180)
    const quat = spin.multiply(this.dragBaseQuat)
    const euler = new THREE.Euler().setFromQuaternion(quat, 'ZYX')
    const rot = {
      x: (euler.x * 180) / Math.PI,
      y: (euler.y * 180) / Math.PI,
      z: (euler.z * 180) / Math.PI,
    }
    if (
      Math.abs(rot.x - this.dragCurrent.x) < 0.05 &&
      Math.abs(rot.y - this.dragCurrent.y) < 0.05 &&
      Math.abs(rot.z - this.dragCurrent.z) < 0.05
    )
      return
    this.dragCurrent = rot
    this.rotateCallback?.({ ...rot }, axis)
    e.preventDefault()
  }

  private onGizmoUp = (e: PointerEvent) => {
    if (this.splitDrag) {
      this.splitDrag = null
      this.controls.enabled = true
      try {
        if (this.canvas.hasPointerCapture(this.dragPointer)) this.canvas.releasePointerCapture(this.dragPointer)
      } catch {
        /* Capture war schon weg */
      }
      this.dragPointer = -1
      e.preventDefault()
      return
    }
    const moving = this.movePending
    this.movePending = null
    if (moving?.active) {
      this.controls.enabled = true
      this.selectionGroup.position.set(0, 0, 0)
      try {
        if (this.canvas.hasPointerCapture(this.dragPointer)) this.canvas.releasePointerCapture(this.dragPointer)
      } catch {
        /* Capture war schon weg */
      }
      this.dragPointer = -1
      this.moveEndCallback?.(moving.id, moving.dx, moving.dy)
      e.preventDefault()
      return
    }
    if (this.dragAxis) {
      this.dragAxis = null
      this.controls.enabled = true
      try {
        if (this.canvas.hasPointerCapture(this.dragPointer)) this.canvas.releasePointerCapture(this.dragPointer)
      } catch {
        /* Capture war schon weg */
      }
      this.dragPointer = -1
      this.rotateEndCallback?.()
      return
    }
    if (e.button !== 0 || this.measureEnabled || this.paintMode) return
    if (Math.hypot(e.clientX - this.downX, e.clientY - this.downY) > 5) return
    if (this.previewPickEnabled) {
      this.pickPreviewSegment(e)
      return
    }
    this.pickObject(e)
  }

  /** Objekt unter dem Mauszeiger; gemessen am nächsten Begrenzungsrahmen. */
  private objectAt(e: PointerEvent): string | null {
    if (!this.modelMesh) return null
    const hit = this.rayAt(e).intersectObject(this.modelMesh, false)[0]
    if (!hit) return null
    let bestId: string | null = null
    let best = Infinity
    for (const o of this.objects) {
      if (!o.placement.visible || o.negative) continue
      const c = this.worldCenter(o)
      const dx = Math.max(0, Math.abs(hit.point.x - c.x) - o.size.x / 2)
      const dy = Math.max(0, Math.abs(hit.point.y - c.y) - o.size.y / 2)
      const dz = Math.max(0, Math.abs(hit.point.z - c.z) - o.size.z / 2)
      const d = dx * dx + dy * dy + dz * dz
      if (d < best) {
        best = d
        bestId = o.id
      }
    }
    return best < 100 ? bestId : null
  }

  /** Klick auf das Mesh wählt das nächstliegende Objekt aus. */
  private pickObject(e: PointerEvent) {
    const id = this.objectAt(e)
    if (id) this.selectCallback?.(id, e.ctrlKey || e.metaKey)
  }

  cancelGizmoDrag() {
    this.movePending = null
    this.selectionGroup.position.set(0, 0, 0)
    if (!this.dragAxis) return
    this.dragAxis = null
    this.controls.enabled = true
    this.dragPointer = -1
  }

  fit() {
    const span = this.bed.x + (this.plateCount - 1) * (this.bed.x + PLATE_GAP_MM)
    const radius = Math.max(span, this.bed.y) * 0.72
    const height = Math.max(24, this.modelHeight)
    const centerX = ((this.plateCount - 1) * (this.bed.x + PLATE_GAP_MM)) / 2
    this.controls.target.set(centerX, 0, height * 0.45)
    const dist = radius / Math.tan((this.camera.fov * Math.PI) / 360) * 0.85
    this.camera.position.set(dist * 0.62, -dist * 0.78, dist * 0.62)
    this.camera.updateProjectionMatrix()
    this.controls.update()
  }

  private resize() {
    const parent = this.canvas.parentElement
    const w = Math.max(1, parent?.clientWidth ?? 800)
    const h = Math.max(1, parent?.clientHeight ?? 600)
    if (w < 2 || h < 2) return
    this.renderer.setSize(w, h, false)
    this.camera.aspect = w / Math.max(1, h)
    this.camera.updateProjectionMatrix()
  }

  private loop = () => {
    this.raf = requestAnimationFrame(this.loop)
    this.controls.update()
    this.renderer.render(this.scene, this.camera)
  }

  dispose() {
    cancelAnimationFrame(this.raf)
    this.observer.disconnect()
    this.canvas.removeEventListener('pointerdown', this.onMeasureDown)
    this.canvas.removeEventListener('pointerup', this.onMeasureUp)
    this.canvas.removeEventListener('pointermove', this.onMeasureMove)
    this.canvas.removeEventListener('pointerdown', this.onGizmoDown)
    this.canvas.removeEventListener('pointermove', this.onGizmoMove)
    this.canvas.removeEventListener('pointerup', this.onGizmoUp)
    this.canvas.removeEventListener('pointerup', this.onPaintUp)
    this.clearMeasure()
    this.clearGroup(this.paintGroup)
    this.clearGroup(this.selectionGroup)
    this.clearGroup(this.gizmoGroup)
    this.clearGroup(this.compareGroup)
    this.controls.dispose()
    this.renderer.dispose()
  }
}

/** Beschriftung im 3D-Raum — als Sprite immer zur Kamera ausgerichtet. */
function textLabel(text: string, color: string, scale: number): THREE.Sprite {
  const font = '700 68px Inter, Segoe UI, sans-serif'
  // Breite an den Text anpassen: Ein fester 512-px-Canvas schnitt lange
  // Objektnamen links und rechts ab („hyperion-skiff-x3.stl“ → „perion…“).
  const canvas = document.createElement('canvas')
  const probe = canvas.getContext('2d')
  let label = text
  if (probe) {
    probe.font = font
    const fit = (value: string) => Math.ceil(probe.measureText(value).width) + 48
    while (label.length > 1 && fit(label) > 1024) label = `${label.slice(0, -2)}…`
    canvas.width = Math.min(1024, Math.max(128, fit(label)))
  } else {
    canvas.width = 512
  }
  canvas.height = 128
  const ctx = canvas.getContext('2d')
  if (ctx) {
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.font = font
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.lineJoin = 'round'
    ctx.lineWidth = 12
    ctx.strokeStyle = 'rgba(5,8,12,0.92)'
    ctx.strokeText(label, canvas.width / 2, 66)
    ctx.fillStyle = color
    ctx.fillText(label, canvas.width / 2, 66)
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false, depthTest: false }),
  )
  sprite.scale.set((scale * canvas.width) / 128, scale, 1)
  sprite.renderOrder = 40
  return sprite
}

/** Nummer unter der Platte — als Sprite, damit sie immer lesbar bleibt. */
function plateLabel(text: string): THREE.Sprite {
  const canvas = document.createElement('canvas')
  canvas.width = 96
  canvas.height = 48
  const ctx = canvas.getContext('2d')
  if (ctx) {
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.fillStyle = 'rgba(9,12,17,0.75)'
    ctx.beginPath()
    ctx.roundRect(10, 6, 76, 36, 12)
    ctx.fill()
    ctx.strokeStyle = 'rgba(255,181,69,0.5)'
    ctx.lineWidth = 2
    ctx.stroke()
    ctx.font = 'bold 24px Inter, Segoe UI, sans-serif'
    ctx.fillStyle = '#ffb545'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(text, 48, 25)
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }),
  )
  sprite.scale.set(18, 9, 1)
  return sprite
}

function disposeObject(obj: THREE.Object3D) {
  obj.traverse((child) => {
    const mesh = child as THREE.Mesh
    if (mesh.geometry) mesh.geometry.dispose()
    const mat = mesh.material as THREE.Material | THREE.Material[] | undefined
    if (Array.isArray(mat)) mat.forEach((m) => m.dispose())
    else mat?.dispose()
  })
}
