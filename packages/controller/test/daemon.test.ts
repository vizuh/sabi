import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'node:net'
import {
  createControllerDaemon,
  isLoopbackControllerHost,
  requestControllerDaemon,
  runForegroundControllerDaemon,
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
    // A shorter/longer token must be rejected too — the constant-time compare guards
    // length equality itself before calling into crypto.timingSafeEqual.
    const wrongLength = await requestControllerDaemon('/health', { info: { ...daemon.info, token: 'short' } })
    assert.equal(wrongLength?.error, 'unauthorized')

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

    const keyedRoute = await requestControllerDaemon('/route', {
      info: daemon.info,
      method: 'POST',
      body: { request: '', cwd, idempotencyKey: 'daemon-receipt-test' },
    })
    const duplicateKeyedRoute = await requestControllerDaemon('/route', {
      info: daemon.info,
      method: 'POST',
      body: { request: '', cwd, idempotencyKey: 'daemon-receipt-test' },
    })
    assert.equal(duplicateKeyedRoute?.ts, keyedRoute?.ts)

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

test('a foreground launch that loses the port race to a healthy incumbent exits clean instead of throwing', async () => {
  const stateDir = workspace()
  const incumbent = await createControllerDaemon({ stateDir, host: '127.0.0.1', port: 0 })
  try {
    await assert.doesNotReject(runForegroundControllerDaemon({ stateDir, host: '127.0.0.1', port: incumbent.info.port }))
  } finally {
    await incumbent.close()
  }
})

test('a foreground launch that loses the port to a non-Sabi process still throws EADDRINUSE', async () => {
  const stateDir = workspace()
  const squatter = createServer()
  await new Promise<void>((resolve) => squatter.listen(0, '127.0.0.1', resolve))
  const address = squatter.address()
  const port = address && typeof address !== 'string' ? address.port : 0
  try {
    await assert.rejects(
      runForegroundControllerDaemon({ stateDir, host: '127.0.0.1', port }),
      /EADDRINUSE/,
    )
  } finally {
    await new Promise<void>((resolve) => squatter.close(() => resolve()))
  }
})

test('a stale daemon.json pointing at a healthy daemon on a different port does not mask a real conflict', async () => {
  // A daemon that died without running close() (SIGKILL) leaves daemon.json
  // behind describing an address nothing is listening on anymore. If some
  // other, unrelated healthy Sabi daemon happens to be reachable at that
  // stale address, the EADDRINUSE recovery must not accept it as proof that
  // *this* port is already served — the address has to match exactly.
  const stateDir = workspace()
  const otherStateDir = workspace()
  const other = await createControllerDaemon({ stateDir: otherStateDir, host: '127.0.0.1', port: 0 })
  const squatter = createServer()
  await new Promise<void>((resolve) => squatter.listen(0, '127.0.0.1', resolve))
  const squattedAddress = squatter.address()
  const squattedPort = squattedAddress && typeof squattedAddress !== 'string' ? squattedAddress.port : 0
  try {
    // Plant a stale-but-healthy daemon.json in `stateDir` describing `other`'s
    // real, live address — a different port from the one we're about to try.
    writeFileSync(path.join(stateDir, 'daemon.json'), `${JSON.stringify(other.info, null, 2)}\n`, { mode: 0o600 })
    await assert.rejects(
      runForegroundControllerDaemon({ stateDir, host: '127.0.0.1', port: squattedPort }),
      /EADDRINUSE/,
    )
  } finally {
    await new Promise<void>((resolve) => squatter.close(() => resolve()))
    await other.close()
  }
})
