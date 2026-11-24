import { inflateRawSync } from 'node:zlib'
import type { DeepPartial, FilamentProfile, FilamentSlot, PrintSettings, PrinterProfile, BuildPlate } from '../shared/types.ts'
import { filamentById } from '../shared/catalog.ts'
import { describeSettingsOverrides } from '../shared/types.ts'
import { easyShrinkToOrca, orcaShrinkToEasy } from '../shared/shrinkage.ts'
import { parseSTL, buildBinarySTL, makeMesh, type Mesh } from './slicer/stl.ts'
import { parseGLB } from './glb.ts'
import { composeObjects, defaultPlacement, type ModelObject } from './objects.ts'

// ---------- ZIP (3MF ist ein ZIP mit XML) ----------

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(buf: Buffer): number {
  let c = -1
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

export function readZip(buf: Buffer): Map<string, Buffer> {
  const entries = new Map<string, Buffer>()
  let eocd = -1
  for (let i = buf.length - 22; i >= 0 && i >= buf.length - 22 - 65535; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('Kein ZIP/3MF-Archiv erkannt.')

  const count = buf.readUInt16LE(eocd + 10)
  let off = buf.readUInt32LE(eocd + 16)
  for (let i = 0; i < count; i++) {
    if (off + 46 > buf.length || buf.readUInt32LE(off) !== 0x02014b50) break
    const method = buf.readUInt16LE(off + 10)
    const compSize = buf.readUInt32LE(off + 20)
    const nameLen = buf.readUInt16LE(off + 28)
    const extraLen = buf.readUInt16LE(off + 30)
    const commentLen = buf.readUInt16LE(off + 32)
    const localOff = buf.readUInt32LE(off + 42)
    const name = buf.toString('utf8', off + 46, off + 46 + nameLen)
    const lNameLen = buf.readUInt16LE(localOff + 26)
    const lExtraLen = buf.readUInt16LE(localOff + 28)
    const start = localOff + 30 + lNameLen + lExtraLen
    const raw = buf.subarray(start, start + compSize)
    try {
      entries.set(name, method === 0 ? Buffer.from(raw) : inflateRawSync(raw))
    } catch {
      throw new Error(`Eintrag "${name}" im Archiv ist beschädigt.`)
    }
    off += 46 + nameLen + extraLen + commentLen
  }
  return entries
}

export function writeZip(files: { name: string; data: Buffer }[]): Buffer {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0

  for (const file of files) {
    const name = Buffer.from(file.name, 'utf8')
    const crc = crc32(file.data)

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x0800, 6) // UTF-8-Namen
    local.writeUInt16LE(0, 8) // stored
    local.writeUInt16LE(0, 10)
    local.writeUInt16LE(0, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(file.data.length, 18)
    local.writeUInt32LE(file.data.length, 22)
    local.writeUInt16LE(name.length, 26)
    local.writeUInt16LE(0, 28)
    locals.push(local, name, file.data)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0x0800, 8)
    central.writeUInt16LE(0, 10)
    central.writeUInt16LE(0, 12)
    central.writeUInt16LE(0, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(file.data.length, 20)
    central.writeUInt32LE(file.data.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt16LE(0, 30)
    central.writeUInt16LE(0, 32)
    central.writeUInt16LE(0, 34)
    central.writeUInt16LE(0, 36)
    central.writeUInt32LE(0, 38)
    central.writeUInt32LE(offset, 42)
    centrals.push(central, name)

    offset += 30 + name.length + file.data.length
  }

  const centralBuf = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(0, 4)
  end.writeUInt16LE(0, 6)
  end.writeUInt16LE(files.length, 8)
  end.writeUInt16LE(files.length, 10)
  end.writeUInt32LE(centralBuf.length, 12)
  end.writeUInt32LE(offset, 16)
  end.writeUInt16LE(0, 20)

  return Buffer.concat([...locals, centralBuf, end])
}

// ---------- Mesh-Bausteine ----------

export function meshToBinarySTL(mesh: Mesh): Buffer {
  const tris: number[][] = []
  for (let i = 0; i < mesh.triangles; i++) {
    tris.push(Array.from(mesh.positions.subarray(i * 9, i * 9 + 9)))
  }
  return buildBinarySTL(tris)
}

// ---------- 3MF ----------

/** Attributmuster je Name — ein RegExp-Objekt pro Aufruf kostete beim
 *  Einlesen großer 3MF den größten Teil der Zeit. */
const ATTR_PATTERNS = new Map<string, RegExp>()

function attr(tag: string, name: string): string | null {
  // Wortgrenze: sonst würde `id` auch in `identify_id` oder `source_object_id`
  // treffen und die falsche Objekt-ID liefern.
  let pattern = ATTR_PATTERNS.get(name)
  if (!pattern) {
    // Ohne `g`-Flag ist `match` zustandslos — das Muster darf wiederverwendet werden.
    pattern = new RegExp(`(?:^|\\s)${name}\\s*=\\s*"([^"]*)"`)
    ATTR_PATTERNS.set(name, pattern)
  }
  const m = tag.match(pattern)
  return m ? m[1] : null
}

function applyTransform(v: number[], t: number[] | null): number[] {
  if (!t || t.length < 12) return v
  return [
    t[0] * v[0] + t[1] * v[1] + t[2] * v[2] + t[9],
    t[3] * v[0] + t[4] * v[1] + t[5] * v[2] + t[10],
    t[6] * v[0] + t[7] * v[1] + t[8] * v[2] + t[11],
  ]
}

type ObjectDef = {
  name: string
  verts: number[][]
  tris: number[][]
  /** Baugruppe: Verweise auf andere Objekte, optional mit eigener Transformation und eigener Modelldatei */
  components: { objectId: string; transform: number[] | null; path: string | null }[]
}

/**
 * Verkettet zwei 3MF-Transforms: erst `inner` (Komponente) anwenden,
 * danach `outer` (Elternobjekt bzw. Build-Item).
 */
function composeTransform(outer: number[] | null, inner: number[] | null): number[] | null {
  if (!outer) return inner
  if (!inner) return outer
  const mul = (row: number, col: number) =>
    inner[row * 3] * outer[col] + inner[row * 3 + 1] * outer[3 + col] + inner[row * 3 + 2] * outer[6 + col]
  return [
    mul(0, 0), mul(0, 1), mul(0, 2),
    mul(1, 0), mul(1, 1), mul(1, 2),
    mul(2, 0), mul(2, 1), mul(2, 2),
    inner[9] * outer[0] + inner[10] * outer[3] + inner[11] * outer[6] + outer[9],
    inner[9] * outer[1] + inner[10] * outer[4] + inner[11] * outer[7] + outer[10],
    inner[9] * outer[2] + inner[10] * outer[5] + inner[11] * outer[8] + outer[11],
  ]
}

/**
 * Liest die objektbezogenen Werte aus `Metadata/model_settings.config`.
 * Orca/Bambu schreiben dort dieselben Schlüssel wie in den Projekteinstellungen,
 * z. B. `sparse_infill_density="0%"` oder `wall_loops="1"`. Werte auf `<part>`
 * überschreiben den übergeordneten `<object>`-Block; bei mehreren Parts gilt der
 * letzte bekannte Wert.
 */
export function parse3MFObjectSettings(configXml: string): Map<string, DeepPartial<PrintSettings>> {
  const result = new Map<string, DeepPartial<PrintSettings>>()
  for (const object of configXml.matchAll(/<object\b([^>]*)>([\s\S]*?)<\/object>/g)) {
    const id = attr(object[1], 'id')
    if (!id) continue
    const raw: Record<string, unknown> = {}
    for (const metadata of object[2].matchAll(/<metadata\b([^>]*?)\/?>/g)) {
      const key = attr(metadata[1], 'key')
      const value = attr(metadata[1], 'value')
      if (!key || value === null || value === 'nil') continue
      raw[key] = value
    }
    const mapped = mapSlicerSettings(raw)
    if (Object.keys(mapped.patch).length) result.set(id, mapped.patch)
  }
  return result
}

/** Führt zwei Deep-Partial-Patches zusammen, ohne Werte des ersten zu verlieren. */
function mergePrintPatches(
  base: DeepPartial<PrintSettings> | undefined,
  extra: DeepPartial<PrintSettings> | undefined,
): DeepPartial<PrintSettings> | undefined {
  if (!base) return extra
  if (!extra) return base
  const out: Record<string, unknown> = { ...base }
  for (const [key, value] of Object.entries(extra)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      out[key] = { ...((base as Record<string, unknown>)[key] as Record<string, unknown> | undefined), ...value }
    } else if (value !== undefined) {
      out[key] = value
    }
  }
  return out as DeepPartial<PrintSettings>
}

/**
 * Zerlegt ein 3MF in Einzelobjekte. Baugruppen (<components>) werden rekursiv
 * aufgelöst: jedes referenzierte Mesh wird mit der verketteten Transformation
 * (Build-Item → Eltern → Komponente) in ein eigenes Objekt geschrieben.
 */
export function parse3MF(
  /** Entpacktes Archiv — so wird eine 3MF nur einmal entpackt. */
  zip: Map<string, Buffer>,
): {
  mesh: Mesh
  objects: ModelObject[]
  printerHint: string | null
  meta: string | null
  plates: number
} {
  const modelPaths = [...zip.keys()]
    .map((key) => key.replace(/\\/g, '/').replace(/^\/+/, ''))
    .filter((key) => /\.model$/i.test(key) && !/^metadata\//i.test(key))
  if (!modelPaths.length) throw new Error('3MF enthält keine 3D-Modell-Datei.')

  const normalizePath = (raw: string, fallback: string) => {
    const clean = raw.replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase()
    return (
      modelPaths.find((p) => p.toLowerCase() === clean) ??
      modelPaths.find((p) => p.toLowerCase().endsWith(clean)) ??
      fallback
    )
  }

  type ParsedItem = { path: string; objectId: string; transform: number[] | null; plate: number }
  const definitionsByPath = new Map<string, Map<string, ObjectDef>>()
  const items: ParsedItem[] = []
  let printerHint: string | null = null
  let meta: string | null = null

  for (const path of modelPaths) {
    const entry = [...zip.entries()].find(
      ([key]) => key.replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase() === path.toLowerCase(),
    )
    if (!entry) continue
    const xml = entry[1].toString('utf8')
    const definitions = new Map<string, ObjectDef>()
    const objectRe = /<object\b([^>]*)>([\s\S]*?)<\/object>/g
    let om: RegExpExecArray | null
    while ((om = objectRe.exec(xml))) {
      const id = attr(om[1], 'id')
      if (!id) continue
      const body = om[2]
      const verts: number[][] = []
      const vRe = /<vertex\b([^>]*)\/?>/g
      let vm: RegExpExecArray | null
      while ((vm = vRe.exec(body))) {
        verts.push([Number(attr(vm[1], 'x')), Number(attr(vm[1], 'y')), Number(attr(vm[1], 'z'))])
      }
      const tris: number[][] = []
      const tRe = /<triangle\b([^>]*)\/?>/g
      let tm: RegExpExecArray | null
      while ((tm = tRe.exec(body))) {
        tris.push([Number(attr(tm[1], 'v1')), Number(attr(tm[1], 'v2')), Number(attr(tm[1], 'v3'))])
      }
      const components: { objectId: string; transform: number[] | null; path: string | null }[] = []
      const cRe = /<component\b([^>]*)\/?>/g
      let cm: RegExpExecArray | null
      while ((cm = cRe.exec(body))) {
        const objectId = attr(cm[1], 'objectid')
        if (!objectId) continue
        const t = attr(cm[1], 'transform')
        // Orca/Bambu legen Bauteile oft in eigene Modelldateien aus und
        // referenzieren sie hier über p:path. Ohne den Pfad bleibt die
        // Baugruppe leer ("3MF enthält keine Dreiecke").
        components.push({
          objectId,
          transform: t ? t.trim().split(/\s+/).map(Number) : null,
          path: attr(cm[1], 'p:path'),
        })
      }
      definitions.set(id, { name: attr(om[1], 'name') ?? `Objekt ${id}`, verts, tris, components })
    }
    definitionsByPath.set(path, definitions)

    for (const item of xml.matchAll(/<item\b([^>]*)\/?>/g)) {
      const objectId = attr(item[1], 'objectid')
      if (!objectId) continue
      const linked = attr(item[1], 'p:path')
      const t = attr(item[1], 'transform')
      items.push({
        path: linked ? normalizePath(linked, path) : path,
        objectId,
        transform: t ? t.trim().split(/\s+/).map(Number) : null,
        plate: 0,
      })
    }

    if (!printerHint) {
      printerHint =
        xml.match(/<metadata\b[^>]*name="(?:PrinterModel|printer_model)"[^>]*>([^<]*)</)?.[1] ??
        xml.match(/<metadata\b[^>]*name="(?:ProfileTitle|printer_settings_id)"[^>]*>([^<]*)</)?.[1] ??
        null
    }
    if (!meta) {
      meta = xml.match(/<metadata\b[^>]*name="(?:Title|Application)"[^>]*>([^<]*)</)?.[1] ?? null
    }
  }

  // Plattenzuordnung aus Metadata/model_settings.config (Orca/Prusa).
  const plateInfo = (() => {
    const entry = [...zip.entries()].find(([key]) => /model_settings\.config$/i.test(key))
    const byInstance = new Map<string, number>()
    const byObject = new Map<string, number>()
    const names = new Map<string, string>()
    let count = 0
    if (!entry) return { plates: 1, byInstance, byObject, names, settings: new Map() }
    const config = entry[1].toString('utf8')
    const settings = parse3MFObjectSettings(config)
    for (const obj of config.matchAll(/<object\b[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/object>/g)) {
      const name = obj[2].match(/key="name"[^>]*value="([^"]*)"/)?.[1]
      if (name) names.set(obj[1], name)
    }
    let index = 0
    for (const match of config.matchAll(/<plate\b[^>]*>([\s\S]*?)<\/plate>/g)) {
      index++
      const body = match[1]
      const idValue = body.match(/key="plater_id"[^>]*value="([^"]*)"/)?.[1]
      const plateNo = Math.max(1, Number(idValue) || index)
      count = Math.max(count, plateNo)
      for (const inst of body.matchAll(/<model_instance\b[^>]*>([\s\S]*?)<\/model_instance>/g)) {
        const objectId = inst[1].match(/key="object_id"[^>]*value="([^"]*)"/)?.[1]
        const instanceId = inst[1].match(/key="instance_id"[^>]*value="([^"]*)"/)?.[1]
        if (!objectId) continue
        if (instanceId != null) byInstance.set(`${objectId}:${instanceId}`, plateNo - 1)
        byObject.set(objectId, plateNo - 1)
      }
    }
    return { plates: count, byInstance, byObject, names, settings }
  })()

  // Mehrfach instanziierte Objekte der Reihe nach den Platten zuordnen.
  const seenInstances = new Map<string, number>()
  for (const item of items) {
    const index = seenInstances.get(item.objectId) ?? 0
    seenInstances.set(item.objectId, index + 1)
    item.plate =
      plateInfo.byInstance.get(`${item.objectId}:${index}`) ?? plateInfo.byObject.get(item.objectId) ?? 0
  }

  const objects: ModelObject[] = []
  let currentPlate = 0

  function addMesh(
    def: ObjectDef,
    transform: number[] | null,
    label: string,
    settings?: DeepPartial<PrintSettings>,
  ) {
    // Direkt in die Positionsliste schreiben. Vorher lief jedes Objekt durch
    // ein binäres STL und wurde wieder geparst — bei vielen Teilen auf einer
    // Platte kostete das beim Laden spürbar Zeit.
    const capacity = def.tris.length * 9
    const positions = new Float32Array(capacity)
    const t = transform && transform.length >= 12 ? transform : null
    let used = 0
    const write = (v: number[]) => {
      if (t) {
        positions[used] = t[0] * v[0] + t[1] * v[1] + t[2] * v[2] + t[9]
        positions[used + 1] = t[3] * v[0] + t[4] * v[1] + t[5] * v[2] + t[10]
        positions[used + 2] = t[6] * v[0] + t[7] * v[1] + t[8] * v[2] + t[11]
      } else {
        positions[used] = v[0]
        positions[used + 1] = v[1]
        positions[used + 2] = v[2]
      }
      used += 3
    }
    for (const tri of def.tris) {
      const a = def.verts[tri[0]]
      const b = def.verts[tri[1]]
      const c = def.verts[tri[2]]
      if (!a || !b || !c) continue
      if (!Number.isFinite(a[0]) || !Number.isFinite(b[0]) || !Number.isFinite(c[0])) continue
      write(a)
      write(b)
      write(c)
    }
    if (!used) return
    // Übersprungene Dreiecke hinterlassen Platz am Ende. Dann genau kopieren,
    // damit nicht der ganze Reserve-Puffer am Mesh hängt.
    objects.push({
      id: `${currentPlate}-${objects.length}`,
      name: label,
      mesh: makeMesh(used === capacity ? positions : positions.slice(0, used), false),
      placement: defaultPlacement(),
      plate: currentPlate,
      ...(settings && Object.keys(settings).length ? { settings } : {}),
    })
  }

  /** Löst eine Objektdefinition rekursiv auf; `seen` verhindert Ringschlüsse
   *  auch dann, wenn verschiedene Modelldateien dieselbe Objekt-ID verwenden. */
  function resolve(
    defs: Map<string, ObjectDef>,
    id: string,
    transform: number[] | null,
    labels: string[],
    depth: number,
    seen: Set<string>,
    currentPath: string,
    inheritedSettings?: DeepPartial<PrintSettings>,
  ) {
    const key = `${currentPath}:${id}`
    const def = defs.get(id)
    if (!def || depth > 16 || seen.has(key)) return
    const settings = mergePrintPatches(inheritedSettings, plateInfo.settings.get(id))
    const displayName = labels.length === 0 ? (plateInfo.names.get(id) ?? def.name) : def.name
    const chain = labels.length === 0
      ? [displayName]
      : labels[labels.length - 1] === displayName
        ? labels
        : [...labels, displayName]
    if (def.tris.length) {
      addMesh(def, transform, chain.join(' · '), settings)
      return
    }
    if (!def.components.length) return
    const nextSeen = new Set(seen)
    nextSeen.add(key)
    for (const child of def.components) {
      const childPath = child.path ? normalizePath(child.path, currentPath) : currentPath
      const childDefs = definitionsByPath.get(childPath) ?? defs
      resolve(
        childDefs,
        child.objectId,
        composeTransform(transform, child.transform),
        chain,
        depth + 1,
        nextSeen,
        childPath,
        settings,
      )
    }
  }

  if (items.length === 0) {
    // Ohne Build: Wurzeln je Datei nehmen, sonst landen Komponenten doppelt in der Liste
    for (const [path, defs] of definitionsByPath) {
      const referenced = new Set<string>()
      for (const def of defs.values()) for (const c of def.components) referenced.add(c.objectId)
      const roots = [...defs.keys()].filter((id) => !referenced.has(id))
      currentPlate = 0
      for (const id of roots.length ? roots : [...defs.keys()]) resolve(defs, id, null, [path], 0, new Set(), path)
    }
  } else {
    for (const item of items) {
      const defs = definitionsByPath.get(item.path)
      if (!defs || !defs.has(item.objectId)) continue
      currentPlate = item.plate
      resolve(defs, item.objectId, item.transform, [], 0, new Set(), item.path)
    }
  }

  if (!objects.length) throw new Error('3MF enthält keine Dreiecke.')

  let plates = Math.max(1, plateInfo.plates)
  for (const object of objects) plates = Math.max(plates, (object.plate ?? 0) + 1)

  // Alle Platten bleiben erhalten. Die Oberfläche legt sie nebeneinander
  // (layoutPlates in server/index.ts) und slict die gewählte Platte.
  const merged = composeObjects(objects)
  if (!merged) throw new Error('3MF enthält keine Dreiecke.')
  return { mesh: merged, objects, printerHint, meta, plates }
}

