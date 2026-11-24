import type { BuildPlate, FilamentProfile, NozzleMaterial, PrintSettings, PrinterProfile } from './types.ts'
import { DEFAULT_SETTINGS, mergeSettings } from './types.ts'
import { applyPrinterLimits } from './limits.ts'

export { applyPrinterLimits } from './limits.ts'

const p = (
  id: string,
  brand: string,
  name: string,
  bed: [number, number, number],
  opts: Partial<PrinterProfile> = {},
): PrinterProfile => ({
  id,
  brand,
  name,
  bed: { x: bed[0], y: bed[1], z: bed[2] },
  baud: 115200,
  maxPrintSpeed: 100,
  hasBedLeveling: false,
  meshGrid: { cols: 5, rows: 5, margin: 20 },
  nozzle: 0.4,
  probe: 'none',
  homesWithProbe: false,
  maxAccel: 500,
  maxTravel: 150,
  layerRange: [0.1, 0.3],
  nozzleOptions: [0.4],
  transportNote: 'USB-Serial (CH340/CP2102)',
  control: 'marlin-serial',
  flavor: 'marlin',
  maxNozzleTemp: 260,
  maxBedTemp: 110,
  defaultPlate: 'textured-pei',
  ...opts,
})

const klipper = { control: 'klipper-moonraker', flavor: 'klipper', transportNote: 'Moonraker im Netz (Port 7125)' } as const

