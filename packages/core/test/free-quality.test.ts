import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  applyFreeQualityConfig,
  configureFreeQuality,
  freeQualityCandidates,
  selectFreeQualityModel,
  validateConfig,
  type OpenRouterCatalogModel,
} from '../src/index.ts'

const free = (patch: Partial<OpenRouterCatalogModel> = {}): OpenRouterCatalogModel => ({
  id: 'vendor/free-review',
  context_length: 131072,
  pricing: { prompt: '0', completion: '0' },
  architecture: { input_modalities: ['text'], output_modalities: ['text'] },
  supported_parameters: ['max_tokens', 'tools', 'structured_outputs', 'reasoning_effort'],
  top_provider: { context_length: 131072, max_completion_tokens: 32768 },
  ...patch,
})

test('free quality selection uses explicit zero pricing and generic capabilities', () => {
  const candidates = freeQualityCandidates([
    free({ id: 'vendor/zeta', context_length: 262144, top_provider: { context_length: 262144, max_completion_tokens: 32768 } }),
    free({ id: 'vendor/alpha' }),
    free({ id: 'vendor/not-free', pricing: { prompt: '0.01', completion: '0' } }),
    free({ id: 'vendor/no-tools', supported_parameters: ['max_tokens'] }),
    free({ id: 'vendor/non-chat', architecture: { input_modalities: ['image'], output_modalities: ['image'] } }),
  ])
  assert.deepEqual(candidates.map(({ id }) => id), ['vendor/zeta', 'vendor/alpha'])
  assert.equal(selectFreeQualityModel(candidates.map((candidate) => ({
    id: candidate.id,
    context_length: candidate.contextWindow,
    pricing: { prompt: '0', completion: '0' },
    architecture: { input_modalities: candidate.inputModalities, output_modalities: ['text'] },
    supported_parameters: ['max_tokens', 'tools'],
    top_provider: { context_length: candidate.contextWindow, max_completion_tokens: candidate.maxOutputTokens },
  })) )?.id, 'vendor/zeta')
})

test('free quality config adds a fixed lane without changing paid tiers', () => {
  const raw = {
    provenance: 'existing',
    upstreams: { openrouter: { baseURL: 'https://openrouter.ai/api/v1', apiKey: '$OPENROUTER_API_KEY' } },
    models: { mid: { upstream: 'openrouter', model: 'paid/mid' } },
    aliases: { 'sabi-code': 'auto' },
    policy: { verification: 'mid', unclassified: 'mid' },
  }
  const patched = applyFreeQualityConfig(raw, selectFreeQualityModel([free({ id: 'vendor/quality' })])!, {
    url: 'https://openrouter.ai/api/v1/models',
    observedAt: '2026-09-20T20:00:00.000Z',
    sha256: 'catalog-hash',
  })
  const checked = validateConfig(patched)
  assert.equal(checked.models.mid.model, 'paid/mid')
  assert.equal(checked.models.quality.model, 'vendor/quality')
  assert.equal(checked.models.quality.cost?.input, 0)
  assert.equal(checked.aliases['sabi-quality'], 'quality')
  assert.equal(checked.policy.verification, 'quality')
  assert.match(checked.provenance ?? '', /catalog-hash/)
})

test('configureFreeQuality writes a one-time backup and never writes the API key', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'sabi-free-quality-'))
  const configPath = path.join(dir, 'sabi.config.json')
  const original = {
    upstreams: { openrouter: { baseURL: 'https://openrouter.ai/api/v1', apiKey: '$OPENROUTER_API_KEY' } },
    models: { mid: { upstream: 'openrouter', model: 'paid/mid' } },
    aliases: { 'sabi-code': 'auto' },
    policy: { verification: 'mid', unclassified: 'mid' },
  }
  writeFileSync(configPath, JSON.stringify(original, null, 2))
  const previous = process.env.OPENROUTER_API_KEY
  process.env.OPENROUTER_API_KEY = 'sk-test-free-quality'
  try {
    const result = await configureFreeQuality(configPath, async (_url, init) => {
      assert.equal((init?.headers as Record<string, string>).Authorization, 'Bearer sk-test-free-quality')
      return {
        ok: true,
        status: 200,
        async json() {
          return { data: [free({ id: 'vendor/live-free' })] }
        },
      } as Response
    }, new Date('2026-09-20T20:00:00.000Z'))
    assert.equal(result.model, 'vendor/live-free')
    assert.ok(existsSync(`${configPath}.sabi-backup`))
    const written = readFileSync(configPath, 'utf8')
    assert.ok(!written.includes('sk-test-free-quality'))
    assert.equal(JSON.parse(written).models.quality.model, 'vendor/live-free')
  } finally {
    if (previous === undefined) delete process.env.OPENROUTER_API_KEY
    else process.env.OPENROUTER_API_KEY = previous
    rmSync(dir, { recursive: true, force: true })
  }
})