export function build3MF(
  mesh: Mesh,
  settings: PrintSettings,
  profile: PrinterProfile,
  filament: FilamentProfile,
  plate: BuildPlate,
  slots: FilamentSlot[] = [],
  objectAssignments: { name: string; filamentId?: string; slotId?: string }[] = [],
): Buffer {
  const slotFilaments = slots.length > 0 ? slots.map((slot) => filamentById(slot.profileId)) : [filament]
  const slotCount = Math.max(1, slotFilaments.length)
  const repeat = <T,>(value: T) => Array.from({ length: slotCount }, () => value)
  const colors = slots.length > 0 ? slots.map((slot) => slot.color ?? '#ffffff') : ['#ffffff']
  const verts: string[] = []
  const tris: string[] = []
  const seen = new Map<string, number>()
  let next = 0

  for (let i = 0; i < mesh.triangles; i++) {
    const ids: number[] = []
    for (let v = 0; v < 3; v++) {
      const o = i * 9 + v * 3
      const key = `${mesh.positions[o].toFixed(4)}|${mesh.positions[o + 1].toFixed(4)}|${mesh.positions[o + 2].toFixed(4)}`
      let id = seen.get(key)
      if (id === undefined) {
        id = next++
        seen.set(key, id)
        verts.push(
          `<vertex x="${mesh.positions[o].toFixed(4)}" y="${mesh.positions[o + 1].toFixed(4)}" z="${mesh.positions[o + 2].toFixed(4)}"/>`,
        )
      }
      ids.push(id)
    }
    tris.push(`<triangle v1="${ids[0]}" v2="${ids[1]}" v3="${ids[2]}"/>`)
  }

  const model = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="de-DE" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
 <metadata name="Application">Easy-Slicer by Becker</metadata>
 <metadata name="Title">${escapeXml(profile.name)}</metadata>
 <metadata name="printer_model">${escapeXml(profile.name)}</metadata>
 <resources>
  <object id="1" type="model">
   <mesh>
    <vertices>${verts.join('')}</vertices>
    <triangles>${tris.join('')}</triangles>
   </mesh>
  </object>
 </resources>
 <build><item objectid="1"/></build>
</model>`

  const config = JSON.stringify(
    {
      printer_model: profile.name,
      printer_settings_id: profile.name,
      nozzle_diameter: repeat(settings.nozzle),
      filament_settings_id: slotFilaments.map((f) => f.name),
      filament_type: slotFilaments.map((f) => f.material),
      filament_colour: colors,
      layer_height: settings.layerHeight,
      initial_layer_print_height: settings.firstLayerHeight,
      line_width: settings.lineWidth,
      first_layer_line_width: settings.firstLayerLineWidth,
      outer_wall_line_width: settings.outerWallLineWidth,
      inner_wall_line_width: settings.innerWallLineWidth,
      top_surface_line_width: settings.topSurfaceLineWidth,
      seam_position: settings.seam.position,
      seam_gap: settings.seam.gap,
      wipe: settings.seam.wipe,
      wall_loops: settings.walls,
      top_shell_layers: settings.topLayers,
      bottom_shell_layers: settings.bottomLayers,
      sparse_infill_density: `${settings.infillDensity}%`,
      sparse_infill_pattern: settings.infillPattern,
      sparse_infill_angle: settings.infillAngle ?? 45,
      filament_diameter: repeat(settings.filamentDiameter),
      filament_flow_ratio: repeat(settings.flow),
      nozzle_temperature: repeat(settings.temps.nozzle),
      bed_temperature: repeat(settings.temps.bed),
      outer_wall_speed: settings.speeds.outerWall,
      inner_wall_speed: settings.speeds.innerWall ?? settings.speeds.print,
      sparse_infill_speed: settings.speeds.infill ?? settings.speeds.print,
      internal_solid_infill_speed: settings.speeds.solid ?? settings.speeds.print,
      top_surface_speed: settings.speeds.topSurface,
      bridge_speed: settings.speeds.bridge,
      support_speed: settings.speeds.support ?? settings.speeds.print,
      support_interface_speed: settings.speeds.supportInterface,
      overhang_speed: settings.speeds.overhang ?? settings.speeds.outerWall,
      travel_speed: settings.speeds.travel,
      initial_layer_speed: settings.speeds.firstLayer,
      outer_wall_acceleration: settings.accelerations?.outerWall,
      inner_wall_acceleration: settings.accelerations?.innerWall,
      sparse_infill_acceleration: settings.accelerations?.infill,
      internal_solid_infill_acceleration: settings.accelerations?.solid,
      top_surface_acceleration: settings.accelerations?.topSurface,
      bridge_acceleration: settings.accelerations?.bridge,
      support_interface_acceleration: settings.accelerations?.supportInterface,
      travel_acceleration: settings.accelerations?.travel,
      retraction_length: [settings.retraction.distance],
      retraction_speed: [settings.retraction.speed],
      fan_max_speed: [settings.fanSpeed],
      enable_ironing: settings.ironing.enabled,
      ironing_flow: `${settings.ironing.flow * 100}%`,
      ironing_type: settings.ironing.type === 'solid' ? 'solid' : 'top',
      ironing_angle: settings.ironing.angle,
      ironing_spacing: settings.ironing.spacing,
      ironing_inset: settings.ironing.inset,
      ironing_pattern: settings.ironing.pattern,
      top_surface_flow: settings.topSurfaceFlow,
      bottom_surface_flow: settings.bottomSurfaceFlow,
      bridge_flow: settings.bridgeFlow,
      infill_overlap: `${settings.infillOverlap}%`,
      alternate_extra_wall: settings.alternateExtraWall,
      brim_type: settings.adhesion === 'brim' ? 'outer_only' : settings.adhesion === 'skirt' ? 'no_brim' : 'no_brim',
      max_volumetric_speed: settings.maxVolumetricFlow,
      enable_support: settings.support.kind !== 'none',
      support_type: settings.support.kind === 'tree' ? 'tree(auto)' : 'normal(auto)',
      support_threshold_angle: settings.support.threshold,
      support_density: `${settings.support.density}%`,
      support_base_pattern:
        settings.support.pattern === 'lines' ? 'rectilinear' : settings.support.pattern === 'zigzag' ? 'zig-zag' : 'grid',
      support_interface_pattern:
        settings.support.interfacePattern === 'lines'
          ? 'rectilinear'
          : settings.support.interfacePattern === 'zigzag'
            ? 'zig-zag'
            : 'grid',
      support_interface_top_layers: settings.support.interfaceLayers,
      support_top_z_distance: settings.support.zDistance,
      support_object_xy_distance: settings.support.xyDistance,
      tree_support_branch_angle: settings.support.branchAngle,
      close_fan_the_first_x_layers: settings.cooling.fanOffLayers,
      slow_down_layer_time: settings.cooling.minLayerTime,
      // Orca/Bambu: 100 % ist neutral und 99 % bedeutet Maß × 0,99.
      // Easy Slicer speichert die prozentuale Vergrößerung (0 = neutral).
      filament_shrink: repeat(easyShrinkToOrca(settings.shrinkage?.x ?? 0)),
      filament_shrinkage_compensation_z: repeat(easyShrinkToOrca(settings.shrinkage?.z ?? 0)),
      bed_custom_texture: plate.material,
      kepler: {
        meshCompensation: settings.meshCompensation,
        adaptiveMesh: settings.adaptiveMesh,
        autoZ: settings.autoZ,
        zHop: settings.zHop,
        lineWidth: settings.lineWidth,
        seam: settings.seam,
        kinematics: profile.kinematics ?? 'cartesian',
        plate: plate.id,
        filament: filament.id,
        printer: profile.id,
        slots,
        objectAssignments,
        // Eigene Werte exakt und vollständig — der Rückimport liest sie zuerst
        easy: {
          format: 1,
          support: settings.support,
          cooling: settings.cooling,
          shrinkage: settings.shrinkage,
          retraction: { onLayerChange: settings.retraction.onLayerChange !== false },
          slots,
          objectAssignments,
        },
      },
    },
    null,
    2,
  )

  const contentTypes = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
<Default Extension="config" ContentType="text/xml"/>
</Types>`

  const rels = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>
</Relationships>`

  return writeZip([
    { name: '[Content_Types].xml', data: Buffer.from(contentTypes) },
    { name: '_rels/.rels', data: Buffer.from(rels) },
    { name: '3D/3dmodel.model', data: Buffer.from(model) },
    { name: 'Metadata/project_settings.config', data: Buffer.from(config) },
  ])
}

function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// ---------- OBJ ----------

export function parseOBJ(text: string): Mesh {
  const verts: number[][] = []
  /** Flache Dreiecksliste (9 Zahlen je Dreieck) — daraus entsteht das Mesh. */
  const positions: number[] = []

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (line.startsWith('v ')) {
      const p = line.split(/\s+/)
      verts.push([parseFloat(p[1]), parseFloat(p[2]), parseFloat(p[3])])
    } else if (line.startsWith('f ')) {
      const refs = line.split(/\s+/).slice(1).map((token) => {
        const idx = parseInt(token.split('/')[0], 10)
        return idx < 0 ? verts.length + idx : idx - 1
      })
      for (let i = 1; i + 1 < refs.length; i++) {
        const a = verts[refs[0]], b = verts[refs[i]], c = verts[refs[i + 1]]
        if (a && b && c) positions.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2])
      }
    }
  }

  if (!positions.length) throw new Error('OBJ enthält keine Flächen (f).')
  return makeMesh(new Float32Array(positions), false)
}

// ---------- PLY ----------

export function parsePLY(buf: Buffer): Mesh {
  const headerEnd = buf.indexOf('end_header')
  if (headerEnd < 0) throw new Error('PLY-Kopfzeile fehlt.')
  const bodyStart = buf.indexOf('\n', headerEnd) + 1
  const header = buf.subarray(0, headerEnd).toString('utf8')

  const format = /format\s+(\S+)/.exec(header)?.[1] ?? 'ascii'
  const vertexSection = /element\s+vertex\s+(\d+)/.exec(header)
  const faceSection = /element\s+face\s+(\d+)/.exec(header)
  if (!vertexSection) throw new Error('PLY enthält keine Punkte.')
  const vertexCount = parseInt(vertexSection[1], 10)
  const faceCount = faceSection ? parseInt(faceSection[1], 10) : 0

  const verts: number[][] = []
  /** Flache Dreiecksliste (9 Zahlen je Dreieck) — daraus entsteht das Mesh. */
  const positions: number[] = []

  if (format === 'ascii') {
    const lines = buf.subarray(bodyStart).toString('utf8').split(/\r?\n/)
    for (let i = 0; i < vertexCount; i++) {
      const p = (lines[i] ?? '').trim().split(/\s+/).map(Number)
      verts.push([p[0], p[1], p[2]])
    }
    for (let i = 0; i < faceCount; i++) {
      const p = (lines[vertexCount + i] ?? '').trim().split(/\s+/).map(Number)
      const n = p[0]
      for (let k = 1; k + 1 <= n; k++) {
        const a = verts[p[k]], b = verts[p[k + 1]], c = verts[p[k + 2]]
        if (a && b && c) positions.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2])
      }
    }
  } else if (format === 'binary_little_endian') {
    // Eigenschaften in Kopfzeilenreihenfolge (nur float x/y/z + face list)
    const props = [...header.matchAll(/property\s+(\S+)\s+(\S+)(?:\s+(\S+))?/g)]
    const vertexProps: { type: string; name: string }[] = []
    let inVertex = false
    let inFace = false
    for (const raw of header.split(/\r?\n/)) {
      const line = raw.trim()
      if (line.startsWith('element vertex')) {
        inVertex = true
        inFace = false
        continue
      }
      if (line.startsWith('element face')) {
        inVertex = false
        inFace = true
        continue
      }
      if (line.startsWith('element')) {
        inVertex = false
        inFace = false
        continue
      }
      if (inVertex && line.startsWith('property ')) {
        const [, type, name] = line.split(/\s+/)
        vertexProps.push({ type, name })
      }
    }
    void props
    const sizes: Record<string, number> = {
      float: 4, float32: 4, double: 8, float64: 8,
      uchar: 1, uint8: 1,
    }
    let off = bodyStart
    for (let i = 0; i < vertexCount; i++) {
      const rec: Record<string, number> = {}
      for (const p of vertexProps) {
        const size = sizes[p.type] ?? 4
        rec[p.name] = p.type.startsWith('double') ? buf.readDoubleLE(off) : size === 1 ? buf.readUInt8(off) : buf.readFloatLE(off)
        off += size
      }
      verts.push([rec.x, rec.y, rec.z])
    }
    for (let f = 0; f < faceCount; f++) {
      const n = buf.readUInt8(off)
      off += 1
      const idx: number[] = []
      for (let k = 0; k < n; k++) {
        idx.push(buf.readUInt32LE(off))
        off += 4
      }
      for (let k = 1; k + 1 < idx.length; k++) {
        const a = verts[idx[0]], b = verts[idx[k]], c = verts[idx[k + 1]]
        if (a && b && c) positions.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2])
      }
    }
  } else {
    throw new Error(`PLY-Variante "${format}" wird nicht unterstützt.`)
  }

  if (!positions.length) throw new Error('PLY enthält keine Flächen.')
  return makeMesh(new Float32Array(positions), false)
}

// ---------- Einstellungen aus 3MF lesen ----------

const singleObject = (mesh: Mesh, name: string): ModelObject[] => [
  { id: 'obj-1', name, mesh, placement: defaultPlacement() },
]

const percent = (v: unknown): number | null => {
  if (Array.isArray(v) && v.length) return percent(v[0])
  if (typeof v === 'number') return v
  if (typeof v === 'string') {
    const n = parseFloat(v.replace('%', ''))
    return Number.isFinite(n) ? n : null
  }
  return null
}

const firstArray = (v: unknown): number | null => {
  if (Array.isArray(v) && v.length) return Number(v[0])
  if (typeof v === 'number') return v
  return null
}

function mapPattern(v: unknown): PrintSettings['infillPattern'] | null {
  const s = String(v ?? '').toLowerCase()
  if (s.includes('gyroid')) return 'gyroid'
  if (s.includes('honeycomb') || s.includes('wabe')) return 'honeycomb'
  if (s.includes('cubic') || s.includes('würfel') || s.includes('wurfel')) return 'cubic'
  if (s.includes('octet') || s.includes('acht')) return 'octet'
  if (s.includes('cross')) return 'crosshatch'
  if (s.includes('tri')) return 'triangles'
  if (s.includes('line') || s.includes('rectilinear')) return 'lines'
  if (s.includes('grid')) return 'grid'
  if (s.includes('concentric')) return 'concentric'
  if (s.includes('zigzag')) return 'zigzag'
  return null
}

export function mapSlicerSettings(raw: Record<string, unknown>): {
  patch: DeepPartial<PrintSettings>
  warnings: string[]
  printerName: string | null
  filamentName: string | null
} {
  const patch: DeepPartial<PrintSettings> = {}
  const warnings: string[] = []

  const num = (key: string): number | null => {
    const v = raw[key]
    if (v === undefined) return null
    const direct = firstArray(v)
    if (direct !== null && Number.isFinite(direct)) return direct
    if (typeof v === 'number') return Number.isFinite(v) ? v : null
    // Bambu schreibt Mehrfachdüsen-Werte wie "nil,250,nil,250". Der erste
    // echte Wert gilt für die aktive Düse; "nil" erbt vom Profil.
    for (const part of String(v).split(',')) {
      const clean = part.trim().replace('%', '')
      if (!clean || clean.toLowerCase() === 'nil') continue
      const n = parseFloat(clean)
      if (Number.isFinite(n)) return n
    }
    return null
  }

  const bool = (key: string): boolean | null => {
    const v = raw[key]
    if (v === undefined || v === null) return null
    if (typeof v === 'boolean') return v
    const s = String(v).toLowerCase()
    if (['1', 'true', 'yes', 'on'].includes(s)) return true
    if (['0', 'false', 'no', 'off'].includes(s)) return false
    return null
  }

  // Eigene Werte liegen direkt oder im Kepler-Block (so schreibt der Export sie)
  const easyRaw = raw['easy'] ?? (raw['kepler'] as Record<string, unknown> | undefined)?.easy
  const easy = easyRaw && typeof easyRaw === 'object' ? (easyRaw as Record<string, any>) : {}

  const layer = num('layer_height')
  if (layer) patch.layerHeight = layer
  const firstLayer = num('initial_layer_print_height') ?? num('first_layer_height')
  if (firstLayer) patch.firstLayerHeight = firstLayer

  const walls = num('wall_loops') ?? num('perimeters')
  if (walls !== null) patch.walls = Math.round(walls)
  const top = num('top_shell_layers') ?? num('top_solid_layers')
  if (top !== null) patch.topLayers = Math.round(top)
  const bottom = num('bottom_shell_layers') ?? num('bottom_solid_layers')
  if (bottom !== null) patch.bottomLayers = Math.round(bottom)

  const density = percent(raw['sparse_infill_density'] ?? raw['fill_density'])
  if (density !== null) patch.infillDensity = density
  const pattern = mapPattern(raw['sparse_infill_pattern'] ?? raw['fill_pattern'])
  if (pattern) patch.infillPattern = pattern

  const nozzle = num('nozzle_diameter')
  if (nozzle) patch.nozzle = nozzle
  const filamentDia = num('filament_diameter')
  if (filamentDia) patch.filamentDiameter = filamentDia
  const flow = num('filament_flow_ratio') ?? num('extrusion_multiplier')
  if (flow) patch.flow = flow

  const lineWidth = num('line_width')
  if (lineWidth) patch.lineWidth = lineWidth
  const firstLineWidth = num('first_layer_line_width')
  if (firstLineWidth) patch.firstLayerLineWidth = firstLineWidth
  const outerLineWidth = num('outer_wall_line_width')
  if (outerLineWidth) patch.outerWallLineWidth = outerLineWidth
  const innerLineWidth = num('inner_wall_line_width')
  if (innerLineWidth) patch.innerWallLineWidth = innerLineWidth
  const topLineWidth = num('top_surface_line_width')
  if (topLineWidth) patch.topSurfaceLineWidth = topLineWidth

  const nozzleTemp = num('nozzle_temperature') ?? num('temperature')
  const bedTemp = num('bed_temperature') ?? num('hot_plate_temp')
  const firstNozzleTemp = num('nozzle_temperature_initial_layer') ?? num('first_layer_temperature')
  const firstBedTemp = num('bed_temperature_initial_layer') ?? num('first_layer_bed_temperature')
  if (nozzleTemp || bedTemp || firstNozzleTemp || firstBedTemp) {
    patch.temps = {
      ...(nozzleTemp ? { nozzle: nozzleTemp } : {}),
      ...(bedTemp ? { bed: bedTemp } : {}),
      ...(firstNozzleTemp ? { firstLayerNozzle: firstNozzleTemp } : (nozzleTemp ? { firstLayerNozzle: nozzleTemp } : {})),
      ...(firstBedTemp ? { firstLayerBed: firstBedTemp } : (bedTemp ? { firstLayerBed: bedTemp } : {})),
    }
  }

  const outer = num('outer_wall_speed') ?? num('perimeter_speed')
  const inner = num('inner_wall_speed') ?? num('infill_speed')
  const travel = num('travel_speed')
  const first = num('initial_layer_speed') ?? num('first_layer_speed')
  if (outer || inner || travel || first) {
    patch.speeds = {
      ...(inner ? { print: inner } : {}),
      ...(outer ? { outerWall: outer } : {}),
      ...(travel ? { travel } : {}),
      ...(first ? { firstLayer: first } : {}),
    }
  }

  const retract = num('retraction_length') ?? num('retract_length')
  const retractSpeed = num('retraction_speed') ?? num('retract_speed')
  if (retract !== null || retractSpeed) {
    patch.retraction = {
      ...(retract !== null ? { distance: retract } : {}),
      ...(retractSpeed ? { speed: retractSpeed } : {}),
    }
  }

  // Stützstrukturen: Orca/Bambu-Schlüssel, eigene Werte haben Vorrang
  const supportOn = bool('enable_support')
  const supportType = String(raw['support_type'] ?? '').toLowerCase()
  let supportKind: PrintSettings['support']['kind'] | null = null
  if (supportOn === false) supportKind = 'none'
  else if (supportType.includes('tree')) supportKind = 'tree'
  else if (supportOn === true) supportKind = 'normal'
  const easyKind = String(easy.support?.kind ?? '')
  if (easyKind === 'none' || easyKind === 'normal' || easyKind === 'tree') supportKind = easyKind
  const threshold = num('support_threshold_angle')
  const supportDensity = percent(raw['support_density'])
  const ifaceLayers = num('support_interface_top_layers') ?? num('support_interface_layers')
  const ifaceDensity = percent(easy.support?.interfaceDensity)
  const zDistance = num('support_top_z_distance') ?? num('support_z_distance')
  const xyDistance = num('support_object_xy_distance')
  const branchAngle = num('tree_support_branch_angle')
  const patternRaw = String(raw['support_base_pattern'] ?? '').toLowerCase()
  const supportPattern: PrintSettings['support']['pattern'] | null = patternRaw.includes('zig')
    ? 'zigzag'
    : patternRaw.includes('line') || patternRaw.includes('rectilinear')
      ? 'lines'
      : patternRaw.includes('grid')
        ? 'grid'
        : null
  if (
    supportKind ||
    threshold !== null ||
    supportDensity !== null ||
    ifaceLayers !== null ||
    ifaceDensity !== null ||
    zDistance !== null ||
    xyDistance !== null ||
    branchAngle !== null ||
    supportPattern
  ) {
    patch.support = {
      ...(supportKind ? { kind: supportKind } : {}),
      ...(threshold !== null ? { threshold } : {}),
      ...(supportDensity !== null ? { density: supportDensity } : {}),
      ...(supportPattern ? { pattern: supportPattern } : {}),
      ...(ifaceLayers !== null ? { interfaceLayers: Math.round(ifaceLayers) } : {}),
      ...(ifaceDensity !== null ? { interfaceDensity: ifaceDensity } : {}),
      ...(zDistance !== null ? { zDistance } : {}),
      ...(xyDistance !== null ? { xyDistance } : {}),
      ...(branchAngle !== null ? { branchAngle } : {}),
    }
  }

  const spiral = bool('spiral_mode') ?? bool('vase_mode')
  if (spiral !== null) {
    patch.special = { ...(patch.special ?? {}), vase: spiral }
  }

  // Schrumpfkompensation (eigene Werte zuerst, sonst Orca-Filamentwert)
  const easyShrink = easy.shrinkage as { x?: number; y?: number; z?: number } | undefined
  const shrinkXY = percent(raw['filament_shrink'])
  if (easyShrink && Number.isFinite(Number(easyShrink.x))) {
    patch.shrinkage = { x: Number(easyShrink.x) || 0, y: Number(easyShrink.y) || 0, z: Number(easyShrink.z) || 0 }
  } else {
    // Orca/Bambu schreibt 100 % für „keine Kompensation“ und 99 % für ein
    // auf 99 % geschrumpftes Maß. Die Umrechnung ist proportional:
    // Orca 99 % → Easy 1,010101 %. 0/ungültig bleibt 0 (alte Easy-Exporte).
    const xy = orcaShrinkToEasy(shrinkXY)
    const z = orcaShrinkToEasy(percent(raw['filament_shrinkage_compensation_z']))
    if (xy !== null || z !== null) {
      patch.shrinkage = { x: xy ?? 0, y: xy ?? 0, z: z ?? 0 }
    }
  }

  // Kühlung
  const fanOff = num('close_fan_the_first_x_layers') ?? num('fan_off_layers')
  const slowDown = num('slow_down_layer_time') ?? num('min_layer_time')
  if (fanOff !== null || slowDown !== null) {
    patch.cooling = {
      ...(fanOff !== null ? { fanOffLayers: Math.round(fanOff) } : {}),
      ...(slowDown !== null ? { minLayerTime: slowDown } : {}),
    }
  }

  // Retract bei Schichtwechsel — eigener Schlüssel
  if (easy.retraction && easy.retraction.onLayerChange !== undefined) {
    patch.retraction = { ...(patch.retraction ?? {}), onLayerChange: !!easy.retraction.onLayerChange }
  }

  const fan = num('fan_max_speed') ?? num('max_fan_speed')
  if (fan !== null) patch.fanSpeed = fan
  const maxFlow = num('max_volumetric_speed') ?? num('filament_max_volumetric_speed')
  if (maxFlow) patch.maxVolumetricFlow = maxFlow

  if (raw['enable_ironing'] !== undefined) {
    const on = raw['enable_ironing'] === true || String(raw['enable_ironing']).toLowerCase() === 'true'
    patch.ironing = {
      enabled: on,
      ...(num('ironing_flow') !== null ? { flow: (percent(raw['ironing_flow']) ?? 12) / 100 } : {}),
      ...(num('ironing_spacing') !== null ? { spacing: percent(raw['ironing_spacing']) as number } : {}),
    }
  }

  const brim = String(raw['brim_type'] ?? '')
  if (brim) patch.adhesion = brim.includes('brim') && brim !== 'no_brim' ? 'brim' : 'skirt'

  if (raw['printer_model'] && !raw['nozzle_diameter']) warnings.push('3MF nennt einen Drucker, aber keine Düsengröße.')
  if (Object.keys(patch).length === 0) warnings.push('Im 3MF waren keine bekannten Slicer-Einstellungen.')

  return {
    patch,
    warnings,
    printerName: (raw['printer_model'] as string) ?? (raw['printer_settings_id'] as string) ?? null,
    filamentName: Array.isArray(raw['filament_settings_id'])
      ? String(raw['filament_settings_id'][0] ?? '')
      : ((raw['filament_settings_id'] as string) ?? (raw['filament_type'] as string) ?? null),
  }
}

/** 3MF: Bambu/Orca (project_settings.config, JSON) und PrusaSlicer (INI) lesen. */
export function read3MFSettings(zip: Map<string, Buffer>): {
  patch: DeepPartial<PrintSettings>
  warnings: string[]
  printerName: string | null
  filamentName: string | null
  source: string | null
} {
  const empty = { patch: {}, warnings: [], printerName: null, filamentName: null, source: null }

  for (const [name, data] of zip) {
    if (!/\.config$/i.test(name)) continue
    const text = data.toString('utf8')

    if (/Metadata\/(project_settings|SlicerConfig)\b/i.test(name) || text.trimStart().startsWith('{')) {
      try {
        const raw = JSON.parse(text) as Record<string, unknown>
        const mapped = mapSlicerSettings(raw)
        return { ...mapped, source: name }
      } catch {
        /* kein JSON — unten weiter versuchen */
      }
    }

    if (/prusaslicer|SlicerConfig/i.test(name) || text.includes(' = ')) {
      const raw: Record<string, unknown> = {}
      for (const line of text.split(/\r?\n/)) {
        const m = line.match(/^([a-z0-9_]+)\s*=\s*(.+)$/i)
        if (m) raw[m[1]] = m[2].trim()
      }
      if (Object.keys(raw).length) {
        const mapped = mapSlicerSettings(raw)
        return { ...mapped, source: name }
      }
    }
  }

  return empty
}

// ---------- Einheitlicher Einstieg ----------

export type ParsedModel = {
  mesh: Mesh
  objects: ModelObject[]
  /** Fertiges STL, wenn die Datei schon eines war; `null` heißt: bei Bedarf bauen. */
  binary: Buffer | null
  format: 'stl' | '3mf' | 'obj' | 'ply' | 'glb'
  settings: DeepPartial<PrintSettings>
  warnings: string[]
  printerHint: string | null
  filamentHint: string | null
  meta: string | null
  /** Anzahl der Platten in einer 3MF-Datei */
  plates: number
}

export function parseModelFile(buf: Buffer, name: string): ParsedModel {
  if (buf.length < 16) throw new Error('Die Datei ist zu klein für ein Modell.')

  const ext = (name.match(/\.([a-z0-9]+)$/i)?.[1] ?? '').toLowerCase()
  const zipMagic = buf[0] === 0x50 && buf[1] === 0x4b

  if (zipMagic || ext === '3mf') {
    const entries = readZip(buf)
    const parsed = parse3MF(entries)
    const settings = read3MFSettings(entries)
    // Bei genau einem Objekt dürfen dessen Objektwerte auch die Oberfläche
    // vorbefüllen. Bei mehreren Objekten bleiben sie bewusst am Objekt, damit
    // ein Testobjekt nicht die Werte der übrigen Teile überschreibt.
    const onlyObjectSettings = parsed.objects.length === 1 ? parsed.objects[0].settings : undefined
    return {
      mesh: parsed.mesh,
      objects: parsed.objects,
      // Kein STL auf Vorrat: Eine 3MF ist keines, und bei mehreren Platten
      // wird die Zusammenfassung ohnehin neu geschrieben.
      binary: null,
      format: '3mf',
      settings: mergePrintPatches(settings.patch, onlyObjectSettings) ?? settings.patch,
      warnings: [
        ...settings.warnings,
        ...parsed.objects
          .filter((object) => object.settings && Object.keys(object.settings).length > 0)
          .map((object) =>
            `3MF: „${object.name}“ bringt eigene Objektwerte mit (${describeSettingsOverrides(object.settings!)}) — sie gelten nur für dieses Objekt.`,
          ),
        ...(parsed.plates > 1
          ? [
              `3MF enthält ${parsed.plates} Platten — sie liegen nebeneinander, geslict wird die gewählte Platte.`,
            ]
          : []),
      ],
      printerHint: settings.printerName ?? parsed.printerHint,
      filamentHint: settings.filamentName,
      meta: parsed.meta ?? settings.source,
      plates: parsed.plates,
    }
  }

  if (ext === 'obj' || buf.subarray(0, 40).toString('utf8').includes('\nv ') || /^v\s/.test(buf.toString('utf8', 0, 3))) {
    const mesh = parseOBJ(buf.toString('utf8'))
    return {
      mesh,
      objects: singleObject(mesh, name),
      binary: meshToBinarySTL(mesh),
      format: 'obj',
      settings: {},
      warnings: [],
      printerHint: null,
      filamentHint: null,
      meta: null,
      plates: 1,
    }
  }

  // Die MeshScan-App liefert am Ende mesh.glb — deshalb liest der Slicer GLB
  // direkt, statt auf die OBJ/PLY-Zwischendateien der Engine zu verweisen.
  if (ext === 'glb' || buf.subarray(0, 4).toString('ascii') === 'glTF') {
    const parsed = parseGLB(buf)
    return {
      mesh: parsed.mesh,
      objects: singleObject(parsed.mesh, name),
      binary: meshToBinarySTL(parsed.mesh),
      format: 'glb',
      settings: {},
      warnings: parsed.warnings,
      printerHint: null,
      filamentHint: null,
      meta: null,
      plates: 1,
    }
  }

  if (ext === 'ply' || buf.subarray(0, 3).toString('ascii') === 'ply') {
    const mesh = parsePLY(buf)
    return {
      mesh,
      objects: singleObject(mesh, name),
      binary: meshToBinarySTL(mesh),
      format: 'ply',
      settings: {},
      warnings: [],
      printerHint: null,
      filamentHint: null,
      meta: null,
      plates: 1,
    }
  }

  const mesh = parseSTL(buf)
  if (!mesh.triangles) throw new Error('STL enthält keine Dreiecke.')
  return {
    mesh,
    objects: singleObject(mesh, name),
    binary: buf,
    format: 'stl',
    settings: {},
    warnings: [],
    printerHint: null,
    filamentHint: null,
    meta: null,
    plates: 1,
  }
}