export const PRINTERS: PrinterProfile[] = [
  // ---------- Anycubic ----------
  p('anycubic-vyper', 'Anycubic', 'Vyper', [245, 245, 260], {
    hasBedLeveling: true,
    meshGrid: { cols: 7, rows: 7, margin: 15 },
    maxPrintSpeed: 100,
    maxAccel: 800,
    layerRange: [0.08, 0.32],
    probe: 'strain-gauge',
    homesWithProbe: true,
    defaultPlate: 'ultrabase',
    transportNote: 'CH340 USB-Serial (/dev/ttyUSB0)',
    note: 'LeviQ misst mit dem Dehnungsmessstreifen; die Nozzle tastet den Z-Nullpunkt, der Offset ist damit bauartbedingt klein.',
  }),
  p('anycubic-i3-mega', 'Anycubic', 'i3 Mega', [210, 210, 205], { baud: 250000, defaultPlate: 'ultrabase', maxBedTemp: 100 }),
  p('anycubic-i3-mega-s', 'Anycubic', 'i3 Mega S', [210, 210, 205], { baud: 250000, defaultPlate: 'ultrabase', maxBedTemp: 100 }),
  p('anycubic-mega-x', 'Anycubic', 'Mega X', [300, 300, 305], { baud: 250000, defaultPlate: 'ultrabase' }),
  p('anycubic-chiron', 'Anycubic', 'Chiron', [400, 400, 450], { defaultPlate: 'ultrabase' }),
  p('anycubic-kobra-go', 'Anycubic', 'Kobra Go', [220, 220, 250], { hasBedLeveling: true, defaultPlate: 'ultrabase' }),
  p('anycubic-kobra-neo', 'Anycubic', 'Kobra Neo', [220, 220, 250], { hasBedLeveling: true }),
  p('anycubic-kobra-2', 'Anycubic', 'Kobra 2', [220, 220, 250], { hasBedLeveling: true, maxPrintSpeed: 150 }),
  p('anycubic-kobra-2-neo', 'Anycubic', 'Kobra 2 Neo', [220, 220, 250], { hasBedLeveling: true, maxPrintSpeed: 150 }),
  p('anycubic-kobra-2-pro', 'Anycubic', 'Kobra 2 Pro', [220, 220, 250], { ...klipper, hasBedLeveling: true, maxPrintSpeed: 250 }),
  p('anycubic-kobra-2-plus', 'Anycubic', 'Kobra 2 Plus', [300, 300, 300], { ...klipper, hasBedLeveling: true, maxPrintSpeed: 250 }),
  p('anycubic-kobra-2-max', 'Anycubic', 'Kobra 2 Max', [420, 420, 500], { ...klipper, hasBedLeveling: true, maxPrintSpeed: 250 }),
  p('anycubic-kobra-3', 'Anycubic', 'Kobra 3', [250, 250, 260], { ...klipper, hasBedLeveling: true, maxPrintSpeed: 300 }),
  p('anycubic-kobra-3-max', 'Anycubic', 'Kobra 3 Max', [420, 420, 500], {
    control: 'manual',
    hasBedLeveling: true,
    maxPrintSpeed: 600,
    maxTravel: 800,
    maxAccel: 10000,
    maxNozzleTemp: 300,
    maxBedTemp: 90,
    nozzleOptions: [0.4, 0.6, 0.8],
    ifs: { name: 'ACE Pro', slots: 4, note: '4 Spulen je Einheit, bis 8 Farben mit zwei ACE Pro. Trocknung bis 55 °C.' },
    transportNote: 'Kobra OS — kein offener Host-Zugriff',
    note: '420 × 420 × 500 mm (88 l), 600 mm/s bei max. 10 000 mm/s². Kobra OS bietet weder Moonraker noch OctoPrint; G-Code exportieren und über LAN/Cloud oder USB drucken.',
  }),
  p('anycubic-kobra-3-max-v2', 'Anycubic', 'Kobra 3 Max V2', [420, 420, 500], {
    control: 'manual',
    hasBedLeveling: true,
    maxPrintSpeed: 600,
    maxTravel: 800,
    maxAccel: 10000,
    maxNozzleTemp: 350,
    maxBedTemp: 90,
    nozzleOptions: [0.25, 0.4, 0.6, 0.8],
    ifs: { name: 'ACE 2 Pro', slots: 4, note: '4 Spulen, bis 16 Farben mit vier Einheiten. Trocknung bis 65 °C, auch während des Drucks.' },
    transportNote: 'Kobra OS — kein offener Host-Zugriff',
    note: 'Wie Kobra 3 Max, aber geschlossenes Ganzmetall-Hotend bis 350 °C und ACE 2 Pro ab Werk.',
  }),
  p('anycubic-kobra-4', 'Anycubic', 'Kobra 4', [260, 260, 260], {
    control: 'manual',
    hasBedLeveling: true,
    maxPrintSpeed: 600,
    maxTravel: 800,
    maxAccel: 20000,
    maxNozzleTemp: 300,
    maxBedTemp: 100,
    nozzleOptions: [0.25, 0.4, 0.6, 0.8],
    ifs: { name: 'ACE 2 Pro (Combo)', slots: 4, note: 'Nur in der Combo-Variante dabei; 4 Farben, bis 8 Farben mit zweiter Einheit und Hub.' },
    transportNote: 'Kobra OS — kein offener Host-Zugriff',
    note: 'Gantry-System, 300 mm/s empfohlen, max. 600 mm/s und 20 000 mm/s². LeviQ 3.0 mit Z-Offset, gehärtete Stahldüse.',
  }),
  p('anycubic-kobra-x', 'Anycubic', 'Kobra X', [260, 260, 260], {
    control: 'manual',
    hasBedLeveling: true,
    maxPrintSpeed: 600,
    maxTravel: 800,
    maxAccel: 20000,
    maxNozzleTemp: 300,
    maxBedTemp: 100,
    nozzleOptions: [0.25, 0.4, 0.6, 0.8],
    ifs: { name: 'ACE Gen 2', slots: 4, note: '4 Farben ohne Zusatzbox, bis 19 Farben mit vier ACE 2 Pro. Trocknung bis 65 °C.' },
    transportNote: 'Kobra OS — kein offener Host-Zugriff',
    note: 'Wie Kobra 4, aber Mehrfarbdruck ab Werk (4 Farben intern) und PVA/PLA-CF/PETG-CF/ASA freigegeben.',
  }),
  p('anycubic-kobra-s1', 'Anycubic', 'Kobra S1', [250, 250, 250], {
    control: 'manual',
    hasBedLeveling: true,
    maxPrintSpeed: 600,
    maxTravel: 800,
    maxAccel: 20000,
    maxNozzleTemp: 320,
    maxBedTemp: 120,
    nozzleOptions: [0.25, 0.4, 0.6, 0.8],
    ifs: { name: 'ACE Pro', slots: 4, note: '4 Spulen, bis 8 Farben mit zwei ACE Pro. Trocknung bis 55 °C; auch als ACE 2 Pro Combo mit bis zu 16 Farben.' },
    transportNote: 'Kobra OS — kein offener Host-Zugriff',
    note: 'Geschlossene CoreXY, 600 mm/s, 20 000 mm/s², Düse bis 320 °C, Bett 120 °C. Kamera und LeviQ 3.0 ab Werk.',
  }),
  p('anycubic-kobra-s1-max', 'Anycubic', 'Kobra S1 Max', [350, 350, 350], {
    control: 'manual',
    hasBedLeveling: true,
    maxPrintSpeed: 600,
    maxTravel: 800,
    maxAccel: 20000,
    maxNozzleTemp: 350,
    maxBedTemp: 120,
    nozzleOptions: [0.25, 0.4, 0.6, 0.8],
    ifs: { name: 'ACE 2 Pro', slots: 4, note: '4 Spulen, bis 16 Farben mit vier Einheiten. Trocknung bis 65 °C.' },
    transportNote: 'Kobra OS — kein offener Host-Zugriff',
    note: 'Große geschlossene CoreXY mit 350 mm Würfel, aktiver Kammertrocknung bis 65 °C und Düse bis 350 °C.',
  }),

  // ---------- Creality ----------
  p('creality-ender3', 'Creality', 'Ender-3', [220, 220, 250], { baud: 115200 }),
  p('creality-ender3-pro', 'Creality', 'Ender-3 Pro', [220, 220, 250]),
  p('creality-ender3-v2', 'Creality', 'Ender-3 V2', [220, 220, 250]),
  p('creality-ender3-s1', 'Creality', 'Ender-3 S1', [220, 220, 270], { hasBedLeveling: true, maxNozzleTemp: 300 }),
  p('creality-ender3-s1-pro', 'Creality', 'Ender-3 S1 Pro', [220, 220, 270], { hasBedLeveling: true, maxNozzleTemp: 300 }),
  p('creality-ender3-v3-se', 'Creality', 'Ender-3 V3 SE', [220, 220, 250], { hasBedLeveling: true, maxPrintSpeed: 200 }),
  p('creality-ender3-v3', 'Creality', 'Ender-3 V3', [220, 220, 250], { ...klipper, hasBedLeveling: true, maxPrintSpeed: 300 }),
  p('creality-ender3-v3-ke', 'Creality', 'Ender-3 V3 KE', [220, 220, 250], { ...klipper, hasBedLeveling: true, maxPrintSpeed: 500 }),
  p('creality-ender5', 'Creality', 'Ender-5', [220, 220, 300]),
  p('creality-ender5-pro', 'Creality', 'Ender-5 Pro', [220, 220, 300]),
  p('creality-ender5-s1', 'Creality', 'Ender-5 S1', [220, 220, 300], { hasBedLeveling: true, maxNozzleTemp: 300 }),
  p('creality-cr10', 'Creality', 'CR-10', [300, 300, 400]),
  p('creality-cr10s', 'Creality', 'CR-10S', [300, 300, 400]),
  p('creality-cr10-v2', 'Creality', 'CR-10 V2', [300, 300, 400]),
  p('creality-cr10-smart', 'Creality', 'CR-10 Smart', [300, 300, 400], { hasBedLeveling: true }),
  p('creality-cr6-se', 'Creality', 'CR-6 SE', [235, 235, 250], { hasBedLeveling: true }),
  p('creality-cr20-pro', 'Creality', 'CR-20 Pro', [220, 220, 250], { hasBedLeveling: true }),
  p('creality-k1', 'Creality', 'K1', [220, 220, 250], { ...klipper, hasBedLeveling: true, maxPrintSpeed: 500, maxNozzleTemp: 300 }),
  p('creality-k1c', 'Creality', 'K1C', [220, 220, 250], { ...klipper, hasBedLeveling: true, maxPrintSpeed: 500, maxNozzleTemp: 300 }),
  p('creality-k1-max', 'Creality', 'K1 Max', [300, 300, 300], { ...klipper, hasBedLeveling: true, maxPrintSpeed: 500, maxNozzleTemp: 300 }),
  p('creality-k2', 'Creality', 'K2', [260, 260, 260], {
    control: 'manual',
    hasBedLeveling: true,
    maxPrintSpeed: 600,
    maxTravel: 800,
    maxAccel: 20000,
    maxNozzleTemp: 300,
    maxBedTemp: 100,
    nozzleOptions: [0.2, 0.4, 0.6, 0.8],
    ifs: { name: 'CFS', slots: 4, note: '4 Spulen je Einheit, bis 4 Einheiten (16 Farben). Automatische Nachfuhr und RFID-Erkennung.' },
    transportNote: 'Creality OS (Klipper-Basis), kein Moonraker-Port',
    note: 'Geschlossene CoreXY mit 260 mm Würfel, 600 mm/s und 20 000 mm/s². Status und Druck laufen über Creality Cloud/App, nicht über Moonraker — G-Code exportieren.',
  }),
  p('creality-k2-pro', 'Creality', 'K2 Pro', [300, 300, 300], {
    control: 'manual',
    hasBedLeveling: true,
    maxPrintSpeed: 600,
    maxTravel: 800,
    maxAccel: 20000,
    maxNozzleTemp: 300,
    maxBedTemp: 110,
    nozzleOptions: [0.2, 0.4, 0.6, 0.8],
    ifs: { name: 'CFS', slots: 4, note: '4 Spulen je Einheit, bis 16 Farben mit vier CFS. RFID und Trocknung.' },
    transportNote: 'Creality OS (Klipper-Basis), kein Moonraker-Port',
    note: 'Ganzmetallrahmen, 300 mm Würfel, Kammer bis 60 °C, Dual-Kamera. Export über Creality Print/Cloud.',
  }),
  p('creality-k2-plus', 'Creality', 'K2 Plus', [350, 350, 350], {
    control: 'manual',
    hasBedLeveling: true,
    maxPrintSpeed: 600,
    maxTravel: 800,
    maxAccel: 30000,
    maxNozzleTemp: 350,
    maxBedTemp: 120,
    nozzleOptions: [0.2, 0.4, 0.6, 0.8],
    ifs: { name: 'CFS', slots: 4, note: '4 Spulen je Einheit, bis 16 Farben mit vier CFS. Trocknung integriert.' },
    transportNote: 'Creality OS (Klipper-Basis), kein Moonraker-Port',
    note: '350 mm Würfel, 5 mm Alu-Bett, 600 mm/s bei 30 000 mm/s², Düse bis 350 °C, Kammer bis 60 °C, fünf Step-Servo-Motoren.',
  }),
  p('creality-hi', 'Creality', 'Hi Combo', [260, 260, 300], {
    control: 'manual',
    hasBedLeveling: true,
    maxPrintSpeed: 500,
    maxTravel: 600,
    maxAccel: 12000,
    maxNozzleTemp: 300,
    maxBedTemp: 100,
    nozzleOptions: [0.4, 0.6, 0.8],
    ifs: { name: 'CFS', slots: 4, note: '4 Spulen, bis 4 Einheiten. Trocknung über Desiccant im CFS.' },
    transportNote: 'Creality OS (Klipper-Basis), kein Moonraker-Port',
    note: 'i3-Gantry mit 260 × 260 × 300 mm, 500 mm/s und 12 000 mm/s², Tri-Metall-Düse. Kommt als Combo mit CFS für Mehrfarbdruck.',
  }),

  // ---------- Prusa ----------
  p('prusa-mk3s', 'Prusa', 'MK3S / MK3S+', [250, 210, 210], { hasBedLeveling: true, meshGrid: { cols: 7, rows: 7, margin: 20 }, maxBedTemp: 120, note: 'Prusa-Firmware: 115200 Baud, G-Code kompatibel' }),
  p('prusa-mk4', 'Prusa', 'MK4', [250, 210, 220], { hasBedLeveling: true, maxNozzleTemp: 290, maxPrintSpeed: 200 }),
  p('prusa-mini', 'Prusa', 'MINI+', [180, 180, 180], { hasBedLeveling: true, maxBedTemp: 100 }),
  p('prusa-xl', 'Prusa', 'XL', [360, 360, 360], { hasBedLeveling: true, maxNozzleTemp: 290, maxPrintSpeed: 200 }),
  p('prusa-core-one', 'Prusa', 'CORE One', [250, 220, 270], {
    hasBedLeveling: true,
    probe: 'strain-gauge',
    homesWithProbe: true,
    maxPrintSpeed: 350,
    maxTravel: 350,
    maxNozzleTemp: 290,
    maxBedTemp: 120,
    layerRange: [0.05, 0.3],
    nozzleOptions: [0.25, 0.4, 0.6, 0.8],
    defaultPlate: 'smooth-pei',
    ifs: { name: 'MMU3', slots: 5, note: 'Fünf Filamente über die MMU3 (Nachrüstung); mit INDX sind bis zu acht möglich.' },
    transportNote: 'USB-C-Serial (Prusa-Firmware), alternativ Prusa Connect',
    note: 'Geschlossene CoreXY mit 250 × 220 × 270 mm, aktiv geregelter Kammer bis 55 °C, Düse 290 °C, Bett 120 °C, Input Shaper und Pressure Advance nativ. Prusa veröffentlicht Maximalbeschleunigung nicht — die 350 mm/s sind der dokumentierte Höchstwert.',
  }),

  // ---------- Artillery ----------
  p('artillery-sidewinder-x1', 'Artillery', 'Sidewinder X1', [300, 300, 400], { hasBedLeveling: true, maxBedTemp: 130 }),
  p('artillery-sidewinder-x2', 'Artillery', 'Sidewinder X2', [300, 300, 400], { hasBedLeveling: true, maxBedTemp: 130 }),
  p('artillery-genius', 'Artillery', 'Genius', [220, 220, 250], { hasBedLeveling: true }),

  // ---------- Sovol ----------
  p('sovol-sv01', 'Sovol', 'SV01', [280, 240, 300], { hasBedLeveling: true }),
  p('sovol-sv06', 'Sovol', 'SV06', [220, 220, 250], { hasBedLeveling: true, maxPrintSpeed: 150 }),
  p('sovol-sv07', 'Sovol', 'SV07', [300, 300, 350], { ...klipper, hasBedLeveling: true, maxPrintSpeed: 250 }),
  p('sovol-sv08', 'Sovol', 'SV08', [350, 350, 345], { ...klipper, hasBedLeveling: true, maxPrintSpeed: 500 }),

  // ---------- Elegoo ----------
  p('elegoo-neptune-2', 'Elegoo', 'Neptune 2', [220, 220, 250]),
  p('elegoo-neptune-3', 'Elegoo', 'Neptune 3', [220, 220, 280], { hasBedLeveling: true }),
  p('elegoo-neptune-3-pro', 'Elegoo', 'Neptune 3 Pro', [225, 225, 280], { hasBedLeveling: true }),
  p('elegoo-neptune-4', 'Elegoo', 'Neptune 4', [235, 235, 265], { ...klipper, hasBedLeveling: true, maxPrintSpeed: 250 }),
  p('elegoo-neptune-4-pro', 'Elegoo', 'Neptune 4 Pro', [235, 235, 265], { ...klipper, hasBedLeveling: true, maxPrintSpeed: 500 }),
  p('elegoo-centauri', 'Elegoo', 'Centauri', [256, 256, 256], {
    control: 'manual',
    hasBedLeveling: true,
    probe: 'strain-gauge',
    homesWithProbe: true,
    maxPrintSpeed: 500,
    maxTravel: 600,
    maxAccel: 20000,
    maxNozzleTemp: 320,
    maxBedTemp: 100,
    layerRange: [0.1, 0.4],
    transportNote: 'ELEGOO OS — kein Moonraker/Port 7125',
    note: 'Offene CoreXY, 256 mm Würfel, 500 mm/s bei 20 000 mm/s², 32 mm³/s Fluss, Düse 320 °C, Bett 100 °C. ELEGOOs Firmware bietet keinen Moonraker-Zugang; G-Code per WLAN/IP oder USB übergeben.',
  }),
  p('elegoo-centauri-carbon', 'Elegoo', 'Centauri Carbon', [256, 256, 256], {
    control: 'manual',
    hasBedLeveling: true,
    probe: 'strain-gauge',
    homesWithProbe: true,
    maxPrintSpeed: 500,
    maxTravel: 600,
    maxAccel: 20000,
    maxNozzleTemp: 320,
    maxBedTemp: 110,
    layerRange: [0.1, 0.4],
    ifs: { name: 'CANVAS', slots: 4, note: 'Nachrüstsatz für vier Farben (seit April 2026). Die Glasabdeckung passt danach nicht mehr.' },
    transportNote: 'ELEGOO OS — SDCP über WLAN, kein Moonraker',
    note: 'Geschlossene CoreXY, 256 mm Würfel, 500 mm/s bei 20 000 mm/s², Düse 320 °C, Bett 110 °C, 121-Punkt-Nivellierung mit vier Wägezellen. Werkseitig kein Moonraker (Port 7125 bleibt zu) — G-Code per LAN/IP oder USB; volles Klipper erst mit der Community-Firmware OpenCentauri.',
  }),

  // ---------- QIDI ----------
  p('qidi-plus4', 'QIDI', 'Plus 4', [305, 305, 280], {
    ...klipper,
    hasBedLeveling: true,
    probe: 'strain-gauge',
    homesWithProbe: true,
    maxPrintSpeed: 600,
    maxTravel: 800,
    maxAccel: 20000,
    maxNozzleTemp: 370,
    maxBedTemp: 120,
    layerRange: [0.05, 0.4],
    nozzleOptions: [0.2, 0.4, 0.6, 0.8],
    defaultPlate: 'textured-pei',
    ifs: { name: 'QIDI Box', slots: 4, note: 'Vier Spulen je Box; QIDI dokumentiert Mehrfarbdruck bis 16 Farben mit vier Boxen.' },
    transportNote: 'Klipper/Moonraker im Netz (Port 7125), Fluidd/Mainsail',
    note: 'Geschlossene CoreXY, 305 × 305 × 280 mm, 600 mm/s bei 20 000 mm/s², Düse bis 370 °C, Bett 120 °C, Kammer 65 °C über 400-W-PTC-Heizer. QIDI liefert einen angepassten Moonraker auf Makerbase-Basis aus: Port 7125 antwortet, einzelne Endpunkte können aber fehlen.',
  }),
  p('qidi-q1-pro', 'QIDI', 'Q1 Pro', [245, 245, 240], {
    ...klipper,
    hasBedLeveling: true,
    probe: 'strain-gauge',
    homesWithProbe: true,
    maxPrintSpeed: 600,
    maxTravel: 800,
    maxAccel: 20000,
    maxNozzleTemp: 350,
    maxBedTemp: 120,
    layerRange: [0.05, 0.4],
    nozzleOptions: [0.2, 0.4, 0.6, 0.8],
    defaultPlate: 'textured-pei',
    ifs: { name: 'QIDI Box', slots: 4, note: 'Vier Spulen, bis 16 Farben mit vier Boxen.' },
    transportNote: 'Klipper/Moonraker im Netz (Port 7125), Fluidd/Mainsail',
    note: 'Kompakte geschlossene CoreXY mit 245 × 245 × 240 mm, aktiver Kammerheizung bis 60 °C, Bimetall-Düse bis 350 °C und Bett bis 120 °C.',
  }),
  p('qidi-x-max-3', 'QIDI', 'X-Max 3', [325, 325, 315], {
    ...klipper,
    hasBedLeveling: true,
    probe: 'strain-gauge',
    homesWithProbe: true,
    maxPrintSpeed: 600,
    maxTravel: 800,
    maxAccel: 20000,
    maxNozzleTemp: 350,
    maxBedTemp: 120,
    layerRange: [0.05, 0.4],
    nozzleOptions: [0.2, 0.4, 0.6, 0.8],
    defaultPlate: 'textured-pei',
    transportNote: 'Klipper/Moonraker im Netz (Port 7125), Fluidd/Mainsail',
    note: 'Großformat mit 325 × 325 × 315 mm, 600 mm/s, Kammer bis 65 °C. Zwei Hotends liegen bei (Kupferlegierung und gehärteter Stahl, beide 350 °C). Die Produktion ist eingestellt, Ersatzteile werden weitergeführt.',
  }),
  p('qidi-x-plus-3', 'QIDI', 'X-Plus 3', [280, 280, 270], {
    ...klipper,
    hasBedLeveling: true,
    probe: 'strain-gauge',
    homesWithProbe: true,
    maxPrintSpeed: 600,
    maxTravel: 800,
    maxAccel: 20000,
    maxNozzleTemp: 350,
    maxBedTemp: 120,
    layerRange: [0.05, 0.4],
    nozzleOptions: [0.2, 0.4, 0.6, 0.8],
    defaultPlate: 'textured-pei',
    transportNote: 'Klipper/Moonraker im Netz (Port 7125), Fluidd/Mainsail',
    note: '280 × 280 × 270 mm in der X-Serie: 600 mm/s, Düse 350 °C, Bett 120 °C, Kammer 65 °C, 4,3-Zoll-Touchscreen.',
  }),

  // ---------- Voron / RatRig ----------
  p('voron-02', 'Voron', 'Voron 0.2', [120, 120, 120], { ...klipper, hasBedLeveling: true, maxPrintSpeed: 300 }),
  p('voron-24-350', 'Voron', 'Voron 2.4 (350)', [350, 350, 330], { ...klipper, hasBedLeveling: true, maxPrintSpeed: 300 }),
  p('voron-trident-300', 'Voron', 'Voron Trident (300)', [300, 300, 300], { ...klipper, hasBedLeveling: true, maxPrintSpeed: 300 }),
  p('ratrig-vcore-500', 'RatRig', 'V-Core 3.1 (500)', [500, 500, 500], { ...klipper, hasBedLeveling: true, maxPrintSpeed: 400 }),

  // ---------- Sonstige ----------
  p('longer-lk4-pro', 'Longer', 'LK4 Pro', [220, 220, 250], { hasBedLeveling: true }),
  p('longer-lk5-pro', 'Longer', 'LK5 Pro', [300, 300, 400]),
  p('tronxy-x5sa', 'Tronxy', 'X5SA', [330, 330, 400], { hasBedLeveling: true }),
  p('twotrees-sapphire-pro', 'Two Trees', 'Sapphire Pro', [235, 235, 235], { hasBedLeveling: true }),
  p('geetech-a10', 'GeeTech', 'A10', [220, 220, 250]),
  p('anet-a8', 'Anet', 'A8', [220, 220, 240], { baud: 250000, maxBedTemp: 100 }),
  p('biqu-b1', 'BIQU', 'B1', [235, 235, 270], { hasBedLeveling: true }),
  p('bambu-p1s', 'Bambu Lab', 'P1S', [256, 256, 256], {
    control: 'manual',
    maxPrintSpeed: 500,
    maxNozzleTemp: 300,
    hasBedLeveling: true,
    defaultPlate: 'textured-pei',
    ifs: { name: 'AMS 2 Pro', slots: 4, note: 'Bis vier Einheiten (16 Farben). AMS 2 Pro trocknet bis 65 °C.' },
    transportNote: 'kein offener USB-Zugriff',
    note: 'Bambu nutzt ein eigenes Protokoll. G-Code exportieren und über SD/Cloud drucken.',
  }),
  p('bambu-x1c', 'Bambu Lab', 'X1 Carbon', [256, 256, 256], {
    control: 'manual',
    maxPrintSpeed: 500,
    maxNozzleTemp: 300,
    hasBedLeveling: true,
    ifs: { name: 'AMS 2 Pro', slots: 4, note: 'Bis vier Einheiten (16 Farben). AMS 2 Pro trocknet bis 65 °C.' },
    transportNote: 'kein offener USB-Zugriff',
    note: 'Bambu nutzt ein eigenes Protokoll. G-Code exportieren und über SD/Cloud drucken.',
  }),
  p('bambu-a1', 'Bambu Lab', 'A1', [256, 256, 256], {
    control: 'manual',
    maxPrintSpeed: 500,
    maxNozzleTemp: 300,
    hasBedLeveling: true,
    transportNote: 'kein offener USB-Zugriff',
    note: 'Bambu nutzt ein eigenes Protokoll. G-Code exportieren und über SD/Cloud drucken.',
    ifs: { name: 'AMS lite', slots: 4, note: 'Vier Spulen, ohne Trocknung. AMS 2 Pro/AMS HT passen nicht an die A-Serie.' },
  }),
  p('bambu-a1-mini', 'Bambu Lab', 'A1 mini', [180, 180, 180], {
    control: 'manual',
    maxPrintSpeed: 500,
    maxTravel: 500,
    maxAccel: 10000,
    maxNozzleTemp: 300,
    maxBedTemp: 80,
    hasBedLeveling: true,
    nozzleOptions: [0.2, 0.4, 0.6, 0.8],
    ifs: { name: 'AMS lite', slots: 4, note: 'Vier Spulen, ohne Trocknung.' },
    transportNote: 'kein offener USB-Zugriff',
    note: 'Cantilever, 180 mm Würfel, Bett nur bis 80 °C — ABS/ASA nicht empfohlen. Export über Bambu Studio/Cloud.',
  }),
  p('bambu-p1p', 'Bambu Lab', 'P1P', [256, 256, 256], {
    control: 'manual',
    maxPrintSpeed: 500,
    maxTravel: 500,
    maxAccel: 20000,
    maxNozzleTemp: 300,
    maxBedTemp: 100,
    hasBedLeveling: true,
    nozzleOptions: [0.2, 0.4, 0.6, 0.8],
    ifs: { name: 'AMS 2 Pro', slots: 4, note: 'Bis vier Einheiten (16 Farben). AMS 2 Pro trocknet bis 65 °C.' },
    transportNote: 'kein offener USB-Zugriff',
    note: 'Offenes Gestell (Upgrade-Kit auf P1S möglich), sonst identisch zum P1S. Produktion wurde im Februar 2026 eingestellt.',
  }),
  p('bambu-x1e', 'Bambu Lab', 'X1E', [256, 256, 256], {
    control: 'manual',
    maxPrintSpeed: 500,
    maxTravel: 500,
    maxAccel: 20000,
    maxNozzleTemp: 320,
    maxBedTemp: 110,
    hasBedLeveling: true,
    nozzleOptions: [0.2, 0.4, 0.6, 0.8],
    ifs: { name: 'AMS 2 Pro', slots: 4, note: 'Bis vier Einheiten (16 Farben), Trocknung bis 65 °C.' },
    transportNote: 'kein offener USB-Zugriff',
    note: 'X1C mit 320-°C-Hotend, aktiver Kammerheizung bis 60 °C, LAN-Anschluss und Netzwerk-Schalter. Bett 110 °C bei 220 V, 120 °C bei 110 V.',
  }),
  p('bambu-h2d', 'Bambu Lab', 'H2D', [325, 320, 325], {
    control: 'manual',
    maxPrintSpeed: 1000,
    maxTravel: 1000,
    maxAccel: 20000,
    maxNozzleTemp: 350,
    maxBedTemp: 120,
    hasBedLeveling: true,
    nozzleOptions: [0.2, 0.4, 0.6, 0.8],
    ifs: { name: 'AMS 2 Pro', slots: 4, note: 'Bis vier Einheiten (16 Farben), Trocknung bis 65 °C.' },
    transportNote: 'kein offener USB-Zugriff',
    note: 'Dual-Extruder: ein Düse 325 × 320 × 325 mm, beide Düsen 300 × 320 × 320 mm (Gesamtvolumen 350 × 320 × 320 mm). Kammerheizung bis 65 °C, Düse bis 350 °C, optional Laser-Modul.',
  }),
  p('bambu-h2s', 'Bambu Lab', 'H2S', [340, 320, 340], {
    control: 'manual',
    maxPrintSpeed: 1000,
    maxTravel: 1000,
    maxAccel: 20000,
    maxNozzleTemp: 350,
    maxBedTemp: 120,
    hasBedLeveling: true,
    nozzleOptions: [0.2, 0.4, 0.6, 0.8],
    ifs: { name: 'AMS 2 Pro', slots: 4, note: 'Bis vier Einheiten (16 Farben), Trocknung bis 65 °C.' },
    transportNote: 'kein offener USB-Zugriff',
    note: 'Einzel-Extruder der H2-Reihe mit 340 × 320 × 340 mm, Düse bis 350 °C, Kammerheizung bis 65 °C und HEPA-Filter.',
  }),
  // ---------- FlashForge ----------

  p('flashforge-ad5m', 'FlashForge', 'Adventurer 5M', [220, 220, 220], {
    ...klipper,
    hasBedLeveling: true,
    probe: 'strain-gauge',
    homesWithProbe: true,
    maxPrintSpeed: 300,
    maxTravel: 600,
    maxAccel: 20000,
    maxNozzleTemp: 300,
    maxBedTemp: 110,
    layerRange: [0.05, 0.4],
    nozzleOptions: [0.25, 0.4, 0.6, 0.8],
    meshGrid: { cols: 11, rows: 11, margin: 5 },
    defaultPlate: 'textured-pei',
    transportNote: 'Klipper/Moonraker über WLAN oder LAN (Port 7125)',
    note: 'Werkseitig Klipper: Status, Bett-Mesh und Druck laufen über Moonraker. Kein USB-Serial. Drucksensor im Bett — die Z-Kalibrierung macht die Firmware selbst.',
  }),
  p('flashforge-ad5m-pro', 'FlashForge', 'Adventurer 5M Pro', [220, 220, 220], {
    ...klipper,
    hasBedLeveling: true,
    probe: 'strain-gauge',
    homesWithProbe: true,
    maxPrintSpeed: 300,
    maxTravel: 600,
    maxAccel: 20000,
    maxNozzleTemp: 300,
    maxBedTemp: 110,
    layerRange: [0.05, 0.4],
    nozzleOptions: [0.25, 0.4, 0.6, 0.8],
    meshGrid: { cols: 11, rows: 11, margin: 5 },
    defaultPlate: 'textured-pei',
    transportNote: 'Klipper/Moonraker über WLAN oder LAN (Port 7125)',
    note: 'Geschlossenes Gehäuse mit Filter — ABS/ASA-tauglich, gleiche Klipper-Basis wie 5M.',
  }),
  p('flashforge-ad5x', 'FlashForge', 'Adventurer 5X (IFS)', [220, 220, 220], {
    ...klipper,
    hasBedLeveling: true,
    probe: 'strain-gauge',
    homesWithProbe: true,
    maxPrintSpeed: 300,
    maxTravel: 600,
    maxAccel: 20000,
    maxNozzleTemp: 300,
    maxBedTemp: 110,
    layerRange: [0.05, 0.4],
    nozzleOptions: [0.25, 0.4, 0.6, 0.8],
    meshGrid: { cols: 11, rows: 11, margin: 5 },
    defaultPlate: 'textured-pei',
    materials: ['PLA', 'PETG', 'TPU'],
    transportNote: 'Klipper/Moonraker über WLAN oder LAN (Port 7125)',
    ifs: {
      name: 'IFS',
      slots: 4,
      note: 'Vier Bahnen auf eigener STM32-Platine, Wechsel macht die Firmware. Der Slicer liefert einfarbigen G-Code je Bahn; die Slot-Belegung steht im Setup.',
    },
    zmodMesh: true,
    note: 'CoreXY, 300 mm/s Druck / 600 mm/s Travel, 20 000 mm/s², Düse bis 300 °C. Wägezellen im Bett tasten die Plattform ab, der Z-Offset wird automatisch bestimmt — kein Papier nötig.',
  }),

  // ---------- FLSun (Delta) ----------
  p('flsun-t1', 'FLSun', 'T1', [260, 260, 330], {
    ...klipper,
    kinematics: 'delta',
    coordOrigin: 'center',
    hasBedLeveling: true,
    probe: 'unknown',
    maxPrintSpeed: 1000,
    maxTravel: 1000,
    maxAccel: 30000,
    maxNozzleTemp: 300,
    maxBedTemp: 110,
    layerRange: [0.1, 0.35],
    nozzleOptions: [0.4],
    transportNote: 'Klipper/Moonraker im Netz (Port 7125)',
    note: 'Delta mit drei Armen: Ø 260 mm × 330 mm hoch, 1000 mm/s bei 30 000 mm/s², Düse 300 °C, Bett 110 °C, 90 mm³/s. Der nutzbare Durchmesser nimmt mit der Höhe ab — der Slicer warnt, wenn das Modell über den Kreis hinausragt. Klipper-Delta rechnet G-Code um die Bettmitte (X0/Y0 = Mitte).',
  }),
  p('flsun-t1-pro', 'FLSun', 'T1 Pro', [260, 260, 330], {
    ...klipper,
    kinematics: 'delta',
    coordOrigin: 'center',
    hasBedLeveling: true,
    probe: 'unknown',
    maxPrintSpeed: 1000,
    maxTravel: 1000,
    maxAccel: 30000,
    maxNozzleTemp: 300,
    maxBedTemp: 110,
    layerRange: [0.1, 0.35],
    nozzleOptions: [0.4],
    transportNote: 'Klipper/Moonraker im Netz (Port 7125)',
    note: 'Wie T1, aber geschlossen (Glasfront, Acrylseiten) mit HEPA-/Aktivkohlefilter — ABS und ASA ohne Zugluft. Bauraum Ø 260 × 330 mm, 1000 mm/s, Düse 300 °C, Bett 110 °C.',
  }),
  p('flsun-t1-max', 'FLSun', 'T1 Max', [300, 300, 297], {
    ...klipper,
    kinematics: 'delta',
    coordOrigin: 'center',
    hasBedLeveling: true,
    probe: 'unknown',
    maxPrintSpeed: 1000,
    maxTravel: 1000,
    maxAccel: 30000,
    maxNozzleTemp: 300,
    maxBedTemp: 100,
    layerRange: [0.1, 0.35],
    nozzleOptions: [0.4],
    transportNote: 'Klipper/Moonraker im Netz (Port 7125)',
    note: 'Offene Farm-Variante mit Ø 300 × 297 mm, gehärteter Stahldüse bis 300 °C und 52 mm³/s Dauerfluss. Bett nur bis 100 °C — für ABS/ASA weniger geeignet.',
  }),
  p('flsun-v400', 'FLSun', 'V400', [300, 300, 410], {
    control: 'manual',
    flavor: 'klipper',
    kinematics: 'delta',
    coordOrigin: 'center',
    hasBedLeveling: true,
    probe: 'unknown',
    maxPrintSpeed: 400,
    maxTravel: 600,
    maxAccel: 12000,
    maxNozzleTemp: 300,
    maxBedTemp: 100,
    layerRange: [0.1, 0.35],
    nozzleOptions: [0.4],
    transportNote: 'FLSun-Firmware auf Klipper-Basis — kein dokumentierter Moonraker-Zugang',
    note: 'Große Delta mit Ø 300 × 410 mm und 400 mm/s. Die Firmware basiert auf Klipper, ein offener Moonraker-Port ist aber nicht belegt — G-Code deshalb per WLAN/FLSun Cloud oder USB-Stick drucken.',
  }),

  // ---------- Kingroon ----------
  p('kingroon-kp3s-pro-v2', 'Kingroon', 'KP3S Pro V2', [200, 200, 200], {
    ...klipper,
    hasBedLeveling: true,
    maxPrintSpeed: 500,
    maxTravel: 500,
    maxAccel: 10000,
    maxNozzleTemp: 260,
    maxBedTemp: 100,
    nozzleOptions: [0.4],
    defaultPlate: 'textured-pei',
    transportNote: 'Klipper/Moonraker über WLAN oder LAN (Port 7125), Fluidd/Mainsail',
    note: 'Cantilever mit Linearschienen auf allen Achsen, Klipper auf eigener Cheetah-Platine, Druck per Web-Oberfläche oder USB-Stick (kein OctoPrint über USB). 500 mm/s Maximum, 200–350 mm/s empfohlen, 10 000 mm/s²; Hotend serienmäßig bis 260 °C.',
  }),
]

