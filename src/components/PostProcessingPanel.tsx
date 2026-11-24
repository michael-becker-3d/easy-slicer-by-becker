import { useEffect, useState } from 'react'
import type { PostProcessingScript } from '../../shared/types.ts'
import { EMPTY_POST_PROCESSING } from '../../shared/types.ts'
import { Chip, InfoDot } from './ui.tsx'

type Props = {
  value: PostProcessingScript
  onSave: (next: PostProcessingScript) => void
  printerName: string
}

/**
 * Post-Processing wie in OrcaSlicer: ein externes Programm bekommt die
 * G-Code-Datei, darf sie verändern und wird direkt nach dem Slicen gestartet.
 * Beispiele sind Hersteller-Tools (Flashforge AD5X Z-Mod) und eigene Skripte.
 */
export function PostProcessingPanel({ value, onSave, printerName }: Props) {
  const [draft, setDraft] = useState<PostProcessingScript>(value)
  useEffect(() => setDraft(value), [value])
  const set = <K extends keyof PostProcessingScript>(key: K, next: PostProcessingScript[K]) =>
    setDraft((current) => ({ ...current, [key]: next }))

  return (
    <section className="rounded-2xl border border-mint/25 bg-mint/[0.035] p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="flex items-center gap-1 text-[10px] font-semibold tracking-[0.16em] text-mint/80 uppercase">
            Post-Processing <InfoDot label="Post-Processing" />
          </h3>
          <p className="mt-1 text-[9px] leading-relaxed text-white/35">
            Wird nach dem Slicen auf diesem PC ausgeführt. EXE, BAT/CMD, PS1, Python-Dateien und ausführbare Dateien
            werden gestartet; <code className="text-mint/70">{'{gcode}'}</code> ist die temporäre G-Code-Datei. Das Skript
            darf sie verändern. Python muss auf dem PC installiert sein. Einstellungen gelten nur für {printerName}.
          </p>
        </div>
        <Chip tone={draft.enabled ? 'mint' : 'neutral'}>{draft.enabled ? 'aktiv' : 'aus'}</Chip>
      </div>

      <label className="mt-2 flex items-center gap-2 text-[10px] text-white/55">
        <input
          type="checkbox"
          checked={draft.enabled}
          onChange={(e) => set('enabled', e.target.checked)}
          className="accent-mint"
        />
        Post-Processing nach jedem Slice ausführen
      </label>

      <div className="mt-2 space-y-2">
        <label className="block">
          <span className="mb-1 block text-[9px] font-medium tracking-wider text-white/35 uppercase">
            Programm / Skriptpfad
          </span>
          <input
            value={draft.path}
            onChange={(e) => set('path', e.target.value)}
            placeholder={'z. B. C:\\Tools\\AD5X_Z-Mod\\ad5x-z-mod.exe oder C:\\Tools\\script.py'}
            spellCheck={false}
            className="w-full rounded-xl border border-line/80 bg-ink-900/70 px-2.5 py-1.5 font-mono text-[10px] text-white/80 outline-none placeholder:text-white/20 focus:border-mint/60"
          />
          <span className="mt-1 block text-[8px] leading-snug text-white/25">
            Absoluten Windows-Pfad eintragen. Der Dateiauswahl-Dialog des Browsers liefert keinen vollständigen Pfad.
          </span>
        </label>

        <div className="grid gap-2 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-[9px] font-medium tracking-wider text-white/35 uppercase">
              Argumente
            </span>
            <input
              value={draft.args}
              onChange={(e) => set('args', e.target.value)}
              placeholder="{gcode}"
              spellCheck={false}
              className="w-full rounded-xl border border-line/80 bg-ink-900/70 px-2.5 py-1.5 font-mono text-[10px] text-white/80 outline-none placeholder:text-white/20 focus:border-mint/60"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[9px] font-medium tracking-wider text-white/35 uppercase">
              Arbeitsordner (optional)
            </span>
            <input
              value={draft.workingDirectory}
              onChange={(e) => set('workingDirectory', e.target.value)}
              placeholder="leer = Ordner des Skripts"
              spellCheck={false}
              className="w-full rounded-xl border border-line/80 bg-ink-900/70 px-2.5 py-1.5 font-mono text-[10px] text-white/80 outline-none placeholder:text-white/20 focus:border-mint/60"
            />
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <label className="flex items-center gap-2 text-[10px] text-white/50">
            Timeout
            <input
              type="number"
              min={5}
              max={600}
              value={draft.timeoutSeconds}
              onChange={(e) => set('timeoutSeconds', Math.max(5, Math.min(600, Number(e.target.value) || 120)))}
              className="w-16 rounded-lg border border-line/80 bg-ink-900/70 px-2 py-1 text-[10px] text-white/80 outline-none focus:border-mint/60"
            />
            s
          </label>
          <label className="flex items-center gap-2 text-[10px] text-white/50">
            <input
              type="checkbox"
              checked={draft.required !== false}
              onChange={(e) => set('required', e.target.checked)}
              className="accent-mint"
            />
            Bei Fehler Slice abbrechen
          </label>
        </div>

        <div className="rounded-xl border border-amber/20 bg-amber/[0.04] px-2.5 py-1.5 text-[9px] leading-relaxed text-amber/70">
          Vorschau und Statistik werden vor dem Skript berechnet. Nach einer Änderung am G-Code können sie vom
          tatsächlichen Druck abweichen.
        </div>

        <div className="flex items-center justify-between gap-2">
          <span className="text-[9px] text-white/25">
            {draft.enabled && draft.path.trim() ? 'wird beim nächsten Slice ausgeführt' : 'kein Skript aktiv'}
          </span>
          <button
            type="button"
            onClick={() =>
              onSave({
                ...EMPTY_POST_PROCESSING,
                ...draft,
                path: draft.path.trim().replace(/[;\s]+$/, ''),
                args: draft.args.trim() || '{gcode}',
                workingDirectory: draft.workingDirectory.trim(),
                timeoutSeconds: Math.max(5, Math.min(600, draft.timeoutSeconds || 120)),
              })
            }
            className="rounded-xl border border-mint/50 bg-mint/15 px-3 py-1.5 text-[10px] font-semibold text-mint transition hover:bg-mint/25"
          >
            Speichern
          </button>
        </div>
      </div>
    </section>
  )
}
