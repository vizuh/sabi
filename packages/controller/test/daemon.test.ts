import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  createControllerDaemon,
  isLoopbackControllerHost,
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
    assert.equal(daemon.info.token.length >= 64, true)
    const health = await requestControllerDaemon('/health', { info: daemon.info })
    assert.equal(health?.ok, true)
    assert.equal(health?.protocol, 1)
    const unauthorized = await requestControllerDaemon('/health', { info: { ...daemon.info, token: 'x'.repeat(64) } })
    assert.equal(unauthorized?.error, 'unauthorized')

    const status = await requestControllerDaemon(`/status?cwd=${encodeURIComponent(cwd)}`, { info: daemon.info })
    assert.equal(status?.runtime && (status.runtime as Record<string, unknown>).mode, 'daemon')
    assert.equal(status?.cwd, cwd)

    const route = await requestControllerDaemon('/route', {
      info: daemon.info,
      method: 'POST',
      body: { request: '', cwd },
    })
    assert.equal(route?.action, 'ASK')
    assert.equal(route?.traceVersion, 1)
    assert.equal(Array.isArray(route?.routing && (route.routing as Record<string, unknown>).candidates), true)
    assert.equal(typeof (route?.execution as Record<string, unknown>).durationMs, 'number')
    assert.equal(existsSync(path.join(cwd, '.sabi', 'controller-decisions.jsonl')), true)

    const plan = await requestControllerDaemon('/plan', {
      info: daemon.info,
      method: 'POST',
      body: { request: 'what is 2 + 2?', cwd },
    })
    assert.equal(plan?.execution && (plan.execution as Record<string, unknown>).status, 'not-started')

    const registered = await requestControllerDaemon('/v1/sessions/register', {
      info: daemon.info,
      method: 'POST',
      body: { sessionId: 'session-secret', adapter: 'claude', harness: 'claude', worktree: cwd, context: 'read-only session' },
    })
    assert.equal(registered?.ok, true)
    assert.match(String((registered?.session as Record<string, unknown>).id), /^registry:claude:/)
    assert.equal(String((registered?.session as Record<string, unknown>).id).includes('session-secret'), false)

    const heartbeat = await requestControllerDaemon('/v1/sessions/heartbeat', {
      info: daemon.info,
      method: 'POST',
      body: { sessionId: 'session-secret', adapter: 'claude', harness: 'claude', worktree: cwd, lifecycle: 'idle' },
    })
    assert.equal((heartbeat?.session as Record<string, unknown>).lifecycle, 'idle')
    const outcome = await requestControllerDaemon('/v1/sessions/outcome', {
      info: daemon.info,
      method: 'POST',
      body: { sessionId: 'session-secret', adapter: 'claude', harness: 'claude', worktree: cwd, outcome: 'completed' },
    })
    assert.equal((outcome?.session as Record<string, unknown>).lastOutcome, 'completed')
    const invalid = await requestControllerDaemon('/v1/sessions/register', {
      info: daemon.info,
      method: 'POST',
      body: { adapter: 'claude' },
    })
    assert.equal(invalid?.error, 'sessionId is required')
  } finally {
    await daemon.close()
    if (previousOrca === undefined) delete process.env.ORCA_CLI_COMMAND
    else process.env.ORCA_CLI_COMMAND = previousOrca
  }
})

test('daemon rejects non-loopback binding and daemon metadata', async () => {
  assert.equal(isLoopbackControllerHost('127.0.0.1'), true)
  assert.equal(isLoopbackControllerHost('localhost'), true)
  assert.equal(isLoopbackControllerHost('0.0.0.0'), false)
  await assert.rejects(() => createControllerDaemon({ stateDir: workspace(), host: '0.0.0.0', port: 0 }), /loopback-only/)
  const response = await requestControllerDaemon('/health', {
    info: {
      protocol: 1,
      pid: process.pid,
      host: '192.0.2.1',
      port: 7433,
      startedAt: new Date().toISOString(),
      stateDir: workspace(),
      token: 'x'.repeat(64),
    },
  })
  assert.equal(response, undefined)
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
