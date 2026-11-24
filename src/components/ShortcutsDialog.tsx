import { useEffect } from 'react'

type Row = { keys: string; action: string; active?: boolean }
type Group = { title: string; rows: Row[] }

/**
 * Tastenkürzel wie im OrcaSlicer. Was in dieser App (noch) keine Funktion hat,
 * steht grau dabei — die Taste läuft dann ins Leere, statt etwas Falsches zu tun.
 */
const GROUPS: Group[] = [
  {
    title: 'Global',
    rows: [
      { keys: 'Strg + I', action: 'Objekt importieren (STL/3MF/OBJ/PLY)', active: true },
      { keys: 'Strg + O', action: 'Projekt/Datei öffnen', active: true },
      { keys: 'Strg + N', action: 'Neues Werkstück laden', active: true },
      { keys: 'Strg + S', action: 'Projekt speichern' },
      { keys: 'Strg + R', action: 'Platte slicen', active: true },
      { keys: 'Strg + G', action: 'G-Code exportieren' },
      { keys: 'Strg + 1 … 6', action: 'Kameraansicht (oben, vorn …)' },
      { keys: 'Strg + E', action: 'Objektnamen in 3D ein-/ausblenden' },
    ],
  },
  {
    title: 'Bearbeiten',
    rows: [
      { keys: 'Strg + Z', action: 'Rückgängig', active: true },
      { keys: 'Strg + Y', action: 'Wiederholen', active: true },
      { keys: 'Strg + C', action: 'Auswahl kopieren', active: true },
      { keys: 'Strg + V', action: 'Kopierte Objekte einfügen', active: true },
      { keys: 'Strg + K', action: 'Auswahl klonen', active: true },
      { keys: 'Strg + A', action: 'Alle Objekte auswählen', active: true },
      { keys: 'Entf / Backspace', action: 'Auswahl löschen', active: true },
      { keys: 'Strg + D', action: 'Alles löschen', active: true },
      { keys: 'Esc', action: 'Auswahl und Werkzeug schließen', active: true },
    ],
  },
  {
    title: 'Anordnen und Bewegen',
    rows: [
      { keys: 'A', action: 'Alle Objekte anordnen', active: true },
      { keys: 'Q', action: 'Automatisch ausrichten', active: true },
      { keys: 'Pfeiltasten', action: 'Auswahl 10 mm verschieben', active: true },
      { keys: 'Shift + Pfeil', action: 'Auswahl 1 mm verschieben', active: true },
      { keys: 'Bild ↑ / ↓', action: 'Auswahl 45° um Z drehen', active: true },
      { keys: 'M', action: 'Größe / Position (Gizmo)', active: true },
      { keys: 'R', action: 'Dreh-Gizmo', active: true },
      { keys: 'S', action: 'Skalieren', active: true },
      { keys: 'F', action: 'Auf die Platte legen', active: true },
      { keys: 'V', action: 'Druckbar ein/aus', active: true },
      { keys: '1 … 9', action: 'Filament zuweisen' },
    ],
  },
  {
    title: 'Werkzeuge',
    rows: [
      { keys: 'C', action: 'Teilen / Schneiden', active: true },
      { keys: 'T', action: 'Text aufbringen', active: true },
      { keys: 'U', action: 'Messen', active: true },
      { keys: 'L', action: 'Stützen malen (grün = Stütze, Shift = Blocker)', active: true },
      { keys: 'Y / B', action: 'Ausgewählte Teile zusammenbauen', active: true },
      { keys: 'P', action: 'Naht malen' },
      { keys: 'H', action: 'Fuzzy Skin malen' },
      { keys: 'N', action: 'Mehrfarb-Malerei' },
      { keys: 'E', action: 'Brim-Ears malen' },
    ],
  },
  {
    title: 'Ansicht und Stützen-Malerei',
    rows: [
      { keys: 'I / O', action: 'Zoom rein / raus', active: true },
      { keys: 'Mausrad', action: 'Zoom', active: true },
      { keys: '?', action: 'Diese Liste öffnen', active: true },
      { keys: 'Strg + Mausrad', action: 'Pinselgröße ändern' },
      { keys: 'Shift + Klick', action: 'Beim Malen Stütze ↔ Blocker tauschen', active: true },
    ],
  },
]

export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === '?') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-[60] overflow-y-auto bg-ink-950/75 p-4 backdrop-blur-sm" onMouseDown={onClose}>
      <div
        className="mx-auto mt-6 w-full max-w-3xl rounded-2xl border border-line/70 bg-ink-900 p-4 shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-white/85">Tastenkürzel (wie OrcaSlicer)</h3>
            <p className="mt-0.5 text-[10px] leading-snug text-white/35">
              Helle Tasten wirken hier. Graue Kürzel gibt es in Orca, sie haben in dieser App noch keine Funktion.
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-white/30 transition hover:text-white/70">
            ✕
          </button>
        </div>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          {GROUPS.map((group) => (
            <div key={group.title}>
              <div className="text-[8px] font-semibold tracking-[0.18em] text-white/25 uppercase">{group.title}</div>
              <ul className="mt-1 space-y-1">
                {group.rows.map((row) => (
                  <li key={row.keys} className="flex items-baseline justify-between gap-3">
                    <kbd
                      className={`shrink-0 rounded border px-1.5 py-0.5 text-[9px] tabular ${
                        row.active ? 'border-amber/40 bg-amber/10 text-amber' : 'border-line/60 bg-ink-950/50 text-white/30'
                      }`}
                    >
                      {row.keys}
                    </kbd>
                    <span className={`text-right text-[10px] leading-snug ${row.active ? 'text-white/65' : 'text-white/25'}`}>
                      {row.action}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <p className="mt-3 border-t border-line/60 pt-2 text-[9px] leading-snug text-white/25">
          Tastenkürzel wirken nicht, während du in einem Textfeld tippst. Esc schließt dieses Fenster.
        </p>
      </div>
    </div>
  )
}
