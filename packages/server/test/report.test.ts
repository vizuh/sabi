import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const script = fileURLToPath(new URL('../src/report.ts', import.meta.url))
function report(rows: unknown[], priced = true, judgeRate?: number): Record<string, any> {
  const dir = mkdtempSync(path.join(tmpdir(), 'sabi-report-test-'))
  try {
    mkdirSync(path.join(dir, '.sabi'))
    const config = path.join(dir, 'sabi.config.json')
    writeFileSync(config, JSON.stringify({
      upstreams: { mock: { baseURL: 'http://127.0.0.1:1/v1', apiKey: false } },
      models: { strong: { upstream: 'mock', model: 'fixture-model', ...(priced ? { cost: { input: 1, output: 2 } } : {}) } },
      aliases: { 'sabi-code': 'strong' }, policy: {},
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
