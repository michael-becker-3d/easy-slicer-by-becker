/**
 * Echte Mengenoperationen über manifold-3d (WASM).
 *
 * Der reine Flächenschnitt lässt die Nahtfläche offen: Beim Slicen entstehen
 * dort offene Konturen. Mit CSG bekommt jedes Teil seine eigene, vollständig
 * geschlossene Nahtfläche — und Überlappungen lassen sich echt vereinigen.
 *
 * In der EXE liegen `manifold.js` und `manifold.wasm` als SEA-Asset bei. Der
 * Lader erwartet eine Datei auf der Platte, deshalb werden beide beim ersten
 * Gebrauch nach `%TEMP%` entpackt und von dort geladen (gleiches Muster wie
 * beim Serial-Binding in `sea.ts`).
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { getAsset, isSea } from 'node:sea'
import { fromCutFrame, permuteMesh, seamHeight, toCutFrame } from './edit.ts'
import { makeMesh, type Mesh } from './slicer/stl.ts'
import { drainOffsets, HOLLOW_DRAIN_MAX, HOLLOW_DRAIN_MIN, HOLLOW_WALL_MAX, HOLLOW_WALL_MIN } from '../shared/scanPrep.ts'

/* eslint-disable @typescript-eslint/no-explicit-any */
type Wasm = any

let loading: Promise<Wasm> | null = null

/** Lädt das WASM-Modul einmal pro Prozess. */
export function loadManifold(): Promise<Wasm> {
  if (!loading) {
    loading = (async () => {
      if (isSea()) {
        const dir = join(tmpdir(), 'easy-slicer-manifold')
        mkdirSync(dir, { recursive: true })
        const jsPath = join(dir, 'manifold.js')
        const wasmPath = join(dir, 'manifold.wasm')
        writeFileSync(jsPath, Buffer.from(getAsset('manifold.js')))
        writeFileSync(wasmPath, Buffer.from(getAsset('manifold.wasm')))
        const mod = await import(pathToFileURL(jsPath).href)
        const api = await mod.default()
        api.setup()
        return api
      }
      const mod = await import('manifold-3d')
      const api = await (mod as any).default()
      api.setup()
      return api
    })()
    // Ein Fehlschlag darf nicht dauerhaft kleben bleiben.
    loading.catch(() => {
      loading = null
    })
  }
  return loading
}

/** Ist CSG in dieser Installation verfügbar? */
export async function csgAvailable(): Promise<boolean> {
  try {
    await loadManifold()
    return true
  } catch {
    return false
  }
}

// 0,1 µm — feiner als jede Druckauflösung, gröber als Rundungsrauschen.
const KEY = 1e4

/** manifold meldet den Status je nach Version als Text oder als Zahl. */
function isOk(solid: Wasm): boolean {
  const status = solid.status()
  return (status === 'NoError' || status === 0) && !solid.isEmpty()
}

/**
 * Verschmilzt gleiche Eckpunkte und indiziert die Dreiecke.
 *
 * Die Eckpunkte liegen in drei verschachtelten Maps statt in einer Map mit
 * zusammengebauten Textschlüsseln. Bei Netzen mit Hunderttausenden Dreiecken
 * war das Erzeugen der Schlüsseltexte der teuerste Teil jedes Imports; die
 * verschachtelten Maps liefern dasselbe Ergebnis (1/10 µm Raster) ohne
 * Textaufwand und ohne die Kollisionsgefahr einer zusammengepressten Zahl.
 */
function weld(positions: Float32Array) {
  const verts: number[] = []
  const index = new Map<number, Map<number, Map<number, number>>>()
  // Ein Index je Eckpunkt der Dreiecksliste; Länge steht nach dem Lauf fest.
  const tris: number[] = new Array(Math.floor(positions.length / 3))
  let n = 0
  for (let i = 0; i < positions.length; i += 3) {
    const ix = Math.round(positions[i] * KEY)
    const iy = Math.round(positions[i + 1] * KEY)
    const iz = Math.round(positions[i + 2] * KEY)
    let ys = index.get(ix)
    if (ys === undefined) {
      ys = new Map()
      index.set(ix, ys)
    }
    let zs = ys.get(iy)
    if (zs === undefined) {
      zs = new Map()
      ys.set(iy, zs)
    }
    let v = zs.get(iz)
    if (v === undefined) {
      v = verts.length / 3
      zs.set(iz, v)
      verts.push(positions[i], positions[i + 1], positions[i + 2])
    }
    tris[n++] = v
  }
  tris.length = n
  return { verts, tris }
}

/** Zerlegt ein Netz in zusammenhängende Komponenten (gemeinsame Eckpunkte). */
export function meshComponents(mesh: Mesh): Mesh[] {
  const { verts, tris } = weld(mesh.positions)
  const triangles = tris.length / 3
  if (!triangles) return []
  const parent = Array.from({ length: triangles }, (_, i) => i)
  const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x])))
  const union = (a: number, b: number) => {
    a = find(a)
    b = find(b)
    if (a !== b) parent[b] = a
  }
  const owner = new Map<number, number>()
  for (let t = 0; t < triangles; t++) {
    for (let v = 0; v < 3; v++) {
      const vertex = tris[t * 3 + v]
      const first = owner.get(vertex)
      if (first === undefined) owner.set(vertex, t)
      else union(t, first)
    }
  }
  const groups = new Map<number, number[]>()
  for (let t = 0; t < triangles; t++) {
    const root = find(t)
    const list = groups.get(root)
    if (list) list.push(t)
    else groups.set(root, [t])
  }
  const out: Mesh[] = []
  for (const list of groups.values()) {
    const positions = new Float32Array(list.length * 9)
    let offset = 0
    for (const t of list) {
      for (let v = 0; v < 3; v++) {
        const i = tris[t * 3 + v] * 3
        positions[offset++] = verts[i]
        positions[offset++] = verts[i + 1]
        positions[offset++] = verts[i + 2]
      }
    }
    out.push(makeMesh(positions, false))
  }
  return out
}

/**
 * Zählt nur die zusammenhängenden Inseln. `meshComponents` baut dafür ein
 * eigenes Mesh je Insel; bei einem großen Scan ist das unnötig viel Speicher.
 */
export function countComponents(mesh: Mesh): number {
  const { tris } = weld(mesh.positions)
  const triangles = tris.length / 3
  if (!triangles) return 0
  const parent = Array.from({ length: triangles }, (_, i) => i)
  const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x])))
  const owner = new Map<number, number>()
  for (let t = 0; t < triangles; t++) {
    for (let v = 0; v < 3; v++) {
      const vertex = tris[t * 3 + v]
      const first = owner.get(vertex)
      if (first === undefined) {
        owner.set(vertex, t)
        continue
      }
      const a = find(t)
      const b = find(first)
      if (a !== b) parent[b] = a
    }
  }
  const roots = new Set<number>()
  for (let t = 0; t < triangles; t++) roots.add(find(t))
  return roots.size
}

/**
 * Vereinigt überlappende Hüllen eines Teils zu einem soliden Körper.
 *
 * Modelle wie BASE.stl bestehen aus zwei Schalen, die sich überlappen, aber
 * keine gemeinsamen Punkte haben (z. B. zwei Exportteile). Der Slicer sieht
 * sonst zwei getrennte Stücke, obwohl sie ineinanderstecken. Getrennte Inseln
 * ohne Überlappung bleiben unangetastet — dort würde eine Vereinigung Teile
 * fälschlich verschmelzen.
 */
