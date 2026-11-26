import type {
  SurfaceTexturePattern,
  TexturePatternChoice,
  TextureZone,
  TopTexturePatternChoice,
} from './surfaceTexture.ts'
import { DEFAULT_MULTI_MATERIAL, normalizeMultiMaterial, type MultiMaterialSettings } from './multiMaterial.ts'

export type { SurfaceTexturePattern, TexturePatternChoice, TextureZone, TopTexturePatternChoice }
export type { MultiMaterialSettings, FilamentChangeMode, PurgeSide } from './multiMaterial.ts'

export type Vec3 = { x: number; y: number; z: number }

/**
 * Ein physischer Filamentplatz am Drucker. Das Profil liefert Temperatur und
 * Fluss; Farbe und Slot-Label gehören zur konkreten Spule.
 */
export type FilamentSlot = {
  id: string
  label: string
  profileId: string
  color?: string
  present?: boolean
}

export type ControlKind = 'marlin-serial' | 'klipper-moonraker' | 'manual'

/** Werkstoff der eingebauten Düse */
export type NozzleMaterial = 'brass' | 'hardened-steel' | 'stainless' | 'unknown'

/** Art der Bett-/Z-Abtastung */
export type ProbeKind = 'strain-gauge' | 'bltouch' | 'inductive' | 'probe' | 'none' | 'unknown'
/** Firmware-Geschmack wie in OrcaSlicer: Marlin 1/2, Klipper, RRF, Repetier. */
export type GcodeFlavor = 'marlin' | 'marlin2' | 'klipper' | 'reprapfirmware' | 'repetier'

export type PrinterProfile = {
  id: string
  name: string
  brand: string
  /** Bauvolumen in mm */
  bed: { x: number; y: number; z: number }
  baud: number
  maxPrintSpeed: number
  hasBedLeveling: boolean
  meshGrid: { cols: number; rows: number; margin: number }
  nozzle: number
  /** Abtastsystem für Bett und Z-Nullpunkt */
  probe: ProbeKind
  /** Z wird über die Probe/Nozzle gehomt (Vyper/LeviQ, Klipper z_virtual_endstop) */
  homesWithProbe: boolean
  /** Werksgrenzen */
  maxAccel: number
  maxTravel: number
  layerRange: [number, number]
  nozzleOptions: number[]
  /** Kinematik — Delta braucht rundes Bett und andere Start-/Endwege */
  kinematics?: 'cartesian' | 'corexy' | 'delta'
  /** G-Code-Nullpunkt: Ecke (Marlin) oder Bettmitte (Klipper-Delta) */
  coordOrigin?: 'corner' | 'center'
  /** freigegebene Materialklassen (nur wenn dokumentiert) */
  materials?: string[]
  /** Multi-Material-Einheit, z. B. FlashForge IFS */
  ifs?: { name: string; slots: number; note: string }
  /** Z-Mod am AD5X: START_PRINT-MESH aus Betttemperatur oder Klipper-Profil. */
  zmodMesh?: boolean
  transportNote: string
  control: ControlKind
  flavor: GcodeFlavor
  maxNozzleTemp: number
  maxBedTemp: number
  defaultPlate: string
  note?: string
  /** Vom Nutzer selbst angelegter Drucker (No-Name) */
  custom?: boolean
}

/**
 * Firmware-Art eines Klipper-Druckers. `auto` erkennt sie beim Verbinden;
 * `zmod` und `original` sind die manuelle Wahl, wenn die Erkennung nicht greift.
 */
export type PrinterFirmwareMode = 'auto' | 'zmod' | 'original'

/** Ergebnis der Erkennung: Z-Mod oder die Original-Firmware. */
export type PrinterFirmwareKind = 'zmod' | 'original'

/**
 * Eigene Gerätewerte eines Druckers. Sie liegen im Setup des Druckers und
 * überschreiben nur für dieses Gerät den Werkskatalog — nie den Katalog selbst.
 */
export type PrinterOverrides = {
  bed?: { x: number; y: number; z: number }
  kinematics?: NonNullable<PrinterProfile['kinematics']>
  /**
   * Firmware-Art dieses Geräts (AD5X: Z-Mod oder Original). Fehlt der Wert,
   * wird sie beim Verbinden erkannt; greift das nicht, gilt der Katalog.
   */
  firmware?: PrinterFirmwareMode
  /** Leer bedeutet: keine Materialbeschränkung. */
  materials?: string[]
}

/** Werksprofil mit den lokal gespeicherten Werten dieses Druckers. */
export function applyPrinterOverrides(
  profile: PrinterProfile,
  overrides?: PrinterOverrides | null,
): PrinterProfile {
  if (!overrides) return profile
  const next: PrinterProfile = { ...profile }
  const bed = overrides.bed
  if (
    bed &&
    Number.isFinite(bed.x) &&
    Number.isFinite(bed.y) &&
    Number.isFinite(bed.z) &&
    bed.x > 0 &&
    bed.y > 0 &&
    bed.z > 0
  ) {
    next.bed = { x: bed.x, y: bed.y, z: bed.z }
  }
  if (overrides.kinematics === 'cartesian' || overrides.kinematics === 'corexy' || overrides.kinematics === 'delta') {
    next.kinematics = overrides.kinematics
  }
  if (Array.isArray(overrides.materials)) {
    const materials = overrides.materials
      .filter((material): material is string => typeof material === 'string')
      .map((material) => material.trim())
      .filter(Boolean)
    if (materials.length) next.materials = [...new Set(materials)]
    else delete next.materials
  }
  return next
}

export type BuildPlate = {
  id: string
  name: string
  material: string
  /** Temperatur-Offset auf die Filament-Betttemperatur */
  bedTempOffset: number
  hint: string
}

export type FilamentProfile = {
  id: string
  name: string
  material: string
  density: number
  nozzle: number
  bed: number
  firstLayerNozzle: number
  firstLayerBed: number
  fanSpeed: number
  flow: number
  retraction: { distance: number; speed: number; minTravel: number; onLayerChange?: boolean }
  maxVolumetricFlow: number
  pricePerKg: number
  note: string
  /** Schrumpfkompensation dieses Filaments */
  shrinkage?: Shrinkage
  /** Kühlverhalten dieses Filaments */
  cooling?: Partial<CoolingSettings>
  /** Vom Nutzer gespeichertes Profil (Temperaturwerte gelten absolut) */
  custom?: boolean
}

export type InfillPattern =
  | 'lines'
  | 'grid'
  | 'triangles'
  | 'zigzag'
  | 'concentric'
  | 'gyroid'
  | 'honeycomb'
  | 'crosshatch'
  | 'cubic'
  | 'octet'
export type SupportKind = 'none' | 'normal' | 'tree'
export type SupportPattern = 'grid' | 'lines' | 'zigzag'

/** Schrumpfkompensation in Prozent — positive Werte vergrößern das Modell. */
export type Shrinkage = { x: number; y: number; z: number }

export type RetractionSettings = {
  /** Rückzugslänge in mm */
  distance: number
  /** Rückzugsgeschwindigkeit in mm/s */
  speed: number
  /** Ab welchem Fahrweg zurückgezogen wird */
  minTravel: number
  /** Vor dem Schichtwechsel zurückziehen */
  onLayerChange: boolean
}

