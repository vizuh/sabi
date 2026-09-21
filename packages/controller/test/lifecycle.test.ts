import test from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { installHooks } from '../src/hooks.ts'
import { uninstallController, upgradeController } from '../src/lifecycle.ts'

function workspace(): string {
  return mkdtempSync(path.join(os.tmpdir(), 'sabi-controller-lifecycle-'))
}

test('upgrade installs with --ignore-scripts and verifies registry signatures', () => {
  const root = workspace()
  try {
    const npm = path.join(root, 'npm')
    const log = path.join(root, 'calls.log')
    writeFileSync(npm, `#!/usr/bin/env node\nrequire('node:fs').appendFileSync(${JSON.stringify(log)}, process.argv.slice(2).join(' ') + '\\n')\nprocess.exit(0)\n`)
    chmodSync(npm, 0o755)
    const result = upgradeController('0.2.0', { ...process.env, SABI_NPM_COMMAND: npm })
    assert.equal(result.status, 0)
    assert.match(result.command, /@vizuh\/sabi-controller@0\.2\.0/)
    const calls = readFileSync(log, 'utf8').trim().split('\n')
    assert.equal(calls.length, 2)
    assert.match(calls[0] as string, /install --global --ignore-scripts @vizuh\/sabi-controller@0\.2\.0/)
    assert.match(calls[1] as string, /^audit signatures$/)
    assert.throws(() => upgradeController('not-a-version', { ...process.env, SABI_NPM_COMMAND: npm }), /invalid controller version/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('upgrade fails when registry signature verification fails', () => {
  const root = workspace()
  try {
    const npm = path.join(root, 'npm')
    writeFileSync(npm, '#!/usr/bin/env node\nprocess.exit(process.argv.includes("audit") ? 1 : 0)\n')
    chmodSync(npm, 0o755)
    const result = upgradeController('0.2.0', { ...process.env, SABI_NPM_COMMAND: npm })
    assert.equal(result.status, 1)
    assert.match(result.error ?? '', /signature verification failed/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('uninstall archives state and restores explicit hook backups', async () => {
  const root = workspace()
  try {
    const stateDir = path.join(root, 'state')
    const claude = path.join(root, 'claude', 'settings.json')
    mkdirSync(path.dirname(claude), { recursive: true })
    writeFileSync(claude, JSON.stringify({
      model: 'new-user-choice',
      hooks: {
        UserPromptSubmit: [
          { hooks: [{ command: 'echo hook claude' }] },
          { hooks: [{ statusMessage: 'Sabi claude routing', command: 'sabi hook claude --event=UserPromptSubmit' }] },
        ],
      },
    }))
    writeFileSync(`${claude}.sabi-backup`, JSON.stringify({ model: 'original' }))
    mkdirSync(stateDir, { recursive: true })
    writeFileSync(path.join(stateDir, 'controller.json'), '{}')
    const result = await uninstallController({
      env: {
        ...process.env,
        SABI_CONTROLLER_HOME: stateDir,
        SABI_CLAUDE_SETTINGS: claude,
        SABI_SERVICE_MODE: 'disabled',
      },
    })
    assert.equal(result.service.detail, 'disabled by environment')
    assert.equal(result.restored.find(({ harness }) => harness === 'claude')?.restored, true)
    assert.deepEqual(JSON.parse(readFileSync(claude, 'utf8')), { model: 'new-user-choice', hooks: { UserPromptSubmit: [{ hooks: [{ command: 'echo hook claude' }] }] } })
    assert.equal(existsSync(`${claude}.sabi-backup`), false)
    assert.equal(existsSync(stateDir), false)
    assert.equal(existsSync(result.archivedState!), true)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('uninstall removes hooks from a fresh installation without a backup', async () => {
  const root = workspace()
  try {
    const stateDir = path.join(root, 'state')
    const claude = path.join(root, 'claude', 'settings.json')
    mkdirSync(stateDir, { recursive: true })
    writeFileSync(path.join(stateDir, 'controller.json'), '{}')
    installHooks({
      harnesses: ['claude'],
      stateDir,
      env: { ...process.env, SABI_CLAUDE_SETTINGS: claude, SABI_HOOK_COMMAND: 'sabi-test' },
    })
    assert.equal(existsSync(claude), true)
    assert.equal(existsSync(`${claude}.sabi-backup`), false)
    const result = await uninstallController({
      env: {
        ...process.env,
        SABI_CONTROLLER_HOME: stateDir,
        SABI_CLAUDE_SETTINGS: claude,
        SABI_SERVICE_MODE: 'disabled',
      },
    })
    assert.equal(result.restored.find(({ harness }) => harness === 'claude')?.restored, true)
    assert.equal(existsSync(claude), false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('uninstall leaves a deliberately deleted config deleted and drops its backup', async () => {
  const root = workspace()
  try {
    const stateDir = path.join(root, 'state')
    const claude = path.join(root, 'claude', 'settings.json')
    mkdirSync(path.dirname(claude), { recursive: true })
    mkdirSync(stateDir, { recursive: true })
    writeFileSync(path.join(stateDir, 'controller.json'), '{}')
    writeFileSync(`${claude}.sabi-backup`, JSON.stringify({ model: 'original' }))
    const result = await uninstallController({
      env: {
        ...process.env,
        SABI_CONTROLLER_HOME: stateDir,
        SABI_CLAUDE_SETTINGS: claude,
        SABI_SERVICE_MODE: 'disabled',
      },
    })
    assert.equal(result.restored.find(({ harness }) => harness === 'claude')?.restored, false)
    assert.equal(existsSync(claude), false)
    assert.equal(existsSync(`${claude}.sabi-backup`), false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