/** Standardauswahl beim ersten Start — bewusst nicht der Vyper. */
export const DEFAULT_PRINTER_ID = 'flashforge-ad5x'
export const DEFAULT_PRINTER =
  PRINTERS.find((profile) => profile.id === DEFAULT_PRINTER_ID) ?? PRINTERS[0]

export const PLATES: BuildPlate[] = [
  {
    id: 'textured-pei',
    name: 'Textured PEI (Flexstahl)',
    material: 'PEI',
    bedTempOffset: 0,
    hint: 'Beste Allround-Haftung, Teile lösen sich nach dem Abkühlen von selbst.',
  },
  {
    id: 'smooth-pei',
    name: 'Glattes PEI',
    material: 'PEI',
    bedTempOffset: 0,
    hint: 'Spiegelglatte Unterseite. PLA mit 60 °C, PETG mit 80 °C und etwas Abstand drucken.',
  },
  {
    id: 'glass',
    name: 'Glasplatte',
    material: 'Glas',
    bedTempOffset: 5,
    hint: 'Braucht bei PETG Klebestift als Trennschicht, sonst reißt Glas aus.',
  },
  {
    id: 'ultrabase',
    name: 'Anycubic Ultrabase',
    material: 'Beschichtetes Glas',
    bedTempOffset: 5,
    hint: 'Nach dem Abkühlen löst sich das Teil fast von allein.',
  },
  {
    id: 'spring-steel',
    name: 'Flexstahl beschichtet',
    material: 'Stahl',
    bedTempOffset: 0,
    hint: 'Schnelles Abnehmen durch Biegen — ideal für Serienteile.',
  },
  {
    id: 'kapton',
    name: 'Kapton / Klebeband',
    material: 'Folie',
    bedTempOffset: 10,
    hint: 'Für ABS/ASA gedacht, hält aber nur begrenzt viele Drucke.',
  },
]

