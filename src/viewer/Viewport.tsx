import { useEffect, useRef } from 'react'
import type * as THREE from 'three'
import type { ModelObjectInfo, PreviewFeatureKind, PreviewLayer, Vec3 } from '../../shared/types.ts'
import {
  Scene3D,
  type MeasureInfo,
  type PreviewSection,
  type PreviewSegmentRef,
} from './scene.ts'
import type { PreviewColorMode } from './previewColors.ts'
import type { PreviewPalette } from './previewColors.ts'
import type { PreviewFilterBounds } from './previewFilters.ts'
import type { SurfaceTexturePattern } from '../../shared/surfaceTexture.ts'

type Props = {
  geometry: THREE.BufferGeometry | null
  layers: PreviewLayer[]
  layer: number
  showAll: boolean
  /** Farbmodus der geslicten Vorschau */
  colorMode?: PreviewColorMode
  /** Ausgeblendete Linientypen in der Vorschau */
  hiddenFeatures?: PreviewFeatureKind[]
  /** Vergleichsergebnis, synchron zur aktuellen Schicht */
  compareLayers?: PreviewLayer[] | null
  /** Konfigurierter Maximalfluss für die Reserve-Färbung */
  maxVolumetricFlow?: number
  /** Nur Segmente dieses Objekts anzeigen */
  previewFilter?: PreviewFilterBounds | null
  /** Standard- oder farbenblindtaugliche Palette */
  palette?: PreviewPalette
  /** Schnittansicht (X/Y/Z) */
  previewSection?: PreviewSection | null
  /** Segment unter dem Zeiger auswählen */
  previewPick?: boolean
  onPreviewPick?: (ref: PreviewSegmentRef | null) => void
  bed: { x: number; y: number; z: number }
  /** Delta-Drucker haben ein rundes Bett */
  kinematics?: 'cartesian' | 'corexy' | 'delta'
  onFitReady?: (fit: () => void) => void
  /** Messmodus: zwei Punkte auf dem Modell anklicken */
  measure?: boolean
  onMeasure?: (info: MeasureInfo | null) => void
  /** Mehrplatten-3MF: Anzahl der Betten und die gewählte Platte */
  plateCount?: number
  activePlate?: number
  /** Einzelobjekte für Auswahl, Markierung und Gizmo */
  objects?: ModelObjectInfo[]
  selectedId?: string | null
  /** Mehrfachauswahl: Strg-Klick ergänzt weitere Objekte. */
  selectedIds?: string[]
  onSelect?: (id: string, additive?: boolean) => void
  /** Bezugspunkt der Modellkoordinaten (Bettmitte der Ansicht) */
  modelCenter?: { x: number; y: number }
  /** Dreh-Gizmo einblenden */
  rotateMode?: boolean
  onRotate?: (rot: { x: number; y: number; z: number }, axis: 'x' | 'y' | 'z') => void
  onRotateEnd?: () => void
  /** Ausgewähltes Objekt mit der Maus verschieben (Betrag in mm) */
  onMove?: (id: string, dx: number, dy: number) => void
  /** Rot dargestellter Negativkörper (eingelassener Text) */
  overlayGeometry?: THREE.BufferGeometry | null
  /** Taste L: Stützen auf die Oberfläche malen */
  paintMode?: boolean
  paintBlock?: boolean
  onPaint?: (id: string, point: Vec3, block: boolean) => void
  /** V-07: sichtbare, ziehbare Schnittebene während des Teilen-Dialogs */
  splitPlane?: { axis: 'x' | 'y' | 'z'; position: number; min: number; max: number } | null
  onSplitPlaneMove?: (position: number) => void
  /** V-21: Oberflächenmuster vor dem Slicen als Modellvorschau. */
  texturePreview?: {
    pattern: SurfaceTexturePattern
    scale: number
    angle: number
    thickness: number
  } | null
}

