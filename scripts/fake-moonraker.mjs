// Minimaler Moonraker-Ersatz für Tests: beantwortet die Endpunkte, die der
// Klipper-Client nutzt, und protokolliert Skripte, Uploads und Starts.
import http from 'node:http'

const state = {
  scripts: [],
  uploads: [],
  started: [],
  mesh: null,
  bed: 25,
  nozzle: 210,
  homed: false,
  probeZ: null,
  probeRuns: 0,
  loadCell: true,
}

const MESH = [
  [0.02, -0.01, 0.0, 0.01, 0.03],
  [0.01, 0.0, -0.02, 0.0, 0.01],
  [0.0, -0.01, 0.01, 0.02, 0.0],
  [0.01, 0.02, 0.0, 0.01, -0.01],
  [0.02, 0.01, 0.0, -0.01, 0.01],
]

const send = (res, obj, code = 200) => {
  res.writeHead(code, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(obj))
}

http
  .createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1')
    const p = url.pathname

    if (p === '/printer/info') {
      return send(res, {
        result: { klippy_state: 'ready', state: 'ready', state_message: 'Printer is ready', hostname: 'fake' },
      })
    }

    if (p === '/printer/objects/query') {
      return send(res, {
        result: {
          status: {
            extruder: { temperature: state.nozzle, target: state.nozzle },
            heater_bed: { temperature: state.bed, target: state.bed },
            toolhead: { position: [0, 0, 0, 0], homed_axes: state.homed ? 'xyz' : '' },
            print_stats: { state: 'standby', filename: '', progress: 0, print_duration: 0 },
            virtual_sdcard: { progress: 0 },
            gcode_move: { homing_origin: [0, 0, 0, 0] },
            probe: state.probeZ === null ? {} : { last_z_result: state.probeZ },
            configfile: {
              config: state.loadCell
                ? {
                    load_cell_probe: { z_offset: 0 },
                    load_cell_endstop: { z_offset: 0 },
                    stepper_z: { endstop_pin: 'z_virtual_endstop' },
                  }
                : { probe: {}, stepper_z: { position_endstop: 0.4 } },
            },
            bed_mesh: state.mesh
              ? {
                  probed_matrix: state.mesh,
                  mesh_min: [10, 10],
                  mesh_max: [330, 330],
                  x_count: 5,
                  y_count: 5,
                  profile_name: 'default',
                }
              : {},
          },
        },
      })
    }

    if (p === '/printer/gcode/script') {
      const script = url.searchParams.get('script') ?? ''
      state.scripts.push(script)
      if (script.startsWith('BED_MESH_CALIBRATE')) state.mesh = MESH
      if (/G28/.test(script)) state.homed = true
      if (script.trim() === 'PROBE') {
        state.probeRuns += 1
        // 1,42 mm mit minimaler, aber echter Streuung
        state.probeZ = 1.42 + [0, 0.004, -0.003, 0.002][state.probeRuns % 4]
      }
      return send(res, { result: 'ok' })
    }

    if (p === '/server/files/upload') {
      const chunks = []
      req.on('data', (c) => chunks.push(c))
      req.on('end', () => {
        const body = Buffer.concat(chunks)
        state.uploads.push({
          len: body.length,
          text: body.toString('latin1'),
          print: url.searchParams.get('print'),
        })
        send(res, { result: { item: { path: 'kepler-job.gcode', size: body.length } } })
      })
      return
    }

    if (p === '/printer/print/start') {
      state.started.push(url.searchParams.get('filename'))
      return send(res, { result: 'ok' })
    }

    if (['/printer/print/pause', '/printer/print/resume', '/printer/print/cancel'].includes(p)) {
      return send(res, { result: 'ok' })
    }

    if (p === '/__config') {
      const v = url.searchParams.get('loadcell')
      if (v === '0') state.loadCell = false
      if (v === '1') state.loadCell = true
      return send(res, { loadCell: state.loadCell })
    }

    if (p === '/__state') return send(res, state)

    send(res, { error: 'not found' }, 404)
  })
  .listen(7126, '127.0.0.1', () => console.log('fake moonraker on 7126'))