export type CoolingSettings = {
  /** Lüfter in den ersten Schichten aus (0 = ab Schicht 1) */
  fanOffLayers: number
  /** Mindestschichtzeit in s — kürzere Schichten werden abgewartet */
  minLayerTime: number
}

export type SequentialPrintSettings = {
  enabled: boolean
  /** Mindestabstand zwischen den Objekt-Bounding-Boxen in mm. */
  clearance: number
}

export type ArcFittingSettings = {
  enabled: boolean
  /** Größte radiale Abweichung eines Zwischenpunkts vom Kreis in mm. */
  tolerance: number
  /** Mindestanzahl polygoner Segmente, die ein Bogen ersetzt. */
  minSegments: number
}

export type SupportSettings = {
  kind: SupportKind
  /** Überhangwinkel ab dem gestützt wird (Grad zur Senkrechten) */
  threshold: number
  /** Dichte der Stützfüllung in % */
  density: number
  pattern: SupportPattern
  /** Verdichtete Kontaktlagen direkt unter dem Bauteil */
  interfaceLayers: number
  interfaceDensity: number
  /** Abstand zwischen Stützspitze und Bauteil in mm */
  zDistance: number
  /** Seitlicher Abstand zum Bauteil in mm */
  xyDistance: number
  /** Baum: Aufweitung nach unten in Grad */
  branchAngle: number
  /** Muster der verdichteten Kontaktlage. */
  interfacePattern: SupportPattern
}

export type Adhesion = 'none' | 'skirt' | 'brim'
export type SkirtType = 'outer_only' | 'combined'
export type BrimType = 'outer_only' | 'inner_only' | 'combined'
export type FuzzySkinMode = 'off' | 'external' | 'all'

/** Saum vor dem Bauteil — reinigt die Düse und stabilisiert den Anlauf. */
export type SkirtSettings = {
  loops: number
  type: SkirtType
  /** Konturen unter dieser Länge werden nicht umfahren. */
  minLength: number
  /** Abstand zwischen Bauteil und erster Runde in mm. */
  distance: number
  /** Startpunkt der Runde in Grad (0 = +X). */
  startAngle: number
  speed: number
  /** Anzahl Schichten, in denen der Saum gedruckt wird. */
  layers: number
  /** Zusätzliche Schutzwand um das gesamte Bauteil. */
  draftShield: boolean
}

/** Umrandung für die Haftung auf dem Bett. */
export type BrimSettings = {
  type: BrimType
  /** Gesamtbreite der Umrandung in mm. */
  width: number
  /** Abstand zum Bauteil in mm. */
  gap: number
  /** Materialfluss relativ zum normalen Fluss. */
  flow: number
}

/** Prozedurale Oberflächenrauheit und -muster an Außenwänden. */
/**
 * Flächenzuweisung der Oberflächentextur (V-21): Die vier senkrechten
 * Hauptseiten lassen sich einzeln abschalten. `enabled` ist der Hauptschalter;
 * alte Profile ohne das Feld bleiben vollständig texturiert.
 */
export type TextureFaceSettings = {
  enabled: boolean
  /** -Y, dem Betrachter zugewandt. */
  front: boolean
  /** +Y, hinten. */
  back: boolean
  /** -X, links. */
  left: boolean
  /** +X, rechts. */
  right: boolean
}

export type FuzzySkinSettings = {
  mode: FuzzySkinMode
  /** Auslenkung in mm. */
  thickness: number
  /** Abstand der Stützpunkte in mm. */
  pointDistance: number
  /** Muster; `noise` ist die klassische Fuzzy-Skin-Rauheit. */
  pattern: SurfaceTexturePattern
  /** Größe der Merkmale in mm (Maserung, Stein, Rändel …). */
  scale: number
  /** Richtung des Musters in Grad; 0 = entlang X, 90 = entlang Y. */
  angle: number
  /**
   * Sichtbare Deckflächen mit derselben Struktur belegen. Der Aufbau erfolgt
   * nur nach oben und mit eigenem Rand-/Düsenabstand; alte Profile bleiben
   * durch den Default `true` kompatibel.
   */
  topSurfaces?: boolean
  /** Eigenes Muster für Deckflächen; `inherit` = Wandmuster, `none` = glatt. */
  topPattern?: TopTexturePatternChoice
  /**
   * Optionale Höhenzonen. Leer = die Textur gilt auf der ganzen Höhe.
   * Sobald Zonen vorhanden sind, wird nur innerhalb einer Zone texturiert.
   */
  textureZones?: TextureZone[]
  /** Nur ausgewählte Wandseiten texturieren (V-21). */
  faces?: TextureFaceSettings
}

export type SpecialSettings = {
  /** Einwandiger Vasenmodus ohne Füllung und Deckschichten. */
  vase: boolean
  /**
   * Kalibrierfall „offene Hülle“: keine Deck- und Bodenschichten. Wird für
   * den einwandigen Flowwürfel und den Max-Flow-Turm verwendet, damit keine
   * massive Bodenfläche die Wandmessung verfälscht.
   */
  openShell?: boolean
}

/** G-Code am Anfang jeder Extrusionsart, je Schicht einmal. */
export type RoleGcodeSettings = {
  outerWall: string
  innerWall: string
  solid: string
  sparse: string
  support: string
  bridge: string
  iron: string
  adhesion: string
}

/**
 * Bett-Mesh wird ausschließlich beim Slicen in den G-Code eingerechnet
 * (funktioniert damit auch von SD-Karte, ohne laufende USB-Verbindung).
 * 'firmware' gibt es nicht mehr: M420/BED_MESH_PROFILE setzt eine
 * Drucker-seitige Messung voraus und war nur im Stream-Betrieb praktikabel.
 */
export type MeshCompensation = 'off' | 'software'

/** Eigener G-Code, getrennt je Drucker im Drucker-Snapshot gespeichert. */
export type CustomGcode = {
  /** Vollständiger Startblock, wenn fullMachineGcode gesetzt ist; sonst ein Zusatzblock. */
  start: string
  /** Vollständiger Endblock, wenn fullMachineGcode gesetzt ist; sonst ein Zusatzblock. */
  end: string
  /** Wird am Anfang jeder Schicht eingefügt. {layer} und {z} werden ersetzt. */
  layerChange: string
  /** Wird vor einem Filamentwechsel (M600) eingefügt. */
  pause: string
  /**
   * true: start/end ersetzen die automatisch erzeugten Standardblöcke.
   * Fehlt das Feld, bleiben ältere gespeicherte Zusatzblöcke kompatibel.
   */
  fullMachineGcode?: boolean
}

/** Betttemperaturen für eine Platte und ein Filament. */
export type PlateFilamentTemps = {
  /** Absolute Betttemperatur; fehlt sie, gilt Filament + Plattenoffset. */
  bedTemp?: number
  /** Absolute Temperatur der ersten Bettschicht. */
  firstLayerBed?: number
}

/** Optionen je Druckplatte, getrennt je Drucker im Setup gespeichert. */
export type PlateProfile = {
  /** Absolute Betttemperaturen je Filament-ID. */
  filamentTemps?: Record<string, PlateFilamentTemps>
  /** Klipper-Meshprofilname; leer = MESH aus der Betttemperatur ableiten. */
  meshProfile?: string
}

export const EMPTY_CUSTOM_GCODE: CustomGcode = {
  start: '',
  end: '',
  layerChange: '',
  pause: '',
  fullMachineGcode: false,
}

