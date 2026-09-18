import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const script = fileURLToPath(new URL('../src/connect.ts', import.meta.url))
const sabiConfig = {
  upstreams: {
    mock: { baseURL: 'http://127.0.0.1:1/v1', apiKey: false },
    ollama: { baseURL: 'http://127.0.0.1:11434/v1', apiKey: false },
  },
  models: {
    cheap: { upstream: 'mock', model: 'm-cheap', contextWindow: 1310720 },
    strong: { upstream: 'mock', model: 'm-strong', contextWindow: 1000000 },
    local: { upstream: 'ollama', model: 'qwen2.5-coder:7b', contextWindow: 32768 },
  },
  aliases: { 'sabi-code': 'auto', 'sabi-strong': 'strong', 'sabi-local': 'local' },
  policy: { 'first-turn': 'cheap', failure: 'strong', exploration: 'cheap', unclassified: 'cheap' },
}
// An existing profile that must survive untouched, including a credential Sabi never reads.
const existing = {
  $schema: 'https://opencode.ai/config.json',
  model: 'other/big',
  small_model: 'other/small',
  provider: { other: { options: { apiKey: 'existing-key-value' } } },
}

function workspace(json: unknown = existing, config: unknown = sabiConfig): { dir: string; file: string } {
  const dir = mkdtempSync(path.join(tmpdir(), 'sabi-opencode-test-'))
  mkdirSync(path.join(dir, 'config'), { recursive: true })
  writeFileSync(path.join(dir, 'sabi.config.json'), JSON.stringify(config))
  const file = path.join(dir, 'config', 'opencode.json')
  if (json !== undefined) writeFileSync(file, typeof json === 'string' ? json : JSON.stringify(json, null, 2))
  return { dir, file }
}

function connect(dir: string, file: string, args: string[] = []): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: dir,
    encoding: 'utf8',
    timeout: 5000,
    env: { PATH: process.env.PATH, HOME: dir, SABI_CONFIG: path.join(dir, 'sabi.config.json'), SABI_OPENCODE_CONFIG: file },
  })
  return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}

test('the writer merges Sabi and preserves the existing profile', () => {
  const { dir, file } = workspace()
  try {
    const result = connect(dir, file)
    assert.equal(result.status, 0, result.stderr)
    const written = JSON.parse(readFileSync(file, 'utf8'))
    assert.deepEqual(Object.keys(written.provider).sort(), ['other', 'sabi'])
    assert.equal(written.provider.other.options.apiKey, 'existing-key-value')
    assert.equal(written.model, 'other/big', 'the default model is left alone without --set-default')
    const sabi = written.provider.sabi
    assert.equal(sabi.npm, '@ai-sdk/openai-compatible')
    assert.equal(sabi.options.baseURL, 'http://127.0.0.1:8787/v1')
    assert.equal(sabi.options.headers['X-Sabi-Client'], 'opencode')
    assert.equal(sabi.models['sabi-code'].tool_call, true)
    // auto = the smallest window among the tiers the policy can serve, never the largest.
    assert.equal(sabi.models['sabi-code'].limit.context, 1000000)
    // OpenCode rejects a limit that omits output, so the writer always pairs the two keys.
    assert.equal(sabi.models['sabi-code'].limit.output, 4096)
    assert.equal(sabi.models['sabi-strong'].limit.context, 1000000)
    assert.equal(sabi.models['sabi-local'], undefined, 'a 32k ollama tier is not exposed by default')
    assert.deepEqual(sabi.models['sabi-code'].modalities, { input: ['text'], output: ['text'] })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('--set-default opts the session into the adaptive alias, and --include-local exposes ollama', () => {
  const { dir, file } = workspace()
  try {
    assert.equal(connect(dir, file, ['--set-default', '--include-local']).status, 0)
    const written = JSON.parse(readFileSync(file, 'utf8'))
    assert.equal(written.model, 'sabi/sabi-code')
    assert.equal(written.small_model, 'sabi/sabi-code')
    assert.equal(written.provider.sabi.models['sabi-local'].limit.context, 32768)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the backup is written once and never overwritten by a re-run', () => {
  const { dir, file } = workspace()
  try {
    assert.equal(connect(dir, file).status, 0)
    const backup = `${file}.sabi-backup`
    assert.equal(existsSync(backup), true)
    assert.deepEqual(JSON.parse(readFileSync(backup, 'utf8')), existing)
    // A second run must not turn the backup into a copy of Sabi's own edit.
    assert.equal(connect(dir, file, ['--set-default']).status, 0)
    assert.deepEqual(JSON.parse(readFileSync(backup, 'utf8')), existing)
    assert.equal(JSON.parse(readFileSync(file, 'utf8')).model, 'sabi/sabi-code')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('an unreadable profile is refused, not rewritten', () => {
  const { dir, file } = workspace('{ not json')
  try {
    const result = connect(dir, file)
    assert.equal(result.status, 1)
    assert.match(result.stderr, /Refusing to touch/)
    assert.equal(readFileSync(file, 'utf8'), '{ not json')
    assert.equal(existsSync(`${file}.sabi-backup`), false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a declared output cap is honoured, and an unknown window omits the limit entirely', () => {
  const declared = {
    ...sabiConfig,
    models: {
      cheap: { upstream: 'mock', model: 'm-cheap', contextWindow: 1310720, maxOutputTokens: 8192 },
      strong: { upstream: 'mock', model: 'm-strong', contextWindow: 1000000, maxOutputTokens: 64000 },
      local: { upstream: 'ollama', model: 'qwen2.5-coder:7b', contextWindow: 32768 },
    },
  }
  const windowless = {
    ...sabiConfig,
    models: { cheap: { upstream: 'mock', model: 'm-cheap' } },
    aliases: { 'sabi-code': 'auto' },
    policy: { 'first-turn': 'cheap' },
  }
  const first = workspace(existing, declared)
  const second = workspace(existing, windowless)
  try {
    assert.equal(connect(first.dir, first.file).status, 0)
    const bounded = JSON.parse(readFileSync(first.file, 'utf8')).provider.sabi.models['sabi-code'].limit
    assert.deepEqual(bounded, { context: 1000000, output: 8192 })

    assert.equal(connect(second.dir, second.file).status, 0)
    const unset = JSON.parse(readFileSync(second.file, 'utf8')).provider.sabi.models['sabi-code']
    assert.equal(unset.limit, undefined, 'no window is knowable, so no limit is claimed')
  } finally {
    rmSync(first.dir, { recursive: true, force: true })
    rmSync(second.dir, { recursive: true, force: true })
  }
})
