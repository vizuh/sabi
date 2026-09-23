import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { UPDATE_WARNING, checkForUpdate, latestVersionUrl, quickCompatibilityChecks, readCachedUpdate } from '../src/updates.ts'

const NOW = 1_760_000_000_000

function workspace(): string {
  return mkdtempSync(path.join(os.tmpdir(), 'sabi-updates-'))
}

/** Every Sabi path this module reads is redirected into the fixture root. */
function isolatedEnv(root: string): NodeJS.ProcessEnv {
  return {
    HOME: root,
    SABI_CONFIG: path.join(root, 'sabi.config.json'),
    SABI_CLAUDE_SETTINGS: path.join(root, 'claude', 'settings.json'),
    SABI_CODEX_HOOKS: path.join(root, 'codex', 'hooks.json'),
    SABI_OPENCODE_CONFIG: path.join(root, 'opencode', 'opencode.json'),
  }
}

function validConfig(): string {
  return JSON.stringify({
    upstreams: { mock: { baseURL: 'http://127.0.0.1:1/v1', apiKey: false } },
    models: { cheap: { upstream: 'mock', model: 'fixture-model' } },
    aliases: { 'sabi-code': 'auto' },
    policy: { unclassified: 'cheap' },
  })
}

function registry(version: string): { calls: () => number; fetchImpl: typeof fetch } {
  let calls = 0
  return {
    calls: () => calls,
    fetchImpl: (async () => {
      calls += 1
      return new Response(JSON.stringify({ version }), { status: 200, headers: { 'content-type': 'application/json' } })
    }) as unknown as typeof fetch,
  }
}

test('a scoped package name is percent-encoded into the registry URL', () => {
  assert.equal(latestVersionUrl(), 'https://registry.npmjs.org/%40vizuh%2Fsabi-controller/latest')
})

