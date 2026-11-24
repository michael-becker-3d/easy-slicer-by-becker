import type {
  CalibrationOptions,
  CalibrationStep,
  CalibrationTool,
  DeepPartial,
  FilamentProfile,
  GcodeFlavor,
  PrintSettings,
  PrinterProfile,
} from '../shared/types.ts'
import { flowCubeWallWidth } from '../shared/calibration.ts'
import { box, type Tri } from './meshlib.ts'
import { buildBinarySTL, parseSTL } from './slicer/stl.ts'
import type { LayerOverride } from './slicer/gcode.ts'
import { inputShaperGcode, isKlipperFlavor, pressureAdvanceGcode } from '../shared/gcode-flavors.ts'
import {
  calibrationModel,
  loadCalibrationModel,
  modelBandLevels,
  type CalibrationModel,
} from './calibrationModels.ts'

export type CalibrationBundle = {
  tool: CalibrationTool
  stl: Buffer
  overrides: LayerOverride[]
}

/**
 * Alle STL-Modelle sind auf 0,20 mm Schichthöhe ausgelegt. Die Stufen liegen
 * auf vollen Millimetern, damit jede Stufe mit einer ganzen Schicht beginnt.
 */
const MODEL_LAYER_HEIGHT = 0.2

/** Ein von einem Test erzeugtes Modell — entweder Dreiecke oder ein STL. */
type BuiltCalibration = {
  tris?: Tri[]
  stl?: Buffer
  overrides: LayerOverride[]
  steps: CalibrationStep[]
  patch: DeepPartial<PrintSettings>
  description: string
  howTo: string[]
}

const clampInt = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, Math.round(value)))

const clampNum = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, Number.isFinite(value) ? value : min))

/** Höchste Modell-Z-Koordinate; Grundlage für die geplante Schichtzahl. */
function modelHeight(tris: Tri[]): number {
  let maxZ = 0
  for (const triangle of tris) {
    for (let i = 2; i < triangle.length; i += 3) maxZ = Math.max(maxZ, triangle[i])
  }
  return maxZ
}

/** Inklusive Werte von → bis; begrenzt, damit kein Test unendlich viele Stufen bekommt. */
function valueRange(from: number, to: number, step: number, maxSteps = 20): number[] {
  const safeStep = Math.max(0.001, step)
  const values: number[] = []
  if (to >= from) {
    for (let value = from; value <= to + 1e-9 && values.length < maxSteps; value += safeStep) {
      values.push(Math.round(value * 1000) / 1000)
    }
    if (!values.length) values.push(from)
    if (values[values.length - 1] < to - 1e-9) values.push(Math.round(to * 1000) / 1000)
  } else {
    for (let value = from; value >= to - 1e-9 && values.length < maxSteps; value -= safeStep) {
      values.push(Math.round(value * 1000) / 1000)
    }
    if (!values.length) values.push(from)
    if (values[values.length - 1] > to + 1e-9) values.push(Math.round(to * 1000) / 1000)
  }
  return values.slice(0, maxSteps)
}

function requiredModel(toolId: string): CalibrationModel {
  const model = calibrationModel(toolId)
  if (!model) throw new Error(`Kalibrier-Modell für ${toolId} fehlt.`)
  return model
}

/**
 * Prüft, ob Von/Bis/Schritt genau so viele Werte ergeben wie das Modell
 * sichtbare Stufen hat. Ein still gekürzter Bereich würde sonst einen
 * anderen Wert drucken, als in der Oberfläche steht.
 */
function requireBandValues(
  model: CalibrationModel,
  values: number[],
  from: number,
  to: number,
  step: number,
  unit: string,
): void {
  const bands = model.bands ?? 0
  if (values.length === bands) return
  throw new Error(
    `${model.modelName} hat ${bands} feste Stufen. Von ${from} bis ${to} ${unit} in ${step}-Schritten ergeben ` +
      `${values.length} Werte — bitte genau ${bands} wählen.`,
  )
}

