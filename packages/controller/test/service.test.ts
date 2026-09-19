import test from 'node:test'
import assert from 'node:assert/strict'
import { installUserService, systemdUnit } from '../src/service.ts'

test('systemd user unit uses absolute paths and the user-scoped state directory', () => {
  const unit = systemdUnit('/tmp/Sabi Install/dist/cli.mjs', '/tmp/sabi state')
  assert.match(unit, /ExecStart=.*\/tmp\/Sabi Install\/dist\/cli\.mjs.*daemon --foreground/)
  assert.match(unit, /Environment=SABI_CONTROLLER_HOME=.*\/tmp\/sabi state/)
  assert.match(unit, /Restart=on-failure/)
})

test('service installation can be explicitly disabled without touching the host', () => {
  const result = installUserService({
    stateDir: '/tmp/sabi-test-state',
    entrypoint: '/tmp/sabi/cli.mjs',
    env: { ...process.env, SABI_SERVICE_MODE: 'disabled' },
  })
  assert.deepEqual(result, { backend: 'unsupported', installed: false, running: false, detail: 'disabled by environment' })
})