export function Viewport({
  geometry,
  layers,
  layer,
  showAll,
  colorMode = 'kind',
  hiddenFeatures = [],
  compareLayers = null,
  maxVolumetricFlow = 0,
  previewFilter = null,
  palette = 'standard',
  previewSection = null,
  previewPick = false,
  onPreviewPick,
  bed,
  kinematics,
  onFitReady,
  measure,
  onMeasure,
  plateCount = 1,
  activePlate = 0,
  objects = [],
  selectedId = null,
  selectedIds = [],
  onSelect,
  modelCenter = { x: 0, y: 0 },
  rotateMode = false,
  onRotate,
  onRotateEnd,
  onMove,
  overlayGeometry = null,
  paintMode = false,
  paintBlock = false,
  onPaint,
  splitPlane = null,
  onSplitPlaneMove,
  texturePreview = null,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const sceneRef = useRef<Scene3D | null>(null)
  const round = kinematics === 'delta'

  useEffect(() => {
    if (!canvasRef.current) return
    const scene = new Scene3D(canvasRef.current)
    sceneRef.current = scene
    onFitReady?.(() => scene.fit())
    return () => {
      scene.dispose()
      sceneRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    sceneRef.current?.setBedSize(bed.x, bed.y, bed.z, round, plateCount)
  }, [bed.x, bed.y, bed.z, round, plateCount])

  useEffect(() => {
    sceneRef.current?.setActivePlate(activePlate)
  }, [activePlate])

  useEffect(() => {
    sceneRef.current?.setModel(geometry)
  }, [geometry])

  useEffect(() => {
    sceneRef.current?.setPreview(
      layers,
      layer,
      showAll,
      colorMode,
      hiddenFeatures,
      compareLayers,
      maxVolumetricFlow,
      previewFilter,
      palette,
    )
  }, [layers, layer, showAll, colorMode, hiddenFeatures, compareLayers, maxVolumetricFlow, previewFilter, palette])

  useEffect(() => {
    sceneRef.current?.setPreviewSection(previewSection)
  }, [previewSection])

  useEffect(() => {
    sceneRef.current?.setPreviewPick(previewPick, onPreviewPick)
  }, [previewPick, onPreviewPick])

  useEffect(() => {
    sceneRef.current?.setMeasure(Boolean(measure), onMeasure)
  }, [measure, onMeasure])

  useEffect(() => {
    sceneRef.current?.setModelCenter(modelCenter.x, modelCenter.y)
  }, [modelCenter.x, modelCenter.y])

  useEffect(() => {
    const ids = selectedIds.length ? selectedIds : selectedId ? [selectedId] : []
    sceneRef.current?.setObjects(objects, ids, onSelect)
  }, [objects, selectedIds, selectedId, onSelect])

  useEffect(() => {
    sceneRef.current?.setRotateMode(rotateMode)
  }, [rotateMode])

  useEffect(() => {
    sceneRef.current?.setGizmoCallbacks(onRotate, onRotateEnd)
  }, [onRotate, onRotateEnd])

  useEffect(() => {
    sceneRef.current?.setMoveCallback(onMove)
  }, [onMove])

  useEffect(() => {
    sceneRef.current?.setOverlay(overlayGeometry)
  }, [overlayGeometry])

  useEffect(() => {
    sceneRef.current?.setPaintMode(paintMode, paintBlock, onPaint)
  }, [paintMode, paintBlock, onPaint])

  useEffect(() => {
    sceneRef.current?.setSplitPlane(splitPlane, onSplitPlaneMove)
  }, [splitPlane, onSplitPlaneMove])

  useEffect(() => {
    sceneRef.current?.setTexturePreview(
      texturePreview?.pattern ?? null,
      texturePreview?.scale ?? 3,
      texturePreview?.angle ?? 0,
      texturePreview?.thickness ?? 0.3,
    )
  }, [texturePreview?.pattern, texturePreview?.scale, texturePreview?.angle, texturePreview?.thickness])

  return <canvas ref={canvasRef} className="h-full w-full" />
}