export const FILAMENTS: FilamentProfile[] = [
  {
    id: 'pla',
    name: 'PLA Standard',
    material: 'PLA',
    density: 1.24,
    nozzle: 210,
    bed: 60,
    firstLayerNozzle: 215,
    firstLayerBed: 65,
    fanSpeed: 100,
    flow: 1,
    retraction: { distance: 0.8, speed: 40, minTravel: 2 },
    maxVolumetricFlow: 12,
    pricePerKg: 20,
    note: 'Der Allrounder. Kühlung voll aufdrehen.',
  },
  {
    id: 'pla-silk',
    name: 'PLA Silk',
    material: 'PLA',
    density: 1.24,
    nozzle: 215,
    bed: 60,
    firstLayerNozzle: 220,
    firstLayerBed: 65,
    fanSpeed: 90,
    flow: 1.02,
    retraction: { distance: 0.9, speed: 35, minTravel: 2 },
    maxVolumetricFlow: 10,
    pricePerKg: 28,
    note: 'Glänzend, aber druckempfindlich — lieber langsamer und kühler.',
  },
  {
    id: 'pla-matte',
    name: 'PLA Matte',
    material: 'PLA',
    density: 1.24,
    nozzle: 210,
    bed: 60,
    firstLayerNozzle: 215,
    firstLayerBed: 65,
    fanSpeed: 100,
    flow: 1,
    retraction: { distance: 0.8, speed: 40, minTravel: 2 },
    maxVolumetricFlow: 11,
    pricePerKg: 24,
    note: 'Mattiert, verzeiht Schichtlinien.',
  },
  {
    id: 'petg',
    name: 'PETG',
    material: 'PETG',
    density: 1.27,
    nozzle: 240,
    bed: 80,
    firstLayerNozzle: 245,
    firstLayerBed: 85,
    fanSpeed: 60,
    flow: 1.02,
    retraction: { distance: 1.2, speed: 35, minTravel: 2.5 },
    maxVolumetricFlow: 8,
    pricePerKg: 24,
    note: 'Zäh und witterungsfest. Abstand zur Düse großzügig halten (Fäden).',
  },
  {
    id: 'abs',
    name: 'ABS',
    material: 'ABS',
    density: 1.04,
    nozzle: 245,
    bed: 100,
    firstLayerNozzle: 250,
    firstLayerBed: 105,
    fanSpeed: 0,
    flow: 1,
    retraction: { distance: 0.8, speed: 45, minTravel: 2 },
    maxVolumetricFlow: 10,
    pricePerKg: 22,
    note: 'Braucht Gehäuse und wenig Kühlung, sonst reißt es.',
  },
  {
    id: 'asa',
    name: 'ASA',
    material: 'ASA',
    density: 1.07,
    nozzle: 255,
    bed: 100,
    firstLayerNozzle: 260,
    firstLayerBed: 105,
    fanSpeed: 15,
    flow: 1,
    retraction: { distance: 0.9, speed: 45, minTravel: 2 },
    maxVolumetricFlow: 10,
    pricePerKg: 28,
    note: 'UV-beständiger ABS-Ersatz für Außenbauteile.',
  },
  {
    id: 'tpu-95a',
    name: 'TPU 95A',
    material: 'TPU',
    density: 1.21,
    nozzle: 225,
    bed: 50,
    firstLayerNozzle: 230,
    firstLayerBed: 55,
    fanSpeed: 60,
    flow: 1.05,
    retraction: { distance: 0.3, speed: 20, minTravel: 4 },
    maxVolumetricFlow: 4,
    pricePerKg: 35,
    note: 'Flexibel — langsam drucken, Retract kurz halten.',
  },
  {
    id: 'pa-cf',
    name: 'PA-CF (Nylon Carbon)',
    material: 'PA',
    density: 1.15,
    nozzle: 265,
    bed: 90,
    firstLayerNozzle: 270,
    firstLayerBed: 95,
    fanSpeed: 30,
    flow: 1,
    retraction: { distance: 1.2, speed: 45, minTravel: 2 },
    maxVolumetricFlow: 8,
    pricePerKg: 60,
    note: 'Hartmetall- oder Stahldüse nötig, trocken lagern.',
  },
  {
    id: 'pc',
    name: 'PC (Polycarbonat)',
    material: 'PC',
    density: 1.2,
    nozzle: 270,
    bed: 105,
    firstLayerNozzle: 275,
    firstLayerBed: 110,
    fanSpeed: 20,
    flow: 1,
    retraction: { distance: 1, speed: 40, minTravel: 2 },
    maxVolumetricFlow: 9,
    pricePerKg: 45,
    note: 'Sehr fest, braucht heißes Bett und Gehäuse.',
  },
  {
    id: 'pla-cf',
    name: 'PLA-CF (Carbon)',
    material: 'PLA',
    density: 1.24,
    nozzle: 220,
    bed: 60,
    firstLayerNozzle: 225,
    firstLayerBed: 65,
    fanSpeed: 100,
    flow: 1,
    retraction: { distance: 0.8, speed: 35, minTravel: 2 },
    maxVolumetricFlow: 10,
    pricePerKg: 40,
    note: 'Gehärtete Düse nötig. Steifer als PLA, bricht weniger.',
  },
  {
    id: 'petg-cf',
    name: 'PETG-CF (Carbon)',
    material: 'PETG',
    density: 1.3,
    nozzle: 250,
    bed: 80,
    firstLayerNozzle: 255,
    firstLayerBed: 85,
    fanSpeed: 50,
    flow: 1.02,
    retraction: { distance: 1.2, speed: 35, minTravel: 2.5 },
    maxVolumetricFlow: 8,
    pricePerKg: 45,
    note: 'Gehärtete Düse, etwas spröder als normales PETG.',
  },
  {
    id: 'tpu-64d',
    name: 'TPU 64D (hart)',
    material: 'TPU',
    density: 1.2,
    nozzle: 230,
    bed: 50,
    firstLayerNozzle: 235,
    firstLayerBed: 55,
    fanSpeed: 50,
    flow: 1.03,
    retraction: { distance: 0.2, speed: 15, minTravel: 5 },
    maxVolumetricFlow: 3,
    pricePerKg: 40,
    note: 'Hartes TPU: langsam und ohne großes Retract, sonst knickt der Draht im Extruder.',
  },
  {
    id: 'pla-wood',
    name: 'PLA Wood',
    material: 'PLA',
    density: 1.2,
    nozzle: 215,
    bed: 60,
    firstLayerNozzle: 220,
    firstLayerBed: 65,
    fanSpeed: 100,
    flow: 1,
    retraction: { distance: 0.8, speed: 35, minTravel: 2 },
    maxVolumetricFlow: 8,
    pricePerKg: 30,
    note: 'Größere Düse (0,5 mm) verhindert Verstopfen durch Holzfasern.',
  },
]

