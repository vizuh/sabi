import test from 'node:test'
import assert from 'node:assert/strict'
import { appendFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  appendCouncilLedgerReceipt,
  appendSurplusReviewReceipt,
  buildSafeReviewPacket,
  readSurplusReviewReceipts,
  readCouncilLedgerReceipts,
  newCouncilLedgerReceipt,
  parseReviewClaims,
  surplusResources,
  type SabiConfig,
} from '../src/index.ts'

function config(): SabiConfig {
  return {
    upstreams: {
      openrouter: { baseURL: 'https://openrouter.ai/api/v1', apiKey: '$OPENROUTER_API_KEY' },
      ollama: { baseURL: 'http://127.0.0.1:11434/v1', apiKey: false },
    },
    models: {
      paid: { upstream: 'openrouter', model: 'paid/model', cost: { input: 1, output: 2 } },
      quality: { upstream: 'openrouter', model: 'free/model', capabilities: { inputModalities: ['text'], tools: false }, cost: { input: 0, output: 0 } },
      local: { upstream: 'ollama', model: 'local/model', capabilities: { inputModalities: ['text'] }, cost: { input: 0, output: 0 } },
    },
    aliases: { 'sabi-code': 'auto', 'sabi-quality': 'quality', 'sabi-local': 'local' },
    policy: { verification: 'paid', unclassified: 'paid' },
  }
}

test('surplus inventory only exposes fixed zero-cost text resources', () => {
  const resources = surplusResources(config())
  assert.deepEqual(resources.map((resource) => resource.alias), ['sabi-local', 'sabi-quality'])
  assert.equal(resources.find((resource) => resource.alias === 'sabi-local')?.trust, 'local')
  assert.equal(resources.find((resource) => resource.alias === 'sabi-quality')?.trust, 'external-free')
  assert.equal(resources.some((resource) => resource.alias === 'sabi-code'), false)
})

test('safe review packets bound diff and refuse secret paths or markers', () => {
  const packet = buildSafeReviewPacket({ intent: 'bug-hunt', changedFiles: ['src/a.ts'], diff: 'x'.repeat(100), maxChars: 20 })
  assert.equal(packet.ok, true)
  if (packet.ok) {
    assert.equal(packet.packet.diff.length, 20)
    assert.equal(packet.packet.truncated, true)
    assert.equal(packet.packet.changedFiles[0], 'src/a.ts')
  }
  assert.deepEqual(buildSafeReviewPacket({ intent: 'bug-hunt', changedFiles: ['.env'], diff: 'safe' }), { ok: false, reason: 'secret-path' })
  for (const file of ['credentials.json', 'secrets.yaml', 'token.txt', '.npmrc', 'id_rsa']) {
    assert.deepEqual(buildSafeReviewPacket({ intent: 'bug-hunt', changedFiles: [file], diff: 'safe' }), { ok: false, reason: 'secret-path' })
  }
  assert.equal(buildSafeReviewPacket({ intent: 'bug-hunt', changedFiles: ['src/tokens.ts'], diff: 'safe' }).ok, true)
  assert.deepEqual(buildSafeReviewPacket({ intent: 'bug-hunt', changedFiles: ['src/a.ts'], diff: 'Authorization: Bearer sk-live-ABCDEF1234567890abcdef' }), { ok: false, reason: 'secret-marker' })
})

test('prefixed secret names are refused while ordinary source names pass (#70)', () => {
  for (const file of ['prod-secrets.yaml', 'app-secrets.json', 'legacy-credentials.txt', 'service-token-prod.yaml', 'config/prod-secrets.yaml']) {
    assert.deepEqual(
      buildSafeReviewPacket({ intent: 'bug-hunt', changedFiles: [file], diff: 'safe' }),
      { ok: false, reason: 'secret-path' },
      `${file} must be refused`,
    )
  }
  for (const file of ['src/a.ts', 'src/tokens.ts', 'src/secret-sauce.ts', 'docs/password-policy.md', 'src/credential-store.test.ts']) {
    const result = buildSafeReviewPacket({ intent: 'bug-hunt', changedFiles: [file], diff: 'safe diff' })
    assert.equal(result.ok, true, `${file} must stay admissible`)
  }
})

