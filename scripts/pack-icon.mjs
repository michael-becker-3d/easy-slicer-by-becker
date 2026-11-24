// Packt die von make-icon.ps1 erzeugten PNGs in eine Windows-ICO-Datei.
// ICO erlaubt für 256x256 PNG-komprimierte Einträge; alle anderen Größen
// werden ebenfalls als PNG eingebettet.
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const pngDir = join(root, 'build', 'icon-png')
const sizes = [16, 24, 32, 48, 64, 128, 256]
const images = sizes.map((size) => {
  const data = readFileSync(join(pngDir, `icon-${size}.png`))
  return { size, data }
})

const headerSize = 6 + images.length * 16
const header = Buffer.alloc(headerSize)
header.writeUInt16LE(0, 0) // reserved
header.writeUInt16LE(1, 2) // type = icon
header.writeUInt16LE(images.length, 4)

let offset = headerSize
images.forEach(({ size, data }, index) => {
  const entry = 6 + index * 16
  header.writeUInt8(size >= 256 ? 0 : size, entry)
  header.writeUInt8(size >= 256 ? 0 : size, entry + 1)
  header.writeUInt8(0, entry + 2) // palette colors
  header.writeUInt8(0, entry + 3) // reserved
  header.writeUInt16LE(1, entry + 4) // color planes
  header.writeUInt16LE(32, entry + 6) // bits per pixel
  header.writeUInt32LE(data.length, entry + 8)
  header.writeUInt32LE(offset, entry + 12)
  offset += data.length
})

const output = join(root, 'assets', 'easy-slicer.ico')
writeFileSync(output, Buffer.concat([header, ...images.map((image) => image.data)]))
console.log(`ICO: ${output} (${images.length} Größen, ${Buffer.concat([header, ...images.map((image) => image.data)]).length} Bytes)`)