export const NOZZLE_SIZES = [0.2, 0.3, 0.4, 0.5, 0.6, 0.8, 1.0]

/**
 * Eigene Drucker (No-Name) — zur Laufzeit angelegt, nicht Teil des Katalogs.
 * Der Server registriert sie beim Start und bei jedem Speichern neu.
 */
export const CUSTOM_PRINTERS: PrinterProfile[] = []

export function registerCustomPrinter(profile: PrinterProfile): PrinterProfile {
  const i = CUSTOM_PRINTERS.findIndex((p) => p.id === profile.id)
  if (i >= 0) CUSTOM_PRINTERS[i] = profile
  else CUSTOM_PRINTERS.push(profile)
  return profile
}

export function unregisterCustomPrinter(id: string): void {
  const i = CUSTOM_PRINTERS.findIndex((p) => p.id === id)
  if (i >= 0) CUSTOM_PRINTERS.splice(i, 1)
}

export type CustomPrinterInput = {
  id?: string
  name: string
  bed: { x: number; y: number; z: number }
  /** 0 = Baudrate automatisch ermitteln */
  baud?: number
  control?: 'marlin-serial' | 'klipper-moonraker' | 'manual'
  hasBedLeveling?: boolean
}

const clampBed = (v: unknown, fallback: number) => {
  const n = Number(v)
  if (!Number.isFinite(n)) return fallback
  return Math.min(1000, Math.max(30, Math.round(n)))
}

