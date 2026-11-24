import type { DetectedDevice } from '../../shared/types.ts'

type ChipInfo = {
  chip: string
  guess: string
  printer: string | null
  /** Übliche Baudraten, erste zuerst */
  bauds: number[]
  hint?: string
}

const CH340_HINT =
  'CH340/CH341: unter Windows den CH341SER-Treiber installieren (gilt für beide Chips). In Cura/OctoPrint/Pronterface den Port freigeben.'

/**
 * USB-Serial-Wandler der älteren Marlin-Drucker. Vyper und Ender-3 sprechen
 * laut Hersteller-/Marlin-Konfiguration 115200, viele andere 250000.
 */
const CHIPS: Record<string, ChipInfo> = {
  '1a86:7523': {
    chip: 'CH340',
    guess: 'Creality, Anycubic (Vyper/i3 Mega), Elegoo, Sovol',
    printer: null,
    bauds: [115200, 250000, 500000, 57600],
    hint: CH340_HINT,
  },
  '1a86:5523': {
    chip: 'CH341',
    guess: 'Creality, Anycubic, ältere Marlin-Boards',
    printer: null,
    bauds: [115200, 250000, 500000, 57600],
    hint: CH340_HINT,
  },
  '1a86:55d4': {
    chip: 'CH9102',
    guess: 'Creality, Anycubic (neuere Boards)',
    printer: null,
    bauds: [115200, 250000],
    hint: CH340_HINT,
  },
  '10c4:ea60': {
    chip: 'CP2102',
    guess: 'Creality, Ender, Sovol, Two Trees',
    printer: 'creality-ender3',
    bauds: [115200, 250000],
  },
  '10c4:ea70': { chip: 'CP2105', guess: 'Creality, Artillery', printer: null, bauds: [115200, 250000] },
  '0403:6001': {
    chip: 'FTDI FT232',
    guess: 'Prusa, Artillery, ältere Drucker',
    printer: 'prusa-mk3s',
    bauds: [250000, 115200],
  },
  '0403:6015': { chip: 'FTDI FT231X', guess: 'Prusa, Artillery', printer: 'prusa-mk3s', bauds: [250000, 115200] },
  '2341:0043': { chip: 'Arduino Mega', guess: 'Prusa MK3 / RAMPS-Umbau', printer: 'prusa-mk3s', bauds: [250000, 115200] },
  '2341:003d': { chip: 'Arduino Mega', guess: 'Prusa MK3 / RAMPS-Umbau', printer: 'prusa-mk3s', bauds: [250000, 115200] },
  '2341:0042': { chip: 'Arduino Mega 2560', guess: 'RAMPS / Eigenbau', printer: null, bauds: [250000, 115200] },
  '2341:0001': { chip: 'Arduino Uno', guess: 'Eigenbau / RAMPS', printer: null, bauds: [115200, 250000] },
  '0483:5740': {
    chip: 'STM32 VCP',
    guess: 'Klipper-MCU (BTT, Octopus), native USB',
    printer: null,
    bauds: [250000],
    hint: 'Klipper nutzt 250000 Baud — der Wert gilt nur für den Host, nicht für die MCU-Konfiguration.',
  },
  '1d6b:0104': { chip: 'USB-ACM', guess: 'Klipper-MCU oder Drucker', printer: null, bauds: [250000, 115200] },
}

/**
 * Art des Ports anhand des Gerätenamens: ACM/USBModem ist natives USB
 * (typisch für Klipper-MCUs), ttyUSB/cu.* ist ein USB-Serial-Wandler
 * (CH340/CP2102/FTDI), COM… ist der Windows-Name eines solchen Adapters.
 */
export function portKind(path: string): 'com' | 'usb-cdc' | 'usb-serial' | 'unknown' {
  const p = path.trim().toLowerCase()
  if (/^com\d+$/.test(p)) return 'com'
  if (/ttyacm|usbmodem|acm\d+/.test(p)) return 'usb-cdc'
  if (/ttyusb|usbserial|cu\./.test(p)) return 'usb-serial'
  return 'unknown'
}

/** Listet serielle Geräte und rät anhand der USB-Kennung auf den Drucker. */
export async function scanDevices(): Promise<DetectedDevice[]> {
  let mod: any
  try {
    mod = await import('serialport')
  } catch {
    return []
  }
  const SerialPort = mod.SerialPort ?? mod.default?.SerialPort
  if (!SerialPort) return []

  try {
    const ports = await SerialPort.list()
    return ports
      .filter((p: any) => p.path)
      .map((p: any) => {
        const vid = String(p.vendorId ?? '').toLowerCase()
        const pid = String(p.productId ?? '').toLowerCase()
        const key = `${vid}:${pid}`
        const info = CHIPS[key]
        const chip = info?.chip ?? (p.vendorId ? `USB ${p.vendorId}:${p.productId}` : 'unbekannt')
        const guess = info?.guess ?? (p.manufacturer || 'Serielles Gerät')
        const kind = portKind(p.path)
        const kindHint =
          kind === 'usb-cdc'
            ? 'Natives USB (ACM/USBModem). Hängt dort ein Klipper-Host oder eine Klipper-MCU, ist die Verbindung Moonraker (Port 7125) — nicht USB-Serial.'
            : kind === 'usb-serial'
              ? 'USB-Serial-Adapter: Marlin-Drucker. Bei Klipper-Mod über Moonraker verbinden, nicht über diesen Port.'
              : kind === 'com'
                ? 'Serieller COM-Port (USB-Adapter). Bei Klipper-Mod über Moonraker verbinden.'
                : null
        return {
          path: p.path,
          label: [p.path, p.manufacturer, p.friendlyName].filter(Boolean).join(' — '),
          chip,
          guess,
          suggestedPrinter: info?.printer ?? null,
          kind: 'serial' as const,
          hint: [info?.hint, kindHint].filter(Boolean).join(' ') || undefined,
          bauds: info?.bauds,
        }
      })
  } catch {
    return []
  }
}