/**
 * Externes Post-Processing nach dem Slicen. Das Skript bekommt die temporäre
 * G-Code-Datei als Argument und darf sie an Ort und Stelle verändern — so
 * arbeiten auch die Skripte von OrcaSlicer und Hersteller-Tools wie dem
 * AD5X-Z-Mod.
 */
export type PostProcessingScript = {
  enabled: boolean
  /** Absoluter Pfad zur EXE, BAT/CMD, PS1, Python-Datei oder ausführbaren Datei. */
  path: string
  /** Argumentvorlage; {gcode} wird durch die temporäre Datei ersetzt. */
  args: string
  /** Optionaler Arbeitsordner für Skripte mit Begleitdateien. */
  workingDirectory: string
  timeoutSeconds: number
  /** Bei Fehler den Slice abbrechen, statt unveränderten G-Code zu liefern. */
  required: boolean
}

export const EMPTY_POST_PROCESSING: PostProcessingScript = {
  enabled: false,
  path: '',
  args: '{gcode}',
  workingDirectory: '',
  timeoutSeconds: 120,
  required: true,
}

/** Optionen, die den erzeugten G-Code und seine Lesbarkeit betreffen. */
export type GcodeOutputSettings = {
  /** Objektnamen als Kommentare und Objektgrenzen in den G-Code schreiben. */
  objectLabels: boolean
  /** Bahntypen (Außenwand, Füllung …) als Kommentar vor der ersten Bahn ausgeben. */
  verbosePaths: boolean
  /** Rückzug bei Reisen innerhalb der Füllung halbieren. */
  reduceInfillRetraction: boolean
  /** N-Nummern vor G-Code-Befehle setzen. */
  lineNumbers: boolean
  /** Firmware-Marker für Klipper/Marlin schreiben. */
  excludeObjects: boolean
  /** Orca-Format für den vorgeschlagenen G-Code-Dateinamen. */
  filenameFormat: string
}

/**
 * Nur für den Pressure-Advance-Linientest: Der Slicer schreibt während einer
 * Bahn fortlaufend neue PA-Werte. Im normalen Druck bleibt der Block aus.
 */
export type PressureAdvanceRamp = {
  enabled: boolean
  from: number
  to: number
  startX: number
  endX: number
}

export type SeamPosition = 'nearest' | 'aligned' | 'rear' | 'random'

/**
 * Scarf-Naht: Die Außenwand läuft am Nahtanfang und -ende über eine kurze
 * Strecke in der Höhe und im Fluss aus. Dadurch treffen sich Anfang und Ende
 * nicht mit einer harten Kante, sondern überlappen wie eine Holzverbindung.
 * Nur für geschlossene Wände ab Schicht 2; im Vasenmodus wirkungslos.
 */
export type ScarfSeamSettings = {
  enabled: boolean
  /** Horizontale Länge der Rampe in mm; 0 schaltet die Rampe ab. */
  length: number
  /** Starthöhe als Prozent der Schichthöhe über der vorherigen Schicht. */
  startHeight: number
  /** Mindestanzahl der Stützpunkte für die Rampe. */
  steps: number
  /** Zusätzlicher Flussfaktor im Scarf-Bereich; 1 = normal. */
  flow: number
  /** Auch Innenwände mit einer Scarf-Naht versehen. */
  innerWalls: boolean
}

/** Echte Reihenfolge der Wände und Bahnen im erzeugten G-Code. */
export type WallOrder = 'inner-first' | 'outer-first'
export type LayerOrder = 'walls-first' | 'infill-first'
export type PathOrder = 'shortest' | 'generated'
export type InputShaperMethod = 'auto' | 'zv' | 'mzv' | 'ei' | '2hump_ei' | '3hump_ei'
export type PrintOrderSettings = {
  /** Innen- oder Außenwand zuerst; die andere Wand folgt danach. */
  walls: WallOrder
  /** Wände vor Füllung/Decklage oder Füllung/Decklage vor Wänden. */
  layer: LayerOrder
  /** Kürzeste Reisen oder die Reihenfolge, in der die Bahnen entstehen. */
  paths: PathOrder
  /** Kurze Wege zwischen Innenwänden/Füllbahnen ohne Rückzug und Z-Hop fahren. */
  continuous: boolean
}

/** Düsenreinigung als kurze Extrusionslinie vor dem eigentlichen Druck. */
export type PrimeLineSettings = {
  enabled: boolean
  /** Gewünschte Länge in mm; wird an den freien Randbereich angepasst. */
  length: number
  /** Geschwindigkeit der Prime-Linie in mm/s */
  speed: number
}

/**
 * Elefantenfuß-Kompensation der ersten Schicht. Positiv zieht die Kontur je
 * Seite nach innen, negativ weitet sie. Der Wert ist ein Bahnversatz in mm.
 */
export type ElephantFootSettings = {
  enabled: boolean
  amount: number
  /** Außenkontur oder sämtliche Konturen der ersten Schicht. */
  scope: 'outer-wall' | 'first-layer'
}

/**
 * Adaptive Schichthöhe: Die Schichtdicke folgt der Moderneigung. Flache oder
 * geneigte Flächen brauchen feinere Schichten als senkrechte Wände, damit die
 * sichtbaren Treppenstufen unter der Zielabweichung bleiben. Die erste Schicht
 * bleibt unverändert.
 */
export type AdaptiveLayerHeightSettings = {
  enabled: boolean
  /** Kleinste Schichthöhe in mm. */
  minHeight: number
  /** Größte Schichthöhe in mm. */
  maxHeight: number
  /** Zulässige sichtbare Abweichung einer Treppenstufe in mm. */
  quality: number
}

/**
 * Gap-Fill für Stellen, die schmaler als eine reguläre Wand sind. Die Breite
 * wird aus dem örtlichen Abstand abgeleitet; Min/Max begrenzen sie, damit keine
 * unbrauchbar dünnen oder überbreiten Bahnen entstehen.
 */
export type GapFillSettings = {
  enabled: boolean
  /** Kleinste zulässige Breite einer Lückenfüllung in mm. */
  minWidth: number
  /** Größte zulässige Breite einer Lückenfüllung in mm. */
  maxWidth: number
  /** Flussfaktor der Lückenfüllung; 1 = normal. */
  flow: number
}

/** Einstellungen, die ein Höhenbereich ändern kann. */
export type HeightRangePatch = {
  /** Multiplikator auf alle Druckgeschwindigkeiten; 1 = unverändert. */
  speedFactor?: number
  /** Globaler Flussfaktor; 1 = unverändert. */
  flow?: number
  /** Multiplikator auf die Linienbreiten; 1 = unverändert. */
  lineWidthFactor?: number
  /** Anzahl Wände; undefiniert = unverändert. */
  walls?: number
  /** Füllgrad in Prozent; undefiniert = unverändert. */
  infillDensity?: number
}

/**
 * Ein Höhenbereich ab `from` bis ausschließlich `to` in mm. Der erste
 * passende Bereich gewinnt. Die erste Schicht bleibt von Höhenbereichen
 * ausgenommen, damit sie nicht versehentlich ihre Haftungseinstellungen
 * verliert.
 */
export type HeightRangeModifier = {
  from: number
  to: number
  /** Freier Name für die Anzeige; optional. */
  label?: string
  patch: HeightRangePatch
}

