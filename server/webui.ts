import type { WebUiInfo } from '../shared/types.ts'

const TIMEOUT_MS = 3000
const MAX_HTML = 200_000
/** Mainsail/Fluidd laufen oft auf einem anderen Port als Moonraker (7125). */
const WEB_PORTS = [80, 443, 8080, 8081, 8000]

function origin(host: string, port: number, secure: boolean): string {
  const clean = host.replace(/^https?:\/\//i, '').replace(/\/.*$/, '').trim()
  const https = secure || port === 443
  const defaultPort = https ? 443 : 80
  return `${https ? 'https' : 'http'}://${clean}${port === defaultPort ? '' : `:${port}`}`
}

function candidates(host: string, port: number | undefined, secure: boolean): string[] {
  const ports = [...new Set([...(port ? [port] : []), ...WEB_PORTS])]
  return ports.map((p) => origin(host, p, secure))
}

/** Prüft, ob der Webserver das Einbetten in ein Fenster erlaubt. */
function framePolicy(headers: Headers): { ok: boolean; reason: string | null } {
  const xfo = (headers.get('x-frame-options') ?? '').toLowerCase()
  if (xfo.includes('deny')) {
    return { ok: false, reason: 'Der Webserver verbietet das Einbetten (X-Frame-Options: DENY).' }
  }
  if (xfo.includes('sameorigin')) {
    return {
      ok: false,
      reason: 'Der Webserver erlaubt das Einbetten nur aus derselben Adresse (X-Frame-Options: SAMEORIGIN).',
    }
  }
  const csp = (headers.get('content-security-policy') ?? '').toLowerCase()
  const match = csp.match(/frame-ancestors([^;]*)/)
  if (match) {
    const value = match[1].trim()
    if (!value.includes('*') && !value.includes('http:') && !value.includes('https:')) {
      return {
        ok: false,
        reason: `Die Content-Security-Policy erlaubt kein Einbetten (frame-ancestors ${value || "'none'"}).`,
      }
    }
  }
  return { ok: true, reason: null }
}

function kindOf(text: string): 'mainsail' | 'fluidd' | 'octoprint' | null {
  const lower = text.toLowerCase()
  if (lower.includes('mainsail')) return 'mainsail'
  if (lower.includes('fluidd')) return 'fluidd'
  if (lower.includes('octoprint')) return 'octoprint'
  return null
}

async function probe(url: string, explicit: boolean): Promise<WebUiInfo | null> {
  try {
    const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(TIMEOUT_MS) })
    if (!res.ok) return null
    const type = res.headers.get('content-type') ?? ''
    if (!type.includes('text/html')) return null
    const html = (await res.text()).slice(0, MAX_HTML)
    const title = html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim() ?? ''
    const kind = kindOf(html) ?? (title ? kindOf(title) : null)
    // Automatisch gefundene Seiten müssen nach Mainsail/Fluidd/OctoPrint aussehen,
    // sonst würde irgendein Webserver im Netz als Druckeroberfläche gelten.
    if (!explicit && !kind) return null
    const policy = framePolicy(res.headers)
    return {
      url: (res.url || url).replace(/\/+$/, ''),
      kind,
      title: title || null,
      embeddable: policy.ok,
      reason: policy.reason,
    }
  } catch {
    return null
  }
}

/**
 * Sucht die Web-Oberfläche des Druckers. Eine ausdrücklich gespeicherte
 * Adresse hat Vorrang; sonst werden der eingegebene Port und die üblichen
 * Web-Ports parallel geprüft (Moonraker selbst läuft auf 7125).
 */
export async function inspectWebUi(input: {
  host: string
  port?: number
  secure?: boolean
  url?: string
}): Promise<WebUiInfo | null> {
  if (input.url) {
    const explicit = await probe(input.url, true)
    if (explicit) return explicit
  }
  const results = await Promise.all(
    candidates(input.host, input.port, !!input.secure).map((url) => probe(url, false)),
  )
  return results.find((r): r is WebUiInfo => !!r) ?? null
}