export async function unionOverlappingComponents(mesh: Mesh): Promise<Mesh> {
  const comps = meshComponents(mesh)
  if (comps.length < 2) return mesh
  const eps = 0.05
  const overlaps = (a: Mesh, b: Mesh) =>
    a.bbox.min.x < b.bbox.max.x - eps &&
    b.bbox.min.x < a.bbox.max.x - eps &&
    a.bbox.min.y < b.bbox.max.y - eps &&
    b.bbox.min.y < a.bbox.max.y - eps &&
    a.bbox.min.z < b.bbox.max.z - eps &&
    b.bbox.min.z < a.bbox.max.z - eps

  // Zusammenhängende Überlappungsgruppen (transitiv) bilden.
  const groups: Mesh[][] = []
  const used = comps.map(() => false)
  for (let i = 0; i < comps.length; i++) {
    if (used[i]) continue
    const group = [comps[i]]
    used[i] = true
    for (let k = 0; k < group.length; k++) {
      for (let j = 0; j < comps.length; j++) {
        if (!used[j] && overlaps(group[k], comps[j])) {
          used[j] = true
          group.push(comps[j])
        }
      }
    }
    groups.push(group)
  }

  const pieces: Mesh[] = []
  let changed = false
  for (const group of groups) {
    if (group.length === 1) {
      pieces.push(group[0])
      continue
    }
    const merged = await unionMeshes(group).catch(() => null)
    if (merged) {
      pieces.push(merged)
      changed = true
    } else {
      // CSG nicht möglich: Hüllen bleiben erhalten, lieber zwei Stücke als
      // ein stillschweigend zerstörtes Teil.
      pieces.push(...group)
    }
  }
  if (!changed) return mesh
  const total = pieces.reduce((n, m) => n + m.positions.length, 0)
  const positions = new Float32Array(total)
  let offset = 0
  for (const piece of pieces) {
    positions.set(piece.positions, offset)
    offset += piece.positions.length
  }
  return makeMesh(positions, false)
}

/**
 * Repariert ein Netz: gleiche Punkte verschmelzen, entartete und doppelte
 * Dreiecke entfernen. Das behebt die häufigsten Gründe, aus denen ein Import
 * nicht wasserdicht ist (T-Stöße, doppelte Flächen, Nullflächendreiecke).
 */
export function repairMesh(mesh: Mesh): Mesh {
  const { verts, tris } = weld(mesh.positions)
  const out: number[] = []
  const seen = new Set<string>()
  let dropped = 0
  const point = (i: number) => [verts[i * 3], verts[i * 3 + 1], verts[i * 3 + 2]]
  for (let t = 0; t + 2 < tris.length; t += 3) {
    const a = tris[t]
    const b = tris[t + 1]
    const c = tris[t + 2]
    if (a === b || b === c || a === c) {
      dropped++
      continue
    }
    const [ax, ay, az] = point(a)
    const [bx, by, bz] = point(b)
    const [cx, cy, cz] = point(c)
    const ux = bx - ax
    const uy = by - ay
    const uz = bz - az
    const vx = cx - ax
    const vy = cy - ay
    const vz = cz - az
    const nx = uy * vz - uz * vy
    const ny = uz * vx - ux * vz
    const nz = ux * vy - uy * vx
    if (Math.sqrt(nx * nx + ny * ny + nz * nz) < 1e-9) {
      dropped++
      continue
    }
    const key = [a, b, c].sort((x, y) => x - y).join(',')
    if (seen.has(key)) {
      dropped++
      continue
    }
    seen.add(key)
    out.push(ax, ay, az, bx, by, bz, cx, cy, cz)
  }
  if (!dropped) return mesh
  return makeMesh(new Float32Array(out), false)
}

/** Kanten, die nur zu einem Dreieck gehören — die offenen Ränder eines Netzes. */
export function countOpenEdges(mesh: Mesh): number {
  const { tris } = weld(mesh.positions)
  // Kante als Zahlenpaar (kleinerer → größerer Punktindex). Textschlüssel je
  // Kante waren bei großen Platten der zweitteureste Teil des Imports.
  const edges = new Map<number, Map<number, number>>()
  for (let t = 0; t + 2 < tris.length; t += 3) {
    for (let e = 0; e < 3; e++) {
      const a = tris[t + e]
      const b = tris[t + ((e + 1) % 3)]
      if (a === b) continue
      const lo = a < b ? a : b
      const hi = a < b ? b : a
      let row = edges.get(lo)
      if (row === undefined) {
        row = new Map()
        edges.set(lo, row)
      }
      row.set(hi, (row.get(hi) ?? 0) + 1)
    }
  }
  let open = 0
  for (const row of edges.values()) for (const n of row.values()) if (n === 1) open++
  return open
}

/**
 * Schließt offene Ränder: Randkanten werden zu Ringen verkettet und jeder
 * Ring mit einem Fächer gedeckt. Das behebt die „offenen Konturen", die der
 * Slicer nach einem Import meldet (fehlende Dreiecke, Löcher, Risse).
 */
export function fillHoles(mesh: Mesh): Mesh {
  const { verts, tris } = weld(mesh.positions)
  if (!tris.length) return mesh
  const triangleCount = tris.length / 3
  // Kanten zählen wie in `countOpenEdges`: Zahlenpaar-Schlüssel in
  // verschachtelten Maps statt zusammengebauter Textschlüssel. Bei Netzen mit
  // Hunderttausenden Dreiecken war das Erzeugen der Schlüsseltexte der
  // teuerste Teil der Reparatur.
  const counts = new Map<number, Map<number, number>>()
  for (let t = 0; t < triangleCount; t++) {
    for (let e = 0; e < 3; e++) {
      const a = tris[t * 3 + e]
      const b = tris[t * 3 + ((e + 1) % 3)]
      if (a === b) continue
      const lo = a < b ? a : b
      const hi = a < b ? b : a
      let row = counts.get(lo)
      if (row === undefined) {
        row = new Map()
        counts.set(lo, row)
      }
      row.set(hi, (row.get(hi) ?? 0) + 1)
    }
  }
  const boundary: [number, number][] = []
  for (let t = 0; t < triangleCount; t++) {
    for (let e = 0; e < 3; e++) {
      const a = tris[t * 3 + e]
      const b = tris[t * 3 + ((e + 1) % 3)]
      if (a === b) continue
      const lo = a < b ? a : b
      const hi = a < b ? b : a
      if (counts.get(lo)?.get(hi) === 1) boundary.push([a, b])
    }
  }
  if (!boundary.length) return mesh
  // Vorhandene Dreiecke in ein vorbelegtes Array kopieren; die Flicken kommen
  // getrennt dazu und werden am Ende genau einmal zusammengeführt.
  const out = new Float32Array(triangleCount * 9)
  for (let t = 0; t < triangleCount; t++) {
    for (let k = 0; k < 3; k++) {
      const v = tris[t * 3 + k] * 3
      const o = t * 9 + k * 3
      out[o] = verts[v]
      out[o + 1] = verts[v + 1]
      out[o + 2] = verts[v + 2]
    }
  }
  const patches: number[] = []
  const next = new Map<number, number>()
  for (const [a, b] of boundary) if (!next.has(a)) next.set(a, b)
  const seen = new Set<number>()
  for (const [start] of boundary) {
    if (seen.has(start)) continue
    const loop: number[] = []
    let cur = start
    let guard = 0
    while (!seen.has(cur) && guard++ < 200000) {
      seen.add(cur)
      loop.push(cur)
      const nxt = next.get(cur)
      if (nxt === undefined || nxt === start) break
      cur = nxt
    }
    if (loop.length < 3) continue
    // Fächer: die Wicklung korrigiert danach orientMesh über die Nachbarn.
    for (let i = 1; i + 1 < loop.length; i++) {
      const a = loop[0]
      const b = loop[i]
      const c = loop[i + 1]
      patches.push(verts[a * 3], verts[a * 3 + 1], verts[a * 3 + 2])
      patches.push(verts[b * 3], verts[b * 3 + 1], verts[b * 3 + 2])
      patches.push(verts[c * 3], verts[c * 3 + 1], verts[c * 3 + 2])
    }
  }
  if (!patches.length) return makeMesh(out, false)
  const merged = new Float32Array(out.length + patches.length)
  merged.set(out, 0)
  merged.set(patches, out.length)
  return makeMesh(merged, false)
}