export type PrintSettings = {
  layerHeight: number
  firstLayerHeight: number
  /** Adaptive Schichthöhe ab der zweiten Schicht. */
  adaptiveLayerHeight: AdaptiveLayerHeightSettings
  /** Lückenfüllung für Bereiche schmaler als eine Wand. */
  gapFill: GapFillSettings
  /** Allgemeine Einstellungen pro Höhenbereich. */
  heightRanges: HeightRangeModifier[]
  /** Linienbreite der Extrusion; 0 = Düsendurchmesser */
  lineWidth: number
  /** Erste Schicht darf breiter sein als die übrigen Schichten. */
  firstLayerLineWidth: number
  /** Optionaler horizontaler Ausgleich nur für die erste Schicht. */
  elephantFoot: ElephantFootSettings
  outerWallLineWidth: number
  innerWallLineWidth: number
  topSurfaceLineWidth: number
  walls: number
  topLayers: number
  bottomLayers: number
  infillDensity: number
  infillPattern: InfillPattern
  /** Grundwinkel der Füllung in Grad */
  infillAngle: number
  /** Überlappung zwischen Füllung und Innenwand in Prozent einer Linienbreite. */
  infillOverlap: number
  /** Zusätzliche Innenwand auf jeder zweiten Schicht. */
  alternateExtraWall: boolean
  nozzle: number
  filamentDiameter: number
  flow: number
  /** Obergrenze für den Volumenstrom in mm³/s */
  maxVolumetricFlow: number
  temps: { nozzle: number; bed: number; firstLayerNozzle: number; firstLayerBed: number }
  /** Geschwindigkeit je Bahnart in mm/s */
  speeds: {
    print: number
    outerWall: number
    innerWall: number
    infill: number
    solid: number
    topSurface: number
    bridge: number
    support: number
    supportInterface: number
    overhang: number
    travel: number
    firstLayer: number
  }
  /** Beschleunigung je Bahnart in mm/s² */
  accelerations: {
    print: number
    outerWall: number
    innerWall: number
    infill: number
    solid: number
    topSurface: number
    bridge: number
    support: number
    supportInterface: number
    travel: number
    firstLayer: number
  }
  retraction: RetractionSettings
  zHop: number
  cooling: CoolingSettings
  support: SupportSettings
  shrinkage: Shrinkage
  /** Nahtlage der Außenwand */
  seam: { position: SeamPosition; gap: number; wipe: boolean; scarf: ScarfSeamSettings }
  /** Druckreihenfolge innerhalb einer Schicht — verändert den G-Code. */
  printOrder: PrintOrderSettings
  /**
   * Objekte vollständig nacheinander drucken, statt alle Objekte layerweise
   * zu verschachteln. Die Reihenfolge wird nach Höhe sortiert; der Abstand
   * wird vor dem Slicen geprüft.
   */
  sequentialPrint: SequentialPrintSettings
  /** Mehrfarbdruck: Wechselbefehl und Spüllinie je Filamentwechsel. */
  multiMaterial: MultiMaterialSettings
  fanSpeed: number
  adhesion: Adhesion
  skirt: SkirtSettings
  brim: BrimSettings
  fuzzySkin: FuzzySkinSettings
  special: SpecialSettings
  /** G-Code, der beim ersten Pfad einer Extrusionsart je Schicht eingefügt wird. */
  roleGcode: RoleGcodeSettings
  /** Prime-/Purge-Linie vor dem Druckstart */
  primeLine: PrimeLineSettings
  /** Fluss der obersten Sichtfläche relativ zum normalen Fluss. */
  topSurfaceFlow: number
  /** Fluss der untersten Sichtfläche relativ zum normalen Fluss. */
  bottomSurfaceFlow: number
  /** Fluss für Brücken; etwas mehr Material stabilisiert die erste Lage. */
  bridgeFlow: number
  /**
   * Schutz der sichtbaren Deckschicht: dichter Unterbau, zusätzliche
   * Deckschichten und ein höherer Fahrweg-Hub gegen Düsenkratzer.
   */
  surfaceGuard: {
    enabled: boolean
    /** Zusätzliche sichtbare Deckschichten (zusätzlich zu topLayers). */
    extraTopLayers: number
    /** Volle Stützschichten direkt unter den sichtbaren Deckschichten. */
    baseSolidLayers: number
    /** Mindest-Hub bei Fahrten auf der Deckschicht in mm. */
    travelHop: number
    /** Ab diesem Fahrweg wird auf der Deckschicht zurückgezogen. */
    retractAbove: number
    /** Mindestabstand der Glättbahnen zur Wand in mm. */
    ironingInset: number
  }
  /** Ausgabeoptionen für den erzeugten G-Code. */
  output: GcodeOutputSettings
  /** Polylinien innerhalb der Toleranz als G2/G3-Kreisbögen ausgeben. */
  arcFitting: ArcFittingSettings
  ironing: {
    enabled: boolean
    flow: number
    speed: number
    spacing: number
    /** Abstand der Glättbahnen zur Wand in mm. */
    inset: number
    /** Winkel der Glättungsbahnen in Grad. */
    angle: number
    /** top = nur oberste Schicht; solid = alle Deckschichten. */
    type: 'top' | 'solid'
    /** lines = parallele Bahnen; grid = gekreuzt; concentric = Ringe von außen nach innen. */
    pattern: 'lines' | 'grid' | 'concentric'
  }
  meshCompensation: MeshCompensation
  /** Adaptives Bett-Mesh: nur den Modellbereich vor dem Druck messen */
  adaptiveMesh: { enabled: boolean; margin: number; grid: number }
  /** Z-Offset gegen eine gespeicherte Referenz automatisch nachführen */
  autoZ: { enabled: boolean; samples: number }
  /**
   * Pressure Advance (Klipper) bzw. Linear Advance (Marlin). Der Schalter ist
   * bewusst unabhängig vom Druckerprofil: Der Wert wird immer in den G-Code
   * geschrieben, auch wenn die Firmware ihn erst nach einem Update versteht.
   */
  pressureAdvance: { enabled: boolean; value: number }
  /** Input Shaper; Marlin nutzt M593, Klipper SET_INPUT_SHAPER. */
  inputShaper: { enabled: boolean; method: InputShaperMethod; freqX: number; freqY: number; damping: number }
  /** Classic Jerk / Junction Deviation / Square Corner Velocity */
  classicJerk: { enabled: boolean; x: number; y: number; z: number; e: number }
  junctionDeviation: { enabled: boolean; value: number }
  squareCornerVelocity: { enabled: boolean; value: number }
  /** Interne Rampe für den PA-Linientest; im normalen Druck aus. */
  pressureAdvanceRamp: PressureAdvanceRamp
}

export type ModelAnalysis = {
  name: string
  triangles: number
  bbox: { min: Vec3; max: Vec3; size: Vec3 }
  volumeMm3: number
  surfaceAreaMm2: number
  overhangRatio: number
  flatTopRatio: number
  footprintAreaMm2: number
}

export type Suggestion = {
  id: string
  title: string
  detail: string
  impact: 'quality' | 'speed' | 'adhesion' | 'safety'
  patch: DeepPartial<PrintSettings>
}

export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K]
}

export type SliceStats = {
  estimatedSeconds: number
  filamentMm: number
  filamentGrams: number
  layerCount: number
  volumeCm3: number
  maxFlowMm3s: number
}

