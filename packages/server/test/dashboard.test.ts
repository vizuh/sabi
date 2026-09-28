import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import type { DecisionRecord } from '@sabi/core'
import { renderDashboard, type DashboardOptions } from '../src/dashboard.ts'

const NOW = Date.parse('2026-09-28T13:00:00.000Z')
const usage = (totalTokens: number) => ({ promptTokens: totalTokens, completionTokens: 0, cachedTokens: 0, totalTokens })
const render = (records: DecisionRecord[], options: DashboardOptions = {}) => renderDashboard(records, { now: NOW, ...options })

function round(overrides: Partial<DecisionRecord>): DecisionRecord {
  return {
    ts: '2026-09-28T12:00:00.000Z', sessionId: 's', alias: 'sabi-code', mode: 'auto', rule: 'fallback', tier: 'cheap',
    reason: 'test', upstream: 'openrouter', upstreamModel: 'vendor/model', stream: false, state: {} as DecisionRecord['state'],
    outcome: 'ok', ...overrides,
  }
}

test('dashboard renders an empty state, the brand logo, and the window pills', () => {
  const html = render([])
  assert.match(html, /No rounds in this window yet/)
  assert.match(html, /<img src="data:image\/png;base64,[^"]+" alt="SABI"/)
  assert.match(html, /<a href="\?hours=48&amp;lang=en" class="on" aria-current="page">48h<\/a>/)
  assert.match(html, />7d<\/a>/)
})