/** Grundstruktur aller Modell-Tests: zwei Wände, normale Füllung, keine Stützen. */
function modelPatch(extra: DeepPartial<PrintSettings> = {}): DeepPartial<PrintSettings> {
  return {
    layerHeight: MODEL_LAYER_HEIGHT,
    firstLayerHeight: MODEL_LAYER_HEIGHT,
    walls: 2,
    topLayers: 3,
    bottomLayers: 2,
    infillDensity: 15,
    ironing: { enabled: false },
    support: { kind: 'none' },
    adhesion: 'skirt',
    zHop: 0.4,
    ...extra,
  }
}

/** Stufenwechsel erst auf der ersten vollständigen Schicht der neuen Stufe. */
const bandSwitchZ = (z: number) => z + 0.0001

/**
 * Thermal-Cell: sechs übereinanderliegende Kammern à 8 mm. Jede Kammer läuft
 * mit einer anderen Düsentemperatur.
 */
function thermalCell(
  printer: PrinterProfile,
  filament: FilamentProfile,
  options?: CalibrationOptions,
): BuiltCalibration {
  const model = requiredModel('temp-tower')
  const bands = model.bands ?? 0
  const levels = modelBandLevels(model)
  const maxTemp = Math.max(150, Math.min(300, printer.maxNozzleTemp))
  const step = clampInt(options?.tempStep ?? 5, 1, 50)
  const from = clampInt(options?.tempFrom ?? filament.nozzle ?? 210, 150, maxTemp)
  const to = clampInt(options?.tempTo ?? Math.max(150, from - step * (bands - 1)), 150, from)
  const temps = valueRange(from, to, step, bands)
  requireBandValues(model, temps, from, to, step, '°C')

  const overrides: LayerOverride[] = []
  const steps: CalibrationStep[] = []
  temps.forEach((temperature, index) => {
    const z = levels[index]
    steps.push({
      label: `Stufe ${index + 1} · ab z ${z} mm`,
      value: `${temperature} °C`,
      atZ: z,
      expectedTemperature: temperature,
    })
    if (index > 0) {
      overrides.push({
        atZ: bandSwitchZ(z),
        lines: [`M104 S${temperature}`, `; Temperatur ${temperature} °C ab z ${z} mm (${model.modelName})`],
        settings: { temps: { nozzle: temperature } },
      })
    }
  })

  return {
    stl: loadCalibrationModel('temp-tower'),
    overrides,
    steps,
    patch: modelPatch({ temps: { nozzle: from, firstLayerNozzle: from } }),
    description: `${model.modelName} (${model.size.x} × ${model.size.z} mm) mit ${bands} Kammern à ${model.bandHeight} mm: ${from} °C bis ${to} °C in ${step} °C-Schritten.`,
    howTo: [
      `Druck starten; die unterste Kammer läuft mit ${from} °C.`,
      'Kammern vergleichen: stabile Brücken, saubere Oberfläche und wenige Fäden gewinnen.',
      'Die Temperatur der besten Kammer als Düsentemperatur übernehmen.',
    ],
  }
}

/**
 * Max-Flow-Core: sieben Bänder à 5 mm mit nach oben breiter werdenden
 * Querschnitten. Die Geschwindigkeit folgt aus Volumenstrom, Düse und Schicht.
 */