/** Bahntypen, die in Vorschau und Legende getrennt ausgewertet werden. */
export type PreviewFeatureKind =
  | 'outer-wall'
  | 'inner-wall'
  | 'overhang'
  | 'bridge'
  | 'solid'
  | 'sparse'
  | 'support'
  | 'iron'
  | 'adhesion'
  | 'travel'
  /** Bahn ohne verwertbaren ;TYPE-Kommentar (z. B. fremder G-Code) */
  | 'other'

export type SliceFeatureStats = {
  kind: PreviewFeatureKind
  seconds: number
  grams: number
  /** Anteil an der reinen Extrusionszeit; bei Reisen 0 (kein Material). */
  percent: number
}

/**
 * Vorschau-Daten liegen als flache Zahlenfolge vor:
 * [kind, x1, y1, x2, y2, speed, flow, temperature, acceleration, width, fan, pressureAdvance].
 * Die Schrittweite steht an einer Stelle, damit Server und Viewer nicht
 * auseinanderlaufen.
 */
export const PREVIEW_STRIDE = 12

export type PreviewLayer = {
  z: number
  data: number[]
  /**
   * Optionale 1-basierte G-Code-Zeilen zu jedem Segment in `data`
   * (`data.length / PREVIEW_STRIDE` Einträge). Fehlt die Zuordnung, bleibt
   * der Sprung im Segment-Steckbrief ausgeblendet.
   */
  lines?: number[]
}

export type SliceResult = {
  gcode: string
  layers: PreviewLayer[]
  stats: SliceStats
  /** Zeit- und Materialanteil je Bahntyp für die Vorschau-Legende. */
  features: SliceFeatureStats[]
  warnings: string[]
  /** Erfolgreich ausgeführtes Post-Processing (optional). */
  postProcess?: {
    script: string
    durationMs: number
    output?: string
  }
}

/** Vom verbundenen Klipper gemeldete Meshprofile. */
export type KlipperMeshProfiles = {
  profiles: string[]
  current: string | null
  available: boolean
  reason?: string
}

export type BedMesh = {
  cols: number
  rows: number
  x0: number
  y0: number
  dx: number
  dy: number
  /** z[reihe][spalte] in mm */
  z: number[][]
  source: 'firmware' | 'simulation' | 'manual' | 'klipper'
  capturedAt: number
  /** Druckerprofil, zu dem diese Messung gehört — verhindert Verwechslungen */
  printerId?: string
}

export type ModelPlacement = {
  offsetX: number
  offsetY: number
  /** Höhe über dem Bett in mm (0 = wie im Mesh) */
  offsetZ: number
  /** Drehung um die X-Achse in Grad */
  rotationX: number
  /** Drehung um die Y-Achse in Grad */
  rotationY: number
  rotationZ: number
  /** Maßstab je Achse (1 = Originalgröße) */
  scaleX: number
  scaleY: number
  scaleZ: number
  visible: boolean
  /** Zugewiesenes Filament (ID aus dem Katalog oder eigenes Profil) */
  filamentId?: string
  /** Stabile Slot-ID, getrennt von der Filamentprofil-ID. */
  slotId?: string
}

/** Form der Lithophan-Lampe */
export type LithophaneShape = 'flat' | 'cylinder'

/** Bilddaten kommen als Graustufen (0 = schwarz, 1 = weiß) vom Browser. */
export type LithophaneRequest = {
  name?: string
  gray: number[]
  cols: number
  rows: number
  widthMm: number
  heightMm: number
  minThickness: number
  maxThickness: number
  contrast: number
  invert: boolean
  shape: LithophaneShape
}

/** Text, der auf einem Objekt sitzt und später nachjustiert werden kann. */
export type TextPart = {
  text: string
  fontHeight: number
  depth: number
  rotation: number
  /** emboss = aufgedruckt, engrave = ins Objekt eingelassen */
  mode: 'emboss' | 'engrave'
  /** Versatz auf der Objektoberfläche in mm */
  offsetX: number
  offsetY: number
  /** Objekt, auf dem der Text sitzt */
  targetId: string
}

/**
 * Stützen-Malerei (Taste L). Der Punkt liegt als Anteil 0…1 der Objekt-
 * Bounding-Box, damit er beim Verschieben am Bauteil bleibt. `r` in mm.
 */
export type PaintMark = { fx: number; fy: number; fz: number; r: number; block?: boolean }

export type ModelObjectInfo = {
  id: string
  name: string
  /** 0-basierte Platte aus einer 3MF-Datei */
  plate?: number
  triangles: number
  size: Vec3
  center: Vec3
  placement: ModelPlacement
  filamentId?: string
  slotId?: string
  /** Vor dem Slicen ausgeschlossen — wird nicht gedruckt, bleibt aber sichtbar. */
  excluded?: boolean
  /** Eingelassener Text: wird beim Slicen vom Zielobjekt abgezogen */
  negative?: boolean
  /** Nur bei Textobjekten gesetzt */
  text?: TextPart
  /** Gemalte Stützen-Bereiche (Taste L) */
  paint?: PaintMark[]
  /** Objektbezogene Slicer-Werte aus einer 3MF-Datei (nur dieses Objekt). */
  settings?: DeepPartial<PrintSettings>
}

export type BedMeshRecord = {
  at: number
  rows: number
  cols: number
  min: number
  max: number
  mean: number
  spread: number
  source: BedMesh['source']
  z: number[][]
}

export type PrinterStatus = {
  connection: 'disconnected' | 'connecting' | 'connected' | 'error'
  mode: 'serial' | 'simulation' | 'klipper' | 'octoprint'
  port: string | null
  firmware: string | null
  /** Erkannte Firmware-Art (nur Klipper/Moonraker), sonst null. */
  firmwareKind?: PrinterFirmwareKind | null
  /** Herkunft der Art: erkannt, manuell gewählt oder aus dem Profil angenommen. */
  firmwareSource?: 'detected' | 'manual' | 'profile' | null
  /** Z-Mod-Funktionen laut Drucker, z. B. print_start_tools. */
  firmwareFeatures?: string[]
  bed: { x: number; y: number; z: number } | null
  temps: { nozzle: number; nozzleTarget: number; bed: number; bedTarget: number }
  position: Vec3
  zOffset: number
  babystep: number
  message: string | null
  print: {
    state: 'idle' | 'printing' | 'paused' | 'complete' | 'error' | 'cancelled'
    file: string | null
    progress: number
    etaSeconds: number | null
    /** Zeilenfortschritt beim USB-Streaming */
    lines?: { sent: number; total: number }
    /** Schicht aus Klipper/Moonraker, wenn dort Metadaten vorliegen */
    layer?: { current: number; total: number } | null
  }
}

/** Gefundene Web-Oberfläche (Mainsail, Fluidd) auf einem Drucker-Host. */
export type WebUiInfo = {
  url: string
  kind: 'mainsail' | 'fluidd' | 'octoprint' | null
  title: string | null
  /** false, wenn X-Frame-Options/CSP das Einbetten verbieten */
  embeddable: boolean
  reason: string | null
}

/** Im lokalen Netz gefundene Moonraker-Instanz (Klipper, z. B. Klipper-Mod). */
export type MoonrakerHost = {
  host: string
  port: number
  url: string
  name: string | null
  klippyState: string | null
}

export type ConsoleLine = { t: number; dir: 'in' | 'out' | 'info'; text: string }