/**
 * Bringt alle Dreiecke auf eine einheitliche Wicklung.
 *
 * Importierte Modelle sind oft geschlossen, aber gemischt orientiert — manifold
 * lehnt sie dann als „nicht manifold“ ab. Die Ausrichtung wird über gemeinsame
 * Kanten fortgepflanzt und am Ende über das Volumen geprüft.
 */
export function orientMesh(mesh: Mesh): Mesh {
  const { verts, tris } = weld(mesh.positions)
  const count = tris.length / 3
  // Kante → abwechselnd Dreiecksindex und Richtung (1 = aufsteigend). Wie in
  // `fillHoles` mit Zahlenpaaren statt Textschlüsseln und ohne ein Objekt je
  // Kante — der größte Einzelposten bei Netzen mit vielen Dreiecken.
  const edgeMap = new Map<number, Map<number, number[]>>()
  for (let t = 0; t < count; t++) {
    const a = tris[t * 3]
    const b = tris[t * 3 + 1]
    const c = tris[t * 3 + 2]
    const add = (p: number, q: number) => {
      const lo = p < q ? p : q
      const hi = p < q ? q : p
      let row = edgeMap.get(lo)
      if (row === undefined) {
        row = new Map()
        edgeMap.set(lo, row)
      }
      const list = row.get(hi)
      if (list === undefined) row.set(hi, [t, p < q ? 1 : 0])
      else list.push(t, p < q ? 1 : 0)
    }
    add(a, b)
    add(b, c)
    add(c, a)
  }

  const flip = new Uint8Array(count)
  const seen = new Uint8Array(count)
  for (let start = 0; start < count; start++) {
    if (seen[start]) continue
    seen[start] = 1
    const queue = [start]
    while (queue.length) {
      const t = queue.pop() as number
      for (let e = 0; e < 3; e++) {
        const p = tris[t * 3 + e]
        const q = tris[t * 3 + ((e + 1) % 3)]
        const lo = p < q ? p : q
        const hi = p < q ? q : p
        const list = edgeMap.get(lo)?.get(hi)
        if (list === undefined) continue
        const mine = (p < q) !== Boolean(flip[t])
        for (let i = 0; i < list.length; i += 2) {
          const other = list[i]
          if (other === t) continue
          const theirs = list[i + 1] === 1 ? !flip[other] : Boolean(flip[other])
          // Benachbart heißt: dieselbe Kante in entgegengesetzter Richtung.
          if (mine === theirs) flip[other] ^= 1
          if (!seen[other]) {
            seen[other] = 1
            queue.push(other)
          }
        }
      }
    }
  }

  // Volumen und Ausgabe direkt über die Punktindizes: keine Zwischenarrays
  // je Dreieck, kein Durchreichen durch ein `number[]`.
  let volume = 0
  for (let t = 0; t < count; t++) {
    const ia = tris[t * 3] * 3
    const ib = tris[t * 3 + 1] * 3
    const ic = tris[t * 3 + 2] * 3
    const ax = verts[ia], ay = verts[ia + 1], az = verts[ia + 2]
    const bx = verts[ib], by = verts[ib + 1], bz = verts[ib + 2]
    const cx = verts[ic], cy = verts[ic + 1], cz = verts[ic + 2]
    const v = (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6
    volume += flip[t] ? -v : v
  }
  const invert = volume < 0
  const out = new Float32Array(count * 9)
  for (let t = 0; t < count; t++) {
    const ia = tris[t * 3] * 3
    const ib = tris[t * 3 + 1] * 3
    const ic = tris[t * 3 + 2] * 3
    const reversed = (flip[t] ^ (invert ? 1 : 0)) === 1
    const o = t * 9
    out[o] = verts[ia]
    out[o + 1] = verts[ia + 1]
    out[o + 2] = verts[ia + 2]
    out[o + 3] = verts[reversed ? ic : ib]
    out[o + 4] = verts[reversed ? ic + 1 : ib + 1]
    out[o + 5] = verts[reversed ? ic + 2 : ib + 2]
    out[o + 6] = verts[reversed ? ib : ic]
    out[o + 7] = verts[reversed ? ib + 1 : ic + 1]
    out[o + 8] = verts[reversed ? ib + 2 : ic + 2]
  }
  return makeMesh(out, false)
}

/** Macht aus einem Dreiecksnetz einen geschlossenen Körper. */
async function toSolid(mesh: Mesh) {
  const api = await loadManifold()
  const build = (positions: Float32Array) => {
    const { verts, tris } = weld(positions)
    return api.Manifold.ofMesh(
      new api.Mesh({
        numProp: 3,
        vertProperties: new Float32Array(verts),
        triVerts: new Uint32Array(tris),
      }),
    )
  }
  // Erst das rohe Netz nur ausrichten: schon geschlossene Dateien (z. B. saubere
  // STL) verlieren sonst durch die Reparatur ihre doppelten Flächen und werden
  // aufgerissen („Not manifold"). Reparatur bleibt der Rückfall für kaputte Netze.
  const raw = build(orientMesh(mesh).positions)
  if (isOk(raw)) return raw
  raw.delete?.()
  const repaired = build(orientMesh(repairMesh(mesh)).positions)
  if (isOk(repaired)) return repaired
  repaired.delete?.()
  throw new Error('Netz ist nicht wasserdicht — bitte reparieren.')
}

/**
 * Räumt doppelte und entartete Dreiecke auf.
 *
 * Importierte Modelle enthalten oft deckungsgleiche oder fast punktförmige
 * Dreiecke. Beim Rendern flackern die Flächen dann (Z-Kämpfen) und sehen wie
 * Löcher aus. Geweldet wird bei 0,01 mm — feiner als jede Düse druckt.
 */
function cleanSoup(positions: Float32Array): Float32Array {
  const KEY = 100
  const key = (i: number) =>
    `${Math.round(positions[i] * KEY)},${Math.round(positions[i + 1] * KEY)},${Math.round(positions[i + 2] * KEY)}`
  const seen = new Set<string>()
  const out: number[] = []
  for (let i = 0; i < positions.length; i += 9) {
    const a = key(i)
    const b = key(i + 3)
    const c = key(i + 6)
    if (a === b || b === c || a === c) continue
    // Flächenlose Dreiecke bleiben drin: Sie haben keine Fläche, sind aber Teil
    // der geschlossenen Naht. Wer sie entfernt, reißt das Netz auf (nicht mehr
    // manifold) — schwarz wirkten die Flächen wegen der Rückseiten-Darstellung.
    const tri = [a, b, c].sort().join('|')
    if (seen.has(tri)) continue
    seen.add(tri)
    for (let k = 0; k < 9; k++) out.push(positions[i + k])
  }
  return new Float32Array(out)
}

/** Zurück in ein Dreiecksnetz (entindiziert, wie der Rest des Servers). */
function fromSolid(solid: Wasm): Mesh {
  const m = solid.getMesh()
  const stride = m.numProp ?? 3
  const vp: Float32Array = m.vertProperties
  const tv: Uint32Array = m.triVerts
  const out = new Float32Array(tv.length * 3)
  for (let i = 0; i < tv.length; i++) {
    const v = tv[i] * stride
    out[i * 3] = vp[v]
    out[i * 3 + 1] = vp[v + 1]
    out[i * 3 + 2] = vp[v + 2]
  }
  // Kein Nachputzen: Das CSG-Ergebnis ist bereits geschlossen. `cleanSoup`
  // verschmilzt Punkte auf 0,01 mm und reißt dabei Nahtdreiecke auf.
  return makeMesh(out, false)
}

type Profile = 'flat' | 'zigzag' | 'dovetail' | 'wave' | 'step' | 'undercut'
type Axis = 'z' | 'x' | 'y'

/** Eine Begrenzung des Teils: ebene Fläche oder Höhenfläche. */
type Boundary =
  | { flat: number }
  | { z0: number; amp: number; period: number; minX: number; shift: number }

/**
 * Baut einen geschlossenen Körper zwischen zwei Begrenzungen.
 *
 * Beide Begrenzungen werden über ein Raster abgetastet; Deckfläche, Boden und
 * die vier Wände ergeben zusammen einen wasserdichten Körper. Er ragt rundum
 * über das Bauteil hinaus, damit der Schnitt an den Außenwänden sauber endet.
 */
function boundarySolid(api: Wasm, min: any, max: any, profile: Profile, lower: Boundary, upper: Boundary) {
  const x0 = min.x - 2
  const x1 = max.x + 2
  const y0 = min.y - 2
  const y1 = max.y + 2
  const nx = Math.max(8, Math.min(180, Math.ceil((x1 - x0) / 1.2)))
  const ny = Math.max(8, Math.min(180, Math.ceil((y1 - y0) / 1.2)))
  // Stufenkanten exakt abtasten: sonst wird die senkrechte Flanke über eine
  // Rasterzelle schräg. Zwei Punkte knapp links/rechts ergeben eine echte Stufe.
  let xs: number[] = Array.from({ length: nx + 1 }, (_, i) => x0 + ((x1 - x0) * i) / nx)
  if (profile === 'step') {
    const period = 'flat' in upper ? ('flat' in lower ? 1 : lower.period) : upper.period
    const extra: number[] = []
    const u0 = (x0 - min.x) / period
    const u1 = (x1 - min.x) / period
    for (let k = Math.ceil(u0 - 0.5); k <= Math.ceil(u1); k++) {
      const xt = min.x + (k + 0.5) * period
      if (xt > x0 + 0.02 && xt < x1 - 0.02) extra.push(xt - 0.004, xt + 0.004)
    }
    xs = [...xs, ...extra].sort((a, b) => a - b)
  }
  const cells = xs.length - 1
  const zt = (x: number) =>
    'flat' in upper ? upper.flat : seamHeight(profile, x, upper.z0, upper.amp, upper.period, upper.minX) + upper.shift
  const zb = (x: number) =>
    'flat' in lower ? lower.flat : seamHeight(profile, x, lower.z0, lower.amp, lower.period, lower.minX) + lower.shift

  const verts: number[] = []
  const index = new Map<string, number>()
  const v = (x: number, y: number, z: number) => {
    const k = `${Math.round(x * 1e3)}|${Math.round(y * 1e3)}|${Math.round(z * 1e3)}`
    let i = index.get(k)
    if (i === undefined) {
      i = verts.length / 3
      index.set(k, i)
      verts.push(x, y, z)
    }
    return i
  }
  const tris: number[] = []
  const at = (i: number, j: number) => {
    const x = xs[i]
    const y = y0 + ((y1 - y0) * j) / ny
    return { x, y }
  }

  for (let i = 0; i < cells; i++) {
    for (let j = 0; j < ny; j++) {
      const a = at(i, j)
      const b = at(i + 1, j)
      const c = at(i + 1, j + 1)
      const d = at(i, j + 1)
      const ta = v(a.x, a.y, zt(a.x))
      const tb = v(b.x, b.y, zt(b.x))
      const tc = v(c.x, c.y, zt(c.x))
      const td = v(d.x, d.y, zt(d.x))
      // Deckfläche von oben gesehen gegen den Uhrzeigersinn → Normale +Z
      tris.push(ta, tb, tc, ta, tc, td)
      const ba = v(a.x, a.y, zb(a.x))
      const bb = v(b.x, b.y, zb(b.x))
      const bc = v(c.x, c.y, zb(c.x))
      const bd = v(d.x, d.y, zb(d.x))
      // Boden umgekehrt gewickelt → Normale −Z
      tris.push(ba, bc, bb, ba, bd, bc)
    }
  }

  // Wände: je Kante nach außen gewickelt, damit die Flächen zusammenpassen.
  for (let i = 0; i < cells; i++) {
    const a = at(i, 0)
    const b = at(i + 1, 0)
    tris.push(v(a.x, a.y, zb(a.x)), v(b.x, b.y, zb(b.x)), v(b.x, b.y, zt(b.x)))
    tris.push(v(a.x, a.y, zb(a.x)), v(b.x, b.y, zt(b.x)), v(a.x, a.y, zt(a.x)))
    const c = at(i, ny)
    const d = at(i + 1, ny)
    tris.push(v(c.x, c.y, zb(c.x)), v(d.x, d.y, zt(d.x)), v(d.x, d.y, zb(d.x)))
    tris.push(v(c.x, c.y, zb(c.x)), v(c.x, c.y, zt(c.x)), v(d.x, d.y, zt(d.x)))
  }
  for (let j = 0; j < ny; j++) {
    const a = at(0, j)
    const b = at(0, j + 1)
    tris.push(v(a.x, a.y, zb(a.x)), v(a.x, a.y, zt(a.x)), v(b.x, b.y, zt(b.x)))
    tris.push(v(a.x, a.y, zb(a.x)), v(b.x, b.y, zt(b.x)), v(b.x, b.y, zb(b.x)))
    const c = at(cells, j)
    const d = at(cells, j + 1)
    tris.push(v(c.x, c.y, zb(c.x)), v(d.x, d.y, zb(d.x)), v(d.x, d.y, zt(d.x)))
    tris.push(v(c.x, c.y, zb(c.x)), v(d.x, d.y, zt(d.x)), v(c.x, c.y, zt(c.x)))
  }

  const mesh = new api.Mesh({
    numProp: 3,
    vertProperties: new Float32Array(verts),
    triVerts: new Uint32Array(tris),
  })
  const solid = api.Manifold.ofMesh(mesh)
  if (!isOk(solid)) {
    solid.delete?.()
    throw new Error('Schnittkörper konnte nicht gebaut werden.')
  }
  return solid
}

/**
 * Leicht konischer Zapfen: unten schmaler als oben.
 * Damit flutscht das Teil beim Zusammenstecken hinein und klemmt erst oben.
 */
function taperedPin(
  api: Wasm,
  center: { x: number; y: number; z: number },
  width: number,
  length: number,
  height: number,
  taper: number,
) {
  const tx = width / 2
  const ty = length / 2
  const bx = tx * (1 - taper)
  const by = ty * (1 - taper)
  const z0 = center.z - height / 2
  const z1 = center.z + height / 2
  const verts = [
    center.x - bx, center.y - by, z0,
    center.x + bx, center.y - by, z0,
    center.x + bx, center.y + by, z0,
    center.x - bx, center.y + by, z0,
    center.x - tx, center.y - ty, z1,
    center.x + tx, center.y - ty, z1,
    center.x + tx, center.y + ty, z1,
    center.x - tx, center.y + ty, z1,
  ]
  const tris = [
    0, 2, 1, 0, 3, 2,        // Boden (Normale −Z)
    4, 5, 6, 4, 6, 7,        // Deckel (+Z)
    0, 1, 5, 0, 5, 4,        // y−
    1, 2, 6, 1, 6, 5,        // x+
    2, 3, 7, 2, 7, 6,        // y+
    3, 0, 4, 3, 4, 7,        // x−
  ]
  const mesh = new api.Mesh({
    numProp: 3,
    vertProperties: new Float32Array(verts),
    triVerts: new Uint32Array(tris),
  })
  const solid = api.Manifold.ofMesh(mesh)
  if (!isOk(solid)) {
    solid.delete?.()
    throw new Error('Zapfen konnte nicht gebaut werden.')
  }
  return solid
}

/** Netz aus Dreiecksliste (9 Zahlen je Dreieck) zu einem geschlossenen Körper. */
function solidFromSoup(api: Wasm, soup: number[]): Wasm {
  const mesh = makeMesh(new Float32Array(soup), false)
  const { verts, tris } = weld(orientMesh(repairMesh(mesh)).positions)
  const m = new api.Mesh({
    numProp: 3,
    vertProperties: new Float32Array(verts),
    triVerts: new Uint32Array(tris),
  })
  const solid = api.Manifold.ofMesh(m)
  if (!isOk(solid)) {
    solid.delete?.()
    throw new Error('Verbinder konnte nicht gebaut werden.')
  }
  return solid
}

/**
 * Schwalbenschwanz-Schiene: ein Prisma entlang X, dessen Querschnitt nach
 * oben breiter wird. Unten schmal (Hals), oben breit (Kopf) — das obere Teil
 * lässt sich seitlich aufschieben und danach nicht mehr nach oben abziehen.
 *
 * `flare` ist der Anteil, um den der Kopf breiter ist als der Hals.
 */
function dovetailRail(
  api: Wasm,
  x0: number,
  x1: number,
  yCenter: number,
  z0: number,
  z1: number,
  width: number,
  flare: number,
): Wasm {
  const head = Math.max(0.5, width / 2)
  const neck = head * Math.max(0.25, 1 - flare)
  const pts = [
    [x0, yCenter - neck, z0],
    [x0, yCenter + neck, z0],
    [x0, yCenter + head, z1],
    [x0, yCenter - head, z1],
    [x1, yCenter - neck, z0],
    [x1, yCenter + neck, z0],
    [x1, yCenter + head, z1],
    [x1, yCenter - head, z1],
  ]
  const faces = [
    [0, 1, 5], [0, 5, 4], // Boden
    [3, 2, 6], [3, 6, 7], // Kopf oben
    [0, 4, 7], [0, 7, 3], // y−
    [1, 2, 6], [1, 6, 5], // y+
    [0, 3, 2], [0, 2, 1], // Stirn x0
    [4, 5, 6], [4, 6, 7], // Stirn x1
  ]
  const soup: number[] = []
  for (const face of faces) for (const i of face) soup.push(pts[i][0], pts[i][1], pts[i][2])
  return solidFromSoup(api, soup)
}

/**
 * Puzzle-Verbinder: T-förmiger Riegel mit gerundetem Kopf.
 *
 * Der schmale Hals sitzt in der Naht, der breite Kopf greift darüber. Das
 * Gegenstück hat die passende Nut und wird von der Seite eingeschoben — danach
 * lässt es sich nicht mehr abheben. Eigene Geometrie, nur die funktionale
 * T-Nut-Form; kein fremder Code und keine fremden Assets.
 */
function puzzleRail(
  api: Wasm,
  x0: number,
  x1: number,
  yCenter: number,
  z0: number,
  z1: number,
  width: number,
): Wasm {
  const head = Math.max(0.6, width / 2)
  const neck = Math.max(0.35, head * 0.55)
  const step = z0 + (z1 - z0) * 0.55
  const r = Math.min(head * 0.45, Math.max(0.15, (z1 - step) * 0.45))
  const pts: [number, number][] = [
    [-neck, z0],
    [neck, z0],
    [neck, step],
    [head, step],
  ]
  // Gerundete obere Ecken: Viertelbögen rechts und links.
  const seg = 6
  for (let i = 1; i <= seg; i++) {
    const a = (i / seg) * (Math.PI / 2)
    pts.push([head - r + Math.cos(a) * r, z1 - r + Math.sin(a) * r])
  }
  for (let i = 1; i <= seg; i++) {
    const a = Math.PI / 2 + (i / seg) * (Math.PI / 2)
    pts.push([-head + r + Math.cos(a) * r, z1 - r + Math.sin(a) * r])
  }
  pts.push([-head, step], [-neck, step])

  const soup: number[] = []
  const at = (x: number, p: [number, number]) => [x, yCenter + p[0], p[1]]
  // Seitenwände entlang X
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]
    const b = pts[(i + 1) % pts.length]
    const a0 = at(x0, a), b0 = at(x0, b), a1 = at(x1, a), b1 = at(x1, b)
    soup.push(...a0, ...b0, ...b1, ...a0, ...b1, ...a1)
  }
  // Deckflächen: Fächer von einem Punkt im Hals (Form ist sternförmig).
  const center: [number, number] = [0, (z0 + step) / 2]
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]
    const b = pts[(i + 1) % pts.length]
    soup.push(...at(x0, center), ...at(x0, a), ...at(x0, b))
    soup.push(...at(x1, center), ...at(x1, b), ...at(x1, a))
  }
  return solidFromSoup(api, soup)
}