/** Baut ein vollständiges Profil für einen selbst angelegten Drucker. */
export function customPrinterProfile(input: CustomPrinterInput): PrinterProfile {
  const name = (input.name ?? '').trim() || 'Eigener Drucker'
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'printer'
  const control = input.control ?? 'marlin-serial'
  const klipperLike = control === 'klipper-moonraker'
  return {
    id: input.id ?? `custom-${slug}-${Date.now().toString(36)}`,
    brand: 'Eigener Drucker',
    name,
    bed: {
      x: clampBed(input.bed?.x, 220),
      y: clampBed(input.bed?.y, 220),
      z: clampBed(input.bed?.z, 250),
    },
    // 0 heißt in der Oberfläche „automatisch“ — der Server probiert dann die Baudraten durch.
    baud: input.baud ?? 0,
    maxPrintSpeed: 100,
    hasBedLeveling: input.hasBedLeveling ?? false,
    meshGrid: { cols: 5, rows: 5, margin: 20 },
    nozzle: 0.4,
    probe: 'none',
    homesWithProbe: false,
    maxAccel: 500,
    maxTravel: 150,
    layerRange: [0.1, 0.3],
    nozzleOptions: [0.4],
    transportNote: klipperLike
      ? 'Moonraker im Netz (Port 7125)'
      : 'USB-Serial (CH340/CH341/CP2102/FTDI) — Baudrate automatisch',
    control,
    flavor: klipperLike ? 'klipper' : 'marlin',
    maxNozzleTemp: 260,
    maxBedTemp: 110,
    defaultPlate: 'textured-pei',
    custom: true,
  }
}

