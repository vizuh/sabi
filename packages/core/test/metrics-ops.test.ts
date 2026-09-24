import test from 'node:test'
import assert from 'node:assert/strict'
import { InMemoryMetrics, metricName, sanitizeLabels } from '../src/metrics.ts'

/**
 * Operational metrics in OTel/Prometheus shape (spec 010 US2, T030/T031).
 * Labels are bounded and allowlisted; samples are append-only.
 */

test('a metric sink records labeled samples and looks them up by name', () => {
  const sink = new InMemoryMetrics()
  sink.record('route_latency_ms', 12.3, { tier: 'mid', upstream: 'openrouter' })
  sink.record('route_latency_ms', 8.1, { tier: 'cheap', upstream: 'openrouter' })
  // Different label sets live in separate series; the sink exposes them all.
  const all = sink.all().filter((series) => series.name === 'route_latency_ms')
  assert.equal(all.length, 2)
  assert.equal(all[0].samples[0].labels.tier, 'mid')
  assert.equal(all[1].samples[0].labels.tier, 'cheap')
})

test('unbounded labels are dropped, never coerced', () => {
  const sink = new InMemoryMetrics()
  sink.record('route_latency_ms', 1, {
    tier: 'mid',
    upstream: 'openrouter',
    rawPrompt: 'a very long secret-ish excerpt that must not survive',
  })
  const series = sink.series('route_latency_ms')!
  const labels = series.samples[0].labels
  assert.ok(!('rawPrompt' in labels))
  assert.equal(labels.tier, 'mid')
})

test('labels are length-bounded', () => {
  const labels = sanitizeLabels({ tier: 'x'.repeat(200) })
  assert.ok(labels.tier.length <= 64)
})

test('the sink is bounded and drops oldest samples first', () => {
  const sink = new InMemoryMetrics(3)
  for (let i = 0; i < 5; i++) sink.record('route_latency_ms', i, { tier: 'mid' })
  const series = sink.series('route_latency_ms')!
  assert.equal(series.samples.length, 3)
  assert.equal(series.samples[0].value, 2)
})

test('metric names are normalized and length-bounded', () => {
  const name = metricName('sabi route', 'latency/ms')
  assert.ok(name.startsWith('sabi_route'))
  assert.ok(name.length <= 128)
  assert.ok(!name.includes('/'))
})

test('reset clears every series', () => {
  const sink = new InMemoryMetrics()
  sink.record('route_latency_ms', 1, { tier: 'mid' })
  sink.reset()
  assert.equal(sink.all().length, 0)
})