/**
 * Schraubgewinde: zylindrischer Kern mit einer echten, helixförmig
 * umlaufenden Rippe. Als geschlossenes Netz aufgebaut, damit es ohne
 * zusätzliche CSG-Schritte mit dem Bauteil vereinigt bzw. ausgespart werden
 * kann. `grow` erweitert Kern und Rippe radial um die Passung.
 */
function threadedPin(
  api: Wasm,
  center: { x: number; y: number; z: number },
  diameter: number,
  height: number,
  grow = 0,
): Wasm {
  const r0 = Math.max(0.8, diameter / 2) + grow / 2
  const rib = Math.max(0.22, Math.min(0.9, r0 * 0.2))
  const pitch = Math.max(1.2, diameter * 0.45)
  const z0 = center.z - height / 2
  const z1 = center.z + height / 2
  const na = 48
  const nz = Math.max(16, Math.min(96, Math.round(height / Math.max(0.15, pitch / 10))))
  const phase = (z: number, a: number) => {
    const f = (z / pitch + a / (Math.PI * 2)) % 1
    return 1 - Math.abs(2 * f - 1)
  }
  const radius = (z: number, a: number) => r0 + rib * phase(z, a)
  const verts: number[] = []
  const tris: number[] = []
  const index: number[][] = []
  for (let iz = 0; iz <= nz; iz++) {
    const row: number[] = []
    const z = z0 + (height * iz) / nz
    for (let ia = 0; ia < na; ia++) {
      const a = (ia / na) * Math.PI * 2
      const r = radius(z, a)
      row.push(verts.length / 3)
      verts.push(center.x + Math.cos(a) * r, center.y + Math.sin(a) * r, z)
    }
    index.push(row)
  }
  for (let iz = 0; iz < nz; iz++) {
    for (let ia = 0; ia < na; ia++) {
      const ia2 = (ia + 1) % na
      const a = index[iz][ia]
      const b = index[iz][ia2]
      const c = index[iz + 1][ia2]
      const d = index[iz + 1][ia]
      tris.push(a, b, c, a, c, d)
    }
  }
  const bottom = verts.length / 3
  verts.push(center.x, center.y, z0)
  const top = verts.length / 3
  verts.push(center.x, center.y, z1)
  for (let ia = 0; ia < na; ia++) {
    const ia2 = (ia + 1) % na
    tris.push(bottom, index[0][ia2], index[0][ia])
    tris.push(top, index[nz][ia], index[nz][ia2])
  }
  const mesh = new api.Mesh({
    numProp: 3,
    vertProperties: new Float32Array(verts),
    triVerts: new Uint32Array(tris),
  })
  const solid = api.Manifold.ofMesh(mesh)
  if (!isOk(solid)) {
    solid.delete?.()
    throw new Error('Gewinde konnte nicht gebaut werden.')
  }
  return solid
}