export type DetectedDevice = {
  path: string
  label: string
  chip: string
  guess: string
  suggestedPrinter: string | null
  kind: 'serial'
  /** Anschlusshinweis, z. B. fehlender CH340-Treiber unter Windows */
  hint?: string
  /** Baudraten, die dieses Gerät üblicherweise spricht (erste zuerst) */
  bauds?: number[]
}

export type ZMeasurement = {
  samples: number[]
  mean: number
  spread: number
  offset: number
  probe: ProbeKind
  /** Offset ist bauartbedingt null, weil die Nozzle den Z-Nullpunkt tastet */
  inherent: boolean
}

export type CalibrationStep = {
  label: string
  value: string
  atZ: number
  /** Soll-Temperatur dieser Stufe; absichtliche Temperaturwechsel sind kein Risiko. */
  expectedTemperature?: number
  /** Soll-Volumenstrom dieser Stufe in mm³/s. */
  expectedFlow?: number
  /** Soll-Geschwindigkeit dieser Stufe in mm/s. */
  expectedSpeed?: number
}

/** Direct Drive oder Bowden — ändert die sinnvollen PA-/Retract-Bereiche. */
export type CalibrationExtruder = 'direct' | 'bowden'

/** Freie Parameter für die Kalibrier-Tests. Jeder Test nutzt nur seine Felder. */
export type CalibrationOptions = {
  /** Starttemperatur in °C */
  tempFrom?: number
  /** Endtemperatur in °C */
  tempTo?: number
  /** Schrittweite in °C */
  tempStep?: number
  /** Schichten je Temperaturstufe */
  tempLayersPerStep?: number
  /** Direct Drive oder Bowden für PA- und Retract-Tests */
  extruder?: CalibrationExtruder
  /** Retract-Turm: Von/Bis/Schritt in mm */
  retractFrom?: number
  retractTo?: number
  retractStep?: number
  /** Max-Flow-Turm: Von/Bis/Schritt in mm³/s */
  flowFrom?: number
  flowTo?: number
  flowStep?: number
  /** Pressure Advance: Von/Bis/Schritt (Klipper ADVANCE bzw. Marlin K) */
  paFrom?: number
  paTo?: number
  paStep?: number
  /** Input-Shaper-Turm: Von/Bis/Schritt in Hz */
  shaperFrom?: number
  shaperTo?: number
  shaperStep?: number
  /** VFA-Turm: Von/Bis/Schritt in mm/s */
  speedFrom?: number
  speedTo?: number
  speedStep?: number
}

export type CalibrationTool = {
  id: string
  label: string
  description: string
  howTo: string[]
  requires: 'serial' | 'klipper' | 'any'
  steps: CalibrationStep[]
  /** Aus Modellhöhe und Test-Schichthöhe erwartete Schichtzahl. */
  plannedLayers?: number
  settingsPatch: DeepPartial<PrintSettings>
}

export const DEFAULT_SETTINGS: PrintSettings = {
  layerHeight: 0.2,
  firstLayerHeight: 0.24,
  adaptiveLayerHeight: { enabled: false, minHeight: 0.08, maxHeight: 0.28, quality: 0.1 },
  gapFill: { enabled: true, minWidth: 0.2, maxWidth: 0.44, flow: 1 },
  heightRanges: [],
  lineWidth: 0.4,
  firstLayerLineWidth: 0.5,
  elephantFoot: { enabled: false, amount: 0.2, scope: 'outer-wall' },
  outerWallLineWidth: 0.42,
  innerWallLineWidth: 0.45,
  topSurfaceLineWidth: 0.4,
  walls: 3,
  topLayers: 4,
  bottomLayers: 3,
  infillDensity: 20,
  infillPattern: 'grid',
  infillAngle: 45,
  infillOverlap: 10,
  alternateExtraWall: false,
  nozzle: 0.4,
  filamentDiameter: 1.75,
  flow: 1,
  maxVolumetricFlow: 12,
  temps: { nozzle: 210, bed: 60, firstLayerNozzle: 215, firstLayerBed: 65 },
  speeds: {
    print: 60,
    outerWall: 35,
    innerWall: 50,
    infill: 60,
    solid: 50,
    topSurface: 50,
    bridge: 25,
    support: 45,
    supportInterface: 35,
    overhang: 25,
    travel: 150,
    firstLayer: 20,
  },
  accelerations: {
    print: 1000,
    outerWall: 800,
    innerWall: 1200,
    infill: 1500,
    solid: 1000,
    topSurface: 900,
    bridge: 800,
    support: 800,
    supportInterface: 700,
    travel: 2000,
    firstLayer: 800,
  },
  retraction: { distance: 0.8, speed: 40, minTravel: 2, onLayerChange: true },
  zHop: 0.3,
  cooling: { fanOffLayers: 1, minLayerTime: 0 },
  support: {
    kind: 'none',
    threshold: 50,
    density: 15,
    pattern: 'grid',
    interfaceLayers: 3,
    interfaceDensity: 80,
    zDistance: 0.2,
    xyDistance: 0.7,
    branchAngle: 30,
    interfacePattern: 'grid',
  },
  shrinkage: { x: 0, y: 0, z: 0 },
  // "Hinten" hält den sichtbaren Ansatz an der Rückseite, statt ihn je
  // Schicht an die aktuelle Düsenposition zu legen.
  seam: {
    position: 'rear',
    gap: 0,
    wipe: false,
    scarf: {
      enabled: false,
      length: 20,
      startHeight: 15,
      steps: 10,
      flow: 1,
      innerWalls: false,
    },
  },
  printOrder: { walls: 'inner-first', layer: 'walls-first', paths: 'shortest', continuous: true },
  sequentialPrint: { enabled: false, clearance: 5 },
  multiMaterial: DEFAULT_MULTI_MATERIAL,
  fanSpeed: 100,
  adhesion: 'skirt',
  skirt: {
    loops: 3,
    type: 'outer_only',
    minLength: 0,
    distance: 4,
    startAngle: -135,
    speed: 20,
    layers: 1,
    draftShield: false,
  },
  brim: { type: 'outer_only', width: 5, gap: 0.1, flow: 1 },
      fuzzySkin: {
      mode: 'off',
      thickness: 0.3,
      pointDistance: 0.8,
      pattern: 'noise',
      scale: 3,
      angle: 0,
      topSurfaces: true,
      topPattern: 'inherit',
      textureZones: [],
      faces: { enabled: false, front: true, back: true, left: true, right: true },
    },

  special: { vase: false },
  roleGcode: {
    outerWall: '',
    innerWall: '',
    solid: '',
    sparse: '',
    support: '',
    bridge: '',
    iron: '',
    adhesion: '',
  },
  primeLine: { enabled: true, length: 60, speed: 20 },
      topSurfaceFlow: 1,
    bottomSurfaceFlow: 1,
    bridgeFlow: 0.9,
  surfaceGuard: {
    enabled: false,
    extraTopLayers: 2,
    baseSolidLayers: 2,
    travelHop: 0.6,
    retractAbove: 1,
    ironingInset: 0.6,
  },
  arcFitting: { enabled: false, tolerance: 0.05, minSegments: 4 },
  output: {
    objectLabels: true,
    verbosePaths: false,
    reduceInfillRetraction: false,
    lineNumbers: false,
    excludeObjects: true,
    filenameFormat: '{input_filename_base}_{filament_type[0]}_{print_time}.gcode',
  },
  ironing: { enabled: false, flow: 0.12, speed: 25, spacing: 0.12, inset: 0, angle: 45, type: 'top', pattern: 'lines' },
  meshCompensation: 'off',
  adaptiveMesh: { enabled: true, margin: 10, grid: 5 },
  autoZ: { enabled: false, samples: 3 },
  pressureAdvance: { enabled: false, value: 0.04 },
  inputShaper: { enabled: false, method: 'auto', freqX: 40, freqY: 40, damping: 0.1 },
  classicJerk: { enabled: false, x: 8, y: 8, z: 0.4, e: 5 },
  junctionDeviation: { enabled: false, value: 0.01 },
  squareCornerVelocity: { enabled: false, value: 5 },
  pressureAdvanceRamp: { enabled: false, from: 0, to: 0.1, startX: 0, endX: 200 },
}

