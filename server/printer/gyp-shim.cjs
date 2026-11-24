// Ersetzt "node-gyp-build" im gebündelten Server.
//
// In der EXE kann ein natives Modul nicht aus dem SEA-Blob geladen werden.
// Deshalb entpackt server/sea.ts das Binding beim Start nach %TEMP% und setzt
// KEPLER_SERIALPORT_BINDING auf den Pfad. Außerhalb der EXE (Entwicklung) wird
// unverändert das echte node-gyp-build verwendet.
const { createRequire } = require('node:module')
const { join } = require('node:path')
const { tmpdir } = require('node:os')

module.exports = function loadBinding(dir) {
  const override = process.env.KEPLER_SERIALPORT_BINDING
  if (override) {
    const req = createRequire(join(tmpdir(), 'kepler-serial.cjs'))
    return req(override)
  }
  const req = createRequire(join(dir, 'package.json'))
  return req('node-gyp-build')(dir)
}
