import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { PrinterHub } from '../server/printer/hub.ts'
import type { PrinterManager } from '../server/printer/manager.ts'
import type { PrinterStatus } from '../shared/types.ts'
import { PrintJobQueue } from '../server/printer/jobs.ts'
import { createFileJobStore } from '../server/printer/jobStore.ts'

const status = (
  connection: PrinterStatus['connection'] = 'connected',
  printState: PrinterStatus['print']['state'] = 'idle',
): PrinterStatus => ({
  connection,
  mode: 'simulation',
  port: connection === 'connected' ? 'simulation' : null,
  firmware: null,
  bed: { x: 220, y: 220, z: 250 },
  temps: { nozzle: 22, nozzleTarget: 0, bed: 21, bedTarget: 0 },
  position: { x: 0, y: 0, z: 0 },
  zOffset: 0,
  babystep: 0,
  message: null,
  print: { state: printState, file: null, progress: 0, etaSeconds: null },
})

type FakeManager = EventEmitter & {
  status: PrinterStatus
  readonly connected: boolean
  print: (gcode: string, name: string) => Promise<void>
}

function makeManager(id: string, started: string[]): FakeManager {
  const manager = new EventEmitter() as FakeManager
  manager.status = status()
  Object.defineProperty(manager, 'connected', {
    get: () => manager.status.connection === 'connected',
  })
  manager.print = async (_gcode, name) => {
    started.push(`${id}:${name}`)
    manager.status = {
      ...manager.status,
      print: { state: 'printing', file: name, progress: 0.01, etaSeconds: 60 },
    }
    manager.emit('status', manager.status)
  }
  return manager
}

function makeHub(managers: Map<string, FakeManager>): PrinterHub {
  return {
    resolve(id?: unknown) {
      const key = typeof id === 'string' ? id : ''
      const manager = managers.get(key)
      if (!manager) throw new Error(`Testdrucker ${key} fehlt.`)
      return manager as unknown as PrinterManager
    },
  } as unknown as PrinterHub
}

const dir = mkdtempSync(join(tmpdir(), 'easy-slicer-queue-'))
const store = createFileJobStore(dir)
const started: string[] = []
const managers = new Map<string, FakeManager>([
  ['a', makeManager('a', started)],
  ['b', makeManager('b', started)],
])
const queue = new PrintJobQueue(makeHub(managers), () => undefined, { store })

const a1 = queue.enqueue({ printerId: 'a', name: 'a1.gcode', gcode: '; a1\nG28\n' })
const b1 = queue.enqueue({ printerId: 'b', name: 'b1.gcode', gcode: '; b1\nG28\n' })
assert.equal(a1.status, 'running')
assert.equal(b1.status, 'running')
assert.deepEqual(started.sort(), ['a:a1.gcode', 'b:b1.gcode'], 'beide Drucker starten parallel')

const a2 = queue.enqueue({ printerId: 'a', name: 'a2.gcode', gcode: '; a2\nG28\n' })
assert.equal(a2.status, 'queued', 'ein zweiter Auftrag desselben Druckers wartet')
assert.equal(started.length, 2, 'der zweite Auftrag startet nicht parallel auf demselben Drucker')
assert.equal(store.readGcode(a2.id), '; a2\nG28\n', 'wartender G-Code liegt auf der Platte')
assert.ok(existsSync(join(dir, `${a2.id}.gcode`)), 'G-Code-Datei für den Neustart ist vorhanden')
assert.equal(queue.list().filter((job) => job.status === 'running').length, 2)

queue.stop()

// Neustart: laufende Aufträge werden nicht blind wiederholt; wartende bleiben.
const restartedStarted: string[] = []
const restartedManagers = new Map<string, FakeManager>([
  ['a', makeManager('a', restartedStarted)],
  ['b', makeManager('b', restartedStarted)],
])
for (const manager of restartedManagers.values()) manager.status = status('disconnected')
const restarted = new PrintJobQueue(makeHub(restartedManagers), () => undefined, { store })
const restored = restarted.list()
assert.equal(restored.find((job) => job.name === 'a1.gcode')?.status, 'error')
assert.equal(restored.find((job) => job.name === 'b1.gcode')?.status, 'error')
assert.equal(restored.find((job) => job.name === 'a2.gcode')?.status, 'queued')
assert.equal(restored.find((job) => job.name === 'a2.gcode')?.message, 'Wartet auf Verbindung zum Drucker.')

restarted.resumeAll()
assert.equal(restartedStarted.length, 0, 'ohne Verbindung startet nach dem Neustart nichts')
assert.equal(restarted.list().find((job) => job.name === 'a2.gcode')?.status, 'queued')

// Verbindung kommt zurück: nur der wartende Auftrag dieses Druckers startet.
restartedManagers.get('a')!.status = status('connected', 'idle')
restarted.observe('a', restartedManagers.get('a')!.status)
assert.deepEqual(restartedStarted, ['a:a2.gcode'], 'wartender Auftrag startet nach Verbindungsaufbau')
assert.equal(restarted.list().find((job) => job.name === 'a2.gcode')?.status, 'running')

// Ein belegter Drucker blockiert den nächsten Auftrag statt ihn zu verlieren.
const a3 = restarted.enqueue({ printerId: 'a', name: 'a3.gcode', gcode: '; a3\n' })
assert.equal(a3.status, 'queued')
assert.equal(restartedStarted.length, 1, 'belegter Drucker startet keinen zweiten Auftrag')
assert.match(restarted.list().find((job) => job.id === a3.id)?.message ?? '', /belegt|wartet/i)

restarted.stop()

// Ein alter complete-Status darf einen neuen Auftrag nicht als fertig melden.
const staleDir = mkdtempSync(join(tmpdir(), 'easy-slicer-queue-stale-'))
const staleStore = createFileJobStore(staleDir)
const staleManager = makeManager('stale', [])
staleManager.status = status('connected', 'complete')
staleManager.print = async () => undefined
const staleQueue = new PrintJobQueue(
  makeHub(new Map([['stale', staleManager]])),
  () => undefined,
  { store: staleStore },
)
const staleJob = staleQueue.enqueue({ printerId: 'stale', name: 'stale.gcode', gcode: '; stale\n' })
assert.equal(staleJob.status, 'running')
staleManager.status = status('connected', 'complete')
staleManager.emit('status', staleManager.status)
assert.equal(
  staleQueue.list().find((job) => job.id === staleJob.id)?.status,
  'error',
  'alter complete-Status wird nicht als neuer Druckabschluss gewertet',
)
assert.match(staleQueue.list().find((job) => job.id === staleJob.id)?.message ?? '', /nicht bestätigt/i)
staleQueue.stop()
rmSync(staleDir, { recursive: true, force: true })

rmSync(dir, { recursive: true, force: true })
console.log('OK: Queue überlebt Neustart; zwei Drucker laufen parallel, belegte Drucker warten; alter complete-Status wird abgewiesen.')
