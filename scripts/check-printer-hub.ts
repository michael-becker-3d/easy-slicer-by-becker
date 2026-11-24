import assert from 'node:assert/strict'
import { PrinterHub } from '../server/printer/hub.ts'

const hub = new PrinterHub({ defaultId: 'anycubic-vyper' })
const vyper = hub.select('anycubic-vyper')
await vyper.connect({ mode: 'simulation', profileId: 'anycubic-vyper' })
const ad5x = hub.select('flashforge-ad5x')
await ad5x.connect({ mode: 'simulation', profileId: 'flashforge-ad5x' })

assert.equal(hub.selectedId, 'flashforge-ad5x')
assert.equal(vyper.connected, true, 'Vyper muss nach dem Umschalten verbunden bleiben')
assert.equal(ad5x.connected, true, 'AD5X muss verbunden sein')
assert.notEqual(vyper, ad5x, 'Jeder Drucker braucht einen eigenen Manager')
assert.equal(vyper.profileId, 'anycubic-vyper')
assert.equal(ad5x.profileId, 'flashforge-ad5x')
assert.equal(hub.snapshot().length, 2)

await hub.disconnectAll()
assert.equal(vyper.connected, false)
assert.equal(ad5x.connected, false)
console.log('OK: zwei Verbindungen unabhängig, Umschalten trennt keine Verbindung, beide sauber getrennt')