/** Umfang des Querschnitts auf Höhe z — Maß für die Nahtfläche. */
export function crossSectionPerimeter(mesh: Mesh, z: number): number {
  const p = mesh.positions
  let sum = 0
  for (let i = 0; i < p.length; i += 9) {
    const pts: number[] = []
    for (let e = 0; e < 3; e++) {
      const a = i + e * 3
      const b = i + ((e + 1) % 3) * 3
      const za = p[a + 2]
      const zb = p[b + 2]
      if ((za < z && zb >= z) || (zb < z && za >= z)) {
        const t = (z - za) / (zb - za)
        pts.push(p[a] + (p[b] - p[a]) * t, p[a + 1] + (p[b + 1] - p[a + 1]) * t)
      }
    }
    if (pts.length === 4) sum += Math.hypot(pts[2] - pts[0], pts[3] - pts[1])
  }
  return sum
}

/**
 * Sucht die Schnittlage mit dem kleinsten Querschnittsumfang.
 * Eine kleine Nahtfläche braucht weniger Stützen und hält besser.
 * Rückgabe in den Koordinaten der gewählten Achse.
 */
export function suggestSeam(mesh: Mesh, axis: Axis = 'z'): number {
  const work = axis === 'z' ? mesh : permuteMesh(mesh, (p) => toCutFrame(axis, p))
  const lo = work.bbox.min.z
  const hi = work.bbox.max.z
  const span = hi - lo
  if (!(span > 1)) return (lo + hi) / 2
  const steps = 48
  const middle = lo + span / 2
  const candidates: { z: number; perimeter: number }[] = []
  for (let i = 3; i <= steps - 3; i++) {
    const z = lo + (span * i) / steps
    const perimeter = crossSectionPerimeter(work, z)
    if (perimeter > 0) candidates.push({ z, perimeter })
  }
  if (!candidates.length) return axis === 'x' ? -middle : middle
  const smallest = Math.min(...candidates.map((c) => c.perimeter))
  // Gleichstand (z. B. Würfel): die Mitte vorziehen — dort bleiben beide Teile
  // gleich groß und die Naht liegt am unauffälligsten.
  const near = candidates.filter((c) => c.perimeter <= smallest * 1.02 + 1e-6)
  near.sort((a, b) => Math.abs(a.z - middle) - Math.abs(b.z - middle))
  const best = near[0].z
  return axis === 'x' ? -best : best
}

