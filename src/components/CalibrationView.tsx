import { useState } from 'react'
import type { CalibrationExtruder, CalibrationOptions, CalibrationTool, PrintSettings } from '../../shared/types.ts'
import { flowCubeWallWidth, summarizeFlowMeasurements } from '../../shared/calibration.ts'
import type { Catalog } from '../api.ts'
import type { Setup } from '../setup.ts'
import { Chip, Panel } from './ui.tsx'
import { CalibrationLoopPanel } from './CalibrationLoopPanel.tsx'

function flowNumber(value: number | null, digits = 3): string {
  return value === null || !Number.isFinite(value) ? '—' : value.toFixed(digits).replace('.', ',')
}

/** Messwerte, die nach einem Kalibriertest in ein Filamentprofil wandern. */
export type CalibrationProfilePatch = {
  nozzleTemp?: number
  flow?: number
  maxVolumetricFlow?: number
  pressureAdvance?: number
}

export type CalibrationSaveResult =
  | { ok: true; profileName: string }
  | { ok: false; error: string }

type Props = {
  catalog: Catalog
  setup: Setup
  settings: PrintSettings
  busy: boolean
  activeProfileName: string
  activeProfileEditable: boolean
  versionNameSuggestion: string
  onGenerate: (toolId: string, options?: CalibrationOptions) => void
  onFlowChange: (flow: number) => void
  /** Ergebnis direkt in die Bewegungseinstellungen übernehmen */
  onApplyPressureAdvance: (value: number) => void
  /** V-18: Korrekturen aus Messwerten als komplettes Profil übernehmen. */
  onApplySettings?: (next: PrintSettings) => void
  onApplyInputShaper: (freqX: number, freqY: number) => void
  onSaveCalibration: (
    patch: CalibrationProfilePatch,
    mode: 'active' | 'new',
    name?: string,
  ) => CalibrationSaveResult
}

const TOOLS: { id: string; label: string; tag: string; text: string; needs?: string }[] = [
  {
    id: 'flow-cube',
    label: 'Fluss',
    tag: 'Pflicht zuerst',
    text: '30-mm-Würfel mit genau einer Außenwand, ohne Boden, Deckel und Füllung. Wandstärke messen, Fluss daraus berechnen — die Grundlage für alle Maßhaltigkeit.',
  },
  {
    id: 'temp-tower',
    label: 'Temperatur',
    tag: 'Thermal-Cell',
    text: 'Thermal-Cell mit sechs Kammern à 8 mm. Von/Bis/Schritt der Temperaturen sind frei; die sechs Kammern sind fest im Modell.',
  },
  {
    id: 'max-flow',
    label: 'Volumenstrom',
    tag: 'Max-Flow-Core',
    text: 'Max-Flow-Core: sieben Bänder à 5 mm, Von/Bis/Schritt in mm³/s frei. Die Geschwindigkeit folgt aus Volumenstrom, Düse und Schichthöhe.',
  },
  {
    id: 'pressure-advance',
    label: 'Pressure Advance',
    tag: 'PA-Blade',
    text: 'PA-Blade mit zehn Stufen à 4 mm. Klipper schreibt SET_PRESSURE_ADVANCE, Marlin M900; Von/Bis/Schritt und Extruder sind frei.',
  },
  {
    id: 'retract-tower',
    label: 'Retract',
    tag: 'Needle-Grid',
    text: 'Needle-Grid mit fünf Nadeln; der Retract steigt in fünf Stufen à 7 mm. Fäden zwischen den Nadeln zeigen zu wenig Retract.',
  },
  {
    id: 'overhang',
    label: 'Überhänge',
    tag: 'Overhang-Array',
    text: 'Grundplatte mit frei stehenden Balken und Bögen — ohne Stützen gedruckt. Zeigt, ab welcher Neigung der Drucker sauber bleibt.',
  },
  {
    id: 'input-shaper',
    label: 'Resonanz',
    tag: 'Resonance-Fin',
    text: 'Dünne hohe Wand; die Shaper-Frequenz wechselt in fünf Stufen à 9 mm. Das ruhigste Segment gewinnt; mit Beschleunigungssensor ist SHAPER_CALIBRATE genauer.',
  },
  {
    id: 'fit-coupon',
    label: 'Passung',
    tag: 'Mech-Clutch',
    text: 'Flache Leiste mit mehreren Kupplungsscheiben. Zeigt Passung und Spiel der Verbinder ohne Schätzen.',
  },
  {
    id: 'first-layer',
    label: 'Erste Schicht',
    tag: 'Z-Offset',
    text: 'Fünf flache Felder über das Bett. Zeigt sofort, ob die Düse zu tief oder zu hoch steht.',
  },
  {
    id: 'pressure-advance-line',
    label: 'PA-Linientest',
    tag: 'Linie statt Turm',
    text: 'Große Linienplatte über die Bettbreite, PA steigt von links nach rechts. Direct Drive oder Bowden, Von/Bis und Schrittweite sind einstellbar.',
  },
  {
    id: 'vfa',
    label: 'VFA / Tempo',
    tag: 'Geschwindigkeit',
    text: 'Turm mit automatisch steigender Geschwindigkeit. Die ruhigste Stufe ohne feine vertikale Rippel ist dein Tempo-Richtwert.',
  },
]

type RangeConfig = {
  title: string
  unit: string
  fromLabel: string
  toLabel: string
  stepLabel: string
  min: number
  max: number
  decimals: number
  /** PA-Linien brauchen feinere Raster als die kleinen Türme. */
  maxSteps?: number
  /** Feste Stufenzahl des STL-Modells; Von/Bis/Schritt müssen genau sie ergeben. */
  stages?: number
  extruder?: boolean
  note: string
  defaults: (bowden: boolean) => { from: number; to: number; step: number }
}