export function printerById(id: string): PrinterProfile {
  return CUSTOM_PRINTERS.find((x) => x.id === id) ?? PRINTERS.find((x) => x.id === id) ?? DEFAULT_PRINTER
}

export function filamentById(id: string): FilamentProfile {
  return FILAMENTS.find((x) => x.id === id) ?? FILAMENTS[0]
}

export function plateById(id: string): BuildPlate {
  return PLATES.find((x) => x.id === id) ?? PLATES[0]
}

/** Filament- und Plattentemperaturen in die Einstellungen übernehmen. */
export function settingsForFilament(
  base: PrintSettings,
  filament: FilamentProfile,
  plate: BuildPlate,
  nozzle: number,
): PrintSettings {
  // Eigene Profile speichern absolute Temperaturen — dann keinen Platten-Offset addieren
  const offset = filament.custom ? 0 : plate.bedTempOffset
  return mergeSettings(base, {
    nozzle,
    flow: filament.flow,
    fanSpeed: filament.fanSpeed,
    maxVolumetricFlow: filament.maxVolumetricFlow,
    temps: {
      nozzle: filament.nozzle,
      bed: filament.bed + offset,
      firstLayerNozzle: filament.firstLayerNozzle,
      firstLayerBed: filament.firstLayerBed + offset,
    },
    retraction: { ...base.retraction, ...filament.retraction },
    shrinkage: filament.shrinkage ?? base.shrinkage ?? { x: 0, y: 0, z: 0 },
    cooling: { ...(base.cooling ?? { fanOffLayers: 1, minLayerTime: 0 }), ...(filament.cooling ?? {}) },
    speeds: { ...base.speeds, outerWall: Math.min(base.speeds.outerWall, Math.round(filament.maxVolumetricFlow / (nozzle * base.layerHeight) * 0.6)) },
  })
}

/**
 * Qualitätsprofile wie in OrcaSlicer: Die Schichthöhe und die davon
 * abhängigen Werte werden je Drucker auf dessen Werksgrenzen begrenzt.
 * Geschwindigkeit und Beschleunigung skalieren mit dem Druckerprofil, statt
 * für einen langsamen Vyper und einen schnellen CoreXY denselben Wert zu setzen.
 */
export type QualityPreset = {
  id: string
  label: string
  layerHeight: number
  firstLayerHeight: number
  walls: number
  topLayers: number
  bottomLayers: number
  infillDensity: number
  /** Faktor auf das Grundtempo des Druckers */
  speedFactor: number
  /** Faktor auf die Grundbeschleunigung des Druckers */
  accelFactor: number
  note: string
  /** Vom Nutzer gespeichertes Profil (nicht im Katalog) */
  custom?: boolean
}

export const QUALITY_PRESETS: QualityPreset[] = [
  {
    id: 'extra-fine',
    label: 'Extra fein',
    layerHeight: 0.08,
    firstLayerHeight: 0.16,
    walls: 4,
    topLayers: 5,
    bottomLayers: 4,
    infillDensity: 30,
    speedFactor: 0.55,
    accelFactor: 0.55,
    note: 'Maximale Details, sehr lange Druckzeit.',
  },
  {
    id: 'fine',
    label: 'Fein',
    layerHeight: 0.12,
    firstLayerHeight: 0.2,
    walls: 4,
    topLayers: 5,
    bottomLayers: 4,
    infillDensity: 25,
    speedFactor: 0.7,
    accelFactor: 0.7,
    note: 'Feine Oberfläche für Sichtteile.',
  },
  {
    id: 'optimal',
    label: 'Optimal',
    layerHeight: 0.16,
    firstLayerHeight: 0.22,
    walls: 3,
    topLayers: 4,
    bottomLayers: 3,
    infillDensity: 20,
    speedFactor: 0.85,
    accelFactor: 0.85,
    note: 'Guter Kompromiss aus Oberfläche und Zeit.',
  },
  {
    id: 'normal',
    label: 'Normal',
    layerHeight: 0.2,
    firstLayerHeight: 0.24,
    walls: 3,
    topLayers: 4,
    bottomLayers: 3,
    infillDensity: 20,
    speedFactor: 1,
    accelFactor: 1,
    note: 'Der Standard für die meisten Teile.',
  },
  {
    id: 'fast',
    label: 'Schnell',
    layerHeight: 0.24,
    firstLayerHeight: 0.28,
    walls: 2,
    topLayers: 3,
    bottomLayers: 2,
    infillDensity: 15,
    speedFactor: 1.2,
    accelFactor: 1.2,
    note: 'Sichtbare Schichten, aber deutlich schneller.',
  },
  {
    id: 'draft',
    label: 'Entwurf',
    layerHeight: 0.3,
    firstLayerHeight: 0.32,
    walls: 2,
    topLayers: 3,
    bottomLayers: 2,
    infillDensity: 10,
    speedFactor: 1.4,
    accelFactor: 1.4,
    note: 'Grober Prototyp, maximale Geschwindigkeit.',
  },
]

