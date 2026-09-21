import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const script = fileURLToPath(new URL('../src/report.ts', import.meta.url))
function report(rows: unknown[], priced = true, judgeRate?: number, policy: Record<string, string> = {}): Record<string, any> {
  const dir = mkdtempSync(path.join(tmpdir(), 'sabi-report-test-'))
  try {
    mkdirSync(path.join(dir, '.sabi'))
    const config = path.join(dir, 'sabi.config.json')
    writeFileSync(config, JSON.stringify({
      upstreams: { mock: { baseURL: 'http://127.0.0.1:1/v1', apiKey: false } },
      models: { strong: { upstream: 'mock', model: 'fixture-model', ...(priced ? { cost: { input: 1, output: 2 } } : {}) } },
      aliases: { 'sabi-code': 'strong' }, policy,
      judge: { enabled: false, ...(judgeRate === undefined ? {} : { costPerMTokInput: judgeRate }) },
    }))
    writeFileSync(path.join(dir, '.sabi/decisions.jsonl'), rows.map(r => JSON.stringify(r)).join('\n') + '\n')
    const result = spawnSync(process.execPath, [script, '--json'], { cwd: dir, encoding: 'utf8', timeout: 5000,
      env: { PATH: process.env.PATH, HOME: dir, SABI_CONFIG: config } })
    assert.equal(result.status, 0, result.stderr)
    return JSON.parse(result.stdout)
  } finally { rmSync(dir, { recursive: true, force: true }) }
}
const usage = { promptTokens: 1000, completionTokens: 200, cachedTokens: 0, totalTokens: 1200 }
const row = { sessionId: 'fixture', sessionKnown: true, tier: 'mid', rule: 'first-turn', upstreamModel: 'fixture-model', outcome: 'ok', usage }

test('report leaves missing prices/cost unknown and does not invent savings', () => {
  const out = report([row], false)
  assert.equal(out.cost, null)
  assert.equal(out.counterfactual, null)
  assert.equal(out.netCost, null)
  assert.equal(out.savingsPct, null)
  assert.equal(out.unknownCostRows, 1)
})
test('report separates missing usage and unverified legacy sessions', () => {
  const out = report([{ ...row, sessionKnown: undefined, usage: undefined }])
  assert.equal(out.sessions, 0)
  assert.equal(out.unattributedRequests, 1)
  assert.equal(out.cost, null)
  assert.equal(out.savingsPct, null)
})
test('report includes known judge spend, but never invents an absent judge price', () => {
  const judged = { ...row, cost: { total: 0.0004 }, judge: { status: 'ok', usage: { inputTokens: 1000 } } }
  assert.equal(report([judged]).judgeCost, null)
  assert.equal(report([judged]).savingsPct, null)
  const out = report([judged], true, 1)
  assert.equal(out.judgeCost, 0.001)
  assert.equal(out.netCost, 0.0014)
  assert.ok(Math.abs(out.savingsPct) < 1e-10)
})

test('report surfaces what the policy could not see, without inventing a counterfactual', () => {
  const vetoed = {
    ...row,
    tier: 'strong',
    cost: { total: 0.0002 },
    judge: { status: 'ok', overridden: true, direction: 'down', originalTier: 'strong', finalTier: 'mid' },
  }
  const upgraded = {
    ...row,
    rule: 'unclassified',
    judge: { status: 'ok', overridden: true, direction: 'up', originalTier: 'cheap', finalTier: 'strong' },
  }
  const out = report([vetoed, upgraded], true, undefined, { 'first-turn': 'strong', failure: 'strong', stuck: 'strong' })
  assert.equal(out.discover.vetoedRounds, 1)
  assert.equal(out.discover.upgradedRounds, 1)
  assert.equal(out.discover.unclassifiedRounds, 1)
  assert.equal(out.discover.unclassifiedSharePct, 50)
  // 1000 in / 200 out at the planned tier's $1/$2 = 0.0014, against 0.0002 actually served.
  assert.ok(Math.abs(out.discover.avoidedCost - 0.0012) < 1e-9)
  assert.equal(out.discover.avoidedCostType, 'rate-only estimate')
  // `first-turn` fired on both rows, so only the rules that never fired are named.
  assert.deepEqual(out.discover.rulesNeverFired, ['failure', 'stuck'])
  assert.deepEqual(out.discover.idleTiers, [])
})

test('a veto without usable usage or price leaves the avoided cost unknown', () => {
  const out = report([
    { ...row, usage: undefined, judge: { status: 'ok', overridden: true, direction: 'down', originalTier: 'strong' } },
  ])
  assert.equal(out.discover.vetoedRounds, 1)
  assert.equal(out.discover.avoidedCost, null)
  assert.equal(out.discover.avoidedCostUnknownRows, 1)
})

test('report counts shadow evidence-redundancy answers without acting on them', () => {
  const shadow = { ...row, judge: { status: 'ok', evidenceRedundant: 0.81 } }
  const out = report([shadow, row])
  assert.deepEqual(out.judge.evidenceRedundant, { scored: 1, redundant: 1, threshold: 0.6 })
})

test('report exposes bounded local semantic profiles without claiming universal rankings', () => {
  const out = report([{ ...row, state: { roundKind: 'verification' }, latencyMs: 25 }])
  assert.equal(out.semanticProfiles.length, 1)
  assert.equal(out.semanticProfiles[0].operation, 'verification')
  assert.equal(out.semanticProfiles[0].model, 'fixture-model')
  assert.equal(out.semanticProfiles[0].confidence, 'low')
})

test('report keeps observational and replayed recovery evidence separate', () => {
  const recovery = (evidenceGrade: 'observed' | 'matched' | 'replayed') => ({
    failureSignature: 'failure-1',
    stateFingerprint: 'state-1',
    action: 'retry-with-feedback',
    outcome: 'recovered',
    evidenceGrade,
    contextGeneration: 0,
  })
  const out = report([
    { ...row, recovery: recovery('observed') },
    { ...row, recovery: recovery('matched') },
    { ...row, recovery: recovery('replayed') },
  ])
  assert.deepEqual(out.recoveryEvidenceGrades, { observed: 1, matched: 1, replayed: 1 })
})