export type SplitSolidRequest = {
  axis?: Axis
  pieces?: number
  profile?: Profile
  connectorSize?: number
  count?: number
  /** Spalt zwischen den beiden Nahtflächen in mm. */
  clearance?: number
  /** Luft rund um Zapfen/Schiene in mm; 0,25 ist der Standard für leichtes Fügen. */
  connectorClearance?: number
  position?: number
  keep?: 'both' | 'low' | 'high'
  /** Zapfen: Anzahl pro Naht (0 = keine) */
  pinCount?: number
  /** Zapfen: Breite entlang der Naht (X) in mm */
  pinWidth?: number
  /** Zapfen: Länge in die Tiefe (Y) in mm */
  pinLength?: number
  /** Zapfen: Höhe über der Naht (Z) in mm */
  pinHeight?: number
  /** Schiene/Puzzle: Überstand über der Naht in mm */
  pinDepth?: number
  /** Konus: 0 = gerade, 0,1 = unten 10 % schmaler */
  pinTaper?: number
  /** Verbinderart: Zapfen, Schiene, Bajonett, Gewinde oder Hinterschnitt */
  pinType?: 'pin' | 'dovetail' | 'puzzle' | 'tongue' | 'bayonet' | 'thread' | 'undercut'
}

/**
 * Teilt ein platziertes Mesh in geschlossene Teile.
 *
 * Jedes Teil ist der Schnitt aus Bauteil und einem eigenen, geschlossenen
 * Körper zwischen zwei Nahtflächen. Dadurch hat jedes Teil eine vollständige
 * Nahtfläche — der Slicer findet keine offenen Konturen mehr.
 */
