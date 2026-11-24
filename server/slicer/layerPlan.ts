/*
 * Proprietaerer Bestandteil der Easy-Slicer-Slice-Engine.
 * Copyright (c) 2026 Michael Becker. Alle Rechte vorbehalten.
 * Nutzung nur im Rahmen von LICENSE und LICENSE-SLICE-ENGINE.md.
 */
import type { PrintSettings } from '../../shared/types.ts'
import type { Mesh } from './stl.ts'

export type LayerBand = { z: number; height: number }

export type LayerPlan = {
  bands: LayerBand[]
  warnings: string[]
}

/** Eine Dreiecksfläche, die eine Schicht in ihrer Höhe begrenzt. */
type SlopedSurface = {
  z0: number
  z1: number
  /** Betrag der Z-Komponente der Flächennormalen (0 = senkrecht, 1 = waagerecht). */
  nz: number
}

function slopedSurfaces(mesh: Mesh): SlopedSurface[] {
  const out: SlopedSurface[] = []
  const p = mesh.positions
  const minZ = mesh.bbox.min.z
  for (let t = 0; t < mesh.triangles; t++) {
    const i = t * 9
    const ax = p[i], ay = p[i + 1], az = p[i + 2]
    const bx = p[i + 3], by = p[i + 4], bz = p[i + 5]
    const cx = p[i + 6], cy = p[i + 7], cz = p[i + 8]
    const z0 = Math.min(az, bz, cz) - minZ
    const z1 = Math.max(az, bz, cz) - minZ
    // Waagerechte Deckel und Böden haben keine Höhenausdehnung. Sie würden
    // sonst die letzte Schicht unnötig verfeinern, obwohl eine ebene Fläche
    // von der Schichtdicke nicht profitiert.
    if (z1 - z0 <= 1e-4) continue
    const ux = bx - ax, uy = by - ay, uz = bz - az
    const vx = cx - ax, vy = cy - ay, vz = cz - az
    const nx = uy * vz - uz * vy
    const ny = uz * vx - ux * vz
    const nz = ux * vy - uy * vx
    const len = Math.hypot(nx, ny, nz)
    if (len < 1e-9) continue
    const steepness = Math.min(1, Math.abs(nz / len))
    // Senkrechte Wände erzeugen keine vertikale Treppenstufe, die von der
    // Schichthöhe abhängt. Sie dürfen mit der maximalen Höhe gedruckt werden.
    if (steepness < 1e-6) continue
    out.push({ z0, z1, nz: steepness })
  }
  return out
}

/**
 * Höhe, bei der die Treppenstufe einer Fläche höchstens `quality` mm hoch
 * wird. Bei einer um α aus der Waagerechten geneigten Fläche ist die
 * senkrechte Stufe h und die sichtbare Abweichung h · cos(α) = h · |nz|.
 */
function heightForCusp(surfaces: SlopedSurface[], z: number, window: number, quality: number): number {
  let maxNz = 0
  for (const surface of surfaces) {
    if (surface.z1 <= z + 1e-7 || surface.z0 >= z + window - 1e-7) continue
    if (surface.nz > maxNz) maxNz = surface.nz
  }
  return maxNz > 0 ? quality / maxNz : Number.POSITIVE_INFINITY
}

/**
 * Erzeugt die Schichthöhen für ein bereits platziertes Netz. Die erste Schicht
 * bleibt immer bei `firstLayerHeight`; erst danach wird die Höhe aus der
 * Neigung der Flächen im nächsten Fenster bestimmt. Eine dünnere Restlage am
 * Modellende wird wie bisher der letzten vollen Schicht zugeschlagen.
 */
export function planLayers(mesh: Mesh, settings: PrintSettings, maxLayers = 2000): LayerPlan {
  const warnings: string[] = []
  const zTop = mesh.bbox.size.z
  const bands: LayerBand[] = []
  if (!(zTop > 1e-6)) return { bands, warnings: ['Modell hat keine Höhe — nichts zu slicen.'] }

  const nominal = Number.isFinite(settings.layerHeight) && settings.layerHeight > 0 ? settings.layerHeight : 0.2
  const first = Number.isFinite(settings.firstLayerHeight) && settings.firstLayerHeight > 0 ? settings.firstLayerHeight : nominal
  const adaptiveSettings = settings.adaptiveLayerHeight
  const adaptive = adaptiveSettings?.enabled === true
  let minHeight = adaptiveSettings?.minHeight
  let maxHeight = adaptiveSettings?.maxHeight
  const quality = adaptiveSettings?.quality

  let minH = Number.isFinite(minHeight) && (minHeight as number) > 0 ? (minHeight as number) : Math.min(0.08, nominal)
  let maxH = Number.isFinite(maxHeight) && (maxHeight as number) > 0 ? (maxHeight as number) : nominal
  if (minH > maxH) {
    warnings.push(`Adaptive Schichthöhe: Min ${minH.toFixed(2)} mm liegt über Max ${maxH.toFixed(2)} mm — die Grenzen werden getauscht.`)
    ;[minH, maxH] = [maxH, minH]
  }
  minH = Math.max(0.02, minH)
  maxH = Math.max(minH, Math.min(2, maxH))
  const target = Number.isFinite(quality) && (quality as number) > 0 ? Math.max(0.01, quality as number) : 0.1
  const surfaces = adaptive ? slopedSurfaces(mesh) : []

  let z = 0
  let nextHeight = first
  while (z < zTop - 1e-4 && bands.length < maxLayers) {
    const remaining = zTop - z
    let height: number
    if (bands.length === 0) {
      height = Math.min(nextHeight, remaining)
    } else if (!adaptive) {
      height = Math.min(nominal, remaining)
    } else {
      // Das Fenster reicht bis zur maximalen Schichthöhe. So wird eine
      // kommende Schräge schon vor ihrem Beginn erkannt und die Schicht davor
      // bleibt nicht unnötig dick.
      const window = Math.min(maxH, remaining)
      const cuspHeight = heightForCusp(surfaces, z, window, target)
      height = Math.min(maxH, cuspHeight, remaining)
      height = Math.max(minH, height)
      // Eine dünnere Restlage ist erlaubt; sie wird unten gegebenenfalls mit
      // der vorherigen Schicht zusammengelegt.
      height = Math.min(height, remaining)
    }
    if (!(height > 1e-6)) break
    bands.push({ z: z + height / 2, height })
    z += height
    nextHeight = nominal
  }
  if (bands.length >= maxLayers) {
    warnings.push(`Schichtanzahl auf ${maxLayers} begrenzt — Layerhöhe erhöhen.`)
  }

  const minLayer = Math.max(0.03, nominal * 0.2)
  while (bands.length > 1 && bands[bands.length - 1].height < minLayer) {
    const sliver = bands.pop()!
    const previous = bands[bands.length - 1]
    const mergedHeight = Math.round((previous.height + sliver.height) * 1e6) / 1e6
    const bottom = previous.z - previous.height / 2
    previous.height = mergedHeight
    previous.z = Math.round((bottom + mergedHeight / 2) * 1e6) / 1e6
    warnings.push(
      `Resthöhe ${sliver.height.toFixed(3)} mm war dünner als ${minLayer.toFixed(2)} mm und wurde der letzten Schicht zugeschlagen (jetzt ${mergedHeight.toFixed(3)} mm).`,
    )
  }

  return { bands, warnings }
}