function maxFlowCore(settings: PrintSettings, options?: CalibrationOptions): BuiltCalibration {
  const model = requiredModel('max-flow')
  const bands = model.bands ?? 0
  const levels = modelBandLevels(model)
  const nozzle = settings.nozzle
  const from = clampNum(options?.flowFrom ?? 4, 0.5, 100)
  const to = clampNum(options?.flowTo ?? 16, from, 100)
  const step = clampNum(options?.flowStep ?? 2, 0.1, 50)
  const flows = valueRange(from, to, step, bands)
  requireBandValues(model, flows, from, to, step, 'mm³/s')

  const overrides: LayerOverride[] = []
  const steps: CalibrationStep[] = []
  flows.forEach((flow, index) => {
    const z = levels[index]
    const speed = flow / (nozzle * MODEL_LAYER_HEIGHT)
    steps.push({
      label: `Band ${index + 1} · ab z ${z} mm`,
      value: `${flow} mm³/s · ${Math.round(speed)} mm/s`,
      atZ: z,
      expectedFlow: flow,
      expectedSpeed: speed,
    })
    overrides.push({
      atZ: index === 0 ? 0 : bandSwitchZ(z),
      lines: [`; Ziel-Volumenstrom ${flow} mm³/s (${model.modelName})`],
      settings: {
        // Die Volumengrenze darf den Test nicht ausbremsen.
        maxVolumetricFlow: 100,
        // Alle extrudierenden Bahnarten auf dieselbe Geschwindigkeit: Sonst
        // läuft die Füllung (Profilwert 60 mm/s) am Bandziel vorbei und der
        // Test zeigt einen anderen Volumenstrom als geplant.
        speeds: {
          print: speed,
          outerWall: speed,
          innerWall: speed,
          infill: speed,
          solid: speed,
          topSurface: speed,
          bridge: speed,
          support: speed,
          supportInterface: speed,
          overhang: speed,
          firstLayer: speed,
        },
      },
    })
  })

  return {
    stl: loadCalibrationModel('max-flow'),
    overrides,
    steps,
    // Eine abweichende Wandbreite aus dem Profil würde den Volumenstrom
    // verfälschen: Der geplante Wert gilt nur bei Düsenbreite als Linienbreite.
    patch: modelPatch({
      lineWidth: nozzle,
      firstLayerLineWidth: nozzle,
      outerWallLineWidth: nozzle,
      innerWallLineWidth: nozzle,
    }),
    description: `${model.modelName} (${model.size.x} × ${model.size.y} × ${model.size.z} mm) mit ${bands} Bändern à ${model.bandHeight} mm: ${from} bis ${to} mm³/s in ${step} mm³/s-Schritten. Die Geschwindigkeit folgt automatisch aus Düse und Schichthöhe.`,
    howTo: [
      'Den Kern drucken und die Bänder von unten nach oben vergleichen.',
      'Das letzte vollständige Band ohne Lücken oder Aussetzer ist dein maximaler Volumenstrom.',
      'Wert unter Profi → Max. Volumenstrom eintragen (mit 20 % Sicherheit).',
    ],
  }
}

/**
 * PA-Blade: senkrechte Klinge mit Zähnen; zehn Stufen à 4 mm mit steigendem
 * Pressure Advance (Klipper) bzw. K-Faktor (Marlin).
 */
function paBlade(flavor: GcodeFlavor, options?: CalibrationOptions): BuiltCalibration {
  const model = requiredModel('pressure-advance')
  const bands = model.bands ?? 0
  const levels = modelBandLevels(model)
  const bowden = options?.extruder === 'bowden'
  const from = clampNum(options?.paFrom ?? (bowden ? 0 : 0.02), 0, 2)
  const to = clampNum(options?.paTo ?? (bowden ? 0.18 : 0.11), from, 2)
  const step = clampNum(options?.paStep ?? (bowden ? 0.02 : 0.01), 0.001, 0.5)
  const values = valueRange(from, to, step, bands)
  requireBandValues(model, values, from, to, step, 'PA')

  const overrides: LayerOverride[] = []
  const steps: CalibrationStep[] = []
  values.forEach((pa, index) => {
    const z = levels[index]
    steps.push({ label: `Stufe ${index + 1} · ab z ${z} mm`, value: `PA ${pa.toFixed(3)}`, atZ: z })
    overrides.push({
      atZ: index === 0 ? 0 : bandSwitchZ(z),
      lines: [pressureAdvanceGcode(flavor, pa.toFixed(3)), `; Pressure Advance ${pa.toFixed(3)} (${model.modelName})`],
    })
  })

  return {
    stl: loadCalibrationModel('pressure-advance'),
    overrides,
    steps,
    patch: modelPatch({ zHop: 0.2 }),
    description: `${bowden ? 'Bowden' : 'Direct Drive'}: ${model.modelName} (${model.size.x} × ${model.size.z} mm) mit ${bands} Stufen à ${model.bandHeight} mm, PA von ${from.toFixed(3)} bis ${to.toFixed(3)} in ${step.toFixed(3)}-Schritten.`,
    howTo: [
      isKlipperFlavor(flavor)
        ? 'Klipper: Der Test schreibt SET_PRESSURE_ADVANCE je Stufe. Wirksam nur, wenn die Firmware den Befehl kennt.'
        : 'Der Test schreibt den passenden Pressure-Advance-Befehl je Stufe. Wirksam nur, wenn die Firmware ihn unterstützt.',
      'Auf Ecken und Kanten der Klinge achten: Überschuss = Wert zu hoch, Lücken = Wert zu niedrig.',
      'Die sauberste Stufe als PA-Wert übernehmen.',
    ],
  }
}

