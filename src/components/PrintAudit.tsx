import type { DeepPartial, PrintSettings } from '../../shared/types.ts'
import type { AuditFinding, AuditSeverity } from '../../shared/audit.ts'
import { auditSummary } from '../../shared/audit.ts'

const SEVERITY: Record<AuditSeverity, { dot: string; text: string; label: string }> = {
  critical: { dot: 'bg-rose', text: 'text-rose', label: 'Kritisch' },
  warn: { dot: 'bg-amber', text: 'text-amber', label: 'Warnung' },
  info: { dot: 'bg-sky', text: 'text-sky', label: 'Hinweis' },
}

/**
 * Druckbarkeits-Audit (V-17): Befunde mit Ort, Messwert, Folge und Fix.
 * Die Begründung steckt in einem aufklappbaren „Warum“ — genau der Teil, den
 * ein reiner Parameter-Slicer nicht liefert.
 */
export function PrintAudit({
  findings,
  onApply,
}: {
  findings: AuditFinding[]
  onApply: (patch: DeepPartial<PrintSettings>) => void
}) {
  const summary = auditSummary(findings)
  return (
    <section className="rounded-2xl border border-line/70 bg-ink-900/55 p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-[10px] font-semibold tracking-[0.16em] text-white/45 uppercase">Druckbarkeits-Audit</h3>
          <p className="mt-0.5 text-[10px] leading-snug text-white/30">
            Modell, Profil und Bett zusammen geprüft — jeder Befund nennt Ort, Zahl, Folge und Begründung.
          </p>
        </div>
        <div className="flex shrink-0 gap-1">
          {summary.critical > 0 && (
            <span className="rounded-full border border-rose/40 bg-rose/10 px-1.5 py-0.5 text-[9px] font-semibold text-rose">
              {summary.critical} kritisch
            </span>
          )}
          {summary.warn > 0 && (
            <span className="rounded-full border border-amber/40 bg-amber/10 px-1.5 py-0.5 text-[9px] font-semibold text-amber">
              {summary.warn} offen
            </span>
          )}
          {summary.total === 0 && (
            <span className="rounded-full border border-mint/40 bg-mint/10 px-1.5 py-0.5 text-[9px] font-semibold text-mint">
              keine Befunde
            </span>
          )}
        </div>
      </div>

      {summary.total === 0 ? (
        <p className="mt-2 rounded-lg border border-mint/25 bg-mint/[0.04] px-2 py-1.5 text-[10px] leading-snug text-mint/80">
          Modell, Profil und Bett passen zusammen. Das Audit prüft 17 Regeln von Bettmaß über Schichthöhe und Stützen bis
          Fluss und Haftung — die Erklärungen bleiben auch bei grünem Befund über die Einstellungen erreichbar.
        </p>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {findings.map((finding) => {
            const tone = SEVERITY[finding.severity]
            return (
              <li key={finding.id} className="rounded-xl border border-line/60 bg-ink-950/40 px-2 py-1.5">
                <div className="flex items-start gap-1.5">
                  <span className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${tone.dot}`} aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-1.5">
                      <span className="text-[11px] font-semibold text-white/85">{finding.title}</span>
                      <span className={`text-[8px] font-semibold tracking-wide uppercase ${tone.text}`}>{tone.label}</span>
                    </div>
                    <div className="mt-0.5 text-[9px] leading-snug text-white/35">
                      {finding.where} · <span className="tabular text-white/55">{finding.value}</span>
                    </div>
                    <p className="mt-1 text-[9px] leading-snug text-white/50">{finding.consequence}</p>
                    <details className="mt-1 group">
                      <summary className="cursor-pointer list-none text-[9px] font-medium text-sky/70 transition hover:text-sky">
                        Warum?
                      </summary>
                      <p className="mt-0.5 rounded-lg border border-sky/20 bg-sky/[0.04] px-2 py-1 text-[9px] leading-snug text-sky/75">
                        {finding.why}
                      </p>
                    </details>
                    {finding.fix && (
                      <button
                        type="button"
                        onClick={() => onApply(finding.fix!.patch)}
                        className="mt-1 rounded-md border border-amber/40 bg-amber/10 px-2 py-0.5 text-[9px] font-medium text-amber transition hover:bg-amber/20"
                      >
                        {finding.fix.label}
                      </button>
                    )}
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      <p className="mt-2 text-[8px] leading-snug text-white/20">
        Ein Klick übernimmt nur den genannten Wert. Nichts wird gedruckt oder hochgeladen; die Prüfung läuft ausschließlich
        lokal.
      </p>
    </section>
  )
}
