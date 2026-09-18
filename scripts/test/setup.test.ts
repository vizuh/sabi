import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveHarness, resolveYesNo, setJevEnabled } from '../setup.ts'

const setupPath = fileURLToPath(new URL('../setup.ts', import.meta.url))
const repoRoot = fileURLToPath(new URL('../../', import.meta.url))

const minimalConfig = {
  upstreams: {
    openrouter: { baseURL: 'http://127.0.0.1:1/v1', apiKey: '$OPENROUTER_API_KEY' },
    ollama: { baseURL: 'http://127.0.0.1:2/v1', apiKey: false },
  },
  models: {
    cheap: { upstream: 'openrouter', model: 'p-cheap', contextWindow: 1000 },
    local: { upstream: 'ollama', model: 'l-local', contextWindow: 500 },
  },
  aliases: { 'sabi-code': 'auto', 'sabi-cheap': 'cheap', 'sabi-local': 'local' },
  policy: { unclassified: 'cheap' },
  judge: { enabled: true, baseURL: 'https://api.typesafe.ai/v1' }, // shipped config ships enabled: true
}

function workspace(): string {
  return mkdtempSync(path.join(os.tmpdir(), 'sabi-setup-'))
}

// A copy, never the tracked file directly — setup.ts's --jev path writes to whatever SABI_CONFIG
// points at, and a test must never be able to mutate this repo's real sabi.config.json.
function tempSabiConfig(): string {
  const configPath = path.join(workspace(), 'sabi.config.json')
  writeFileSync(configPath, readFileSync(path.join(repoRoot, 'sabi.config.json'), 'utf8'))
  return configPath
}

// --- Unit tests: pure decision functions, no subprocess ---

test('resolveYesNo: flags win outright regardless of TTY', async () => {
  assert.equal(await resolveYesNo(['--jev'], true, '--jev', '--no-jev', 'q', false), true)
  assert.equal(await resolveYesNo(['--no-jev'], true, '--jev', '--no-jev', 'q', true), false)
})

test('resolveYesNo: no flags defaults to the fallback when non-interactive', async () => {
  assert.equal(await resolveYesNo([], false, '--jev', '--no-jev', 'q', false), false)
  assert.equal(await resolveYesNo([], false, '--paid', '--free', 'q', true), true)
})

test('resolveHarness: flag wins outright, kilo/prime-agent map to recipe-only', async () => {
  assert.equal(await resolveHarness(['--harness=opencode'], true), 'opencode')
  assert.equal(await resolveHarness(['--harness=command-code'], false), 'command-code')
  assert.equal(await resolveHarness(['--harness=hermes'], false), 'hermes')
  assert.equal(await resolveHarness(['--harness=kilo'], false), 'recipe-only')
  assert.equal(await resolveHarness(['--harness=prime-agent'], false), 'recipe-only')
})

test('resolveHarness: no flag and non-interactive resolves to undefined (no safe default)', async () => {
  assert.equal(await resolveHarness([], false), undefined)
})

test('resolveHarness: an unrecognized flag value is a hard error, not silently "no flag"', async () => {
  const before = process.exitCode
  process.exitCode = undefined
  const result = await resolveHarness(['--harness=comand-code'], false)
  assert.equal(result, undefined)
  assert.equal(process.exitCode, 1, 'a typo must fail loudly, not swallow into the usage-print path')
  process.exitCode = before
})

test('setJevEnabled: declining actively turns Jev off, not just leaves it as-is', () => {
  const dir = workspace()
  const configPath = path.join(dir, 'sabi.config.json')
  // Matches the shipped sabi.config.json's real default: judge.enabled already true.
  writeFileSync(configPath, JSON.stringify(minimalConfig, null, 2))

  setJevEnabled(configPath, false)
  const patched = JSON.parse(readFileSync(configPath, 'utf8'))
  assert.equal(patched.judge.enabled, false, 'declining must flip an already-true config to false')
})

