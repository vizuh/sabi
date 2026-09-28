import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import type { DecisionRecord } from '@sabi/core'
import { renderDashboard } from '../src/dashboard.ts'

const usage = (totalTokens: number) => ({ promptTokens: totalTokens, completionTokens: 0, cachedTokens: 0, totalTokens })

function round(overrides: Partial<DecisionRecord>): DecisionRecord {
  return {
    ts: '2026-09-28T12:00:00.000Z', sessionId: 's', alias: 'sabi-code', mode: 'auto', rule: 'fallback', tier: 'cheap',
    reason: 'test', upstream: 'openrouter', upstreamModel: 'vendor/model', stream: false, state: {} as DecisionRecord['state'],
    outcome: 'ok', ...overrides,
  }
}

test('dashboard renders an empty state before any round', () => {
  const html = renderDashboard([])
  assert.match(html, /Waiting for the first round/)
  assert.match(html, /No rounds yet/)
})

test('dashboard escapes model names, reasons and rules', () => {
  const html = renderDashboard([
    round({ upstreamModel: '<img src=x onerror=alert(1)>', rule: '<b>r</b>', reason: '"><script>' }),
  ])
  assert.doesNotMatch(html, /<img src=x/)
  assert.doesNotMatch(html, /<script>/)
  assert.match(html, /&#60;img src=x onerror=alert\(1\)&#62;/)
})

test('confirmed free counts only $0-priced successes; unpriced is never shown as free', () => {
  const html = renderDashboard([
    round({ usage: usage(100), cost: { input: 0, output: 0, total: 0 } }),
    round({ usage: usage(50) }),
    round({ outcome: 'transport', transport: 429 }),
  ])
  assert.match(html, /100<\/span> tok<\/div><div class="muted">1 round at \$0/)
  assert.match(html, /67% of tokens confirmed free/)
  assert.match(html, /1 successful round price unknown/)
  assert.match(html, /✕ transport 429/)
})

test('a fallback-served round counts as recovered and shows in the timeline', () => {
  const html = renderDashboard([
    round({ outcome: 'transport', transport: 429 }),
    round({ fallback: 'mid', usage: usage(10) }),
  ])
  assert.match(html, /Recovered<\/div><div class="kpi-value">1<\/div><div class="muted">of 2 failed plans/)
  assert.match(html, /planned cheap failed · served by mid/)
})

test('savings count only rounds with both prices known, and say when the baseline is $0', () => {
  const priced = [round({ usage: usage(1_000_000), cost: { input: 1, output: 0, total: 1 } })]
  const html = renderDashboard(priced, { input: 5, output: 25 })
  assert.match(html, /Strong baseline<\/span><b>\$5\.00/)
  assert.match(html, /Avoided<\/span><b class="good-ink">\$4\.00 · 80%/)
  assert.match(html, /Pricing coverage<\/span><b>100% of tokens/)
  assert.match(renderDashboard(priced, { input: 0, output: 0 }), /strong tier is priced at \$0/)
  assert.match(renderDashboard(priced), /No strong-tier price configured/)
  assert.match(renderDashboard([round({ usage: usage(10) })], { input: 5, output: 25 }), /No successful round has a known price yet/)
})

test('tokens read as-is up to 999, then k / M / B with the exact count on hover', () => {
  const kpiFor = (n: number, lang?: 'en' | 'pt-BR') =>
    renderDashboard([round({ usage: usage(n), cost: { input: 0, output: 0, total: 0 } })], undefined, lang)
  assert.match(kpiFor(999), /<span title="999 tokens">999<\/span> tok/)
  assert.match(kpiFor(1_000), />1k<\/span>/)
  assert.match(kpiFor(1_234_567), /<span title="1,234,567 tokens">1.23M<\/span>/)
  assert.match(kpiFor(999_950), />1M<\/span>/)
  assert.match(kpiFor(12_300_000_000), />12.3B<\/span>/)
  assert.match(kpiFor(1_234_567, 'pt-BR'), /<span title="1.234.567 tokens">1,23mi<\/span>/)
  assert.match(kpiFor(2_000_000_000, 'pt-BR'), />2bi<\/span>/)
})

test('pt-BR renders translated copy, pt-BR numbers, and a link back to English', () => {
  const html = renderDashboard([round({ usage: usage(10), cost: { input: 1, output: 0, total: 1 } })], { input: 5, output: 25 }, 'pt-BR')
  assert.match(html, /<html lang="pt-BR">/)
  assert.match(html, /Visão geral/)
  assert.match(html, /US\$\s1,00/)
  assert.match(html, /href="\?lang=en"[^>]*>English<\/a>/)
  assert.match(renderDashboard([]), /href="\?lang=pt-BR"[^>]*>Português \(BR\)<\/a>/)
})
