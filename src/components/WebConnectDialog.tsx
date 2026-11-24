import { useEffect, useRef, useState } from 'react'
import type { PrinterProfile, PrinterStatus, WebUiInfo } from '../../shared/types.ts'
import * as api from '../api.ts'
import { loadWebTarget, saveWebTarget, webUrlMatchesHost, type WebTarget } from '../setup.ts'
import { Toggle } from './ui.tsx'

export type WebClientId = 'moonraker' | 'octoprint'

type ClientDef = {
  id: WebClientId
  label: string
  mode: 'klipper' | 'octoprint'
  port: number
  hint: string
}

export const WEB_CLIENTS: ClientDef[] = [
  {
    id: 'moonraker',
    label: 'Moonraker (Klipper)',
    mode: 'klipper',
    port: 7125,
    hint: 'Klipper mit Moonraker, Mainsail oder Fluidd. Standardport 7125. API-Key nur nötig, wenn „Trusted Clients“ ausgeschaltet ist.',
  },
  {
    id: 'octoprint',
    label: 'OctoPrint',
    mode: 'octoprint',
    port: 80,
    hint: 'OctoPrint über die REST-API, meist Port 80 oder 5000. Der API-Key steht in OctoPrint unter Einstellungen → API.',
  },
]

/** Netzwerkdrucker verbinden: IP/Host, Port und Client (Moonraker, OctoPrint). */
export function WebConnectDialog({
  open,
  printer,
  status,
  onClose,
  onConnected,
}: {
  open: boolean
  printer: PrinterProfile
  status: PrinterStatus
  onClose: () => void
  /** Mainsail/Fluidd, falls gefunden — wird direkt in der App geöffnet */
  onConnected: (webUi: WebUiInfo | null) => void
}) {
  const [client, setClient] = useState<WebClientId>('moonraker')
  const [host, setHost] = useState('')
  const [port, setPort] = useState('7125')
  const [secure, setSecure] = useState(false)
  const [apiKey, setApiKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [webUiUrl, setWebUiUrl] = useState('')
  /** Nur beim Öffnen zurücksetzen, nicht bei jedem Status-Update. */
  const wasOpen = useRef(false)

  const def = WEB_CLIENTS.find((c) => c.id === client) ?? WEB_CLIENTS[0]
  const networkConnected =
    status.connection === 'connected' && (status.mode === 'klipper' || status.mode === 'octoprint')

  useEffect(() => {
    if (!open) {
      wasOpen.current = false
      return
    }
    if (wasOpen.current) return
    wasOpen.current = true
    setError(null)
    setNote(null)
    const saved = loadWebTarget()
    if (saved) {
      setClient(saved.client)
      setHost(saved.host)
      setPort(String(saved.port))
      setSecure(saved.secure)
      setApiKey(saved.apiKey)
      // Eine alte Mainsail-Adresse darf nicht die neue Drucker-IP überstimmen.
      setWebUiUrl(webUrlMatchesHost(saved.webUiUrl, saved.host) ? saved.webUiUrl ?? '' : '')
      return
    }
    setWebUiUrl('')
    setPort('7125')
    // Ohne gemerkte Adresse den laufenden Drucker eintragen: Ein Dialog, der
    // „Verbunden“ meldet und dabei leere Felder zeigt, wirkt wie ein Fehler.
    const live = status.port?.match(/^(https?):\/\/([^/:]+)(?::(\d+))?/i)
    if (live) {
      setHost(live[2])
      setPort(live[3] ?? (live[1].toLowerCase() === 'https' ? '443' : '80'))
      setSecure(live[1].toLowerCase() === 'https')
      if (status.mode === 'octoprint') setClient('octoprint')
      else if (status.mode === 'klipper') setClient('moonraker')
    }
  }, [open, status.mode, status.port])

  const chooseClient = (id: WebClientId) => {
    const next = WEB_CLIENTS.find((c) => c.id === id) ?? WEB_CLIENTS[0]
    const prev = WEB_CLIENTS.find((c) => c.id === client)
    setClient(id)
    if (!port || Number(port) === prev?.port) setPort(String(next.port))
    setError(null)
  }

  /** "192.168.1.50:7125" oder "https://voron.local" direkt übernehmen. */
  const onHostChange = (value: string) => {
    const m = value.trim().match(/^(https?:\/\/)?([^/:]+):(\d+)\/?$/i)
    const nextHost = m ? m[2] : value
    setHost(nextHost)
    if (m) {
      setPort(m[3])
      if (/^https/i.test(m[1] ?? '')) setSecure(true)
    }
    // Beim Wechsel der IP die zum alten Host gehörende Mainsail-Adresse fallen
    // lassen; sonst öffnet „Verbinden“ weiterhin die Oberfläche des AD5X.
    if (webUiUrl.trim() && !webUrlMatchesHost(webUiUrl, nextHost.trim())) setWebUiUrl('')
  }

  const cleanHost = host.trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '')
  const portNum = Number(port) || def.port
  const url = cleanHost ? `${secure ? 'https' : 'http'}://${cleanHost}:${portNum}` : ''

  const connect = async () => {
    if (!cleanHost) {
      setError('IP-Adresse oder Hostname fehlt.')
      return
    }
    setBusy(true)
    setError(null)
    setNote(null)
    const target: WebTarget = {
      client,
      host: cleanHost,
      port: portNum,
      secure,
      apiKey: apiKey.trim(),
      webUiUrl: webUrlMatchesHost(webUiUrl, cleanHost) ? webUiUrl.trim() : '',
    }
    try {
      const st = await api.connectPrinter({
        mode: def.mode,
        url,
        profileId: printer.id,
        apiKey: apiKey.trim() || undefined,
      })
      setNote(`${def.label} verbunden — ${st.firmware ?? 'Firmware unbekannt'}`)
      // Nach der IP-Eingabe gleich Mainsail/Fluidd suchen und mitliefern —
      // die gefundene Adresse wird getrennt vom Moonraker-Port gemerkt.
      const explicitWebUi = webUrlMatchesHost(webUiUrl, cleanHost) ? webUiUrl.trim() : undefined
      const webUi = await api
        .inspectWebUi(cleanHost, portNum, secure, explicitWebUi)
        .catch(() => null)
      saveWebTarget({ ...target, webUiUrl: webUi?.url ?? explicitWebUi ?? '' })
      onConnected(webUi)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Verbindung fehlgeschlagen.')
    } finally {
      setBusy(false)
    }
  }

  const disconnect = async () => {
    setBusy(true)
    setError(null)
    try {
      await api.disconnectPrinter()
      setNote('Verbindung getrennt.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Trennen fehlgeschlagen.')
    } finally {
      setBusy(false)
    }
  }

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-ink-950/70 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Web-Drucker"
        className="w-full max-w-md rounded-3xl border border-line/70 bg-ink-900/95 p-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 className="text-[13px] font-semibold tracking-[0.16em] text-white/85 uppercase">Web-Drucker</h2>
            <p className="mt-1 text-[10px] leading-snug text-white/35">
              IP, Port und Client wählen — z. B. Moonraker (Klipper) oder OctoPrint.
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-white/30 transition hover:text-white/70" aria-label="Schließen">
            ✕
          </button>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-1.5">
          {WEB_CLIENTS.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => chooseClient(c.id)}
              className={`rounded-xl border px-2.5 py-2 text-left transition ${
                client === c.id
                  ? 'border-amber/60 bg-amber/10 text-amber'
                  : 'border-line/70 bg-ink-900/50 text-white/60 hover:border-white/20 hover:text-white/85'
              }`}
            >
              <span className="block text-[11px] font-semibold">{c.label}</span>
              <span className="mt-0.5 block text-[9px] text-white/30">Port {c.port}</span>
            </button>
          ))}
        </div>

        <div className="mt-3 grid grid-cols-[minmax(0,1fr)_84px] gap-2">
          <label className="min-w-0">
            <span className="mb-1 block text-[10px] font-medium tracking-wider text-white/40 uppercase">
              IP / Host
            </span>
            <input
              value={host}
              onChange={(e) => onHostChange(e.target.value)}
              placeholder={client === 'octoprint' ? '192.168.1.50' : 'voron.local'}
              inputMode="url"
              autoFocus
              className="w-full rounded-lg border border-line/80 bg-ink-900/70 px-2 py-1.5 text-[11px] text-white/80 outline-none focus:border-amber/50"
            />
          </label>
          <label>
            <span className="mb-1 block text-[10px] font-medium tracking-wider text-white/40 uppercase">Port</span>
            <input
              value={port}
              onChange={(e) => setPort(e.target.value.replace(/[^\d]/g, ''))}
              inputMode="numeric"
              className="tabular w-full rounded-lg border border-line/80 bg-ink-900/70 px-2 py-1.5 text-center text-[11px] text-white/80 outline-none focus:border-amber/50"
            />
          </label>
        </div>

        <div className="mt-2 flex items-center justify-between gap-2">
          <Toggle checked={secure} onChange={setSecure} label="HTTPS" />
          <span className="truncate text-[9px] text-white/25">{url || 'http://…'}</span>
        </div>

        <label className="mt-2 block">
          <span className="mb-1 block text-[10px] font-medium tracking-wider text-white/40 uppercase">
            Mainsail/Fluidd (optional)
          </span>
          <input
            value={webUiUrl}
            onChange={(e) => setWebUiUrl(e.target.value)}
            placeholder="http://192.168.1.50:8080"
            className="w-full rounded-lg border border-line/80 bg-ink-900/70 px-2 py-1.5 text-[11px] text-white/80 outline-none focus:border-amber/50"
          />
          <span className="mt-1 block text-[9px] leading-snug text-white/25">
            Leer lassen: die Oberfläche wird auf Port 80/443/8080/8081/8000 gesucht und die Adresse dauerhaft gemerkt.
          </span>
        </label>

        <label className="mt-2 block">
          <span className="mb-1 block text-[10px] font-medium tracking-wider text-white/40 uppercase">
            API-Key {client === 'octoprint' ? '' : '(optional)'}
          </span>
          <input
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            type="password"
            autoComplete="off"
            placeholder={client === 'octoprint' ? 'erforderlich, außer anonym erlaubt' : 'nur bei geschützten Trusted Clients'}
            className="w-full rounded-lg border border-line/80 bg-ink-900/70 px-2 py-1.5 text-[11px] text-white/80 outline-none focus:border-amber/50"
          />
        </label>

        <p className="mt-2 text-[9px] leading-snug text-white/30">{def.hint}</p>
        {client === 'octoprint' && (
          <p className="mt-1 text-[9px] leading-snug text-amber/60">
            Hinweis: OctoPrint liefert Bett-Mesh und Probe-Werte nicht zurück — Bettvermessung und Z-Messung bleiben
            Moonraker bzw. USB vorbehalten.
          </p>
        )}

        {networkConnected && (
          <div className="mt-2 rounded-xl border border-mint/30 bg-mint/8 px-2.5 py-1.5 text-[10px] text-mint/90">
            Verbunden: {status.port ?? '—'} · {status.firmware ?? 'Firmware unbekannt'}
          </div>
        )}

        {error && (
          <div className="mt-2 rounded-xl border border-rose/35 bg-rose/10 px-2.5 py-1.5 text-[10px] leading-snug text-rose/90">
            {error}
          </div>
        )}
        {note && !error && (
          <div className="mt-2 rounded-xl border border-mint/30 bg-mint/8 px-2.5 py-1.5 text-[10px] text-mint/90">{note}</div>
        )}

        <div className="mt-3 flex gap-2">
          <button
            type="button"
            disabled={busy || !cleanHost}
            onClick={() => void connect()}
            className="flex-1 rounded-xl bg-gradient-to-r from-mint to-[#8ef0c8] py-2 text-xs font-semibold text-ink-950 transition hover:brightness-110 disabled:opacity-35"
          >
            {busy ? 'Verbinde …' : 'Verbinden'}
          </button>
          {networkConnected && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void disconnect()}
              className="rounded-xl border border-rose/40 bg-rose/10 px-3 py-2 text-xs font-medium text-rose transition hover:bg-rose/20 disabled:opacity-40"
            >
              Trennen
            </button>
          )}
        </div>

        <p className="mt-2 text-[9px] leading-snug text-white/20">
          Der API-Key wird nur lokal im Browser gespeichert und an den Drucker weitergegeben.
        </p>
      </div>
    </div>
  )
}
