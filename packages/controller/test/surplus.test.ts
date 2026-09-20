import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { validateConfig, type SabiConfig } from '@sabi/core'
import { runSurplusReview } from '../src/surplus.ts'

function workspace(): string {
  const cwd = mkdtempSync(path.join(os.tmpdir(), 'sabi-surplus-controller-'))
  execFileSync('git', ['init', '-q'], { cwd })
  execFileSync('git', ['config', 'user.email', 'sabi-test@example.invalid'], { cwd })
  execFileSync('git', ['config', 'user.name', 'Sabi Test'], { cwd })
  writeFileSync(path.join(cwd, 'example.ts'), 'export function ready(value: string): boolean { return value.length > 0 }\n')
  execFileSync('git', ['add', 'example.ts'], { cwd })
  execFileSync('git', ['commit', '-qm', 'base'], { cwd })
  writeFileSync(path.join(cwd, 'example.ts'), 'export function ready(value: string): boolean { return value.trim().length > 0 }\n')
  return cwd
}

function config(): SabiConfig {
  return validateConfig({
    server: { host: '127.0.0.1', port: 8787 },
    upstreams: { openrouter: { baseURL: 'https://openrouter.ai/api/v1', apiKey: '$OPENROUTER_API_KEY' } },
    models: { quality: { upstream: 'openrouter', model: 'vendor/free-review', capabilities: { inputModalities: ['text'], tools: false }, cost: { input: 0, output: 0 } } },
    aliases: { 'sabi-quality': 'quality' },
    policy: { verification: 'quality' },
  })
}

test('surplus review sends one bounded shadow packet and persists a non-verifying receipt', async () => {
  const cwd = workspace()
  const logFile = path.join(cwd, 'receipts.jsonl')
  try {
    let calls = 0
    const result = await runSurplusReview({
      cwd,
      config: config(),
      intent: 'bug-hunt',
      logFile,
      now: new Date('2026-09-20T20:00:00.000Z'),
      fetchImpl: async (url, init) => {
        calls += 1
        assert.match(String(url), /\/v1\/chat\/completions$/)
        assert.equal((init?.headers as Record<string, string>)['x-sabi-client'], 'sabi-surplus')
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>
        assert.equal(body.model, 'sabi-quality')
        assert.equal(body.tools, undefined)
        const messages = body.messages as Array<Record<string, unknown>>
        assert.equal(messages.length, 2)
        assert.match(String(messages[1]?.content), /example\.ts/)
        assert.ok(!String(messages[1]?.content).includes('OPENROUTER_API_KEY'))
        return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: '{"claims":[{"category":"bug","severity":"low","claim":"check the trim behavior","file":"example.ts","line":1}]}' } }] }), { status: 200 })
      },
    })
    assert.equal(calls, 1)
    assert.equal(result.receipt.status, 'ok')
    assert.equal(result.receipt.verifiedClaimCount, 0)
    assert.equal(result.claims.length, 1)
    assert.equal(readFileSync(logFile, 'utf8').includes('check the trim behavior'), false)
    assert.equal(readFileSync(path.join(cwd, 'example.ts'), 'utf8').includes('trim'), true)
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})

test('surplus review records a free-provider rate limit without paid fallback', async () => {
  const cwd = workspace()
  const logFile = path.join(cwd, 'receipts.jsonl')
  try {
    let calls = 0
    const result = await runSurplusReview({
      cwd,
      config: config(),
      intent: 'test-gap',
      logFile,
      fetchImpl: async () => {
        calls += 1
        return new Response(JSON.stringify({ error: { message: 'rate limited' } }), { status: 429 })
      },
    })
    assert.equal(calls, 1)
    assert.equal(result.receipt.status, 'unavailable')
    assert.equal(result.receipt.transportStatus, 429)
    assert.equal(result.claims.length, 0)
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})