/**
 * Needle-Grid: Grundplatte mit fünf Nadeln. Der Retract steigt in fünf
 * Stufen à 7 mm; Fäden zwischen den Nadeln zeigen zu wenig Retract.
 */
function needleGrid(options?: CalibrationOptions): BuiltCalibration {
  const model = requiredModel('retract-tower')
  const bands = model.bands ?? 0
  const levels = modelBandLevels(model)
  const bowden = options?.extruder === 'bowden'
  const from = clampNum(options?.retractFrom ?? (bowden ? 1 : 0.2), 0, 20)
  const to = clampNum(options?.retractTo ?? (bowden ? 5 : 1), from, 20)
  const step = clampNum(options?.retractStep ?? (bowden ? 1 : 0.2), 0.05, 5)
  const values = valueRange(from, to, step, bands)
  requireBandValues(model, values, from, to, step, 'mm')

  // Die erste Stufe läuft ab der ersten Schicht mit dem Von-Wert; sonst
  // beginnt der Test unbemerkt mit der Retract-Distanz des Profils.
  const overrides: LayerOverride[] = [
    {
      atZ: 0,
      lines: [`; Retract ${from.toFixed(1)} mm`],
      settings: { retraction: { distance: from } } as DeepPartial<PrintSettings>,
    },
  ]
  const steps: CalibrationStep[] = []
  values.forEach((distance, index) => {
    const z = levels[index]
    steps.push({ label: `Stufe ${index + 1} · ab z ${z} mm`, value: `${distance.toFixed(1)} mm`, atZ: z })
    if (index > 0) {
      overrides.push({
        atZ: bandSwitchZ(z),
        lines: [`; Retract ${distance.toFixed(1)} mm`],
        settings: { retraction: { distance } } as DeepPartial<PrintSettings>,
      })
    }
  })

  return {
    stl: loadCalibrationModel('retract-tower'),
    overrides,
    steps,
    patch: modelPatch({ zHop: 0, retraction: { distance: from } as DeepPartial<PrintSettings>['retraction'] }),
    description: `${bowden ? 'Bowden' : 'Direct Drive'}: ${model.modelName} (${model.size.x} × ${model.size.y} × ${model.size.z} mm) mit ${bands} Stufen à ${model.bandHeight} mm, Retract von ${from.toFixed(2)} bis ${to.toFixed(2)} mm in ${step.toFixed(2)}-mm-Schritten.`,
    howTo: [
      'Gitter drucken und die Nadeln aus nächster Nähe ansehen.',
      'Die unterste Stufe ohne Fäden zwischen den Nadeln ist die richtige Retract-Distanz.',
      'Wert unter Profi → Retract eintragen.',
    ],
  }
}

/**
 * Resonance-Fin: dünne hohe Wand auf einer Grundplatte. Die Shaper-Frequenz
 * wechselt in fünf Stufen à 9 mm; Ringing wird als Wellenmuster sichtbar.
 */
