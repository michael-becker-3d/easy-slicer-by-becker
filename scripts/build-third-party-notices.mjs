// Erzeugt THIRD_PARTY_NOTICES.md aus den Produktionsabhängigkeiten in
// package-lock.json. Dev-Werkzeuge (Vite, TypeScript, resedit) sind nicht
// Bestandteil des Releases und werden nicht aufgenommen.
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const root = process.cwd()
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'))
const direct = new Set([
  ...Object.keys(pkg.dependencies ?? {}),
  ...Object.keys(pkg.optionalDependencies ?? {}),
])

const packages = []
const seen = new Set()
for (const [key, entry] of Object.entries(lock.packages ?? {})) {
  if (!key.startsWith('node_modules/') || entry.dev) continue
  const dir = join(root, key)
  if (!existsSync(dir)) continue
  const name = entry.name ?? key.slice(key.lastIndexOf('node_modules/') + 'node_modules/'.length)
  const version = entry.version ?? ''
  const id = `${name}@${version}`
  if (seen.has(id)) continue
  seen.add(id)
  packages.push({ name, version, dir, license: typeof entry.license === 'string' ? entry.license : '' })
}
packages.sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version))

const licenseFiles = (dir) => {
  try {
    return readdirSync(dir)
      .filter((name) => /^(LICENSE|COPYING|NOTICE)/i.test(name))
      .sort()
  } catch {
    return []
  }
}

const lines = []
lines.push('# Drittanbieter-Hinweise')
lines.push('')
lines.push('Easy-Slicer by Becker enthält die folgenden Komponenten von Drittanbietern.')
lines.push('Die jeweiligen Lizenzbedingungen gelten zusätzlich zur proprietären Lizenz in `LICENSE`.')
lines.push('')
lines.push(`Erzeugt aus \`package-lock.json\` (${packages.length} Produktionspakete).`)
lines.push('')

// Node.js wird als Laufzeit in die EXE eingebettet.
const nodeLicenseCandidates = [
  join(dirname(process.execPath), 'LICENSE'),
  join(root, '.tools', `node-v${process.versions.node}-win-x64`, 'LICENSE'),
]
const nodeLicense = nodeLicenseCandidates.find((file) => existsSync(file))
lines.push('## Node.js')
lines.push('')
lines.push(`Laufzeit: Node.js ${process.versions.node}`)
lines.push('')
lines.push('Lizenz: MIT')
lines.push('')
lines.push('```text')
lines.push(
  nodeLicense
    ? readFileSync(nodeLicense, 'utf8').trim()
    : 'Node.js is licensed under the MIT license. See https://nodejs.org/en/about/previous-releases for the complete license text.',
)
lines.push('```')
lines.push('')

for (const component of packages) {
  lines.push(`## ${component.name} ${component.version}`.trim())
  lines.push('')
  lines.push(`Lizenz: ${component.license || 'siehe Lizenzdatei'}`)
  if (direct.has(component.name)) lines.push('')
  if (direct.has(component.name)) lines.push('Direkte Laufzeitabhängigkeit.')
  const files = licenseFiles(component.dir)
  if (files.length === 0) {
    lines.push('')
    lines.push('Keine separate Lizenzdatei im Paket gefunden; maßgeblich ist die Lizenzangabe des Pakets.')
  } else {
    for (const file of files) {
      const full = join(component.dir, file)
      const text = readFileSync(full, 'utf8').trim()
      if (!text) continue
      lines.push('')
      lines.push(`### ${file}`)
      lines.push('')
      lines.push('```text')
      lines.push(text)
      lines.push('```')
    }
  }
  lines.push('')
}

const output = join(root, 'THIRD_PARTY_NOTICES.md')
writeFileSync(output, `${lines.join('\n').trim()}\n`)
const suspicious = packages.filter((component) => /(^|\W)(A?GPL|LGPL)(\W|$)/i.test(component.license))
if (suspicious.length > 0) {
  console.warn(`WARNUNG: Copyleft-Lizenzangaben gefunden: ${suspicious.map((c) => `${c.name}@${c.version} (${c.license})`).join(', ')}`)
}
console.log(`Drittanbieter-Hinweise: ${output} (${packages.length} Pakete, ${Buffer.byteLength(lines.join('\n'))} Bytes)`)
