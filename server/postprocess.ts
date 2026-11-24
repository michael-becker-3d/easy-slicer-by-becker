import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, extname, isAbsolute, join, resolve } from 'node:path'
import type { PostProcessingScript } from '../shared/types.ts'

export type PostProcessed = {
  gcode: string
  info?: { script: string; durationMs: number; output?: string }
  warning?: string
}

const MAX_CAPTURE = 8000

/** Einfache Argumenttrennung mit Anführungszeichen, ohne Shell auszuführen. */
function splitArgs(input: string): string[] {
  const out: string[] = []
  let current = ''
  let quote: '"' | "'" | null = null
  let escaped = false
  for (const char of input) {
    if (escaped) {
      current += char
      escaped = false
      continue
    }
    if (char === '\\' && quote === '"') {
      escaped = true
      continue
    }
    if (quote) {
      if (char === quote) quote = null
      else current += char
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      continue
    }
    if (/\s/.test(char)) {
      if (current) {
        out.push(current)
        current = ''
      }
      continue
    }
    current += char
  }
  if (current) out.push(current)
  return out
}

function quoteWindows(value: string): string {
  return `"${value.replaceAll('"', '\\"')}"`
}

function expandArgs(input: string, gcodeFile: string, modelName: string, printerName: string): string[] {
  const template = input.trim() || '{gcode}'
  const args = splitArgs(template)
  const expanded = args.map((arg) =>
    arg
      .replaceAll('{gcode}', gcodeFile)
      .replaceAll('{model}', modelName)
      .replaceAll('{printer}', printerName),
  )
  // Orca-Skripte bekommen die G-Code-Datei als Pfad. Wenn der Nutzer den
  // Platzhalter vergessen hat, hängen wir ihn an, statt das Skript ohne Datei
  // zu starten.
  if (!expanded.some((arg) => arg === gcodeFile)) expanded.push(gcodeFile)
  return expanded
}

type CommandAttempt = { command: string; args: string[] }

function commandsFor(scriptPath: string, args: string[]): CommandAttempt[] {
  const win = process.platform === 'win32'
  const ext = extname(scriptPath).toLowerCase()
  if (ext === '.py') {
    // Windows: erst der offizielle Launcher (py -3), dann PATH-Python.
    const candidates: { command: string; prefix: string[] }[] = win
      ? [
          { command: 'py', prefix: ['-3'] },
          { command: 'python', prefix: [] },
          { command: 'python3', prefix: [] },
        ]
      : [
          { command: 'python3', prefix: [] },
          { command: 'python', prefix: [] },
        ]
    return candidates.map(({ command, prefix }) => ({
      command,
      args: [...prefix, scriptPath, ...args],
    }))
  }
  if (win && (ext === '.bat' || ext === '.cmd')) {
    return [
      {
        command: process.env.ComSpec || 'cmd.exe',
        args: ['/d', '/s', '/c', [scriptPath, ...args].map(quoteWindows).join(' ')],
      },
    ]
  }
  if (win && ext === '.ps1') {
    return [
      {
        command: 'powershell.exe',
        args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, ...args],
      },
    ]
  }
  return [{ command: scriptPath, args }]
}

async function execute(
  command: string,
  args: string[],
  cwd: string,
  timeoutSeconds: number,
): Promise<{ code: number | null; stdout: string; stderr: string; timedOut: boolean }> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd,
      windowsHide: true,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    let timedOut = false
    let settled = false
    const append = (current: string, chunk: Buffer) =>
      current.length >= MAX_CAPTURE ? current : (current + chunk.toString()).slice(0, MAX_CAPTURE)
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout = append(stdout, chunk)
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr = append(stderr, chunk)
    })
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, Math.max(5, Math.min(600, timeoutSeconds || 120)) * 1000)
    const finish = (code: number | null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolvePromise({ code, stdout, stderr, timedOut })
    }
    child.on('error', (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', finish)
  })
}

/**
 * Führt das konfigurierte Post-Processing aus. Das Skript bekommt eine
 * temporäre G-Code-Datei, darf sie in-place verändern und wird mit einem
 * harten Timeout beendet. Bei `required: false` bleibt der unveränderte
 * G-Code erhalten und der Fehler wird als Warnung zurückgegeben.
 */
export async function runPostProcessing(
  gcode: string,
  config: PostProcessingScript | undefined,
  context: { modelName: string; printerName: string },
): Promise<PostProcessed> {
  if (!config?.enabled) return { gcode }
  const started = Date.now()
  const requestedPath = config.path.trim().replace(/[;\s]+$/, '')
  const fail = (message: string): PostProcessed => {
    if (config.required !== false) throw new Error(message)
    return { gcode, warning: `${message} — der unveränderte G-Code wird verwendet.` }
  }
  if (!requestedPath) return fail('Post-Processing ist aktiv, aber kein Skriptpfad eingetragen')

  const scriptPath = isAbsolute(requestedPath) ? requestedPath : resolve(requestedPath)
  try {
    const info = await stat(scriptPath)
    if (!info.isFile()) return fail(`Post-Processing-Skript ist keine Datei: ${scriptPath}`)
  } catch {
    return fail(`Post-Processing-Skript nicht gefunden: ${scriptPath}`)
  }

  let dir: string | null = null
  try {
    dir = await mkdtemp(join(tmpdir(), 'easy-slicer-post-'))
    const gcodeFile = join(dir, 'output.gcode')
    await writeFile(gcodeFile, gcode, 'utf8')
    const args = expandArgs(config.args, gcodeFile, context.modelName, context.printerName)
    const cwd = config.workingDirectory.trim()
      ? resolve(config.workingDirectory.trim())
      : dirname(scriptPath)
    let result: Awaited<ReturnType<typeof execute>> | null = null
    let spawnError: unknown = null
    for (const attempt of commandsFor(scriptPath, args)) {
      try {
        result = await execute(attempt.command, attempt.args, cwd, config.timeoutSeconds)
        break
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code
        if (code === 'ENOENT') {
          spawnError = error
          continue
        }
        return fail(error instanceof Error ? error.message : 'Post-Processing konnte nicht ausgeführt werden')
      }
    }
    if (!result) {
      return fail(
        extname(scriptPath).toLowerCase() === '.py'
          ? 'Python-Interpreter nicht gefunden (py/python/python3). Python installieren oder den vollständigen Pfad als Programm eintragen.'
          : `Post-Processing-Programm nicht startbar: ${spawnError instanceof Error ? spawnError.message : scriptPath}`,
      )
    }
    if (result.timedOut) {
      return fail(
        `Post-Processing-Skript hat das Zeitlimit von ${Math.max(5, Math.min(600, config.timeoutSeconds || 120))} s überschritten`,
      )
    }
    if (result.code !== 0) {
      const detail = (result.stderr || result.stdout).trim().slice(-1600)
      return fail(
        `Post-Processing-Skript endete mit Code ${result.code ?? 'unbekannt'}${detail ? `: ${detail}` : ''}`,
      )
    }
    const changed = await readFile(gcodeFile, 'utf8')
    if (!changed.trim()) return fail('Post-Processing-Skript hat eine leere G-Code-Datei hinterlassen')
    return {
      gcode: changed,
      info: {
        script: basename(scriptPath),
        durationMs: Date.now() - started,
        output: (result.stdout || result.stderr).trim().slice(-1600) || undefined,
      },
    }
  } catch (error) {
    return fail(error instanceof Error ? error.message : 'Post-Processing konnte nicht ausgeführt werden')
  } finally {
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => undefined)
  }
}
