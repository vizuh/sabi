import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  createControllerDaemon,
  requestControllerDaemon,
  startControllerDaemon,
  stopControllerDaemon,
} from '../src/daemon.ts'

function workspace(): string {
  return mkdtempSync(path.join(os.tmpdir(), 'sabi-controller-daemon-'))
}

test('daemon serves health, live inventory and controller routing over loopback', async () => {
  const stateDir = workspace()
  const cwd = workspace()
  const previousOrca = process.env.ORCA_CLI_COMMAND
  process.env.ORCA_CLI_COMMAND = '/nonexistent/sabi-daemon-test-orca'
  const daemon = await createControllerDaemon({ stateDir, host: '127.0.0.1', port: 0 })
  try {
    const health = await requestControllerDaemon('/health', { info: daemon.info })
    assert.equal(health?.ok, true)
    assert.equal(health?.protocol, 1)

    const status = await requestControllerDaemon(`/status?cwd=${encodeURIComponent(cwd)}`, { info: daemon.info })
    assert.equal(status?.runtime && (status.runtime as Record<string, unknown>).mode, 'daemon')
    assert.equal(status?.cwd, cwd)

    const route = await requestControllerDaemon('/route', {
      info: daemon.info,
      method: 'POST',
      body: { request: '', cwd },
    })
    assert.equal(route?.action, 'ASK')
    assert.equal(existsSync(path.join(cwd, '.sabi', 'controller-decisions.jsonl')), true)

    const plan = await requestControllerDaemon('/plan', {
      info: daemon.info,
      method: 'POST',
      body: { request: 'what is 2 + 2?', cwd },
    })
    assert.equal(plan?.execution && (plan.execution as Record<string, unknown>).status, 'not-started')
  } finally {
    await daemon.close()
    if (previousOrca === undefined) delete process.env.ORCA_CLI_COMMAND
    else process.env.ORCA_CLI_COMMAND = previousOrca
  }
})

test('setup state can start and stop an actual detached daemon process', async () => {
  const stateDir = workspace()
  const entrypoint = fileURLToPath(new URL('../src/cli.ts', import.meta.url))
  const info = await startControllerDaemon({ stateDir, port: 0, entrypoint, waitMs: 3000 })
  try {
    assert.equal((await requestControllerDaemon('/health', { info }))?.ok, true)
  } finally {
    assert.equal(await stopControllerDaemon(stateDir, 3000), true)
  }
  assert.equal(existsSync(path.join(stateDir, 'daemon.json')), false)
})
