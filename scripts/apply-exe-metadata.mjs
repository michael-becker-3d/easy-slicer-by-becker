// Setzt Icon und Versionsinformationen der Windows-EXE. Läuft absichtlich
// VOR postject: resedit baut die PE-Ressourcen neu; der SEA-Blob bleibt so
// unberührt und wird anschließend sauber injiziert.
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import * as ResEdit from 'resedit'

const root = process.cwd()
const exePath = process.argv[2]
if (!exePath) {
  console.error('Aufruf: node scripts/apply-exe-metadata.mjs <exe>')
  process.exit(1)
}

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const iconPath = join(root, 'assets', 'easy-slicer.ico')
const data = readFileSync(exePath)
const exe = ResEdit.NtExecutable.from(data, { ignoreCert: true })
const resources = ResEdit.NtExecutableResource.from(exe)

const iconGroups = ResEdit.Resource.IconGroupEntry.fromEntries(resources.entries)
if (iconGroups.length === 0) {
  throw new Error('Die Laufzeit-EXE enthält keine Icon-Gruppe zum Ersetzen.')
}
const iconFile = ResEdit.Data.IconFile.from(readFileSync(iconPath))
const group = iconGroups[0]
ResEdit.Resource.IconGroupEntry.replaceIconsForResource(
  resources.entries,
  group.id,
  group.lang,
  iconFile.icons.map((icon) => icon.data),
)

const versionInfos = ResEdit.Resource.VersionInfo.fromEntries(resources.entries)
if (versionInfos.length === 0) {
  throw new Error('Die Laufzeit-EXE enthält keine Versionsinformationen.')
}
const version = versionInfos[0]
version.setFileVersion(pkg.version, 1033)
version.setProductVersion(pkg.version, 1033)
version.setStringValues(
  { lang: 1033, codepage: 1200 },
  {
    CompanyName: 'Michael Becker',
    FileDescription: 'Easy-Slicer by Becker - 3D-Druck-Slicer',
    FileVersion: pkg.version,
    InternalName: 'Easy-Slicer-by-Becker',
    LegalCopyright: 'Copyright (c) 2026 Michael Becker. Alle Rechte vorbehalten.',
    OriginalFilename: 'Easy-Slicer-by-Becker.exe',
    ProductName: 'Easy-Slicer by Becker',
    ProductVersion: pkg.version,
    Comments: 'Proprietaere Software. Slice-Engine: siehe LICENSE-SLICE-ENGINE.md.',
  },
)
version.outputToResourceEntries(resources.entries)
resources.outputResource(exe)
writeFileSync(exePath, Buffer.from(exe.generate()))
console.log(`Metadaten gesetzt: Easy-Slicer by Becker ${pkg.version}, Icon aus assets/easy-slicer.ico`)