export async function splitSolid(mesh: Mesh, opts: SplitSolidRequest): Promise<Mesh[]> {
  const api = await loadManifold()
  const axis: Axis = opts.axis === 'x' || opts.axis === 'y' ? opts.axis : 'z'
  const work = axis === 'z' ? mesh : permuteMesh(mesh, (p) => toCutFrame(axis, p))
  const { min, max } = work.bbox
  const lo = min.z
  const hi = max.z
  const span = hi - lo
  if (!(span > 0.2)) return [mesh]

  const pieces = Math.max(2, Math.min(12, Math.round(opts.pieces ?? 2)))
  const profile: Profile = opts.profile ?? 'wave'
  const amp = Math.max(0.2, opts.connectorSize ?? 1.6)
  const count = Math.max(1, Math.min(12, Math.round(opts.count ?? 2)))
  const period = Math.max(0.01, max.x - min.x) / count
  const clearance = Math.max(-1, Math.min(2, opts.clearance ?? 0.05))
  const fit = Math.max(0, Math.min(1, opts.connectorClearance ?? 0.25))

  // Die Schnittlage kommt in Modellkoordinaten (so wie der Dialog sie zeigt).
  // Im Schnittrahmen ist die X-Achse gespiegelt — ohne Umrechnung läge der
  // Schnitt bei X-Schnitten an der falschen Stelle.
  const wanted = opts.position === undefined ? undefined : axis === 'x' ? -opts.position : opts.position
  const cuts: number[] = []
  for (let k = 1; k < pieces; k++) {
    cuts.push(
      pieces === 2 && wanted !== undefined
        ? Math.max(lo + 0.5, Math.min(hi - 0.5, wanted))
        : lo + (span * k) / pieces,
    )
  }

  const body = await toSolid(work)
  const solids: Wasm[] = []
  const parts: Mesh[] = []
  try {
    for (let k = 0; k < pieces; k++) {
      const lower: Boundary =
        k === 0 ? { flat: lo - 2 } : { z0: cuts[k - 1], amp, period, minX: min.x, shift: clearance / 2 }
      const upper: Boundary =
        k === pieces - 1 ? { flat: hi + 2 } : { z0: cuts[k], amp, period, minX: min.x, shift: -clearance / 2 }
      const blade = boundarySolid(api, min, max, profile, lower, upper)
      const piece = body.intersect(blade)
      blade.delete?.()
      if (!isOk(piece)) {
        piece.delete?.()
        throw new Error('CSG-Schnitt fehlgeschlagen.')
      }
      solids.push(piece)
    }

    // Verbinder: unten aufsetzen, oben die passende Nut aussparen. Zapfen
    // werden gesteckt, der Schwalbenschwanz wird seitlich eingeschoben und
    // hält danach gegen Abheben.
    const pinCount = Math.max(0, Math.min(8, Math.round(opts.pinCount ?? 0)))
    const dovetail = opts.pinType === 'dovetail'
    const puzzle = opts.pinType === 'puzzle'
    const tongue = opts.pinType === 'tongue'
    const bayonet = opts.pinType === 'bayonet'
    const thread = opts.pinType === 'thread'
    const undercut = opts.pinType === 'undercut'
    if (pinCount > 0 && solids.length > 1) {
      const width = Math.min(Math.max(1, opts.pinWidth ?? 6), (max.x - min.x) / (pinCount + 1))
      const length = Math.min(Math.max(1, opts.pinLength ?? 8), Math.max(2, (max.y - min.y) * 0.8))
      const height = Math.min(Math.max(1, opts.pinHeight ?? 4), Math.max(2, (span / pieces) * 0.8))
      const taper = Math.max(0, Math.min(0.35, opts.pinTaper ?? 0.06))
      const midY = (min.y + max.y) / 2
      const railWidth = Math.min(
        Math.max(3, opts.pinWidth ?? 12),
        Math.max(3, (max.y - min.y) / (pinCount + 1) - 1),
      )
      const railHeight = Math.min(Math.max(2, opts.pinHeight ?? 5), Math.max(2, (span / pieces) * 0.5))
      // Überstand: wie weit der Riegel über die Naht ins Gegenstück ragt.
      // Der Hals darunter ist halb so tief — so bleibt genug Fleisch am Teil.
      const depth = Math.min(Math.max(1, opts.pinDepth ?? railHeight * 0.5), Math.max(2, (span / pieces) * 0.9))
      for (let k = 0; k < cuts.length; k++) {
        for (let i = 0; i < pinCount; i++) {
          const y = min.y + ((max.y - min.y) * (i + 1)) / (pinCount + 1)
          let pin: Wasm
          let socket: Wasm
          if (thread) {
            const threadHeight = Math.max(3, Math.min(opts.pinHeight ?? 8, (span / pieces) * 0.9))
            pin = threadedPin(api, { x: min.x + ((max.x - min.x) * (i + 1)) / (pinCount + 1), y: midY, z: cuts[k] }, width, threadHeight)
            socket = threadedPin(
              api,
              { x: min.x + ((max.x - min.x) * (i + 1)) / (pinCount + 1), y: midY, z: cuts[k] },
              width,
              threadHeight + fit * 2,
              fit * 2,
            )
          } else if (tongue || bayonet || undercut) {
            // Nut/Feder ist eine gerade Schiene; Bajonett und Hinterschnitt
            // nutzen einen breiteren Kopf hinter einem schmalen Hals. Der Kopf
            // liegt über der Naht und hält gegen Abheben.
            const z0 = cuts[k] - depth * 0.5
            const z1 = cuts[k] + depth
            const flare = tongue ? 0.02 : bayonet ? 0.55 : 0.7
            pin = dovetailRail(api, min.x - 2, max.x + 2, y, z0, z1, railWidth, flare)
            socket = dovetailRail(
              api,
              min.x - 2,
              max.x + 2,
              y,
              z0 - fit,
              z1 + fit,
              railWidth + fit * 2,
              flare,
            )
          } else if (dovetail) {
            // Der Kopf liegt über der Naht, der Hals darunter — das untere Teil
            // bekommt die Schiene, das obere die Nut mit Passung.
            const z0 = cuts[k] - depth * 0.5
            const z1 = cuts[k] + depth
            pin = dovetailRail(api, min.x - 2, max.x + 2, y, z0, z1, railWidth, 0.4)
            socket = dovetailRail(
              api,
              min.x - 2,
              max.x + 2,
              y,
              z0 - fit,
              z1 + fit,
              railWidth + fit * 2,
              0.4,
            )
          } else if (puzzle) {
            // T-Nut: schmaler Hals in der Naht, breiter gerundeter Kopf
            // darüber. Von der Seite einschieben, danach gegen Abheben gesichert.
            const z0 = cuts[k] - depth * 0.5
            const z1 = cuts[k] + depth
            pin = puzzleRail(api, min.x - 2, max.x + 2, y, z0, z1, railWidth)
            socket = puzzleRail(
              api,
              min.x - 2,
              max.x + 2,
              y,
              z0 - fit,
              z1 + fit,
              railWidth + fit * 2,
            )
          } else {
            const x = min.x + ((max.x - min.x) * (i + 1)) / (pinCount + 1)
            const center = { x, y: midY, z: cuts[k] }
            pin = taperedPin(api, center, width, length, height, taper)
            socket = taperedPin(api, center, width + fit * 2, length + fit * 2, height + fit * 2, taper)
          }
          try {
            // Nur der Teil des Zapfens, der im Bauteil liegt — nichts steht über.
            const inside = pin.intersect(body)
            if (isOk(inside)) {
              const grown = solids[k].add(inside)
              solids[k].delete?.()
              solids[k] = grown
            }
            inside.delete?.()
            const pocket = socket.intersect(body)
            if (isOk(pocket)) {
              const cut = solids[k + 1].subtract(pocket)
              solids[k + 1].delete?.()
              solids[k + 1] = cut
            }
            pocket.delete?.()
            // Einführfase nur am gesteckten Zapfen: Die Nutöffnung an der Naht
            // wird um 0,8 mm aufgeweitet und läuft auf das Nennmaß zurück.
            // Schiene/Puzzle werden seitlich eingeschoben; dort ist der Eingang
            // bereits offen und braucht keine Schulter.
            if (!dovetail && !puzzle && !tongue && !bayonet && !undercut && !thread) {
              const chamfer = 0.8
              const pinX = min.x + ((max.x - min.x) * (i + 1)) / (pinCount + 1)
              const lead = taperedPin(
                api,
                { x: pinX, y: midY, z: cuts[k] + chamfer / 2 },
                width + fit * 2,
                length + fit * 2,
                chamfer,
                -(chamfer * 2) / Math.max(0.01, width + fit * 2),
              )
              const leadPocket = lead.intersect(body)
              if (isOk(leadPocket)) {
                const eased = solids[k + 1].subtract(leadPocket)
                solids[k + 1].delete?.()
                solids[k + 1] = eased
              }
              leadPocket.delete?.()
              lead.delete?.()
            }
          } finally {
            pin.delete?.()
            socket.delete?.()
          }
        }
      }
    }

    for (const solid of solids) {
      const converted = fromSolid(solid)
      if (converted.triangles > 0) parts.push(await unionOverlappingComponents(converted))
    }
  } finally {
    for (const solid of solids) solid.delete?.()
    body.delete?.()
  }

  if (parts.length < 2) return [mesh]
  let kept = parts
  if (pieces === 2 && opts.keep === 'low') kept = [parts[0]]
  else if (pieces === 2 && opts.keep === 'high') kept = [parts[parts.length - 1]]
  return axis === 'z' ? kept : kept.map((m) => permuteMesh(m, (p) => fromCutFrame(axis, p)))
}

