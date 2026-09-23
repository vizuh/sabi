import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateConfig } from '../src/index.ts'
import { isFreeModel, servesUpstreamBilling } from '../src/compatibility.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
const repo = path.resolve(here, '../../..')
const shipped = [
  'sabi.config.json',
  'packages/adapters/hermes/sabi.config.openrouter.json.example',
  'packages/adapters/hermes/sabi.config.nous-free.json.example',
]

for (const relative of shipped) {
  test(`shipped ${relative}: every openrouter model is free and the upstream is free-only`, () => {
    const raw = JSON.parse(readFileSync(path.join(repo, relative), 'utf8')) as Parameters<typeof validateConfig>[0]
    const config = validateConfig(raw, relative)
    const upstream = config.upstreams.openrouter
    assert.ok(upstream, 'openrouter upstream must exist')
    assert.equal(upstream.paidModelsAllowed, false, 'openrouter upstream must declare paidModelsAllowed:false')
    for (const [tier, model] of Object.entries(config.models)) {
      if (model.upstream !== 'openrouter') continue
      assert.equal(isFreeModel(model), true, `tier '${tier}' (${model.model}) must be zero-priced/:free`)
      assert.equal(servesUpstreamBilling(upstream, model), true, `tier '${tier}' must pass the billing gate`)
    }
  })
}