function resonanceFin(
  printer: PrinterProfile,
  settings: PrintSettings,
  options?: CalibrationOptions,
): BuiltCalibration {
  const model = requiredModel('input-shaper')
  const bands = model.bands ?? 0
  const levels = modelBandLevels(model)
  const from = clampNum(options?.shaperFrom ?? 20, 5, 200)
  const to = clampNum(options?.shaperTo ?? 60, from, 200)
  const step = clampNum(options?.shaperStep ?? 10, 1, 50)
  const freqs = valueRange(from, to, step, bands)
  requireBandValues(model, freqs, from, to, step, 'Hz')
  const accel = Math.max(100, Math.min(printer.maxAccel, settings.accelerations?.print ?? 3000))
  const damping = Math.max(0.01, Math.min(1, settings.inputShaper?.damping ?? 0.1))

  const overrides: LayerOverride[] = []
  const steps: CalibrationStep[] = []
  freqs.forEach((freq, index) => {
    const z = levels[index]
    steps.push({ label: `Stufe ${index + 1} · ab z ${z} mm`, value: `${freq} Hz`, atZ: z })
    overrides.push({
      atZ: index === 0 ? 0 : bandSwitchZ(z),
      lines: [
        ...inputShaperGcode(printer.flavor, (value) => value.toFixed(3), freq, freq, damping, settings.inputShaper.method),
        `M204 S${accel}`,
        `; Input Shaper ${freq} Hz (${model.modelName})`,
      ],
    })
  })

  return {
    stl: loadCalibrationModel('input-shaper'),
    overrides,
    steps,
    patch: modelPatch({ zHop: 0.2 }),
    description: `${model.modelName} (${model.size.x} × ${model.size.y} × ${model.size.z} mm): dünne Wand mit ${bands} Stufen à ${model.bandHeight} mm, Input-Shaper-Frequenz von ${from} bis ${to} Hz in ${step}-Hz-Schritten.`,
    howTo: [
      isKlipperFlavor(printer.flavor)
        ? 'Klipper: Der Test setzt SET_INPUT_SHAPER je Stufe. Genauer ist SHAPER_CALIBRATE mit Beschleunigungssensor.'
        : 'Der Test setzt den passenden Input-Shaper-Befehl je Stufe. Das funktioniert nur, wenn die Firmware Input Shaping unterstützt.',
      'Nach dem Druck die Wand bei Streiflicht ansehen: Die Stufe mit den wenigsten Wellen ist die beste Frequenz.',
      'Frequenz im Tab Bewegung eintragen und Input Shaper einschalten.',
    ],
  }
}

/** Overhang-Array: Grundplatte mit frei stehenden Balken und Bögen. */
function overhangArray(): BuiltCalibration {
  const model = requiredModel('overhang')
  return {
    stl: loadCalibrationModel('overhang'),
    overrides: [],
    steps: [],
    // Stützen wären hier ein Messfehler: Der Test soll zeigen, was der Drucker
    // an Überhängen ohne Hilfe schafft.
    patch: modelPatch({ support: { kind: 'none' } }),
    description: `${model.modelName} (${model.size.x} × ${model.size.y} × ${model.size.z} mm): Grundplatte mit mehreren frei stehenden Balken und Bögen.`,
    howTo: [
      'Ohne Stützen drucken — genau darum geht es.',
      'Von unten nach oben vergleichen, ab welcher Neigung die Unterseite einbricht oder Fäden hängen.',
      'Bei Bedarf die Stützschwelle im Profil an das schlechteste noch saubere Teil anpassen.',
    ],
  }
}

/** Mech-Clutch: flache Leiste mit mehreren Kupplungsscheiben. */
function mechClutch(): BuiltCalibration {
  const model = requiredModel('fit-coupon')
  return {
    stl: loadCalibrationModel('fit-coupon'),
    overrides: [],
    steps: [],
    patch: modelPatch({ walls: 3, topLayers: 3, bottomLayers: 3, infillDensity: 20 }),
    description: `${model.modelName} (${model.size.x} × ${model.size.y} × ${model.size.z} mm): flache Grundleiste mit mehreren runden Kupplungsscheiben.`,
    howTo: [
      'Bauteil drucken und abkühlen lassen.',
      'Scheiben zusammensetzen: Sie müssen ohne Kraft greifen und dürfen nicht klappern.',
      'Gemessenes Spiel im Teilen-Dialog als Verbinder-Passung eintragen.',
    ],
  }
}