test('dashboard escapes model names, reasons and rules', () => {
  const html = render([round({ upstreamModel: '<img src=x onerror=alert(1)>', rule: '<b>r</b>', reason: '"><script>' })])
  assert.doesNotMatch(html, /<img src=x/)
  assert.doesNotMatch(html, /<script>/)
  assert.match(html, /&#60;img src=x onerror=alert\(1\)&#62;/)
})

test('only rounds inside the selected window count', () => {
  const records = [
    round({ ts: '2026-09-26T12:00:00.000Z', outcome: 'transport', transport: 429 }), // 49h before NOW
    round({ ts: '2026-09-28T12:30:00.000Z' }),
  ]
  assert.match(render(records), /1 round in the last 48 hours/)
  assert.match(render(records), /100% successful/)
  assert.match(render(records, { hours: 168 }), /2 rounds in the last 7 days/)
  assert.match(render(records, { hours: 168, lang: 'pt-BR' }), /2 rodadas nos últimos 7 dias/)
  assert.match(render(records, { lang: 'pt-BR' }), /1 rodada nas últimas 48 horas/)
})

test('activity buckets successful and failed rounds by hour, with a legend', () => {
  const html = render([round({}), round({ outcome: 'transport', transport: 429 })])
  assert.match(html, /<i class="sw ok"><\/i>successful/)
  assert.match(html, /<i class="sw fail"><\/i>failed/)
  assert.match(html, /1 successful · 1 failed<\/title>/)
})

test('rounds held only in memory say so', () => {
  assert.match(render([round({})], { source: 'memory' }), /No decision log found/)
  assert.doesNotMatch(render([round({})]), /No decision log found/)
})

test('confirmed free counts only $0-priced successes; unpriced is never shown as free', () => {
  const html = render([
    round({ usage: usage(100), cost: { input: 0, output: 0, total: 0 } }),
    round({ usage: usage(50) }),
    round({ outcome: 'transport', transport: 429 }),
  ])
  assert.match(html, /Free-lane hit rate<\/div><div class="kpi-value">33%<\/div><div class="muted">1 \/ 3 rounds done at \$0 · <span title="100 tokens">100<\/span> tok/)
  assert.match(html, /67% of tokens confirmed free/)
  assert.match(html, /1 successful round price unknown/)
  assert.match(html, /✕ transport 429/)
})

test('a fallback-served round counts as recovered and shows in the timeline', () => {
  const html = render([round({ outcome: 'transport', transport: 429 }), round({ fallback: 'mid', usage: usage(10) })])
  assert.match(html, /Recovered<\/div><div class="kpi-value">1<\/div><div class="muted">of 2 failed plans/)
  assert.match(html, /planned cheap failed · served by mid/)
})

test('savings count only rounds with both prices known, and say when the baseline is $0', () => {
  const priced = [round({ usage: usage(1_000_000), cost: { input: 1, output: 0, total: 1 } })]
  const html = render(priced, { baselineRates: { input: 5, output: 25 } })
  assert.match(html, /Strong baseline<\/span><b>\$5\.00/)
  assert.match(html, /Avoided<\/span><b class="good">\$4\.00 · 80%/)
  assert.match(html, /Pricing coverage<\/span><b>100% of tokens/)
  assert.match(render(priced, { baselineRates: { input: 0, output: 0 } }), /strong tier is priced at \$0/)
  assert.match(render(priced), /No strong-tier price configured/)
  assert.match(render([round({ usage: usage(10) })], { baselineRates: { input: 5, output: 25 } }), /No successful round has a known price yet/)
})

test('tokens read as-is up to 999, then k / M / B with the exact count on hover', () => {
  const kpiFor = (n: number, lang?: 'en' | 'pt-BR') =>
    render([round({ usage: usage(n), cost: { input: 0, output: 0, total: 0 } })], { lang })
  assert.match(kpiFor(999), /<span title="999 tokens">999<\/span> tok/)
  assert.match(kpiFor(1_000), />1k<\/span>/)
  assert.match(kpiFor(1_234_567), /<span title="1,234,567 tokens">1.23M<\/span>/)
  assert.match(kpiFor(999_950), />1M<\/span>/)
  assert.match(kpiFor(12_300_000_000), />12.3B<\/span>/)
  assert.match(kpiFor(1_234_567, 'pt-BR'), /<span title="1.234.567 tokens">1,23mi<\/span>/)
  assert.match(kpiFor(2_000_000_000, 'pt-BR'), />2bi<\/span>/)
})

test('pt-BR renders translated copy, pt-BR numbers, and a link back to English that keeps the window', () => {
  const html = render([round({ usage: usage(10), cost: { input: 1, output: 0, total: 1 } })], { lang: 'pt-BR', hours: 24 })
  assert.match(html, /<html lang="pt-BR">/)
  assert.match(html, /Visão geral/)
  assert.match(html, /US\$\s1,00/)
  assert.match(html, /href="\?lang=en&amp;hours=24"[^>]*>English<\/a>/)
  assert.match(render([]), /href="\?lang=pt-BR&amp;hours=48"[^>]*>Português \(BR\)<\/a>/)
})

test('model health groups by provider and model, and grades by success rate', () => {
  const html = render([
    ...Array.from({ length: 9 }, () => round({ upstream: 'nvidia' })),
    round({ upstream: 'nvidia', outcome: 'transport', transport: 429 }),
    round({ upstream: 'openrouter', outcome: 'transport', transport: 429 }),
  ])
  assert.match(html, /<div class="via muted">nvidia<\/div><\/td>\s*<td><span class="st good">● healthy/)
  assert.match(html, /<div class="via muted">openrouter<\/div><\/td>\s*<td><span class="st bad">✕ failing/)
})

test('a non-zero share below half a percent reads as <1%, not 0%', () => {
  const html = render([
    round({ usage: usage(1), cost: { input: 0, output: 0, total: 0 } }),
    round({ usage: usage(1_000) }),
  ])
  assert.match(html, /&#60;1% of tokens confirmed free/)
})

test('route reasons read as plain language, keeping the raw rule on hover', () => {
  const html = render([round({ rule: 'transport-fallback' }), round({ rule: 'some-new-rule' })])
  assert.match(html, /title="transport-fallback">Planned provider failed, rerouted</)
  assert.match(html, /title="some-new-rule">some-new-rule</)
  assert.match(render([round({ rule: 'first-turn' })], { lang: 'pt-BR' }), />Primeiro turno da tarefa</)
})

test('zero states collapse instead of reading "0 of 0"', () => {
  const html = render([round({ usage: usage(5), cost: { input: 0, output: 0, total: 0 } })])
  assert.match(html, /Recovered<\/div><div class="kpi-value">—<\/div><div class="muted">No failures in this window/)
  assert.match(html, /every successful round priced/)
  assert.match(html, /Past results in this window, not live availability/)
  assert.match(html, /1 hr\. ago|1 hour ago/)
})

test('a round stamped exactly at now is in the activity chart as well as the headline', () => {
  const html = render([round({ ts: new Date(NOW).toISOString() })])
  assert.match(html, /1 successful · 0 failed<\/title>/)
})