/** Nur Profile, deren Schichthöhe der Drucker laut Werksgrenzen schafft. */
export function qualityPresetsFor(profile: PrinterProfile): QualityPreset[] {
  const [min, max] = profile.layerRange
  return QUALITY_PRESETS.filter((p) => p.layerHeight >= min - 1e-9 && p.layerHeight <= max + 1e-9)
}

/** Aktuelles Profil anhand der Schichthöhe erkennen (null = eigene Werte). */
export function qualityPresetFor(profile: PrinterProfile, layerHeight: number): QualityPreset | null {
  return qualityPresetsFor(profile).find((p) => Math.abs(p.layerHeight - layerHeight) < 0.005) ?? null
}

/**
 * Vollständiger Profilstand für einen Drucker. Die Filamenttemperaturen und
 * der Fluss kommen aus dem gewählten Filament; Schichthöhe, Wände, Füllung,
 * Tempo und Beschleunigung aus dem Qualitätsprofil.
 */
export function qualityBaseline(
  profile: PrinterProfile,
  filament: FilamentProfile,
  plate: BuildPlate,
  nozzle: number,
  presetId: string,
): PrintSettings {
  const preset = QUALITY_PRESETS.find((p) => p.id === presetId) ?? QUALITY_PRESETS.find((p) => p.id === 'normal')!
  const [minLayer, maxLayer] = profile.layerRange
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
  const layerHeight = clamp(preset.layerHeight, minLayer, maxLayer)
  const firstLayerHeight = clamp(Math.max(layerHeight, preset.firstLayerHeight), minLayer, maxLayer)

  // Drucker mit 100 mm/s (Vyper) und 600 mm/s (Kobra) bekommen beide ein
  // sinnvolles Grundtempo. Die Faktoren halten die Relation der Profile.
  const print = clamp(Math.round(profile.maxPrintSpeed * 0.55 * preset.speedFactor), 20, profile.maxPrintSpeed)
  const outerWall = clamp(Math.round(print * 0.6), 10, print)
  const innerWall = clamp(Math.round(print * 0.85), 10, print)
  const solid = clamp(Math.round(print * 0.85), 10, print)
  const support = clamp(Math.round(print * 0.75), 10, print)
  const overhang = clamp(Math.round(print * 0.4), 10, print)
  const travel = clamp(Math.round(Math.max(150, print * 2.2)), 30, profile.maxTravel)
  const accelBase = Math.min(profile.maxAccel, 3000)
  const accel = (factor: number) => clamp(Math.round(accelBase * preset.accelFactor * factor), 100, profile.maxAccel)

  const base = settingsForFilament(DEFAULT_SETTINGS, filament, plate, nozzle)
  const next = mergeSettings(base, {
    layerHeight,
    firstLayerHeight,
    lineWidth: nozzle,
    walls: preset.walls,
    topLayers: preset.topLayers,
    bottomLayers: preset.bottomLayers,
    infillDensity: preset.infillDensity,
    speeds: {
      print,
      outerWall,
      innerWall,
      infill: print,
      solid,
      topSurface: clamp(Math.round(print * 0.75), 10, print),
      bridge: clamp(Math.round(print * 0.4), 10, print),
      support,
      supportInterface: clamp(Math.round(support * 0.8), 5, print),
      overhang,
      travel,
      firstLayer: Math.min(20, print),
    },
    accelerations: {
      print: accel(1),
      outerWall: accel(0.7),
      innerWall: accel(0.9),
      infill: accel(1),
      solid: accel(0.85),
      topSurface: accel(0.8),
      bridge: accel(0.7),
      support: accel(0.7),
      supportInterface: accel(0.65),
      travel: accel(1.3),
      firstLayer: accel(0.75),
    },
  })
  return applyPrinterLimits(profile, next)
}

/** Prüft, ob die aktuellen Einstellungen zum gewählten Drucker passen. */
export function compatibilityWarnings(
  profile: PrinterProfile,
  filament: FilamentProfile,
  plate: BuildPlate,
  s: PrintSettings,
  nozzleMaterial?: NozzleMaterial,
): string[] {
  const out: string[] = []
  const [minLayer, maxLayer] = profile.layerRange

  if (s.layerHeight < minLayer || s.layerHeight > maxLayer)
    out.push(`Schichthöhe ${s.layerHeight} mm liegt außerhalb ${minLayer}–${maxLayer} mm von ${profile.name}.`)
  if (s.firstLayerHeight < minLayer || s.firstLayerHeight > maxLayer)
    out.push(`Erste Schicht ${s.firstLayerHeight} mm passt nicht zu ${profile.name} (${minLayer}–${maxLayer} mm).`)
  if (s.speeds.print > profile.maxPrintSpeed)
    out.push(`Drucktempo ${s.speeds.print} mm/s über dem Werkslimit ${profile.maxPrintSpeed} mm/s.`)
  if (s.speeds.travel > profile.maxTravel)
    out.push(`Travel ${s.speeds.travel} mm/s über dem Limit ${profile.maxTravel} mm/s.`)
  if (s.temps.nozzle > profile.maxNozzleTemp)
    out.push(`Düsentemperatur ${s.temps.nozzle} °C über dem Maximum ${profile.maxNozzleTemp} °C.`)
  if (s.temps.bed > profile.maxBedTemp)
    out.push(`Betttemperatur ${s.temps.bed} °C über dem Maximum ${profile.maxBedTemp} °C.`)
  if (s.temps.bed > filament.bed + plate.bedTempOffset + 15)
    out.push(
      `Bett ${s.temps.bed} °C ist deutlich heißer als ${filament.name} auf ${plate.name} (${filament.bed + plate.bedTempOffset} °C).`,
    )
  if (profile.materials && !profile.materials.includes(filament.material))
    out.push(`${filament.material} ist für ${profile.name} nicht freigegeben (${profile.materials.join(', ')}).`)
  // Faserhaltige Filamente schleifen weiche Düsen aus — das ist unabhängig
  // vom Drucker und wird deshalb hier geprüft.
  const abrasive = /(?:^|[\s-])(CF|GF)\b|carbon|glasfaser/i.test(`${filament.name} ${filament.note}`)
  if (abrasive && (nozzleMaterial === 'brass' || nozzleMaterial === 'unknown' || nozzleMaterial == null))
    out.push(
      `${filament.name} enthält Fasern — Messing und unbekannte Düsen werden ausgeschliffen. Gehärtete Stahl- oder Edelstahldüse einsetzen.`,
    )
  const lineWidth = s.lineWidth > 0 ? s.lineWidth : s.nozzle
  if (lineWidth < s.nozzle * 0.85)
    out.push(`Linienbreite ${lineWidth} mm ist schmaler als die Düse (${s.nozzle} mm) — Lücken zwischen den Bahnen.`)
  if (lineWidth > s.nozzle * 1.6)
    out.push(`Linienbreite ${lineWidth} mm ist für eine ${s.nozzle}-mm-Düse sehr breit — Bahnen reißen leichter.`)
  if (profile.control === 'manual') out.push(`${profile.name} lässt sich nicht aus dem Slicer steuern (nur Export).`)
  return out
}