function flowCube(nozzle: number): BuiltCalibration {
  // Ein massiver Würfel mit offener Hülle: Der Slicer legt genau eine
  // Außenwand um den Umfang. Ein hohler 0,42-mm-Kasten erzeugte dagegen zwei
  // fast deckungsgleiche Linien (Außen- und Innenkontur) und förderte dadurch
  // etwa die doppelte Materialmenge — die gemessene Wand war dann zu dick.
  // Bei 0,42 mm Planungsbreite kollabierte der hohle Kasten sogar ganz.
  const wall = flowCubeWallWidth(nozzle)
  return {
    tris: box(30, 15, 30),
    // Ein am Drucker verbliebener Flussfaktor (M221) würde die Messung
    // unbrauchbar machen: Bei 24 % entsteht aus der 0,42-mm-Wand eine
    // 0,1-mm-Wand, obwohl der G-code korrekt ist. Der Test startet deshalb
    // mit einem definierten Flussfaktor von 100 %.
    overrides: [{ atZ: 0, lines: ['M221 S100 ; Flussfaktor für den Flowtest auf 100 %'] }] as LayerOverride[],
    steps: [] as CalibrationStep[],
    patch: {
      layerHeight: 0.2,
      firstLayerHeight: 0.2,
      lineWidth: wall,
      firstLayerLineWidth: wall,
      outerWallLineWidth: wall,
      innerWallLineWidth: wall,
      topSurfaceLineWidth: wall,
      walls: 1,
      // Kein Boden und kein Deckel: Sonst entsteht die massive Fläche aus dem
      // Foto, und die Wandstärke ist nicht mehr die einzige Messgröße.
      topLayers: 0,
      bottomLayers: 0,
      infillDensity: 0,
      ironing: { enabled: false },
      // Haftung ohne massive Bodenfläche: Der Brim liegt außen um die Wand.
      adhesion: 'brim',
      brim: { type: 'outer_only', width: 4, gap: 0.1, flow: 1 },
      zHop: 0.2,
      // Der Flowtest misst die Wand, nicht die Maßhaltigkeit des Alltagsprofils.
      // Eine aktive Schrumpfkompensation (z. B. 2,04 %) würde den 30-mm-Würfel
      // auf 30,6 × 30,6 × 15,3 mm aufblasen und am Deckel eine dünne Restlage
      // erzeugen; der Test soll aber exakt 30 × 30 × 15 mm und 75 Schichten haben.
      shrinkage: { x: 0, y: 0, z: 0 },
      special: { vase: false, openShell: true },
    } as DeepPartial<PrintSettings>,
    description:
      '30-mm-Würfel mit genau einer Außenwand, ohne Deckel, Boden und Füllung. Die Wandstärke wird gemessen und daraus der Fluss berechnet.',
    howTo: [
      'Würfel drucken und abkühlen lassen.',
      'Wandstärke an allen vier Seiten mit dem Messschieber messen und mitteln.',
      'Messwert im Fluss-Rechner eintragen — der neue Fluss wird sofort berechnet.',
    ],
  }
}