test('a plain read never contacts the registry and reports the cached answer', async () => {
  const root = workspace()
  try {
    const stateDir = path.join(root, 'state')
    const env = isolatedEnv(root)

    const never = registry('9.9.9')
    const cold = await checkForUpdate({ stateDir, env, now: NOW, installedVersion: '0.1.0', fetchImpl: never.fetchImpl })
    assert.equal(never.calls(), 0)
    assert.equal(cold.status, 'unavailable')
    assert.equal(cold.stale, true)
    assert.match(cold.error ?? '', /sabi updates --check/)
    assert.equal(readCachedUpdate({ stateDir }), undefined)

    const fresh = registry('0.2.0')
    const checked = await checkForUpdate({ stateDir, env, now: NOW, installedVersion: '0.1.0', refresh: true, fetchImpl: fresh.fetchImpl })
    assert.equal(fresh.calls(), 1)
    assert.equal(checked.status, 'update-available')
    assert.equal(checked.latestVersion, '0.2.0')
    assert.equal(checked.stale, false)

    const unreachable = registry('9.9.9')
    const cached = await checkForUpdate({ stateDir, env, now: NOW + 60_000, installedVersion: '0.1.0', fetchImpl: unreachable.fetchImpl })
    assert.equal(unreachable.calls(), 0)
    assert.equal(cached.status, 'update-available')
    assert.equal(cached.latestVersion, '0.2.0')
    assert.equal(cached.stale, false)

    // The window is a day wide: the next plain read after it must say so rather than re-check.
    const later = await checkForUpdate({ stateDir, env, now: NOW + 24 * 60 * 60 * 1_000, installedVersion: '0.1.0', fetchImpl: unreachable.fetchImpl })
    assert.equal(unreachable.calls(), 0)
    assert.equal(later.status, 'update-available')
    assert.equal(later.stale, true)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('an unreachable registry is recorded, not thrown, and stays readable offline', async () => {
  const root = workspace()
  try {
    const stateDir = path.join(root, 'state')
    const env = isolatedEnv(root)
    const failing = (async () => {
      throw new Error('getaddrinfo ENOTFOUND registry.npmjs.org')
    }) as unknown as typeof fetch

    const result = await checkForUpdate({ stateDir, env, now: NOW, installedVersion: '0.1.0', refresh: true, fetchImpl: failing })
    assert.equal(result.status, 'unavailable')
    assert.equal(result.latestVersion, undefined)
    assert.match(result.error ?? '', /ENOTFOUND/)

    const offline = await checkForUpdate({ stateDir, env, now: NOW + 1_000, installedVersion: '0.1.0', fetchImpl: failing })
    assert.equal(offline.status, 'unavailable')
    assert.match(offline.error ?? '', /ENOTFOUND/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('an HTTP error status is not mistaken for a version', async () => {
  const root = workspace()
  try {
    const stateDir = path.join(root, 'state')
    const env = isolatedEnv(root)
    const notFound = (async () => new Response('{"error":"Not found"}', { status: 404 })) as unknown as typeof fetch
    const result = await checkForUpdate({ stateDir, env, now: NOW, installedVersion: '0.1.0', refresh: true, fetchImpl: notFound })
    assert.equal(result.status, 'unavailable')
    assert.match(result.error ?? '', /HTTP 404/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a cached answer is not reused for a different installed version', async () => {
  const root = workspace()
  try {
    const stateDir = path.join(root, 'state')
    const env = isolatedEnv(root)
    await checkForUpdate({ stateDir, env, now: NOW, installedVersion: '0.1.0', refresh: true, fetchImpl: registry('0.2.0').fetchImpl })

    const upgraded = await checkForUpdate({ stateDir, env, now: NOW + 1_000, installedVersion: '0.2.0', fetchImpl: registry('9.9.9').fetchImpl })
    assert.equal(upgraded.status, 'unavailable')
    assert.match(upgraded.error ?? '', /sabi updates --check/)
    assert.equal(upgraded.latestVersion, undefined)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('the upgrade warning appears only when the registry is ahead of the installed version', async () => {
  const root = workspace()
  try {
    const stateDir = path.join(root, 'state')
    const env = isolatedEnv(root)

    const ahead = await checkForUpdate({ stateDir, env, now: NOW, installedVersion: '0.1.0', refresh: true, fetchImpl: registry('0.2.0').fetchImpl })
    assert.equal(ahead.warning, UPDATE_WARNING)

    const level = await checkForUpdate({ stateDir, env, now: NOW, installedVersion: '0.2.0', refresh: true, fetchImpl: registry('0.2.0').fetchImpl })
    assert.equal(level.status, 'up-to-date')
    assert.equal(level.warning, undefined)

    const behind = await checkForUpdate({ stateDir, env, now: NOW, installedVersion: '0.3.0', refresh: true, fetchImpl: registry('0.2.0').fetchImpl })
    assert.equal(behind.status, 'up-to-date')
    assert.equal(behind.warning, undefined)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('the preflight passes an unconfigured project and fails a config the server could not load', () => {
  const root = workspace()
  try {
    const env = isolatedEnv(root)
    const absent = quickCompatibilityChecks({ cwd: root, env })
    assert.equal(absent.ok, true)
    assert.deepEqual(absent.checks.map(({ name, ok }) => [name, ok]), [['node', true], ['config', true], ['hooks', true]])

    writeFileSync(path.join(root, 'sabi.config.json'), '{"upstreams": {}, "models": {}}')
    const broken = quickCompatibilityChecks({ cwd: root, env })
    assert.equal(broken.ok, false)
    const config = broken.checks.find(({ name }) => name === 'config')
    assert.equal(config?.ok, false)
    assert.match(config?.detail ?? '', /no upstreams declared/)

    writeFileSync(path.join(root, 'sabi.config.json'), validConfig())
    const healthy = quickCompatibilityChecks({ cwd: root, env })
    assert.equal(healthy.ok, true)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('the preflight fails when an installed hook no longer resolves', () => {
  const root = workspace()
  try {
    const env = isolatedEnv(root)
    const claude = path.join(root, 'claude', 'settings.json')
    mkdirSync(path.dirname(claude), { recursive: true })
    writeFileSync(claude, JSON.stringify({
      hooks: {
        UserPromptSubmit: [{
          hooks: [{ type: 'command', command: `'/definitely/missing/node' '/also/missing/sabi.mjs' hook claude`, statusMessage: 'Sabi claude routing' }],
        }],
      },
    }))
    writeFileSync(path.join(root, 'sabi.config.json'), validConfig())

    const result = quickCompatibilityChecks({ cwd: root, env })
    assert.equal(result.ok, false)
    const hooks = result.checks.find(({ name }) => name === 'hooks')
    assert.equal(hooks?.ok, false)
    assert.match(hooks?.detail ?? '', /run sabi hooks install to repair/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a refresh rewrites the cache atomically enough to survive a reread', async () => {
  const root = workspace()
  try {
    const stateDir = path.join(root, 'state')
    await checkForUpdate({ stateDir, env: isolatedEnv(root), now: NOW, installedVersion: '0.1.0', refresh: true, fetchImpl: registry('0.2.0').fetchImpl })
    const written = JSON.parse(readFileSync(path.join(stateDir, 'update-check.json'), 'utf8')) as Record<string, unknown>
    assert.equal(written.packageName, '@vizuh/sabi-controller')
    assert.equal(written.installedVersion, '0.1.0')
    assert.equal(written.latestVersion, '0.2.0')
    assert.equal(written.checkedAt, NOW)
    assert.equal(written.nextCheckAt, NOW + 24 * 60 * 60 * 1_000)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
