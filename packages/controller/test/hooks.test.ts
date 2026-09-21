import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { hookOutput, installHooks, routeHookPrompt } from '../src/hooks.ts'

function workspace(): string {
  return mkdtempSync(path.join(os.tmpdir(), 'sabi-controller-hooks-'))
}

test('installHooks merges Claude, Codex and OpenCode without replacing existing config', () => {
  const root = workspace()
  try {
    const claude = path.join(root, 'claude', 'settings.json')
    const codex = path.join(root, 'codex', 'hooks.json')
    const opencode = path.join(root, 'opencode', 'opencode.json')
    const originalClaude = { model: 'keep-me', hooks: { Stop: [{ hooks: [{ type: 'command', command: 'existing-stop' }] }] } }
    const originalCodex = { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'existing-stop' }] }] } }
    const originalOpenCode = { model: 'other/model', plugin: ['existing-plugin'], provider: { other: { options: { apiKey: 'not-read' } } } }
    mkdirSync(path.join(root, 'claude'), { recursive: true })
    mkdirSync(path.join(root, 'codex'), { recursive: true })
    mkdirSync(path.join(root, 'opencode'), { recursive: true })
    writeFileSync(claude, JSON.stringify(originalClaude))
    writeFileSync(codex, JSON.stringify(originalCodex))
    writeFileSync(opencode, JSON.stringify(originalOpenCode))

    const stateDir = path.join(root, 'state')
    const env = {
      ...process.env,
      HOME: root,
      SABI_CLAUDE_SETTINGS: claude,
      SABI_CODEX_HOOKS: codex,
      SABI_OPENCODE_CONFIG: opencode,
      SABI_HOOK_COMMAND: 'sabi-test',
      SABI_OPENCODE_HOOK_SOURCE: path.resolve('packages/adapters/opencode/src/sabi-hook.mjs'),
    }
    const first = installHooks({ stateDir, env })
    assert.deepEqual(first.map(({ harness }) => harness), ['claude', 'codex', 'opencode'])

    const claudeWritten = JSON.parse(readFileSync(claude, 'utf8'))
    assert.equal(claudeWritten.model, 'keep-me')
    assert.equal(claudeWritten.hooks.Stop[0].hooks[0].command, 'existing-stop')
    assert.equal(claudeWritten.hooks.UserPromptSubmit.length, 1)
    assert.match(claudeWritten.hooks.UserPromptSubmit[0].hooks[0].command, /^['"]sabi-test['"] hook claude/)

    const codexWritten = JSON.parse(readFileSync(codex, 'utf8'))
    assert.equal(codexWritten.hooks.Stop[0].hooks[0].command, 'existing-stop')
    assert.equal(codexWritten.hooks.UserPromptSubmit.length, 1)
    assert.equal(codexWritten.hooks.SessionStart.length, 1)
    assert.equal(codexWritten.hooks.SessionEnd.length, 1)

    const opencodeWritten = JSON.parse(readFileSync(opencode, 'utf8'))
    assert.equal(opencodeWritten.model, 'other/model')
    assert.deepEqual(opencodeWritten.plugin.slice(0, 1), ['existing-plugin'])
    assert.equal(opencodeWritten.plugin.length, 2)
    const pluginPath = opencodeWritten.plugin[1]
    assert.equal(existsSync(pluginPath), true)
    assert.match(readFileSync(pluginPath, 'utf8'), /chat\.message/)

    const backups = [claude, codex, opencode].map((file) => `${file}.sabi-backup`)
    for (const backup of backups) assert.equal(existsSync(backup), true)
    assert.deepEqual(JSON.parse(readFileSync(`${claude}.sabi-backup`, 'utf8')), originalClaude)
    assert.deepEqual(JSON.parse(readFileSync(`${codex}.sabi-backup`, 'utf8')), originalCodex)
    assert.deepEqual(JSON.parse(readFileSync(`${opencode}.sabi-backup`, 'utf8')), originalOpenCode)

    const second = installHooks({ stateDir, env })
    assert.equal(JSON.parse(readFileSync(claude, 'utf8')).hooks.UserPromptSubmit.length, 1)
    assert.equal(JSON.parse(readFileSync(codex, 'utf8')).hooks.UserPromptSubmit.length, 1)
    assert.equal(JSON.parse(readFileSync(opencode, 'utf8')).plugin.length, 2)
    assert.equal(second.length, 3)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a SABI_HOOK_COMMAND containing shell metacharacters cannot break out of its quoting', () => {
  const root = workspace()
  try {
    const claude = path.join(root, 'claude', 'settings.json')
    const payload = "sabi-test; touch /tmp/sabi-hooks-injection-poc"
    const env = {
      ...process.env,
      HOME: root,
      SABI_CLAUDE_SETTINGS: claude,
      SABI_CODEX_HOOKS: path.join(root, 'codex', 'hooks.json'),
      SABI_OPENCODE_CONFIG: path.join(root, 'opencode', 'opencode.json'),
      SABI_HOOK_COMMAND: payload,
      SABI_OPENCODE_HOOK_SOURCE: path.resolve('packages/adapters/opencode/src/sabi-hook.mjs'),
    }
    installHooks({ stateDir: path.join(root, 'state'), env })

    const written = JSON.parse(readFileSync(claude, 'utf8'))
    const command: string = written.hooks.UserPromptSubmit[0].hooks[0].command
    // The whole payload must be one single-quoted shell token — never a bare, unescaped
    // semicolon a shell would treat as a command separator.
    assert.equal(command, `'${payload}' hook claude --event=UserPromptSubmit`)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('hook output blocks only after a real delegated execution receipt', () => {
  assert.deepEqual(hookOutput('claude', 'UserPromptSubmit'), {})
  assert.deepEqual(hookOutput('claude', 'UserPromptSubmit', {
    action: 'DELEGATE',
    target: { agent: 'codex' },
    execution: { status: 'unverifiable' },
  }), {})
  const output = hookOutput('codex', 'UserPromptSubmit', {
    action: 'SPAWN',
    target: { agent: 'opencode' },
    execution: { status: 'started', receipt: { phase: 'started', observedAt: '2026-09-20T00:00:00.000Z' } },
  })
  assert.equal(output.continue, false)
  assert.equal((output.hookSpecificOutput as Record<string, unknown>).hookEventName, 'UserPromptSubmit')
  assert.match(String(output.systemMessage), /opencode/)
})

test('a hook is a no-op before user setup enables the daemon', async () => {
  const root = workspace()
  try {
    const output = await routeHookPrompt('claude', 'UserPromptSubmit', { prompt: 'what is 2 + 2?', cwd: root }, {
      ...process.env,
      HOME: root,
      SABI_CONTROLLER_HOME: path.join(root, 'state'),
    })
    assert.deepEqual(output, {})
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('OpenCode follows its active config directory when Orca provides one', () => {
  const root = workspace()
  try {
    const config = path.join(root, 'orca-opencode', 'opencode.json')
    installHooks({
      harnesses: ['opencode'],
      stateDir: path.join(root, 'state'),
      env: {
        ...process.env,
        HOME: root,
        OPENCODE_CONFIG_DIR: '',
        ORCA_OPENCODE_CONFIG_DIR: path.dirname(config),
        SABI_OPENCODE_HOOK_SOURCE: path.resolve('packages/adapters/opencode/src/sabi-hook.mjs'),
      },
    })
    assert.equal(existsSync(config), true)
    assert.equal(JSON.parse(readFileSync(config, 'utf8')).plugin.length, 1)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