function pressureAdvanceLine(printer: PrinterProfile, options?: CalibrationOptions): BuiltCalibration {
  // Große Linienplatte über die verfügbare Bettbreite. Die PA-Rampe läuft auf
  // allen Bahnen von links nach rechts; 220 × 24 mm statt des früheren
  // 80-mm-Minirahmens. Direct Drive und Bowden haben getrennte Bereiche.
  const bowden = options?.extruder === 'bowden'
  const from = clampNum(options?.paFrom ?? 0, 0, 2)
  const to = clampNum(options?.paTo ?? (bowden ? 1 : 0.1), from, 2)
  const step = clampNum(options?.paStep ?? (bowden ? 0.02 : 0.01), 0.001, 0.5)
  const values = valueRange(from, to, step, 60)
  const width = Math.max(120, Math.min(220, Math.floor(printer.bed.x - 20)))
  const depth = 24
  const layers = 3
  const height = layers * 0.2
  const startX = printer.bed.x / 2 - width / 2
  const endX = printer.bed.x / 2 + width / 2

  return {
    tris: box(width, height, depth, 0, 0, 0),
    overrides: [],
    steps: values.map((value, index) => ({
      label: `Messpunkt ${index + 1}`,
      value: `PA ${value.toFixed(3)}`,
      atZ: 0,
    })),
    patch: {
      layerHeight: 0.2,
      firstLayerHeight: 0.2,
      walls: 1,
      topLayers: 1,
      bottomLayers: 1,
      infillDensity: 0,
      ironing: { enabled: false },
      adhesion: 'skirt',
      zHop: 0.2,
      pressureAdvanceRamp: {
        enabled: true,
        from,
        to,
        startX,
        endX,
      },
    } as DeepPartial<PrintSettings>,
    description: `Pressure-Advance-Linientest (${bowden ? 'Bowden' : 'Direct Drive'}): ${width} × ${depth} mm große Platte, PA steigt von ${from.toFixed(3)} bis ${to.toFixed(3)}. Die gleichmäßigste Stelle gewinnt.`,
    howTo: [
      'Die große Platte drucken und die langen Bahnen von links nach rechts vergleichen.',
      'Links (niedriger PA): Lücken oder dünne Ecken. Rechts (hoher PA): Verdickungen, Wülste oder überschüssiges Material an den Ecken.',
      'Den gleichmäßigsten Bereich wählen und den Wert im Tab Bewegung bei Pressure Advance eintragen — dort einschalten, damit er im G-Code bleibt.',
      isKlipperFlavor(printer.flavor)
        ? 'Ausgabe: SET_PRESSURE_ADVANCE ADVANCE=… entlang der Bahn.'
        : `Ausgabe: ${pressureAdvanceGcode(printer.flavor, '…')} entlang der Bahn.`,
    ],
  }
}

/** VFA-/Geschwindigkeitsturm: Die Geschwindigkeit steigt pro 8-mm-Segment. */
function vfaTower(printer: PrinterProfile, settings: PrintSettings, options?: CalibrationOptions): BuiltCalibration {
  const from = clampNum(options?.speedFrom ?? 40, 10, printer.maxPrintSpeed)
  const to = clampNum(options?.speedTo ?? Math.min(printer.maxPrintSpeed, 120), from, printer.maxPrintSpeed)
  const step = clampNum(options?.speedStep ?? 20, 1, 100)
  const speeds = valueRange(from, to, step, 20)
  const seg = 8
  const height = seg * speeds.length
  const tris: Tri[] = [
    ...box(44, 3, 14, 0, 0, 0),
    // Schlanker Turm mit geraden Wänden: VFA-Rippel werden sichtbar.
    ...box(20, height, 14, 0, 0, 3),
  ]
  const overrides: LayerOverride[] = []
  const steps: CalibrationStep[] = []

  speeds.forEach((speed, i) => {
    const z = 3 + i * seg
    steps.push({
      label: `Segment ${i + 1}`,
      value: `${Math.round(speed)} mm/s`,
      atZ: z,
      expectedSpeed: speed,
    })
    overrides.push({
      atZ: z,
      lines: [`; Geschwindigkeit ${Math.round(speed)} mm/s`],
      settings: {
        speeds: {
          print: speed,
          outerWall: speed,
          innerWall: speed,
          solid: speed,
          travel: Math.min(printer.maxTravel, Math.max(speed, 150)),
        },
      },
    })
  })

  return {
    tris,
    overrides,
    steps,
    patch: {
      layerHeight: 0.2,
      walls: 2,
      topLayers: 3,
      bottomLayers: 2,
      infillDensity: 10,
      ironing: { enabled: false },
      zHop: 0.2,
      adhesion: 'skirt',
      speeds: { print: from, outerWall: from, innerWall: from, solid: from },
    } as DeepPartial<PrintSettings>,
    description: `VFA-/Geschwindigkeitsturm: ${from} bis ${to} mm/s in ${step}-mm/s-Schritten. Die ruhigste Stufe ohne Rippel gewinnt.`,
    howTo: [
      'Turm drucken; jede 8-mm-Stufe läuft mit einer anderen Geschwindigkeit.',
      'Die Wände bei Streiflicht vergleichen: feine vertikale Rippel zeigen VFA. Die schnellste saubere Stufe ist dein Richtwert.',
      'Wert als normale Druckgeschwindigkeit übernehmen; VFA ist kein Ersatz für Input Shaper.',
    ],
  }
}