/** Bereiche und Voreinstellungen für alle Tests, die einen Werte-Sweep drucken. */
const RANGE_TOOLS: Record<string, RangeConfig> = {
  'retract-tower': {
    title: 'Retract-Test einstellen',
    unit: 'mm',
    fromLabel: 'Von mm',
    toLabel: 'Bis mm',
    stepLabel: 'Schritt mm',
    min: 0,
    max: 20,
    decimals: 2,
    stages: 5,
    extruder: true,
    note: 'Needle-Grid: fünf Stufen à 7 mm sind fest — Von/Bis/Schritt müssen genau fünf Werte ergeben.',
    defaults: (bowden) => (bowden ? { from: 1, to: 5, step: 1 } : { from: 0.2, to: 1.0, step: 0.2 }),
  },
  'max-flow': {
    title: 'Volumenstrom-Test einstellen',
    unit: 'mm³/s',
    fromLabel: 'Von mm³/s',
    toLabel: 'Bis mm³/s',
    stepLabel: 'Schritt mm³/s',
    min: 0.5,
    max: 100,
    decimals: 1,
    stages: 7,
    note: 'Max-Flow-Core: sieben Bänder à 5 mm sind fest. Die Geschwindigkeit folgt aus Volumenstrom, Linienbreite und Schichthöhe.',
    defaults: () => ({ from: 4, to: 16, step: 2 }),
  },
  'pressure-advance': {
    title: 'Pressure-Advance-Test einstellen',
    unit: 'PA',
    fromLabel: 'PA von',
    toLabel: 'PA bis',
    stepLabel: 'PA-Schritt',
    min: 0,
    max: 2,
    decimals: 3,
    stages: 10,
    extruder: true,
    note: 'PA-Blade: zehn Stufen à 4 mm sind fest. Direct Drive und Bowden brauchen getrennte Bereiche.',
    defaults: (bowden) => (bowden ? { from: 0, to: 0.18, step: 0.02 } : { from: 0.02, to: 0.11, step: 0.01 }),
  },
  'pressure-advance-line': {
    title: 'PA-Linientest einstellen',
    unit: 'PA',
    fromLabel: 'PA von',
    toLabel: 'PA bis',
    stepLabel: 'PA-Schritt',
    min: 0,
    max: 2,
    decimals: 3,
    maxSteps: 60,
    extruder: true,
    note: 'Die Platte nutzt die volle Bettbreite (bis 220 mm) und ist 24 mm tief — deutlich größer als der alte Mini-Rahmen.',
    defaults: (bowden) => (bowden ? { from: 0, to: 1, step: 0.02 } : { from: 0, to: 0.1, step: 0.01 }),
  },
  'input-shaper': {
    title: 'Resonanz-Test einstellen',
    unit: 'Hz',
    fromLabel: 'Von Hz',
    toLabel: 'Bis Hz',
    stepLabel: 'Schritt Hz',
    min: 5,
    max: 200,
    decimals: 0,
    stages: 5,
    note: 'Resonance-Fin: fünf Stufen à 9 mm sind fest; die Beschleunigung bleibt am oberen sinnvollen Wert.',
    defaults: () => ({ from: 20, to: 60, step: 10 }),
  },
  vfa: {
    title: 'VFA-/Tempo-Turm einstellen',
    unit: 'mm/s',
    fromLabel: 'Von mm/s',
    toLabel: 'Bis mm/s',
    stepLabel: 'Schritt mm/s',
    min: 10,
    max: 300,
    decimals: 0,
    note: 'Die Geschwindigkeit steigt automatisch pro 8-mm-Stufe; PA und Beschleunigung bleiben unverändert.',
    defaults: () => ({ from: 40, to: 100, step: 20 }),
  },
}

const MODEL_SOURCES: { tool: string; name: string; source: string; url: string; license: string }[] = [
  { tool: 'Fluss', name: 'Improved Flow Rate Calibration', source: 'Printables', url: 'https://www.printables.com/model/538734-improved-flow-rate-calibration', license: 'CC0' },
  { tool: 'Temperatur', name: 'Temp Tower + Explanations', source: 'Printables', url: 'https://www.printables.com/model/274675-temp-tower-explanations', license: 'CC0' },
  { tool: 'Max-Flow', name: 'HexCalibr Max Volumetric Flow Test', source: 'Printables', url: 'https://www.printables.com/model/1870791-max-volumetric-flow-test-for-prusaslicer-hotend-fl', license: 'CC BY-SA 4.0' },
  { tool: 'Pressure Advance', name: 'HexCalibr Pressure Advance Test', source: 'Printables', url: 'https://www.printables.com/model/1870778-pressure-advance-test-for-prusaslicer-klipper-prus', license: 'CC BY-SA 4.0' },
  { tool: 'Retract', name: 'Ultimate string/retraction test', source: 'MakerWorld', url: 'https://makerworld.com/en/models/177153-ultimate-string-retraction-test', license: 'Public Domain' },
  { tool: 'Erste Schicht', name: 'First Layer / Z-Offset Test', source: 'Printables', url: 'https://www.printables.com/model/1871141-first-layer-z-offset-test-for-prusaslicer-live-hex', license: 'CC BY-SA 4.0' },
  { tool: 'Ringing/VFA', name: 'Quick Ringing/VFA/Ghosting Test', source: 'MakerWorld', url: 'https://makerworld.com/en/models/450864-quick-ringing-vfa-ghosting-test', license: 'CC BY-NC-SA 4.0' },
]

