import net from 'node:net'
import os from 'node:os'
import type { MoonrakerHost } from '../../shared/types.ts'

const DEFAULT_PORT = 7125
const CONNECT_TIMEOUT_MS = 220
const CONCURRENCY = 64

/** IPv4-Netze (/24) aller aktiven Netzwerkkarten, ohne Loopback. */
function localSubnets(): string[] {
  const prefixes = new Set<string>()
  for (const list of Object.values(os.networkInterfaces())) {
    for (const addr of list ?? []) {
      if (addr.family !== 'IPv4' || addr.internal) continue
      const parts = addr.address.split('.')
      if (parts.length !== 4) continue
      prefixes.add(`${parts[0]}.${parts[1]}.${parts[2]}`)
    }
  }
  return [...prefixes]
}

function reachable(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port })
    let settled = false
    const done = (ok: boolean) => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve(ok)
    }
    socket.setTimeout(CONNECT_TIMEOUT_MS)
    socket.once('connect', () => done(true))
    socket.once('timeout', () => done(false))
    socket.once('error', () => done(false))
  })
}

/** Fragt /server/info — nur echte Moonraker antworten mit klippy_state. */
async function moonrakerInfo(
  host: string,
  port: number,
): Promise<{ name: string | null; klippyState: string | null } | null> {
  for (const path of ['/server/info', '/printer/info']) {
    try {
      const res = await fetch(`http://${host}:${port}${path}`, { signal: AbortSignal.timeout(1500) })
      if (!res.ok) continue
      const data = (await res.json()) as { result?: Record<string, unknown> }
      const result = data.result
      if (!result || typeof result.klippy_state !== 'string') continue
      const name = typeof result.hostname === 'string' ? result.hostname : null
      return { name, klippyState: result.klippy_state }
    } catch {
      /* nächster Endpunkt */
    }
  }
  return null
}

/**
 * Sucht Moonraker-Instanzen im lokalen Netz: offene TCP-Ports auf 7125 im
 * eigenen /24 (plus 127.0.0.1) und danach die Bestätigung über /server/info.
 * Reine HTTP-Suche — kein mDNS nötig, funktioniert auch mit Firewall-Regeln,
 * die Multicast blocken. Ergebnisse sind nach IP sortiert.
 */
export async function discoverMoonraker(
  opts: { port?: number; timeoutMs?: number } = {},
): Promise<MoonrakerHost[]> {
  const port = opts.port && opts.port > 0 ? opts.port : DEFAULT_PORT
  const deadline = Date.now() + (opts.timeoutMs ?? 5000)

  const candidates = new Set<string>(['127.0.0.1'])
  for (const prefix of localSubnets()) {
    for (let i = 1; i <= 254; i++) candidates.add(`${prefix}.${i}`)
  }

  const hosts = [...candidates]
  const open: string[] = []
  let next = 0
  const worker = async () => {
    while (next < hosts.length && Date.now() < deadline) {
      const host = hosts[next++]
      if (await reachable(host, port)) open.push(host)
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker))

  const found: MoonrakerHost[] = []
  await Promise.all(
    open.map(async (host) => {
      const info = await moonrakerInfo(host, port)
      if (!info) return
      found.push({
        host,
        port,
        url: `http://${host}:${port}`,
        name: info.name,
        klippyState: info.klippyState,
      })
    }),
  )

  const numeric = (ip: string) => ip.split('.').reduce((sum, part) => sum * 256 + Number(part), 0)
  return found.sort((a, b) => numeric(a.host) - numeric(b.host))
}