function firstLayer(): BuiltCalibration {
  const positions: [number, number][] = [
    [0, 0],
    [-42, 0],
    [42, 0],
    [0, -42],
    [0, 42],
  ]
  return {
    tris: positions.flatMap(([x, y]) => box(20, 0.24, 20, x, y, 0)),
    overrides: [],
    steps: positions.map(([x, y], i) => ({ label: `Feld ${i + 1}`, value: `x ${x} / y ${y}`, atZ: 0 })),
    patch: {
      layerHeight: 0.24,
      firstLayerHeight: 0.24,
      walls: 2,
      topLayers: 1,
      bottomLayers: 1,
      infillDensity: 0,
      ironing: { enabled: false },
      adhesion: 'none',
    } as DeepPartial<PrintSettings>,
    description:
      'Fünf flache Felder über das ganze Bett. Damit siehst du sofort, ob die erste Schicht trägt oder zu dünn ist.',
    howTo: [
      'Druck starten und die Felder beobachten.',
      'Zu dünn/transparent? Im Drucker-Tab mit Babystep +0,01 mm nach oben korrigieren.',
      'Zu dick (Rillen)? Babystep in kleinen Schritten nach unten.',
    ],
  }
}

const META: Record<string, { label: string; requires: CalibrationTool['requires'] }> = {
  'flow-cube': { label: 'Fluss (einwandiger Würfel)', requires: 'any' },
  'temp-tower': { label: 'Temperatur (Thermal-Cell)', requires: 'any' },
  'retract-tower': { label: 'Retract / Fäden (Needle-Grid)', requires: 'any' },
  'max-flow': { label: 'Maximaler Volumenstrom (Max-Flow-Core)', requires: 'any' },
  'pressure-advance': { label: 'Pressure Advance (PA-Blade)', requires: 'any' },
  'pressure-advance-line': { label: 'Pressure Advance Linientest', requires: 'any' },
  'input-shaper': { label: 'Resonanz / Input Shaper (Resonance-Fin)', requires: 'any' },
  vfa: { label: 'VFA / Geschwindigkeitsturm', requires: 'any' },
  'first-layer': { label: 'Erste Schicht / Z-Offset', requires: 'any' },
  'fit-coupon': { label: 'Passung (Mech-Clutch)', requires: 'any' },
  overhang: { label: 'Überhänge (Overhang-Array)', requires: 'any' },
}

export function buildCalibration(
  id: string,
  printer: PrinterProfile,
  filament: FilamentProfile,
  settings: PrintSettings,
  options?: CalibrationOptions,
): CalibrationBundle | null {
  const meta = META[id]
  if (!meta) return null

  let built: BuiltCalibration

  switch (id) {
    case 'temp-tower':
      built = thermalCell(printer, filament, options)
      break
    case 'retract-tower':
      built = needleGrid(options)
      break
    case 'max-flow':
      built = maxFlowCore(settings, options)
      break
    case 'pressure-advance':
      built = paBlade(printer.flavor, options)
      break
    case 'pressure-advance-line':
      built = pressureAdvanceLine(printer, options)
      break
    case 'input-shaper':
      built = resonanceFin(printer, settings, options)
      break
    case 'vfa':
      built = vfaTower(printer, settings, options)
      break
    case 'first-layer':
      built = firstLayer()
      break
    case 'fit-coupon':
      built = mechClutch()
      break
    case 'overhang':
      built = overhangArray()
      break
    case 'flow-cube':
    default:
      built = flowCube(settings.nozzle)
  }

  const stl = built.stl ?? buildBinarySTL(built.tris ?? [])
  const height = built.tris ? modelHeight(built.tris) : parseSTL(stl).bbox.size.z
  const testLayerHeight = Math.max(0.01, built.patch.layerHeight ?? settings.layerHeight)
  const plannedLayers = Math.max(1, Math.round(height / testLayerHeight))
  return {
    tool: {
      id,
      label: meta.label,
      description: built.description,
      howTo: built.howTo,
      requires: meta.requires,
      steps: built.steps,
      plannedLayers,
      settingsPatch: built.patch,
    },
    stl,
    overrides: built.overrides,
  }
}