/** Überschreibt die Betttemperaturen mit den Werten der aktiven Platte und des Filaments. */
export function applyPlateProfile(
  settings: PrintSettings,
  profile?: PlateProfile,
  filamentId?: string,
): PrintSettings {
  if (!profile || !filamentId) return settings
  const override = profile.filamentTemps?.[filamentId]
  if (!override) return settings
  const bed = Number(override.bedTemp)
  const firstLayerBed = Number(override.firstLayerBed)
  const hasBed = Number.isFinite(bed) && bed > 0
  const hasFirstLayerBed = Number.isFinite(firstLayerBed) && firstLayerBed > 0
  if (!hasBed && !hasFirstLayerBed) return settings
  return {
    ...settings,
    temps: {
      ...settings.temps,
      ...(hasBed ? { bed } : {}),
      ...(hasFirstLayerBed ? { firstLayerBed } : {}),
    },
  }
}

export function mergeSettings(base: PrintSettings, patch: DeepPartial<PrintSettings>): PrintSettings {
  const out: any = { ...base }
  for (const [k, v] of Object.entries(patch)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      out[k] = { ...(base as any)[k], ...(v as any) }
    } else if (v !== undefined) {
      out[k] = v
    }
  }
  // Alte Einstellungen („Firmware-Mesh“) auf das Einschreiben in den G-Code umstellen
  if ((out.meshCompensation as string) === 'firmware') out.meshCompensation = 'software'
  if (!Number.isFinite(out.lineWidth) || out.lineWidth <= 0) out.lineWidth = out.nozzle
  // Ältere Snapshots kennen die Bewegungssteuerung noch nicht.
  out.pressureAdvance = { enabled: false, value: 0.04, ...(out.pressureAdvance ?? {}) }
  out.inputShaper = { enabled: false, method: 'auto', freqX: 40, freqY: 40, damping: 0.1, ...(out.inputShaper ?? {}) }
  out.printOrder = { walls: 'inner-first', layer: 'walls-first', paths: 'shortest', continuous: true, ...(out.printOrder ?? {}) }
  out.classicJerk = { enabled: false, x: 8, y: 8, z: 0.4, e: 5, ...(out.classicJerk ?? {}) }
  out.junctionDeviation = { enabled: false, value: 0.01, ...(out.junctionDeviation ?? {}) }
  out.squareCornerVelocity = { enabled: false, value: 5, ...(out.squareCornerVelocity ?? {}) }
  out.pressureAdvanceRamp = { enabled: false, from: 0, to: 0.1, startX: 0, endX: 200, ...(out.pressureAdvanceRamp ?? {}) }
  out.arcFitting = { enabled: false, tolerance: 0.05, minSegments: 4, ...(out.arcFitting ?? {}) }
  out.primeLine = { enabled: true, length: 60, speed: 20, ...(out.primeLine ?? {}) }
  out.multiMaterial = normalizeMultiMaterial(out.multiMaterial)
  out.output = {
    objectLabels: true,
    verbosePaths: false,
    reduceInfillRetraction: false,
    lineNumbers: false,
    excludeObjects: true,
    filenameFormat: '{input_filename_base}_{filament_type[0]}_{print_time}.gcode',
    ...(out.output ?? {}),
  }
  out.skirt = {
    loops: 3,
    type: 'outer_only',
    minLength: 0,
    distance: 4,
    startAngle: -135,
    speed: 20,
    layers: 1,
    draftShield: false,
    ...(out.skirt ?? {}),
  }
  out.brim = { type: 'outer_only', width: 5, gap: 0.1, flow: 1, ...(out.brim ?? {}) }
  out.adaptiveLayerHeight = {
    enabled: false,
    minHeight: Math.min(0.08, out.layerHeight),
    maxHeight: Math.max(0.08, out.layerHeight),
    quality: 0.1,
    ...(out.adaptiveLayerHeight ?? {}),
  }
  if (!Number.isFinite(out.adaptiveLayerHeight.minHeight) || out.adaptiveLayerHeight.minHeight <= 0) {
    out.adaptiveLayerHeight.minHeight = Math.min(0.08, out.layerHeight)
  }
  if (!Number.isFinite(out.adaptiveLayerHeight.maxHeight) || out.adaptiveLayerHeight.maxHeight <= 0) {
    out.adaptiveLayerHeight.maxHeight = Math.max(0.08, out.layerHeight)
  }
  if (!Number.isFinite(out.adaptiveLayerHeight.quality) || out.adaptiveLayerHeight.quality <= 0) {
    out.adaptiveLayerHeight.quality = 0.1
  }
  out.gapFill = {
    enabled: true,
    minWidth: 0.2,
    maxWidth: Math.max(0.2, (Number.isFinite(out.lineWidth) && out.lineWidth > 0 ? out.lineWidth : 0.4) * 1.02),
    flow: 1,
    ...(out.gapFill ?? {}),
  }
  if (!Number.isFinite(out.gapFill.minWidth) || out.gapFill.minWidth <= 0) out.gapFill.minWidth = 0.2
  if (!Number.isFinite(out.gapFill.maxWidth) || out.gapFill.maxWidth <= 0) {
    out.gapFill.maxWidth = Math.max(0.2, out.lineWidth * 1.02)
  }
  if (!Number.isFinite(out.gapFill.flow) || out.gapFill.flow <= 0) out.gapFill.flow = 1
  out.heightRanges = Array.isArray(out.heightRanges)
    ? out.heightRanges.map((range: HeightRangeModifier) => ({
        ...range,
        label: typeof range?.label === 'string' ? range.label : '',
        patch: range?.patch && typeof range.patch === 'object' ? range.patch : {},
      }))
    : []
  out.elephantFoot = {
    enabled: false,
    amount: 0.2,
    scope: 'outer-wall',
    ...(out.elephantFoot ?? {}),
  }
  out.seam = { position: 'rear', gap: 0, wipe: false, ...(out.seam ?? {}) }
  out.seam.scarf = {
    enabled: false,
    length: 20,
    startHeight: 15,
    steps: 10,
    flow: 1,
    innerWalls: false,
    ...(out.seam.scarf ?? {}),
  }
  out.fuzzySkin = {
    mode: 'off',
    thickness: 0.3,
    pointDistance: 0.8,
    topSurfaces: true,
    topPattern: 'inherit',
    textureZones: [],
    ...(out.fuzzySkin ?? {}),
  }
  if (!Array.isArray(out.fuzzySkin.textureZones)) out.fuzzySkin.textureZones = []
  if (!out.fuzzySkin.topPattern) out.fuzzySkin.topPattern = 'inherit'
  out.special = { vase: false, ...(out.special ?? {}) }
  out.roleGcode = {
    outerWall: '',
    innerWall: '',
    solid: '',
    sparse: '',
    support: '',
    bridge: '',
    iron: '',
    adhesion: '',
    ...(out.roleGcode ?? {}),
  }
  out.ironing = {
    enabled: false,
    flow: 0.12,
    speed: 25,
    spacing: 0.12,
    inset: 0,
    angle: 45,
    type: 'top',
    pattern: 'lines',
    ...(out.ironing ?? {}),
  }
  out.surfaceGuard = {
    enabled: false,
    extraTopLayers: 2,
    baseSolidLayers: 2,
    travelHop: 0.6,
    retractAbove: 1,
    ironingInset: 0.6,
    ...(out.surfaceGuard ?? {}),
  }
  out.support = { ...out.support, interfacePattern: out.support?.interfacePattern ?? 'grid' }
  out.speeds = {
    topSurface: out.speeds?.solid ?? 50,
    bridge: out.speeds?.overhang ?? 25,
    supportInterface: Math.round((out.speeds?.support ?? 45) * 0.8),
    ...(out.speeds ?? {}),
  }
  out.accelerations = {
    topSurface: out.accelerations?.solid ?? 900,
    bridge: out.accelerations?.solid ?? 800,
    supportInterface: out.accelerations?.support ?? 700,
    firstLayer: out.accelerations?.print ?? 800,
    ...(out.accelerations ?? {}),
  }
  if (!Number.isFinite(out.firstLayerLineWidth) || out.firstLayerLineWidth <= 0) out.firstLayerLineWidth = out.lineWidth
  if (!Number.isFinite(out.outerWallLineWidth) || out.outerWallLineWidth <= 0) out.outerWallLineWidth = out.lineWidth
  if (!Number.isFinite(out.innerWallLineWidth) || out.innerWallLineWidth <= 0) out.innerWallLineWidth = out.lineWidth
  if (!Number.isFinite(out.topSurfaceLineWidth) || out.topSurfaceLineWidth <= 0) out.topSurfaceLineWidth = out.lineWidth
  if (!Number.isFinite(out.infillOverlap)) out.infillOverlap = 10
  if (typeof out.alternateExtraWall !== 'boolean') out.alternateExtraWall = false
  if (!Number.isFinite(out.topSurfaceFlow) || out.topSurfaceFlow <= 0) out.topSurfaceFlow = 1
  if (!Number.isFinite(out.bottomSurfaceFlow) || out.bottomSurfaceFlow <= 0) out.bottomSurfaceFlow = 1
  if (!Number.isFinite(out.bridgeFlow) || out.bridgeFlow <= 0) out.bridgeFlow = 0.9
  return out as PrintSettings
}