test('setJevEnabled: enabling sets baseURL/apiKey only when absent, backs up once, never a literal key', () => {
  const dir = workspace()
  const configPath = path.join(dir, 'sabi.config.json')
  const withoutJudgeDetails = { ...minimalConfig, judge: { enabled: false } }
  writeFileSync(configPath, JSON.stringify(withoutJudgeDetails, null, 2))

  setJevEnabled(configPath, true)
  const first = JSON.parse(readFileSync(configPath, 'utf8'))
  assert.equal(first.judge.enabled, true)
  assert.equal(first.judge.baseURL, 'https://api.typesafe.ai/v1')
  assert.equal(first.judge.apiKey, '$TYPESAFE_API_KEY', 'apiKey must be wired to an env reference when absent, never left undefined')
  const backupPath = `${configPath}.sabi-backup`
  assert.ok(existsSync(backupPath))
  const backup = JSON.parse(readFileSync(backupPath, 'utf8'))
  assert.equal(backup.judge.enabled, false, 'backup preserves the pre-patch state')

  // Re-run: existing baseURL/apiKey preserved, backup not overwritten with the already-patched file.
  first.judge.baseURL = 'https://custom.example/v1'
  writeFileSync(configPath, JSON.stringify(first, null, 2))
  setJevEnabled(configPath, true)
  const second = JSON.parse(readFileSync(configPath, 'utf8'))
  assert.equal(second.judge.baseURL, 'https://custom.example/v1')
  const backupAfter = JSON.parse(readFileSync(backupPath, 'utf8'))
  assert.equal(backupAfter.judge.enabled, false, 'backup still holds the original, not the re-run')
})

test('setJevEnabled: an invalid patch throws before anything is written', () => {
  const dir = workspace()
  const configPath = path.join(dir, 'sabi.config.json')
  const broken = { ...minimalConfig, upstreams: {} } // validateConfig rejects: no upstreams declared
  writeFileSync(configPath, JSON.stringify(broken, null, 2))
  const before = readFileSync(configPath, 'utf8')
  assert.throws(() => setJevEnabled(configPath, true))
  assert.equal(readFileSync(configPath, 'utf8'), before)
  assert.equal(existsSync(`${configPath}.sabi-backup`), false)
})

// --- Integration tests: spawn the real script, piped stdio (non-TTY, never prompts) ---

function run(args: string[], env: Record<string, string> = {}) {
  const result = spawnSync(process.execPath, [setupPath, ...args], {
    cwd: repoRoot,
    env: { ...process.env, ...env },
    stdio: ['pipe', 'pipe', 'pipe'],
    encoding: 'utf8',
  })
  return result
}

test('no flags, non-interactive: prints usage, exits 0, writes nothing', () => {
  const { status, stdout } = run([])
  assert.equal(status, 0)
  assert.match(stdout, /Usage: npm run setup/)
})

test('an unrecognized --harness value exits non-zero instead of silently printing usage', () => {
  const { status, stderr } = run(['--harness=comand-code'])
  assert.notEqual(status, 0)
  assert.match(stderr, /Unrecognized --harness/)
})

test('--harness=kilo and --harness=prime-agent print the recipe-only note and exit 0', () => {
  for (const harness of ['kilo', 'prime-agent']) {
    const { status, stdout } = run([`--harness=${harness}`])
    assert.equal(status, 0)
    assert.match(stdout, /recipe-only today/)
  }
})

test('--harness=command-code --class=a skips the Jev question and touches no file', () => {
  const dir = workspace()
  const providersPath = path.join(dir, 'providers.json')
  const configPath = path.join(dir, 'sabi.config.json')
  writeFileSync(configPath, JSON.stringify(minimalConfig, null, 2))
  const before = readFileSync(configPath, 'utf8')
  const { status, stdout } = run(['--harness=command-code', '--class=a'], {
    SABI_CONFIG: configPath,
    SABI_CC_PROVIDERS: providersPath,
  })
  assert.equal(status, 0)
  assert.match(stdout, /cmd mods add/)
  assert.match(stdout, /Jev is proxy-only/)
  assert.equal(existsSync(providersPath), false)
  assert.equal(readFileSync(configPath, 'utf8'), before, 'Class A must not touch sabi.config.json either')
})

test('--harness=command-code --class=b --free registers nothing paid, non-interactively', () => {
  const dir = workspace()
  const providersPath = path.join(dir, 'providers.json')
  const configPath = path.join(dir, 'sabi.config.json')
  writeFileSync(configPath, JSON.stringify(minimalConfig, null, 2))
  const { status } = run(['--harness=command-code', '--class=b', '--free', '--no-jev'], {
    SABI_CONFIG: configPath,
    SABI_CC_PROVIDERS: providersPath,
  })
  assert.equal(status, 0)
  const written = JSON.parse(readFileSync(providersPath, 'utf8'))
  assert.deepEqual(written.provider.sabi.models, {})
})

test('a missing sabi.config.json fails cleanly before any writer runs', () => {
  const dir = workspace()
  const { status, stderr } = run(['--harness=opencode', '--jev'], {
    SABI_CONFIG: path.join(dir, 'does-not-exist.json'),
    SABI_OPENCODE_CONFIG: path.join(dir, 'opencode.json'),
  })
  assert.notEqual(status, 0)
  assert.match(stderr, /Sabi config not found/)
  assert.equal(existsSync(path.join(dir, 'opencode.json')), false)
})