/** Vereinigt mehrere Netze zu einem Körper — Überlappungen verschwinden. */
export async function unionMeshes(meshes: Mesh[]): Promise<Mesh | null> {
  const usable = meshes.filter((m) => m.triangles > 0)
  if (!usable.length) return null
  if (usable.length === 1) return usable[0]
  const solids = []
  for (const mesh of usable) solids.push(await toSolid(repairMesh(mesh)))
  try {
    let current = solids[0]
    for (let i = 1; i < solids.length; i++) {
      const next = current.add(solids[i])
      current = next
    }
    if (!isOk(current)) throw new Error('Vereinigung fehlgeschlagen.')
    return fromSolid(current)
  } finally {
    for (const solid of solids) solid.delete?.()
  }
}

/** Volumen in mm³ — nur für Prüfungen und Tests. */
export async function solidVolume(mesh: Mesh): Promise<number> {
  const solid = await toSolid(mesh)
  try {
    return solid.volume() as number
  } finally {
    solid.delete?.()
  }
}

export type HollowRequest = {
  /** Gewünschte Wandstärke im Druck in mm. */
  wall: number
  drainHoles: number
  drainDiameter: number
  /** Vereinfachung vor dem Aushöhlen in mm. */
  detail: number
}

export type HollowResult = {
  mesh: Mesh
  wall: number
  drainHoles: number
  drainDiameter: number
  detail: number
  /** Vereinfachtes Netz vor dem Aushöhlen. */
  simplifiedTriangles: number
  trianglesBefore: number
  trianglesAfter: number
  /** Hohlraum vorhanden (Wandstärke passt zum Modell). */
  cavity: boolean
  /** Mindestens ein Abflussloch hat den Hohlraum geöffnet. */
  opened: boolean
  /** Zahl der Löcher, die wirklich bis in den Hohlraum reichen. */
  openedHoles: number
  /** Materialersparnis gegenüber massiv in Prozent. */
  savingPercent: number
  /** Maßstab, mit dem die Druck-Wandstärke in lokale Einheiten umgerechnet wurde. */
  scale: number
  durationMs: number
}

const clampNumber = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, Number.isFinite(value) ? value : min))

/**
 * Höhlt ein geschlossenes Netz aus: Erosion mit einer Kugel ergibt den
 * Innenraum, die Differenz die Schale. Abflusslöcher werden als Zylinder von
 * der lokalen Unterseite abgezogen.
 *
 * Die Erosion ist bewusst kein Live-Vorgang: manifold rechnet je nach
 * Dreieckszahl Sekunden bis über eine Minute. Deshalb wird vorher auf die
 * gewählte Stufe vereinfacht und die Dauer im Ergebnis gemeldet.
 */
export async function hollowSolid(
  mesh: Mesh,
  request: HollowRequest,
  options: { scale?: number } = {},
): Promise<HollowResult> {
  const started = Date.now()
  const api = await loadManifold()
  // Die Wandstärke ist in Druck-Millimetern angegeben. Liegt das Objekt
  // skaliert auf dem Bett, muss die Erosion in lokalen Einheiten rechnen.
  const scale = clampNumber(options.scale ?? 1, 0.05, 10)
  const wall = clampNumber(request.wall, HOLLOW_WALL_MIN, HOLLOW_WALL_MAX)
  const diameter = clampNumber(request.drainDiameter, HOLLOW_DRAIN_MIN, HOLLOW_DRAIN_MAX)
  const holes = Math.round(clampNumber(request.drainHoles, 0, 6))
  const detail = clampNumber(request.detail, 0.05, 0.6)
  const localWall = wall / scale
  const localDiameter = diameter / scale

  if (mesh.triangles < 4) throw new Error('Das Netz enthält keine Flächen.')
  if (localWall <= 0.05) throw new Error('Wandstärke ist für dieses Modell zu dünn.')

  const body = await toSolid(mesh)
  const created = new Set<Wasm>()
  const track = (solid: Wasm) => {
    created.add(solid)
    return solid
  }
  try {
    track(body)
    const simplified = track(body.simplify(detail))
    if (!isOk(simplified)) throw new Error('Das Netz ließ sich nicht vereinfachen.')
    const simplifiedTriangles = simplified.numTri() as number
    if (simplifiedTriangles > 250_000) {
      throw new Error(
        `Das Netz ist auch nach der Vereinfachung mit ${Math.round(simplifiedTriangles / 1000)}.000 Dreiecken zu fein. Bitte die grobe Stufe wählen.`,
      )
    }

    const sphere = track(api.Manifold.sphere(localWall, 24))
    const inner = track(simplified.minkowskiDifference(sphere))
    const cavity = isOk(inner)
    if (!cavity) {
      throw new Error(
        `Bei ${wall.toFixed(1).replace('.', ',')} mm Wand bleibt kein Hohlraum — das Modell ist an seiner dünnsten Stelle zu schmal.`,
      )
    }

    let shell = track(simplified.subtract(inner))
    if (!isOk(shell)) throw new Error('Die Schale konnte nicht berechnet werden.')
    const solidSize = simplified.volume() as number

    const { min, max, size } = mesh.bbox
    const drains = drainOffsets(size, holes, localDiameter)
    let openedHoles = 0
    for (const drain of drains) {
      const height = Math.max(4, localWall * 4)
      const drill = api.Manifold.cylinder(height, localDiameter / 2, localDiameter / 2, 24, true).translate([
        (min.x + max.x) / 2 + drain.x,
        (min.y + max.y) / 2 + drain.y,
        min.z + height / 2 - 1.5,
      ])
      // Nur ein Loch, das den Innenraum erreicht, ist wirklich ein Abfluss.
      const reachesCavity = inner.intersect(drill)
      if (isOk(reachesCavity)) openedHoles++
      reachesCavity.delete?.()
      const next = shell.subtract(drill)
      drill.delete?.()
      if (isOk(next)) {
        shell = track(next)
      }
    }
    const afterHoles = shell.volume() as number
    const converted = fromSolid(shell)
    if (!converted.triangles) throw new Error('Das Aushöhlen ergab kein druckbares Netz.')

    return {
      mesh: converted,
      wall,
      drainHoles: drains.length,
      drainDiameter: diameter,
      detail,
      simplifiedTriangles,
      trianglesBefore: mesh.triangles,
      trianglesAfter: converted.triangles,
      cavity,
      opened: openedHoles > 0,
      openedHoles,
      savingPercent: solidSize > 0 ? Math.max(0, (1 - afterHoles / solidSize) * 100) : 0,
      scale,
      durationMs: Date.now() - started,
    }
  } finally {
    for (const solid of created) solid.delete?.()
  }
}
