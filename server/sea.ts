import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { extname } from 'node:path'
import { getAsset, isSea } from 'node:sea'
import type { NextFunction, Request, Response } from 'express'

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
}

/**
 * Entpackt das native Serial-Binding aus den SEA-Assets und meldet den Pfad
 * über KEPLER_SERIALPORT_BINDING. Nativ kompilierte Module lassen sich nicht in
 * den SEA-Blob einbetten — ohne diesen Schritt bliebe USB in der EXE tot.
 */
export function ensureSerialBinding(): void {
  if (!isSea()) return
  let data: ArrayBuffer
  try {
    data = getAsset('serial-binding.node')
  } catch {
    return
  }
  if (!data) return

  try {
    const dir = join(tmpdir(), `easy-slicer-serial-${process.versions.node}`)
    mkdirSync(dir, { recursive: true })
    const file = join(dir, 'node.napi.node')
    const next = Buffer.from(data)
    let same = false
    try {
      same = readFileSync(file).equals(next)
    } catch {
      same = false
    }
    if (!same) writeFileSync(file, next)
    process.env.KEPLER_SERIALPORT_BINDING = file
  } catch {
    // Ohne Binding bleibt USB aus; Netzwerk und Simulation laufen weiter.
  }
}

/**
 * Liefert das gebaute Frontend aus den in die EXE eingebetteten Assets
 * (Node-SEA). Außerhalb einer SEA-Instanz gibt es nichts zu tun.
 */
export function embeddedAssetHandler() {
  if (!isSea()) return null

  return (req: Request, res: Response, next: NextFunction) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      next()
      return
    }

    const raw = decodeURIComponent((req.path || '/').replace(/^\/+/, ''))
    // Unbekannte Pfade bekommen die SPA-Startseite (Client-Routing)
    for (const key of [raw || 'index.html', 'index.html']) {
      let data: ArrayBuffer
      try {
        data = getAsset(key)
      } catch {
        continue
      }
      if (!data) continue
      res.setHeader('Content-Type', TYPES[extname(key).toLowerCase()] ?? 'application/octet-stream')
      res.setHeader(
        'Cache-Control',
        key === 'index.html' ? 'no-store' : 'public, max-age=31536000, immutable',
      )
      res.end(Buffer.from(data))
      return
    }

    next()
  }
}
