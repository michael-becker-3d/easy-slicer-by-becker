import type { GcodeFlavor, PrinterProfile } from '../shared/types.ts'
import type { PrinterLimits } from './setup.ts'
import { flavorLabel, isKlipperFlavor, pressureAdvanceGcode } from '../shared/gcode-flavors.ts'

export type TestPrintVariant = GcodeFlavor

/**
 * Erzeugt einen kleinen Prüfsatz als reine G-Code-Datei. Bewusst ohne
 * Slicer-Modell: Rahmen, Geschwindigkeits-/Jerk-Stufen, ein Ringing-Turm und
 * PA-Linien liegen direkt auf dem Bett und lassen sich mit jedem Profil
 * drucken. Die Datei ersetzt keine echte Messung — sie macht die Reaktion
 * des Druckers sichtbar.
 */
export function buildPrinterTestGcode({
  profile,
  limits,
  variant = profile.flavor,
}: {
  profile: PrinterProfile
  limits: PrinterLimits
  variant?: TestPrintVariant
}): string {
  const bed = profile.bed
  const margin = Math.max(12, Math.min(20, Math.min(bed.x, bed.y) * 0.07))
  const x0 = margin
  const y0 = margin
  const x1 = Math.max(x0 + 40, bed.x - margin)
  const y1 = Math.max(y0 + 40, bed.y - margin)
  const cx = (x0 + x1) / 2
  const cy = (y0 + y1) / 2
  const layerH = 0.2
  const lineW = Math.max(0.42, profile.nozzle * 1.1)
  const ePerMm = (lineW * layerH) / (Math.PI * (1.75 / 2) ** 2)
  const nozzleTemp = Math.min(205, Math.max(180, profile.maxNozzleTemp))
  const bedTemp = Math.min(60, Math.max(0, profile.maxBedTemp))
  const maxSpeed = Math.max(25, limits.maxPrintSpeed)
  const maxAccel = Math.max(500, limits.maxAccel)
  const speed = (mmPerSecond: number) => Math.round(Math.min(mmPerSecond, maxSpeed) * 60)
  const accel = (value: number) => Math.round(Math.min(value, maxAccel))
  const f = (n: number, digits = 3) => n.toFixed(digits).replace(/\.?0+$/, '') || '0'

  let e = 0
  let x = 0
  let y = 0
  const lines: string[] = []

  const line = (s: string) => lines.push(s)
  const klipper = isKlipperFlavor(variant)
  const setMotion = (a: number, jerk: number) => {
    if (klipper) {
      line(`SET_VELOCITY_LIMIT ACCEL=${accel(a)} SQUARE_CORNER_VELOCITY=${f(jerk, 1)}`)
    } else if (variant === 'reprapfirmware') {
      line(`M204 S${accel(a)}`)
      line(`M566 X${f(jerk * 60, 0)} Y${f(jerk * 60, 0)} Z24 E300 ; Jerk mm/min`)
    } else {
      line(`M204 S${accel(a)}`)
      line(`M205 X${f(jerk, 1)} Y${f(jerk, 1)} Z0.4 E5`)
    }
  }
  const setPa = (value: number) => line(pressureAdvanceGcode(variant, f(value, 4)))
  const travel = (tx: number, ty: number, mmPerSecond = Math.min(120, maxSpeed)) => {
    line(`G0 X${f(tx, 2)} Y${f(ty, 2)} F${speed(mmPerSecond)}`)
    x = tx
    y = ty
  }
  const draw = (tx: number, ty: number, mmPerSecond = 35) => {
    const dist = Math.hypot(tx - x, ty - y)
    if (dist < 0.001) return
    e += dist * ePerMm
    line(`G1 X${f(tx, 2)} Y${f(ty, 2)} E${f(e)} F${speed(mmPerSecond)}`)
    x = tx
    y = ty
  }
  const square = (sx: number, sy: number, size: number, mmPerSecond = 35) => {
    travel(sx, sy)
    draw(sx + size, sy, mmPerSecond)
    draw(sx + size, sy + size, mmPerSecond)
    draw(sx, sy + size, mmPerSecond)
    draw(sx, sy, mmPerSecond)
  }

  line('; Easy-Slicer by Becker — Drucker-Prüfsatz')
  line(`; Drucker: ${profile.name} · Variante: ${flavorLabel(variant)}`)
  line('; Enthält: Bettgrenzen, Geschwindigkeits-/Accel-Stufen, Classic Jerk, Ringing-Turm, PA-Linien.')
  line('; PLA einlegen, Bett sauber machen, erste Schicht prüfen. Kein Ersatz für einen echten Messlauf.')
  line(`; Druckraum: X ${f(x0, 1)}–${f(x1, 1)} mm · Y ${f(y0, 1)}–${f(y1, 1)} mm · Düse ${profile.nozzle} mm`)
  line(`; Grenzen aus dem Profil: ${maxSpeed} mm/s · ${maxAccel} mm/s²`)
  line(`M117 Easy-Slicer Pruefsatz`)
  line('G21')
  line('G90')
  line('M82')
  line('M107')
  line('G28')
  line(`M140 S${f(bedTemp, 0)}`)
  line(`M104 S${f(nozzleTemp, 0)}`)
  line(`M190 S${f(bedTemp, 0)}`)
  line(`M109 S${f(nozzleTemp, 0)}`)
  line('G92 E0')
  line(`G1 Z${f(layerH, 2)} F600`)

  // 1) Äußerer Rahmen: zeigt, ob die berechnete Druckfläche wirklich erreichbar ist.
  line('')
  line('; --- 1) DRUCKGRENZEN / RAHMEN (60 mm/s) ---')
  line('; Der Rahmen liegt 12–20 mm vom Bettrand entfernt. Er darf nirgends anschlagen.')
  setMotion(Math.min(1000, maxAccel), 8)
  square(x0, y0, x1 - x0, 60)
  square(x0 + 2.2, y0 + 2.2, x1 - x0 - 4.4, 45)

  // 2) Drei kleine Quadrate mit steigendem Tempo und steigender Beschleunigung.
  line('')
  line('; --- 2) TEMPO / ACCEL (Quadrate von oben nach unten) ---')
  const speedSteps = [40, Math.min(70, maxSpeed), Math.min(100, maxSpeed)]
  const accelSteps = [accel(600), accel(1000), accel(1500)]
  const small = Math.min(24, (y1 - y0 - 18) / 4)
  speedSteps.forEach((s, i) => {
    const sy = y0 + 8 + i * (small + 4)
    line(`; Stufe ${i + 1}: ${s} mm/s · ${accelSteps[i]} mm/s²`)
    setMotion(accelSteps[i], 8)
    square(x0 + 8, sy, small, s)
  })

  // 3) Classic Jerk: fünf gleiche Quadrate, nur der Jerk-Wert steigt.
  line('')
  line('; --- 3) CLASSIC JERK (5 Quadrate, von links nach rechts) ---')
  line(klipper
    ? '; Klipper: SQUARE_CORNER_VELOCITY je Quadrat. Kein echtes Classic Jerk — der SCV ist der nächste Ersatz.'
    : variant === 'reprapfirmware'
      ? '; RepRapFirmware: M566 je Quadrat. Jedes Quadrat hat einen anderen Jerk-Wert.'
      : `; ${flavorLabel(variant)}: M205 X/Y. Jedes Quadrat hat einen anderen Jerk-Wert.`)
  const jerkValues = [4, 8, 12, 16, 20]
  const jerkSize = Math.min(14, Math.max(9, (x1 - x0 - 16) / 6))
  const jerkGap = 4
  const jerkTotal = jerkValues.length * jerkSize + (jerkValues.length - 1) * jerkGap
  let jerkX = cx - jerkTotal / 2
  const jerkY = y1 - jerkSize - 8
  jerkValues.forEach((jerk) => {
    line(`; Jerk / SCV ${jerk} mm/s`)
    setMotion(accel(800), jerk)
    square(jerkX, jerkY, jerkSize, 35)
    jerkX += jerkSize + jerkGap
  })

  // 4) PA-Linien: der PA-Wert steigt von links nach rechts über jede Bahn.
  line('')
  line('; --- 4) PRESSURE ADVANCE / LINEAR ADVANCE (Linien von oben nach unten) ---')
  line('; 0.000 bis 0.080. Die Stelle mit gleichmäßiger Breite und sauberen Ecken ist der Kandidat.')
  const paLineStart = cx + 12
  const paLineEnd = x1 - 8
  for (let row = 0; row < 4; row++) {
    const py = y0 + 16 + row * 9
    travel(paLineStart, py, 90)
    const steps = 8
    for (let i = 0; i < steps; i++) {
      setPa((i / (steps - 1)) * 0.08)
      draw(paLineStart + ((paLineEnd - paLineStart) * (i + 1)) / steps, py, 28)
    }
  }
  setPa(0.04)

  // 5) Ringing-/Input-Shaper-Turm: gleiche Kontur, alle fünf Schichten neue Beschleunigung.
  line('')
  line('; --- 5) INPUT SHAPER / RINGING-TURM (8 mm hoch) ---')
  line('; Jede Stufe ist 1 mm hoch. Ringing-Muster an den Kanten vergleichen.')
  line(klipper
    ? '; Mit ADXL zusätzlich SHAPER_CALIBRATE ausführen — dieser Turm zeigt nur die sichtbare Reaktion.'
    : `; ${flavorLabel(variant)} mit Input Shaping: M593-Werte anschließend mit dem Turm prüfen.`)
  const towerSize = Math.min(20, Math.max(14, (x1 - x0) / 7))
  const towerX = cx - towerSize / 2
  const towerY = cy - towerSize / 2
  const towerAccel = [600, 1000, 1500, 2000, 2500, 3000, 3500, 4000]
  const layers = 40
  for (let layer = 0; layer < layers; layer++) {
    const z = layerH + layer * layerH
    const block = Math.floor(layer / 5)
    if (layer % 5 === 0) {
      line(`; Ringing-Stufe ${block + 1}: ${accel(towerAccel[block] ?? towerAccel[towerAccel.length - 1])} mm/s²`)
      setMotion(towerAccel[block] ?? towerAccel[towerAccel.length - 1], 8)
    }
    line(`G1 Z${f(z, 2)} F600`)
    square(towerX, towerY, towerSize, 45)
  }

  line('')
  line('; --- ENDE ---')
  line('M107')
  line('M104 S0')
  line('M140 S0')
  line('G91')
  line('G1 Z10 F600')
  line('G90')
  line(`G0 X${f(cx, 2)} Y${f(y1, 2)} F${speed(80)}`)
  line('M84')
  line('; Hinweis: Der Prüfsatz ist ein Diagnosewerkzeug, keine Kalibriergarantie.')
  return lines.join('\n') + '\n'
}