export function CalibrationView({
  catalog,
  setup,
  settings,
  busy,
  activeProfileName,
  activeProfileEditable,
  versionNameSuggestion,
  onGenerate,
  onFlowChange,
  onApplyPressureAdvance,
  onApplyInputShaper,
  onSaveCalibration,
  onApplySettings,
}: Props) {
  const printer = catalog.printers.find((p) => p.id === setup.printerId)
  const isKlipper = printer?.control === 'klipper-moonraker'
  const [wallMeasurements, setWallMeasurements] = useState<string[]>(['', '', '', ''])
  const [pa, setPa] = useState(settings.pressureAdvance.value.toFixed(3))
  const [freqX, setFreqX] = useState(String(settings.inputShaper.freqX))
  const [freqY, setFreqY] = useState(String(settings.inputShaper.freqY))
  const [profileTemp, setProfileTemp] = useState('')
  const [profileFlow, setProfileFlow] = useState('')
  const [profileMaxFlow, setProfileMaxFlow] = useState('')
  const [profilePa, setProfilePa] = useState('')
  const [versionName, setVersionName] = useState('')
  const [profileNotice, setProfileNotice] = useState('')
  const [profileError, setProfileError] = useState('')
  const [tempOpen, setTempOpen] = useState(false)
  const [tempFrom, setTempFrom] = useState(String(Math.round(settings.temps.nozzle)))
  const [tempTo, setTempTo] = useState(String(Math.max(150, Math.round(settings.temps.nozzle) - 25)))
  const [tempStep, setTempStep] = useState('5')
  const [tempError, setTempError] = useState('')
  const [rangeTool, setRangeTool] = useState<string | null>(null)
  const [rangeExtruder, setRangeExtruder] = useState<CalibrationExtruder>('direct')
  const [rangeFrom, setRangeFrom] = useState('')
  const [rangeTo, setRangeTo] = useState('')
  const [rangeStep, setRangeStep] = useState('')
  const [rangeError, setRangeError] = useState('')
  const rangeConfig = rangeTool ? RANGE_TOOLS[rangeTool] : null

  const flowTargetWidth = flowCubeWallWidth(settings.nozzle)
  const wallValues = wallMeasurements
    .map((value) => parseFloat(value.replace(',', '.')))
    .filter((value) => Number.isFinite(value) && value > 0)
  const flowSummary = summarizeFlowMeasurements(wallValues, settings.flow, flowTargetWidth)
  const newFlow = flowSummary.count === 4 ? flowSummary.flow : null
  // Ein 0,1-mm-Wert ist bei einer 0,42-mm-Testwand fast immer der Brimspalt
  // oder eine stark unterextrudierende Düse, keine Wandstärke. Nicht still als
  // Messwert übernehmen, sondern die Messstelle und den Druckerfluss prüfen.
  const flowMeasurementImplausible =
    flowSummary.mean !== null && flowSummary.mean < flowTargetWidth * 0.5

  const tempFromNum = Number(tempFrom.replace(',', '.'))
  const tempToNum = Number(tempTo.replace(',', '.'))
  const tempStepNum = Number(tempStep.replace(',', '.'))
  const maxNozzleTemp = printer?.maxNozzleTemp ?? 300
  const bedZ = printer?.bed.z ?? 250
  const tempRangeValid =
    Number.isFinite(tempFromNum) &&
    Number.isFinite(tempToNum) &&
    Number.isFinite(tempStepNum) &&
    Number.isInteger(tempFromNum) &&
    Number.isInteger(tempToNum) &&
    Number.isInteger(tempStepNum) &&
    tempFromNum > tempToNum &&
    tempToNum >= 150 &&
    tempStepNum >= 1 &&
    tempStepNum <= 50
  const tempDivisible =
    tempRangeValid &&
    Math.abs((tempFromNum - tempToNum) / tempStepNum - Math.round((tempFromNum - tempToNum) / tempStepNum)) < 1e-9
  const tempCount = tempRangeValid ? Math.floor((tempFromNum - tempToNum) / tempStepNum) + 1 : 0
  const tempValues =
    tempCount > 0 && tempCount <= 20
      ? Array.from({ length: tempCount }, (_, i) => Math.round(tempFromNum - i * tempStepNum))
      : []
  // Thermal-Cell: sechs Kammern à 8 mm, Schichthöhe 0,20 mm vorgegeben.
  const TEMP_BANDS = 6
  const tempModelHeight = 48
  const tempCanBuild =
    tempRangeValid &&
    tempFromNum <= maxNozzleTemp &&
    tempDivisible &&
    tempCount === TEMP_BANDS &&
    tempModelHeight <= bedZ - 5

  const rangeFromNum = Number(rangeFrom.replace(',', '.'))
  const rangeToNum = Number(rangeTo.replace(',', '.'))
  const rangeStepNum = Number(rangeStep.replace(',', '.'))
  const rangeCount =
    Number.isFinite(rangeFromNum) && Number.isFinite(rangeToNum) && Number.isFinite(rangeStepNum) && rangeStepNum > 0
      ? Math.floor((rangeToNum - rangeFromNum) / rangeStepNum + 1e-9) + 1
      : 0
  const rangeValues =
    rangeCount > 0 && rangeCount <= (rangeConfig?.maxSteps ?? 20) && rangeConfig
      ? Array.from({ length: rangeCount }, (_, i) => rangeFromNum + i * rangeStepNum)
      : []
  const rangeCanBuild =
    Boolean(rangeConfig) &&
    Number.isFinite(rangeFromNum) &&
    Number.isFinite(rangeToNum) &&
    Number.isFinite(rangeStepNum) &&
    rangeFromNum >= (rangeConfig?.min ?? 0) &&
    rangeToNum <= (rangeConfig?.max ?? 1000) &&
    rangeStepNum > 0 &&
    rangeToNum > rangeFromNum &&
    rangeCount >= 2 &&
    rangeCount <= (rangeConfig?.maxSteps ?? 20) &&
    (rangeConfig?.stages === undefined || rangeCount === rangeConfig.stages)

  const parseProfileNumber = (value: string): number | null => {
    const trimmed = value.trim()
    if (!trimmed) return null
    const parsed = Number(trimmed.replace(',', '.'))
    return Number.isFinite(parsed) ? parsed : Number.NaN
  }

  const profileTempNum = parseProfileNumber(profileTemp)
  const profileFlowNum = parseProfileNumber(profileFlow)
  const profileMaxFlowNum = parseProfileNumber(profileMaxFlow)
  const profilePaNum = parseProfileNumber(profilePa)
  const profileTempInvalid =
    profileTempNum !== null &&
    (!Number.isFinite(profileTempNum) ||
      !Number.isInteger(profileTempNum) ||
      profileTempNum < 150 ||
      profileTempNum > maxNozzleTemp)
  const profileFlowInvalid =
    profileFlowNum !== null && (!Number.isFinite(profileFlowNum) || profileFlowNum <= 0 || profileFlowNum > 3)
  const profileMaxFlowInvalid =
    profileMaxFlowNum !== null &&
    (!Number.isFinite(profileMaxFlowNum) || profileMaxFlowNum < 0 || profileMaxFlowNum > 200)
  const profilePaInvalid =
    profilePaNum !== null && (!Number.isFinite(profilePaNum) || profilePaNum < 0 || profilePaNum > 2)
  const profileInputError = profileTempInvalid
    ? `Düse: ganze Zahl zwischen 150 und ${maxNozzleTemp} °C.`
    : profileFlowInvalid
      ? 'Fluss: Wert zwischen 0,01 und 3,00 ×.'
      : profileMaxFlowInvalid
        ? 'Max. Volumenstrom: Wert zwischen 0 und 200 mm³/s (0 = unbegrenzt).'
        : profilePaInvalid
          ? 'PA / K-Faktor: Wert zwischen 0 und 2.'
          : ''

  const profilePatch: CalibrationProfilePatch = {}
  if (profileTempNum !== null && !profileTempInvalid) profilePatch.nozzleTemp = Math.round(profileTempNum)
  if (profileFlowNum !== null && !profileFlowInvalid) profilePatch.flow = profileFlowNum
  if (profileMaxFlowNum !== null && !profileMaxFlowInvalid) profilePatch.maxVolumetricFlow = profileMaxFlowNum
  if (profilePaNum !== null && !profilePaInvalid) profilePatch.pressureAdvance = profilePaNum
  const profileCanSave = !busy && !profileInputError && Object.keys(profilePatch).length > 0

  const fillProfileValues = () => {
    setProfileTemp(String(Math.round(settings.temps.nozzle)))
    setProfileFlow(newFlow !== null ? newFlow.toFixed(3) : settings.flow.toFixed(3))
    setProfileMaxFlow(settings.maxVolumetricFlow.toFixed(1))
    setProfilePa(
      Number.isFinite(parseFloat(pa.replace(',', '.'))) ? pa : settings.pressureAdvance.value.toFixed(3),
    )
    setProfileNotice('')
    setProfileError('')
  }

  const saveProfile = (mode: 'active' | 'new') => {
    setProfileNotice('')
    setProfileError('')
    if (mode === 'active' && !activeProfileEditable) {
      setProfileError('Das aktive Profil ist ein Katalogprofil. Speichere die Messwerte als neue Version.')
      return
    }
    if (profileInputError) {
      setProfileError(profileInputError)
      return
    }
    if (!Object.keys(profilePatch).length) {
      setProfileError('Bitte mindestens einen Messwert eintragen.')
      return
    }
    const result = onSaveCalibration(profilePatch, mode, versionName.trim() || undefined)
    if (!result.ok) {
      setProfileError(result.error)
      return
    }
    setProfileNotice(
      mode === 'active'
        ? `Messwerte in „${result.profileName}“ übernommen.`
        : `Als neue Version „${result.profileName}“ gespeichert und aktiviert.`,
    )
    if (mode === 'new') setVersionName('')
  }

  const openRangeDialog = (tool: string) => {
    const config = RANGE_TOOLS[tool]
    if (!config) return
    const defaults = config.defaults(false)
    if (tool === 'vfa' && printer) defaults.to = Math.min(defaults.to, printer.maxPrintSpeed)
    setRangeTool(tool)
    setRangeExtruder('direct')
    setRangeFrom(String(defaults.from))
    setRangeTo(String(defaults.to))
    setRangeStep(String(defaults.step))
    setRangeError('')
  }

  const changeRangeExtruder = (extruder: CalibrationExtruder) => {
    if (!rangeConfig) return
    const defaults = rangeConfig.defaults(extruder === 'bowden')
    if (rangeTool === 'vfa' && printer) defaults.to = Math.min(defaults.to, printer.maxPrintSpeed)
    setRangeExtruder(extruder)
    setRangeFrom(String(defaults.from))
    setRangeTo(String(defaults.to))
    setRangeStep(String(defaults.step))
    setRangeError('')
  }

  const submitRange = () => {
    if (!rangeTool || !rangeConfig || !rangeCanBuild) {
      setRangeError(
        !rangeConfig
          ? 'Unbekannter Test.'
          : rangeToNum <= rangeFromNum
            ? 'Bis muss größer als Von sein.'
            : rangeCount > (rangeConfig.maxSteps ?? 20)
              ? `Bitte höchstens ${rangeConfig.maxSteps ?? 20} Stufen wählen.`
              : rangeConfig.stages !== undefined && rangeCount !== rangeConfig.stages
                ? `Das Modell hat genau ${rangeConfig.stages} Stufen; gewählt sind ${rangeCount}. Bitte Von/Bis/Schritt anpassen.`
                : `Bitte Werte zwischen ${rangeConfig.min} und ${rangeConfig.max} ${rangeConfig.unit} eingeben.`,
      )
      return
    }
    const options: CalibrationOptions = { extruder: rangeExtruder }
    if (rangeTool === 'retract-tower') {
      options.retractFrom = rangeFromNum
      options.retractTo = rangeToNum
      options.retractStep = rangeStepNum
    } else if (rangeTool === 'max-flow') {
      options.flowFrom = rangeFromNum
      options.flowTo = rangeToNum
      options.flowStep = rangeStepNum
    } else if (rangeTool === 'pressure-advance' || rangeTool === 'pressure-advance-line') {
      options.paFrom = rangeFromNum
      options.paTo = rangeToNum
      options.paStep = rangeStepNum
    } else if (rangeTool === 'input-shaper') {
      options.shaperFrom = rangeFromNum
      options.shaperTo = rangeToNum
      options.shaperStep = rangeStepNum
    } else if (rangeTool === 'vfa') {
      options.speedFrom = rangeFromNum
      options.speedTo = rangeToNum
      options.speedStep = rangeStepNum
    }
    onGenerate(rangeTool, options)
    setRangeTool(null)
  }

  const openTempDialog = () => {
    const from = Math.round(settings.temps.nozzle)
    setTempFrom(String(from))
    // Sechs Kammern à 5 °C: Von minus fünf Schritte.
    setTempTo(String(Math.max(150, from - 25)))
    setTempStep('5')
    setTempError('')
    setTempOpen(true)
  }

  const submitTempTower = () => {
    if (!tempCanBuild) {
      const message = !Number.isFinite(tempFromNum) || !Number.isFinite(tempToNum) || !Number.isFinite(tempStepNum)
        ? 'Bitte alle Werte ausfüllen.'
        : tempFromNum > maxNozzleTemp
          ? `Von darf höchstens ${maxNozzleTemp} °C sein.`
          : tempToNum < 150
            ? 'Bis muss mindestens 150 °C sein.'
            : tempFromNum <= tempToNum
              ? 'Von muss größer als Bis sein.'
              : !Number.isInteger(tempFromNum) || !Number.isInteger(tempToNum)
                ? 'Bitte ganze Temperaturen eingeben.'
                : !Number.isInteger(tempStepNum) || tempStepNum < 1 || tempStepNum > 50
                  ? 'Schritt: 1 bis 50 °C.'
                  : !tempDivisible
                    ? 'Bis muss im gewählten Schritt unter Von liegen.'
                    : tempCount !== TEMP_BANDS
                      ? `Die Thermal-Cell hat ${TEMP_BANDS} Kammern; gewählt sind ${tempCount}. Bitte Von/Bis/Schritt auf ${TEMP_BANDS} Werte einstellen.`
                      : tempModelHeight > bedZ - 5
                        ? `Die Thermal-Cell ist ${tempModelHeight} mm hoch; verfügbar sind ${(bedZ - 5).toFixed(0)} mm.`
                        : 'Bitte die Werte prüfen.'
      setTempError(message)
      return
    }
    onGenerate('temp-tower', {
      tempFrom: Math.round(tempFromNum),
      tempTo: Math.round(tempToNum),
      tempStep: Math.round(tempStepNum),
    })
    setTempOpen(false)
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4">
      <div className="mx-auto max-w-5xl space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold text-white/90">Kalibrieren</h1>
            <p className="mt-1 max-w-2xl text-[11px] leading-relaxed text-white/40">
              Jedes Werkzeug erzeugt ein fertiges Modell mit Beschriftung und den passenden Einstellungen. Du druckst,
              misst und trägst den Wert hier ein — ohne G-Code-Bastelei und ohne fremde Testdateien.
            </p>
          </div>
          <Chip tone={isKlipper ? 'sky' : 'neutral'}>{printer?.name ?? 'kein Drucker'}</Chip>
        </div>

        {printer && onApplySettings && (
          <CalibrationLoopPanel
            printerId={printer.id}
            printerName={printer.name}
            filamentName={activeProfileName}
            settings={settings}
            onApply={onApplySettings}
            disabled={busy}
          />
        )}

        <Panel
          title="Messwerte ins Filamentprofil"
          hint="Nach Temperaturturm, Fluss- oder PA-Test: nur die gemessenen Werte eintragen. Leere Felder bleiben unverändert."
          right={
            <span
              className={`rounded-full border px-2 py-0.5 text-[9px] font-semibold tracking-wide uppercase ${
                activeProfileEditable
                  ? 'border-mint/40 bg-mint/10 text-mint'
                  : 'border-amber/40 bg-amber/10 text-amber'
              }`}
            >
              {activeProfileEditable ? 'Eigenes Profil' : 'Katalogprofil'}
            </span>
          }
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-[11px] leading-relaxed text-white/50">
              Aktiv: <span className="font-semibold text-white/85">{activeProfileName}</span>
              <span className="ml-1 text-white/30">
                {activeProfileEditable
                  ? '· kann direkt überschrieben werden'
                  : '· Katalogprofil, schreibgeschützt'}
              </span>
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={fillProfileValues}
              className="rounded-lg border border-line/80 px-2.5 py-1.5 text-[10px] text-white/55 transition hover:border-white/30 hover:text-white disabled:opacity-30"
            >
              Werte aus Rechnern einsetzen
            </button>
          </div>

          <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            <label className="block">
              <span className="mb-1 block text-[9px] tracking-wider text-white/40 uppercase">Düse °C</span>
              <input
                value={profileTemp}
                onChange={(event) => {
                  setProfileTemp(event.target.value)
                  setProfileNotice('')
                  setProfileError('')
                }}
                inputMode="numeric"
                placeholder={`${Math.round(settings.temps.nozzle)} · aktuell`}
                className="tabular w-full rounded-xl border border-line/80 bg-ink-900/70 px-3 py-2 text-sm text-white/85 outline-none focus:border-amber/50"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-[9px] tracking-wider text-white/40 uppercase">Fluss ×</span>
              <input
                value={profileFlow}
                onChange={(event) => {
                  setProfileFlow(event.target.value)
                  setProfileNotice('')
                  setProfileError('')
                }}
                inputMode="decimal"
                placeholder={`${settings.flow.toFixed(3)} · aktuell`}
                className="tabular w-full rounded-xl border border-line/80 bg-ink-900/70 px-3 py-2 text-sm text-white/85 outline-none focus:border-mint/50"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-[9px] tracking-wider text-white/40 uppercase">Max. Volumenstrom</span>
              <input
                value={profileMaxFlow}
                onChange={(event) => {
                  setProfileMaxFlow(event.target.value)
                  setProfileNotice('')
                  setProfileError('')
                }}
                inputMode="decimal"
                placeholder={`${settings.maxVolumetricFlow.toFixed(1)} · mm³/s`}
                className="tabular w-full rounded-xl border border-line/80 bg-ink-900/70 px-3 py-2 text-sm text-white/85 outline-none focus:border-sky/50"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-[9px] tracking-wider text-white/40 uppercase">PA / K-Faktor</span>
              <input
                value={profilePa}
                onChange={(event) => {
                  setProfilePa(event.target.value)
                  setProfileNotice('')
                  setProfileError('')
                }}
                inputMode="decimal"
                placeholder={`${settings.pressureAdvance.value.toFixed(3)} · aktuell`}
                className="tabular w-full rounded-xl border border-line/80 bg-ink-900/70 px-3 py-2 text-sm text-white/85 outline-none focus:border-amber/50"
              />
            </label>
          </div>

          <div className="mt-3 grid gap-2 lg:grid-cols-[minmax(0,1fr)_auto_auto] lg:items-end">
            <label className="block">
              <span className="mb-1 block text-[9px] tracking-wider text-white/40 uppercase">Name der neuen Version</span>
              <input
                value={versionName}
                onChange={(event) => {
                  setVersionName(event.target.value)
                  setProfileNotice('')
                  setProfileError('')
                }}
                placeholder={versionNameSuggestion}
                className="w-full rounded-xl border border-line/80 bg-ink-900/70 px-3 py-2 text-sm text-white/85 outline-none focus:border-sky/50"
              />
            </label>
            <button
              type="button"
              disabled={!profileCanSave || !activeProfileEditable}
              title={
                activeProfileEditable
                  ? 'Messwerte in das aktive Profil schreiben'
                  : 'Katalogprofile sind schreibgeschützt'
              }
              onClick={() => saveProfile('active')}
              className="rounded-xl bg-amber/20 px-3 py-2 text-[11px] font-semibold text-amber transition hover:bg-amber hover:text-ink-950 disabled:cursor-not-allowed disabled:opacity-30"
            >
              In aktives Profil übernehmen
            </button>
            <button
              type="button"
              disabled={!profileCanSave}
              onClick={() => saveProfile('new')}
              className="rounded-xl bg-mint/20 px-3 py-2 text-[11px] font-semibold text-mint transition hover:bg-mint hover:text-ink-950 disabled:cursor-not-allowed disabled:opacity-30"
            >
              Als neue Version speichern
            </button>
          </div>

          {profileError && (
            <p className="mt-2 rounded-lg border border-rose/35 bg-rose/[0.07] px-2.5 py-1.5 text-[10px] text-rose/90">
              {profileError}
            </p>
          )}
          {profileNotice && (
            <p className="mt-2 rounded-lg border border-mint/35 bg-mint/[0.07] px-2.5 py-1.5 text-[10px] text-mint/90">
              {profileNotice}
            </p>
          )}
          <p className="mt-2 text-[10px] leading-relaxed text-white/30">
            Die Übernahme setzt den aktiven Stand auf die Messwerte und speichert sie im Filamentprofil. Eine neue
            Version wird sofort ausgewählt; die bisherige bleibt unverändert erhalten. Düse ist die Drucktemperatur,
            PA schaltet die Rampenfunktion des Linientests aus.
          </p>
        </Panel>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {TOOLS.map((t) => {
            const disabled = busy
            return (
              <div key={t.id} className="flex flex-col rounded-2xl border border-line/70 glass p-4">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="text-sm font-semibold text-white/85">{t.label}</h3>
                  <span className="rounded-full border border-line px-2 py-0.5 text-[9px] tracking-wide text-white/40 uppercase">
                    {t.tag}
                  </span>
                </div>
                <p className="mt-2 flex-1 text-[11px] leading-relaxed text-white/40">{t.text}</p>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() =>
                    t.id === 'temp-tower'
                      ? openTempDialog()
                      : RANGE_TOOLS[t.id]
                        ? openRangeDialog(t.id)
                        : onGenerate(t.id)
                  }
                  className="mt-3 rounded-xl border border-amber/40 bg-amber/10 py-2 text-[11px] font-semibold text-amber transition hover:bg-amber/20 disabled:cursor-not-allowed disabled:opacity-30"
                >
                  {t.id === 'temp-tower'
                    ? 'Temperaturen wählen'
                    : RANGE_TOOLS[t.id]
                      ? 'Test einstellen'
                      : 'Modell erzeugen'}
                </button>
              </div>
            )
          })}
        </div>

        <Panel
          title="Bewährte Testmodelle"
          hint="Externe Quellen mit klarer Lizenz — als Vergleich zu den eingebauten Modellen"
        >
          <div className="grid gap-1.5 sm:grid-cols-2">
            {MODEL_SOURCES.map((entry) => (
              <a
                key={`${entry.tool}-${entry.source}`}
                href={entry.url}
                target="_blank"
                rel="noreferrer"
                className="flex items-center justify-between gap-2 rounded-lg border border-line/60 bg-ink-900/35 px-2 py-1.5 text-[10px] text-white/55 transition hover:border-amber/40 hover:text-white/85"
              >
                <span className="min-w-0 truncate">
                  <span className="font-semibold text-white/70">{entry.tool}</span> · {entry.name}
                </span>
                <span className="shrink-0 text-[8px] text-white/30">
                  {entry.source} · {entry.license}
                </span>
              </a>
            ))}
          </div>
          <p className="mt-2 text-[9px] leading-relaxed text-white/30">
            Die Modelle werden nicht mitgeliefert; die Links öffnen die Quelle. Eingebaute Tests bleiben parametrisch und
            brauchen keinen Download. Bitte Lizenz vor einer Weitergabe erneut prüfen.
          </p>
        </Panel>

        <Panel
          title="PA-Farbskala in der Vorschau"
          hint="Nach dem Slicen: Blau = wenig PA, Rot = viel PA"
        >
          <div className="h-2.5 w-full rounded-full bg-gradient-to-r from-[#2f6fed] via-[#7cde78] via-50% to-[#ef4444]" />
          <div className="mt-1 flex justify-between text-[9px] text-white/35">
            <span>{(settings.pressureAdvanceRamp?.enabled ? settings.pressureAdvanceRamp.from : 0).toFixed(3).replace('.', ',')} · Lücken möglich</span>
            <span>{(settings.pressureAdvanceRamp?.enabled ? (settings.pressureAdvanceRamp.from + settings.pressureAdvanceRamp.to) / 2 : 0.05).toFixed(3).replace('.', ',')} · Mitte</span>
            <span>{(settings.pressureAdvanceRamp?.enabled ? settings.pressureAdvanceRamp.to : 0.1).toFixed(3).replace('.', ',')} · Wülste möglich</span>
          </div>
          <p className="mt-2 text-[10px] leading-relaxed text-white/30">
            Erzeuge den PA-Linientest und slice ihn. Die langen Bahnen werden dann in der 3D-Vorschau von Blau nach Rot
            eingefärbt; so siehst du vor dem Druck, wo welcher PA-Wert liegt.
          </p>
        </Panel>

        <Panel title="Fluss-Rechner" hint="Nach dem Druck des einwandigen Würfels — vier Wandmessungen">
          <div className="grid gap-2 sm:grid-cols-4">
            {wallMeasurements.map((value, index) => (
              <label key={index} className="block">
                <span className="mb-1 block text-[10px] tracking-wider text-white/40 uppercase">Wand {index + 1}</span>
                <input
                  value={value}
                  onChange={(e) =>
                    setWallMeasurements((current) =>
                      current.map((entry, entryIndex) => (entryIndex === index ? e.target.value : entry)),
                    )
                  }
                  inputMode="decimal"
                  placeholder="0,42"
                  className="tabular w-full rounded-xl border border-line/80 bg-ink-900/70 px-3 py-2 text-sm text-white/85 outline-none focus:border-amber/50"
                />
              </label>
            ))}
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-xl border border-line/60 bg-ink-900/50 px-3 py-2">
              <div className="text-[10px] tracking-wider text-white/30 uppercase">Ziel · Testwand</div>
              <div className="tabular text-lg font-semibold text-white/80">
                {flowTargetWidth.toFixed(2).replace('.', ',')}{' '}
                <span className="text-xs text-white/35">mm</span>
              </div>
            </div>
            <div className="rounded-xl border border-line/60 bg-ink-900/50 px-3 py-2">
              <div className="flex items-baseline justify-between gap-2 text-[10px] tracking-wider text-white/30 uppercase">
                <span>Mittelwert</span>
                <span className="tabular text-[9px] text-white/25">{flowSummary.count}/4</span>
              </div>
              <div className="tabular text-lg font-semibold text-white/80">
                {flowNumber(flowSummary.mean, 3)} <span className="text-xs text-white/35">mm</span>
              </div>
            </div>
            <div className="rounded-xl border border-line/60 bg-ink-900/50 px-3 py-2">
              <div className="text-[10px] tracking-wider text-white/30 uppercase">Streuung σ</div>
              <div className="tabular text-lg font-semibold text-white/80">
                {flowSummary.standardDeviation === null ? '—' : `± ${flowNumber(flowSummary.standardDeviation, 4)}`}{' '}
                <span className="text-xs text-white/35">mm</span>
              </div>
              <div className="mt-0.5 text-[8px] text-white/25">
                Messbereich{' '}
                {flowSummary.minimum === null || flowSummary.maximum === null
                  ? '—'
                  : `${flowNumber(flowSummary.minimum, 2)}–${flowNumber(flowSummary.maximum, 2)} mm`}
              </div>
            </div>
            <div className="rounded-xl border border-mint/40 bg-mint/10 px-3 py-2">
              <div className="text-[10px] tracking-wider text-mint/60 uppercase">Neuer Fluss</div>
              <div className="tabular text-lg font-semibold text-mint">{newFlow ?? '—'}</div>
              <div className="mt-0.5 text-[8px] text-mint/55">aus Mittelwert</div>
            </div>
          </div>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <div className="rounded-xl border border-line/60 bg-ink-900/50 px-3 py-2">
              <div className="text-[10px] tracking-wider text-white/30 uppercase">Aktueller Fluss</div>
              <div className="tabular text-lg font-semibold text-white/80">{settings.flow.toFixed(3)}</div>
            </div>
            <div className="rounded-xl border border-sky/30 bg-sky/[0.04] px-3 py-2">
              <div className="text-[10px] tracking-wider text-sky/55 uppercase">Flussbereich · Min/Max</div>
              <div className="tabular text-lg font-semibold text-sky/85">
                {flowSummary.flowMinimum === null || flowSummary.flowMaximum === null
                  ? '—'
                  : `${flowNumber(flowSummary.flowMinimum, 3)}–${flowNumber(flowSummary.flowMaximum, 3)}`}
              </div>
              <div className="mt-0.5 text-[8px] text-white/25">dickste bis dünnste Wand</div>
            </div>
          </div>
          <div className="mt-3 flex items-center justify-between gap-3">
            <p className="text-[10px] leading-relaxed text-white/30">
              Mittelwert aus den gültigen Wandmessungen. Der Flussbereich nutzt die dickste und dünnste Wand; eine
              einzelne Fehlmessung verschiebt den empfohlenen Fluss nur anteilig. Formel: alter Fluss × Ziel /
              Mittelwert. Ziel ist die Soll-Wandbreite des Testwürfels ({flowTargetWidth.toFixed(2).replace('.', ',')}{' '}
              mm), nicht die Düsenbreite.
              {flowSummary.count < 4 && (
                <span className="text-amber/70"> Für die Übernahme alle vier Wandmessungen eintragen.</span>
              )}
              {flowMeasurementImplausible && (
                <span className="text-amber/80">
                  {' '}
                  Der Mittelwert {flowNumber(flowSummary.mean, 2)} mm ist weniger als die halbe Sollwand. Miss die Wand
                  in der Mitte einer Seite, nicht am Brim: Der Brim hat absichtlich 0,10 mm Abstand. Prüfe außerdem den
                  Flussfaktor am Drucker (100 %).
                </span>
              )}
            </p>
            <button
              type="button"
              disabled={newFlow === null}
              onClick={() => {
                if (newFlow === null) return
                onFlowChange(newFlow)
                setProfileFlow(newFlow.toFixed(3))
                setProfileNotice('')
                setProfileError('')
              }}
              className="shrink-0 rounded-xl bg-white/8 px-3 py-2 text-[11px] font-medium text-white/75 transition hover:bg-mint hover:text-ink-950 disabled:opacity-30"
            >
              Fluss übernehmen
            </button>
          </div>
        </Panel>

        <Panel
          title="Pressure Advance & Input Shaper übernehmen"
          hint="Ergebnis aus Linientest, Turm oder eigener Messung"
        >
          <div className="grid gap-3 sm:grid-cols-4">
            <label className="block">
              <span className="mb-1 block text-[10px] tracking-wider text-white/40 uppercase">PA / K-Faktor</span>
              <input
                value={pa}
                onChange={(e) => setPa(e.target.value)}
                inputMode="decimal"
                placeholder="0,045"
                className="tabular w-full rounded-xl border border-line/80 bg-ink-900/70 px-3 py-2 text-sm text-white/85 outline-none focus:border-amber/50"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-[10px] tracking-wider text-white/40 uppercase">Frequenz X</span>
              <input
                value={freqX}
                onChange={(e) => setFreqX(e.target.value)}
                inputMode="numeric"
                placeholder="40"
                className="tabular w-full rounded-xl border border-line/80 bg-ink-900/70 px-3 py-2 text-sm text-white/85 outline-none focus:border-sky/50"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-[10px] tracking-wider text-white/40 uppercase">Frequenz Y</span>
              <input
                value={freqY}
                onChange={(e) => setFreqY(e.target.value)}
                inputMode="numeric"
                placeholder="38"
                className="tabular w-full rounded-xl border border-line/80 bg-ink-900/70 px-3 py-2 text-sm text-white/85 outline-none focus:border-sky/50"
              />
            </label>
            <div className="flex flex-col justify-end gap-1.5">
              <button
                type="button"
                disabled={!Number.isFinite(parseFloat(pa.replace(',', '.')))}
                onClick={() => {
                  const value = parseFloat(pa.replace(',', '.'))
                  if (!Number.isFinite(value)) return
                  onApplyPressureAdvance(value)
                  setProfilePa(value.toFixed(3))
                  setProfileNotice('')
                  setProfileError('')
                }}
                className="rounded-xl bg-amber/20 px-3 py-2 text-[11px] font-semibold text-amber transition hover:bg-amber hover:text-ink-950 disabled:opacity-30"
              >
                PA übernehmen
              </button>
              <button
                type="button"
                disabled={
                  !Number.isFinite(parseFloat(freqX.replace(',', '.'))) ||
                  !Number.isFinite(parseFloat(freqY.replace(',', '.')))
                }
                onClick={() =>
                  onApplyInputShaper(parseFloat(freqX.replace(',', '.')), parseFloat(freqY.replace(',', '.')))
                }
                className="rounded-xl bg-sky/20 px-3 py-2 text-[11px] font-semibold text-sky transition hover:bg-sky hover:text-ink-950 disabled:opacity-30"
              >
                Frequenzen übernehmen
              </button>
            </div>
          </div>
          <p className="mt-2 text-[10px] leading-relaxed text-white/30">
            Beide Knöpfe schalten die Funktion ein und schreiben sie beim nächsten Slicen in den G-Code: Marlin M900/M593,
            Klipper SET_PRESSURE_ADVANCE/SET_INPUT_SHAPER. Bei Marlin-Geräten ohne Input-Shaping-Support bleibt M593
            wirkungslos, der G-Code aber gültig.
          </p>
        </Panel>

        <p className="pb-2 text-[10px] leading-relaxed text-white/20">
          Hinweis: Temperatur-, Retract-, Pressure-Advance- und Input-Shaper-Türme wechseln die Werte über
          Schicht-Overrides direkt im G-Code. Beim Drucken siehst du an den aufgedruckten Ziffern, welches Segment
          gerade läuft. Pressure Advance und Input Shaper werden nur wirksam, wenn die Firmware die jeweiligen Befehle
          unterstützt; der G-Code bleibt auch ohne Support gültig.
        </p>

        {rangeTool && rangeConfig && (
          <div
            className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-ink-950/80 p-4 backdrop-blur-sm"
            onClick={() => setRangeTool(null)}
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="range-title"
              className="w-full max-w-xl rounded-2xl border border-amber/30 bg-ink-900 p-4 shadow-2xl"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 id="range-title" className="text-sm font-semibold text-white/90">
                    {rangeConfig.title}
                  </h2>
                  <p className="mt-1 max-w-lg text-[10px] leading-relaxed text-white/40">{rangeConfig.note}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setRangeTool(null)}
                  aria-label="Testeinstellungen schließen"
                  className="text-white/35 transition hover:text-white/80"
                >
                  ✕
                </button>
              </div>

              {rangeConfig.extruder && (
                <label className="mt-4 block">
                  <span className="mb-1 block text-[9px] tracking-wider text-white/40 uppercase">Extruder</span>
                  <select
                    value={rangeExtruder}
                    onChange={(event) => changeRangeExtruder(event.target.value as CalibrationExtruder)}
                    className="w-full rounded-xl border border-line/80 bg-ink-950/70 px-2.5 py-2 text-sm text-white/85 outline-none focus:border-amber/60"
                  >
                    <option value="direct">Direct Drive</option>
                    <option value="bowden">Bowden</option>
                  </select>
                </label>
              )}

              <div className="mt-3 grid grid-cols-3 gap-2">
                <label className="block">
                  <span className="mb-1 block text-[9px] tracking-wider text-white/40 uppercase">{rangeConfig.fromLabel}</span>
                  <input
                    type="number"
                    min={rangeConfig.min}
                    max={rangeConfig.max}
                    step={1 / 10 ** rangeConfig.decimals}
                    value={rangeFrom}
                    onChange={(event) => setRangeFrom(event.target.value)}
                    className="tabular w-full rounded-xl border border-line/80 bg-ink-950/70 px-2.5 py-2 text-sm text-white/85 outline-none focus:border-amber/60"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[9px] tracking-wider text-white/40 uppercase">{rangeConfig.toLabel}</span>
                  <input
                    type="number"
                    min={rangeConfig.min}
                    max={rangeConfig.max}
                    step={1 / 10 ** rangeConfig.decimals}
                    value={rangeTo}
                    onChange={(event) => setRangeTo(event.target.value)}
                    className="tabular w-full rounded-xl border border-line/80 bg-ink-950/70 px-2.5 py-2 text-sm text-white/85 outline-none focus:border-amber/60"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[9px] tracking-wider text-white/40 uppercase">{rangeConfig.stepLabel}</span>
                  <input
                    type="number"
                    min={1 / 10 ** rangeConfig.decimals}
                    max={rangeConfig.max}
                    step={1 / 10 ** rangeConfig.decimals}
                    value={rangeStep}
                    onChange={(event) => setRangeStep(event.target.value)}
                    className="tabular w-full rounded-xl border border-line/80 bg-ink-950/70 px-2.5 py-2 text-sm text-white/85 outline-none focus:border-amber/60"
                  />
                </label>
              </div>

              <div className="mt-3 rounded-xl border border-amber/25 bg-amber/[0.06] px-3 py-2">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-[11px] font-semibold text-amber">
                    {rangeCount > 0 ? `${rangeCount} Stufen` : 'Noch keine gültige Stufenzahl'}
                  </span>
                  <span className="text-[9px] text-white/35">
                    {rangeConfig.extruder ? `${rangeExtruder === 'bowden' ? 'Bowden' : 'Direct Drive'} · ` : ''}
                    {rangeConfig.unit}
                  </span>
                </div>
                {rangeValues.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {rangeValues.map((value) => (
                      <span
                        key={value}
                        className="rounded border border-line/70 bg-ink-950/60 px-1.5 py-0.5 text-[9px] text-white/55"
                      >
                        {value.toFixed(rangeConfig.decimals).replace('.', ',')}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {rangeError && (
                <p className="mt-2 rounded-lg border border-rose/35 bg-rose/[0.07] px-2.5 py-1.5 text-[10px] text-rose/90">
                  {rangeError}
                </p>
              )}

              <div className="mt-4 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setRangeTool(null)}
                  className="rounded-xl border border-line/80 px-3 py-2 text-[11px] text-white/55 transition hover:border-white/30 hover:text-white/80"
                >
                  Abbrechen
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={submitRange}
                  className="rounded-xl bg-amber px-4 py-2 text-[11px] font-semibold text-ink-950 transition hover:bg-amber/90 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Test erzeugen
                </button>
              </div>
            </div>
          </div>
        )}

        {tempOpen && (
          <div
            className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-ink-950/80 p-4 backdrop-blur-sm"
            onClick={() => setTempOpen(false)}
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="temp-tower-title"
              className="w-full max-w-xl rounded-2xl border border-amber/30 bg-ink-900 p-4 shadow-2xl"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 id="temp-tower-title" className="text-sm font-semibold text-white/90">
                    Temperaturtest einstellen
                  </h2>
                  <p className="mt-1 max-w-lg text-[10px] leading-relaxed text-white/40">
                    Die <strong>Thermal-Cell</strong> startet bei <strong>Von</strong> und senkt die Temperatur je Kammer.
                    Das Modell hat sechs feste Kammern à 8 mm und eine vorgegebene Schichthöhe — einstellbar sind nur die
                    sechs Temperaturen.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setTempOpen(false)}
                  aria-label="Temperaturturm schließen"
                  className="text-white/35 transition hover:text-white/80"
                >
                  ✕
                </button>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                <label className="block">
                  <span className="mb-1 block text-[9px] tracking-wider text-white/40 uppercase">Von °C</span>
                  <input
                    type="number"
                    min={150}
                    max={maxNozzleTemp}
                    step={1}
                    value={tempFrom}
                    onChange={(event) => setTempFrom(event.target.value)}
                    className="tabular w-full rounded-xl border border-line/80 bg-ink-950/70 px-2.5 py-2 text-sm text-white/85 outline-none focus:border-amber/60"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[9px] tracking-wider text-white/40 uppercase">Bis °C</span>
                  <input
                    type="number"
                    min={150}
                    max={maxNozzleTemp}
                    step={1}
                    value={tempTo}
                    onChange={(event) => setTempTo(event.target.value)}
                    className="tabular w-full rounded-xl border border-line/80 bg-ink-950/70 px-2.5 py-2 text-sm text-white/85 outline-none focus:border-amber/60"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[9px] tracking-wider text-white/40 uppercase">Schritt °C</span>
                  <input
                    type="number"
                    min={1}
                    max={50}
                    step={1}
                    value={tempStep}
                    onChange={(event) => setTempStep(event.target.value)}
                    className="tabular w-full rounded-xl border border-line/80 bg-ink-950/70 px-2.5 py-2 text-sm text-white/85 outline-none focus:border-amber/60"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[9px] tracking-wider text-white/40 uppercase">Schichthöhe</span>
                  <div className="tabular rounded-xl border border-line/60 bg-ink-950/40 px-2.5 py-2 text-sm text-white/45">
                    0,20 mm · fest
                  </div>
                </label>
              </div>

              <div className="mt-3 rounded-xl border border-amber/25 bg-amber/[0.06] px-3 py-2">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-[11px] font-semibold text-amber">
                    {tempCount === TEMP_BANDS
                      ? '6 Kammern · 48 mm · Thermal-Cell'
                      : `6 Kammern nötig · aktuell ${tempCount || '—'}`}
                  </span>
                  <span className="text-[9px] text-white/35">Schichthöhe 0,20 mm vorgegeben · nur Temperaturen ändern</span>
                </div>
                {tempValues.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {tempValues.map((value) => (
                      <span
                        key={value}
                        className="rounded border border-line/70 bg-ink-950/60 px-1.5 py-0.5 text-[9px] text-white/55"
                      >
                        {value} °C
                      </span>
                    ))}
                  </div>
                )}
                <p className="mt-1.5 text-[9px] leading-snug text-white/30">
                  Die sechs Kammern à 8 mm sind fest. Bei 0,20 mm sind das 40 Schichten je Kammer; die Temperatur
                  wechselt ab Schicht 41, 81, 121 …
                </p>
              </div>

              {tempError && (
                <p className="mt-2 rounded-lg border border-rose/35 bg-rose/[0.07] px-2.5 py-1.5 text-[10px] text-rose/90">
                  {tempError}
                </p>
              )}

              <div className="mt-4 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setTempOpen(false)}
                  className="rounded-xl border border-line/80 px-3 py-2 text-[11px] text-white/55 transition hover:border-white/30 hover:text-white/80"
                >
                  Abbrechen
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={submitTempTower}
                  className="rounded-xl bg-amber px-4 py-2 text-[11px] font-semibold text-ink-950 transition hover:bg-amber/90 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Modell erzeugen
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