test('--harness=opencode wires the real writer end to end', () => {
  const dir = workspace()
  const openCodeConfigPath = path.join(dir, 'opencode.json')
  const { status } = run(['--harness=opencode', '--no-jev'], {
    SABI_CONFIG: tempSabiConfig(),
    SABI_OPENCODE_CONFIG: openCodeConfigPath,
  })
  assert.equal(status, 0)
  const written = JSON.parse(readFileSync(openCodeConfigPath, 'utf8'))
  assert.ok(written.provider.sabi)
})

test('a failing writer is surfaced as this process\'s own non-zero exit code', () => {
  const dir = workspace()
  const openCodeConfigPath = path.join(dir, 'opencode.json')
  writeFileSync(openCodeConfigPath, '{ not json')
  const { status } = run(['--harness=opencode', '--no-jev'], {
    SABI_CONFIG: tempSabiConfig(),
    SABI_OPENCODE_CONFIG: openCodeConfigPath,
  })
  assert.notEqual(status, 0, 'connect.ts refuses invalid JSON and exits 1 — setup.ts must not swallow that')
})

test('--harness=hermes creates HERMES_HOME with the plugin and config, no __pycache__', () => {
  const dir = workspace()
  const home = path.join(dir, 'hermes-home')
  const { status, stdout } = run(['--harness=hermes', `--hermes-home=${home}`, '--no-jev'], {
    SABI_CONFIG: tempSabiConfig(),
  })
  assert.equal(status, 0)
  assert.match(stdout, /uncertified/)
  assert.ok(existsSync(path.join(home, 'config.yaml')))
  assert.ok(existsSync(path.join(home, 'plugins', 'sabi-metadata', '__init__.py')))
  assert.equal(existsSync(path.join(home, 'plugins', 'sabi-metadata', '__pycache__')), false)
  const yaml = readFileSync(path.join(home, 'config.yaml'), 'utf8')
  assert.match(yaml, /REPLACE_WITH_VERIFIED_CONTEXT_TOKENS/)
})

test('--harness=hermes refuses a non-empty target directory', () => {
  const dir = workspace()
  const home = path.join(dir, 'hermes-home')
  mkdirSync(home, { recursive: true })
  writeFileSync(path.join(home, 'existing-file'), 'x')
  const { status, stderr } = run(['--harness=hermes', `--hermes-home=${home}`, '--no-jev'], {
    SABI_CONFIG: tempSabiConfig(),
  })
  assert.notEqual(status, 0)
  assert.match(stderr, /not empty/)
})

test('--harness=hermes with a missing sabi.config.json fails before creating anything', () => {
  const dir = workspace()
  const home = path.join(dir, 'hermes-home')
  const { status } = run(['--harness=hermes', `--hermes-home=${home}`, '--no-jev'], {
    SABI_CONFIG: path.join(dir, 'does-not-exist.json'),
  })
  assert.notEqual(status, 0)
  assert.equal(existsSync(home), false, 'no side effect from a config that never validated')
})

test('--jev patches sabi.config.json, never writes the literal key, and only claims git-tracked when true', () => {
  const dir = workspace()
  const configPath = path.join(dir, 'sabi.config.json')
  writeFileSync(configPath, JSON.stringify({ ...minimalConfig, judge: { enabled: false } }, null, 2))
  const providersPath = path.join(dir, 'providers.json')
  const { status, stdout } = run(['--harness=command-code', '--class=b', '--free', '--jev'], {
    SABI_CONFIG: configPath,
    SABI_CC_PROVIDERS: providersPath,
    TYPESAFE_API_KEY: 'sk-should-never-appear-anywhere',
  })
  assert.equal(status, 0)
  const written = readFileSync(configPath, 'utf8')
  assert.ok(!written.includes('sk-should-never-appear-anywhere'))
  const parsed = JSON.parse(written)
  assert.equal(parsed.judge.enabled, true)
  assert.equal(existsSync(`${configPath}.sabi-backup`), true)
  // configPath lives under a bare tmpdir, not a git working tree.
  assert.ok(!stdout.includes('git-tracked'), 'must not claim git-tracked for a path outside any repo')
})

test('--jev inside a git working tree does claim git-tracked', () => {
  const dir = workspace()
  mkdirSync(path.join(dir, '.git')) // isInsideGitRepo only checks for this marker's existence
  const configPath = path.join(dir, 'sabi.config.json')
  writeFileSync(configPath, JSON.stringify({ ...minimalConfig, judge: { enabled: false } }, null, 2))
  const providersPath = path.join(dir, 'providers.json')
  const { status, stdout } = run(['--harness=command-code', '--class=b', '--free', '--jev'], {
    SABI_CONFIG: configPath,
    SABI_CC_PROVIDERS: providersPath,
  })
  assert.equal(status, 0)
  assert.match(stdout, /git-tracked/)
})