/** Kurzbeschreibung objektbezogener 3MF-Werte für Hinweise und Objektliste. */
export function describeSettingsOverrides(patch: DeepPartial<PrintSettings>): string {
  const parts: string[] = []
  const number = (value: number) => String(Math.round(value * 100) / 100)
  if (patch.infillDensity !== undefined) parts.push(`Füllung ${number(patch.infillDensity)} %`)
  if (patch.walls !== undefined) parts.push(`${number(patch.walls)} Wand${patch.walls === 1 ? '' : 'e'}`)
  if (patch.topLayers !== undefined) parts.push(`${number(patch.topLayers)} Deckschichten`)
  if (patch.bottomLayers !== undefined) parts.push(`${number(patch.bottomLayers)} Bodenschichten`)
  if (patch.layerHeight !== undefined) parts.push(`Schicht ${number(patch.layerHeight)} mm`)
  if (patch.special?.vase) parts.push('Vasenmodus')
  else if (patch.special?.openShell) parts.push('offene Hülle')
  if (patch.support?.kind) parts.push(patch.support.kind === 'none' ? 'ohne Stützen' : `Stützen ${patch.support.kind}`)
  if (patch.speeds?.outerWall !== undefined) parts.push(`Außenwand ${number(patch.speeds.outerWall)} mm/s`)
  if (patch.maxVolumetricFlow !== undefined) parts.push(`max. ${number(patch.maxVolumetricFlow)} mm³/s`)
  if (patch.nozzle !== undefined) parts.push(`Düse ${number(patch.nozzle)} mm`)
  return parts.join(' · ')
}

/** Verschiebung zwischen Bett-Koordinaten (0…bed) und G-Code-Koordinaten. */
export function machineOffset(profile: PrinterProfile): { dx: number; dy: number } {
  if (profile.coordOrigin === 'center') return { dx: -profile.bed.x / 2, dy: -profile.bed.y / 2 }
  return { dx: 0, dy: 0 }
}

/** Abstand zwischen zwei Platten in der Mehrplatten-Ansicht (mm). */
export const PLATE_GAP_MM = 20

/** Linke Kante von Platte `plate` in der Mehrplatten-Ansicht. */
export function plateOffsetX(plate: number, bedWidth: number): number {
  return Math.max(0, Math.floor(plate)) * (bedWidth + PLATE_GAP_MM)
}

export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.round((seconds % 3600) / 60)
  if (h > 0) return `${h} h ${m.toString().padStart(2, '0')} min`
  return `${Math.max(1, m)} min`
}

export function formatWeight(g: number): string {
  return g >= 100 ? `${g.toFixed(0)} g` : `${g.toFixed(1)} g`
}

/**
 * Macht einen vom Nutzer vergebenen Namen zu einem sicheren G-Code-Dateinamen.
 * Der Server normalisiert Druckernamen genauso; so steht in der App und auf
 * dem Drucker derselbe Name. Leerzeichen werden zu Unterstrichen.
 */
export function normalizeGcodeFilename(value: string, fallback = 'easy-slicer.gcode'): string {
  const base = (input: string) =>
    input
      .trim()
      .replace(/(?:\.(?:gcode|gco))+$/i, '')
      .replace(/[^\w.-]+/g, '_')
      .replace(/_+/g, '_')
      .replace(/^[._-]+|[._-]+$/g, '')

  return `${base(value) || base(fallback) || 'easy-slicer'}.gcode`
}

/** Baut den G-Code-Dateinamen aus dem Orca-Format mit den sicheren Platzhaltern. */
export function formatGcodeFilename(
  template: string,
  values: { model: string; layerHeight: number; filamentType: string; printTime: string; nozzle: number },
): string {
  const fallback = '{input_filename_base}_{filament_type[0]}_{print_time}.gcode'
  const safe = (value: string) =>
    value
      .trim()
      .replace(/[^\w.-]+/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '') || 'x'
  let name = (template.trim() || fallback)
    .replaceAll('{input_filename_base}', safe(values.model.replace(/\.(stl|3mf|obj|ply)$/i, '')))
    .replaceAll('{filament_type[0]}', safe(values.filamentType || 'filament'))
    .replaceAll('{print_time}', safe(values.printTime || '0m'))
    .replaceAll('{layer_height}', values.layerHeight.toFixed(2))
    .replaceAll('{nozzle_diameter}', values.nozzle.toFixed(2))
  name = name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/\s+/g, '_')
  if (!/\.gcode$/i.test(name)) name += '.gcode'
  return name
}
