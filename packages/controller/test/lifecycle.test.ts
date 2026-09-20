import test from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { uninstallController, upgradeController } from '../src/lifecycle.ts'

function workspace(): string {
  return mkdtempSync(path.join(os.tmpdir(), 'sabi-controller-lifecycle-'))
}

test('upgrade accepts an exact semver and invokes the package manager', () => {
  const root = workspace()
  try {
    const npm = path.join(root, 'npm-fake.js')
    writeFileSync(npm, '#!/usr/bin/env node\nprocess.exit(0)\n')
    chmodSync(npm, 0o755)
    const result = upgradeController('0.2.0', { ...process.env, SABI_NPM_COMMAND: npm })
    assert.equal(result.status, 0)
    assert.match(result.command, /@vizuh\/sabi-controller@0\.2\.0/)
    assert.throws(() => upgradeController('not-a-version', { ...process.env, SABI_NPM_COMMAND: npm }), /invalid controller version/)
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
    assert.equal(existsSync(stateDir), false)
    assert.equal(existsSync(result.archivedState!), true)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