test('the egress canary refuses common credential tokens (#70)', () => {
  for (const diff of [
    'key = ghp_A1b2C3d4E5f6G7h8I9j0K1l2M3',
    'token github_pat_11ABCDEFG1234567890abcdef',
    'postgres://usuario:senha@host:5432/db',
    'DB_PASSWORD=hunter2segredo',
  ]) {
    assert.deepEqual(
      buildSafeReviewPacket({ intent: 'bug-hunt', changedFiles: ['src/a.ts'], diff }),
      { ok: false, reason: 'secret-marker' },
      `diff must be refused: ${diff.slice(0, 24)}…`,
    )
  }
})
test('review claim parsing is structured, bounded and never verifies model claims', () => {
  const result = parseReviewClaims('prefix ```json\n{"claims":[{"category":"bug","severity":"high","claim":"null state","file":"src/a.ts","line":4,"confidence":0.8},{"claim":"sk-live-ABCDEF1234567890abcdef"}]}\n``` suffix')
  assert.equal(result.status, 'ok')
  assert.equal(result.claims.length, 1)
  assert.equal(result.claims[0]?.line, 4)
  assert.equal(result.claims[0]?.confidence, 0.8)
})

test('surplus receipts persist metadata only', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'sabi-surplus-core-'))
  const file = path.join(dir, 'receipts.jsonl')
  try {
    const receipt = {
      version: 1 as const,
      reviewId: 'review-1',
      ts: '2026-09-20T20:00:00.000Z',
      taskKey: 'task-1',
      intent: 'bug-hunt' as const,
      resource: { alias: 'sabi-quality', provider: 'openrouter', model: 'free/model', trust: 'external-free' as const },
      status: 'ok' as const,
      parseStatus: 'ok' as const,
      claimCount: 1,
      verifiedClaimCount: 0 as const,
      verification: 'not-run' as const,
    }
    appendSurplusReviewReceipt(receipt, file)
    assert.equal(readSurplusReviewReceipts(file)[0]?.claimCount, 1)
    assert.ok(!readFileSync(file, 'utf8').includes('null state'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('council ledger receipts preserve harness provenance without raw content', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'sabi-council-core-'))
  const file = path.join(dir, 'council.jsonl')
  try {
    const receipt = newCouncilLedgerReceipt({
      taskKey: 'task-1',
      harness: 'opencode',
      runtimeVersion: '1.18.31',
      provider: 'openrouter',
      model: 'provider/model:free',
      seatId: 'contract-seat',
      stage: 'review',
      mode: 'probe',
      intent: 'api-contract',
      status: 'completed',
      evidence: 'execution',
      source: 'live',
      inputSha256: 'A'.repeat(64),
      transportStatus: 700,
      claimCount: 2,
      verifiedClaimCount: 2,
      now: new Date('2026-09-20T22:00:00.000Z'),
    })
    appendCouncilLedgerReceipt(receipt, file)
    const rows = readCouncilLedgerReceipts(file)
    assert.equal(rows.length, 1)
    assert.equal(rows[0]?.harness, 'opencode')
    assert.equal(rows[0]?.runtimeVersion, '1.18.31')
    assert.equal(rows[0]?.model, 'provider/model:free')
    assert.equal(rows[0]?.verifiedClaimCount, 0)
    assert.equal(rows[0]?.transportStatus, undefined)
    assert.ok(!readFileSync(file, 'utf8').includes('raw content'))
    appendCouncilLedgerReceipt({ ...receipt, rawPrompt: 'do not persist', credentials: 'do not persist' } as typeof receipt, file)
    assert.equal(readCouncilLedgerReceipts(file).length, 2)
    assert.doesNotMatch(readFileSync(file, 'utf8'), /do not persist/)
    appendFileSync(file, `${JSON.stringify({ ...receipt, intent: 'invalid' })}\n`)
    assert.equal(readCouncilLedgerReceipts(file).length, 2)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
