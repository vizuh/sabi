import { estimateCost, type CostRates, type DecisionRecord } from '@sabi/core'

/**
 * The `/dashboard` page: a read-only view over the proxy's in-memory recent rounds, organised
 * around whether Sabi routed well — success, recovery, confirmed-free compute, latency, and why
 * each route was chosen — before which model spent how many tokens.
 *
 * Every number is computed from `records`. A round without a finite, non-negative cost is
 * "price unknown", never $0; a savings figure only counts rounds where both the actual price and
 * the baseline price are known, and says how much of the traffic that covers.
 */

type Priced = DecisionRecord & { cost: NonNullable<DecisionRecord['cost']> }

const esc = (value: unknown): string =>
  String(value).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
const compactFormat = new Intl.NumberFormat('en', { notation: 'compact', maximumSignificantDigits: 3 })
const compact = (n: number): string => compactFormat.format(n)
const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`
const pct = (part: number, whole: number): string => whole === 0 ? '—' : `${Math.round((part / whole) * 100)}%`
const modelOf = (rec: DecisionRecord): string => rec.servedModel || rec.upstreamModel

function money(n: number): string {
  if (n === 0) return '$0'
  const digits = n >= 100 ? 0 : n >= 1 ? 2 : 4
  return `$${n.toLocaleString('en', { minimumFractionDigits: Math.min(digits, 2), maximumFractionDigits: digits })}`
}

function ms(n: number | undefined): string {
  if (n === undefined) return '—'
  return n < 1000 ? `${Math.round(n)} ms` : `${(n / 1000).toFixed(1)} s`
}

/** Nearest-rank percentile; undefined when nothing was measured. */
function percentile(values: number[], p: number): number | undefined {
  if (values.length === 0) return undefined
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]
}

/** Same rule as `sabi report`: only a finite, non-negative total is a price. */
function isPriced(rec: DecisionRecord): rec is Priced {
  return Number.isFinite(rec.cost?.total) && rec.cost!.total >= 0
}

function countBy<T>(items: T[], key: (item: T) => string): Array<[string, number]> {
  const counts = new Map<string, number>()
  for (const item of items) counts.set(key(item), (counts.get(key(item)) ?? 0) + 1)
  return [...counts].sort((a, b) => b[1] - a[1])
}

const clock = (ts: string): string => {
  const t = Date.parse(ts)
  return Number.isFinite(t) ? new Date(t).toLocaleTimeString('en', { hour12: false }) : '—'
}

function outcomeLabel(rec: DecisionRecord): string {
  if (rec.outcome === 'ok') return '<span class="st good">✓ ok</span>'
  const detail = rec.transport ? `${rec.outcome} ${rec.transport}` : rec.outcome
  return `<span class="st bad">✕ ${esc(detail)}</span>`
}

function kpi(label: string, value: string, sub: string): string {
  return `<div class="kpi"><div class="eyebrow">${label}</div><div class="kpi-value">${value}</div><div class="muted">${sub}</div></div>`
}

function bars(rows: Array<[string, number]>, total: number): string {
  if (rows.length === 0) return '<p class="empty">No rounds yet.</p>'
  return rows.map(([label, n]) => `
    <div class="bar-row">
      <span class="bar-label" title="${esc(label)}">${esc(label)}</span>
      <span class="bar-track"><span class="bar-fill" style="width:${((n / total) * 100).toFixed(1)}%"></span></span>
      <span class="bar-value">${pct(n, total)} <span class="muted">· ${n}</span></span>
    </div>`).join('')
}

function timeline(records: DecisionRecord[]): string {
  if (records.length === 0) return '<p class="empty">No rounds yet. Send a request through the proxy and refresh.</p>'
  return records.slice(-12).reverse().map((rec) => `
    <li>
      <div class="tl-head">
        <span class="tl-time">${esc(clock(rec.ts))}</span>
        <span class="badge">${esc(rec.tier)}</span>
        <span class="tl-model" title="${esc(modelOf(rec))}">${esc(modelOf(rec))}</span>
        ${outcomeLabel(rec)}
      </div>
      <div class="tl-sub muted">
        ${rec.fallback ? `<span class="recovered">↳ planned ${esc(rec.tier)} failed · served by ${esc(rec.fallback)}</span> · ` : ''}
        rule <b>${esc(rec.rule)}</b>${rec.usage ? ` · ${compact(rec.usage.totalTokens)} tok` : ''}${rec.latencyMs !== undefined ? ` · ${ms(rec.latencyMs)}` : ''}
      </div>
    </li>`).join('')
}

function health(records: DecisionRecord[]): string {
  const models = new Map<string, DecisionRecord[]>()
  for (const rec of records) models.set(modelOf(rec), [...(models.get(modelOf(rec)) ?? []), rec])
  if (models.size === 0) return '<p class="empty">No models observed yet.</p>'
  const rows = [...models].map(([model, recs]) => {
    const ok = recs.filter((rec) => rec.outcome === 'ok').length
    const last = recs[recs.length - 1]
    // ponytail: status is a heuristic over these rounds only; the controller's live health is a separate process.
    const status = ok === 0 ? ['bad', '✕ failing'] : last.outcome !== 'ok' || ok < recs.length ? ['warn', '! degraded'] : ['good', '● healthy']
    const p50 = percentile(recs.flatMap((rec) => rec.latencyMs !== undefined && rec.outcome === 'ok' ? [rec.latencyMs] : []), 50)
    return `<tr>
      <td class="model" title="${esc(model)}">${esc(model)}</td>
      <td><span class="st ${status[0]}">${status[1]}</span></td>
      <td>${pct(ok, recs.length)} <span class="muted">${ok}/${recs.length}</span></td>
      <td>${ms(p50)}</td>
    </tr>`
  }).join('')
  return `<div class="table"><table>
    <thead><tr><th>Model</th><th>Status</th><th>Success</th><th>P50</th></tr></thead>
    <tbody>${rows}</tbody></table></div>`
}

function economics(records: DecisionRecord[], baselineRates: CostRates | undefined): string {
  const ok = records.filter((rec) => rec.outcome === 'ok' && rec.usage)
  const priced = ok.filter(isPriced)
  const actual = priced.reduce((sum, rec) => sum + rec.cost.total, 0)
  const tokens = ok.reduce((sum, rec) => sum + rec.usage!.totalTokens, 0)
  const paidTokens = priced.filter((rec) => rec.cost.total > 0).reduce((sum, rec) => sum + rec.usage!.totalTokens, 0)
  const covered = priced.flatMap((rec) => {
    const baseline = estimateCost(rec.usage!, baselineRates)
    return baseline ? [{ rec, baseline: baseline.total }] : []
  })
  const baseline = covered.reduce((sum, c) => sum + c.baseline, 0)
  const coveredActual = covered.reduce((sum, c) => sum + c.rec.cost.total, 0)
  const coveredTokens = covered.reduce((sum, c) => sum + c.rec.usage!.totalTokens, 0)

  const avoided = !baselineRates
    ? '<p class="note">No strong-tier price configured, so there is no baseline to compare against.</p>'
    : baselineRates.input === 0 && baselineRates.output === 0
      ? '<p class="note">The strong tier is priced at $0, so there is no paid inference to avoid. Configure a priced baseline to measure savings.</p>'
      : covered.length === 0
        ? '<p class="note">No successful round has a known price yet, so savings cannot be estimated.</p>'
        : `<div class="econ-row"><span>Strong baseline</span><b>${money(baseline)}</b></div>
         <div class="econ-row"><span>Avoided</span><b class="good-ink">${money(baseline - coveredActual)} · ${pct(baseline - coveredActual, baseline)}</b></div>
         <div class="econ-row"><span>Pricing coverage</span><b>${pct(coveredTokens, tokens)} of tokens</b></div>`
  return `
    <div class="econ-row"><span>Known cost</span><b>${money(actual)}</b></div>
    <div class="econ-row"><span>Paid tokens</span><b>${compact(paidTokens)}</b></div>
    <div class="econ-row"><span>Price unknown</span><b>${plural(ok.length - priced.length, 'round')}</b></div>
    ${avoided}`
}

function roundsTable(records: DecisionRecord[]): string {
  if (records.length === 0) return ''
  const rows = [...records].reverse().map((rec) => `<tr>
    <td>${esc(clock(rec.ts))}</td>
    <td>${esc(rec.alias)}</td>
    <td>${esc(rec.tier)}${rec.fallback ? ` → ${esc(rec.fallback)}` : ''}</td>
    <td class="model" title="${esc(modelOf(rec))}">${esc(modelOf(rec))}</td>
    <td title="${esc(rec.reason)}">${esc(rec.rule)}</td>
    <td>${ms(rec.ttftMs)}</td>
    <td>${ms(rec.latencyMs)}</td>
    <td>${outcomeLabel(rec)}</td>
    <td>${isPriced(rec) ? money(rec.cost.total) : '—'}</td>
  </tr>`).join('')
  return `<details class="card"><summary><span class="eyebrow">All ${plural(records.length, 'round')}</span><h2>Recent rounds</h2></summary>
    <div class="table"><table>
      <thead><tr><th>Time</th><th>Route</th><th>Tier</th><th>Model</th><th>Rule</th><th>TTFT</th><th>Latency</th><th>Outcome</th><th>Cost</th></tr></thead>
      <tbody>${rows}</tbody></table></div></details>`
}

export function renderDashboard(records: DecisionRecord[], baselineRates?: CostRates): string {
  const ok = records.filter((rec) => rec.outcome === 'ok')
  const withUsage = ok.filter((rec) => rec.usage)
  const tokens = withUsage.reduce((sum, rec) => sum + rec.usage!.totalTokens, 0)
  const free = withUsage.filter((rec) => isPriced(rec) && rec.cost.total === 0)
  const freeTokens = free.reduce((sum, rec) => sum + rec.usage!.totalTokens, 0)
  const recovered = ok.filter((rec) => rec.fallback).length
  const failed = records.length - ok.length
  const priced = withUsage.filter(isPriced)
  const knownCost = priced.reduce((sum, rec) => sum + rec.cost.total, 0)
  const ttft = percentile(ok.flatMap((rec) => rec.ttftMs !== undefined ? [rec.ttftMs] : []), 50)
  const p95 = percentile(ok.flatMap((rec) => rec.latencyMs !== undefined ? [rec.latencyMs] : []), 95)
  const headline = records.length === 0
    ? 'Waiting for the first round.'
    : `${pct(ok.length, records.length)} successful · ${pct(freeTokens, tokens)} of tokens confirmed free · ${plural(recovered, 'round')} recovered by fallback`

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sabi Dashboard</title>
<style>
  :root {
    color-scheme: light;
    --bg: #f5f6f8; --card: #ffffff; --line: #eceef2; --zebra: #f7f8fa;
    --ink: #101217; --muted: #6b7180; --accent: #e8175d; --accent-soft: #fde8ef;
    --good: #0b7a4b; --warn: #a15c00; --bad: #c0262d;
    --radius: 20px;
    font-family: Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--ink); font-size: 14px; line-height: 1.45; }
  .bar { display: flex; align-items: center; justify-content: space-between; padding: 14px 32px; background: var(--card); border-bottom: 1px solid var(--line); }
  .brand { display: inline-flex; align-items: center; gap: 8px; padding: 8px 14px; border-radius: 12px; background: var(--accent-soft); color: var(--accent); font-weight: 600; }
  .brand i { width: 14px; height: 14px; border-radius: 4px; background: var(--accent); }
  main { max-width: 1280px; margin: 0 auto; padding: 32px; display: grid; gap: 20px; }
  .head { display: flex; flex-wrap: wrap; align-items: end; justify-content: space-between; gap: 16px; }
  h1 { margin: 0; font-size: 26px; font-weight: 600; letter-spacing: -0.02em; }
  h2 { margin: 2px 0 16px; font-size: 18px; font-weight: 600; letter-spacing: -0.01em; }
  .muted, .eyebrow { color: var(--muted); }
  .eyebrow { font-size: 13px; }
  .pill { padding: 8px 14px; border-radius: 12px; background: var(--card); border: 1px solid var(--line); color: var(--muted); font-size: 13px; }
  .card { background: var(--card); border: 1px solid var(--line); border-radius: var(--radius); padding: 24px; min-width: 0; }
  .kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); padding: 8px 0; }
  .kpi { padding: 14px 24px; border-left: 1px solid var(--line); min-width: 0; }
  .kpi:first-child { border-left: 0; }
  .kpi-value { margin: 8px 0 4px; font-size: 30px; font-weight: 600; letter-spacing: -0.03em; line-height: 1.1; }
  .badge { flex: none; padding: 2px 8px; border-radius: 999px; background: var(--accent-soft); color: var(--accent); font-size: 12px; font-weight: 500; }
  .grid2 { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 20px; }
  .st { white-space: nowrap; font-weight: 500; }
  .good, .good-ink { color: var(--good); } .warn { color: var(--warn); } .bad { color: var(--bad); }
  .timeline { list-style: none; margin: 0; padding: 0; }
  .timeline li { padding: 12px 0; border-top: 1px solid var(--line); }
  .timeline li:first-child { border-top: 0; padding-top: 0; }
  .tl-head { display: flex; align-items: center; gap: 10px; min-width: 0; }
  .tl-time { font-variant-numeric: tabular-nums; color: var(--muted); }
  .tl-model { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .tl-sub { margin: 4px 0 0 72px; font-size: 13px; }
  .tl-sub b { font-weight: 500; color: var(--ink); }
  .recovered { color: var(--good); }
  .bar-row { display: grid; grid-template-columns: minmax(80px, 140px) 1fr auto; align-items: center; gap: 12px; padding: 6px 0; }
  .bar-label, .model { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .bar-track { height: 10px; border-radius: 999px; background: var(--zebra); overflow: hidden; }
  .bar-fill { display: block; height: 100%; border-radius: 999px; background: var(--accent); }
  .bar-value { font-variant-numeric: tabular-nums; min-width: 72px; text-align: right; }
  .econ-row { display: flex; justify-content: space-between; gap: 12px; padding: 10px 0; border-top: 1px solid var(--line); }
  .econ-row:first-of-type { border-top: 0; }
  .econ-row b { font-weight: 600; font-variant-numeric: tabular-nums; }
  .note { margin: 12px 0 0; padding: 12px 14px; border-radius: 12px; background: var(--zebra); color: var(--muted); }
  .table { border: 1px solid var(--line); border-radius: 14px; overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; }
  th, td { padding: 12px 14px; text-align: left; white-space: nowrap; }
  th { font-size: 12px; font-weight: 500; text-transform: uppercase; letter-spacing: 0.02em; color: var(--muted); border-bottom: 1px solid var(--line); }
  tbody tr:nth-child(even) { background: var(--zebra); }
  td { font-variant-numeric: tabular-nums; }
  .model { max-width: 240px; }
  details summary { cursor: pointer; list-style: none; }
  details summary::-webkit-details-marker { display: none; }
  details:not([open]) h2 { margin-bottom: 0; }
  details h2::after { content: " ▾"; color: var(--muted); font-size: 14px; }
  .empty { color: var(--muted); margin: 0; }
  @media (max-width: 900px) { .grid2 { grid-template-columns: 1fr; } }
  @media (max-width: 600px) {
    .bar, main { padding-left: 16px; padding-right: 16px; }
    .kpi { border-left: 0; border-top: 1px solid var(--line); }
    .kpi:first-child { border-top: 0; }
    .tl-sub { margin-left: 0; }
  }
</style>
</head>
<body>
<header class="bar"><span class="brand"><i></i>Sabi</span><span class="muted">Local proxy</span></header>
<main>
  <section class="head">
    <div>
      <h1>Overview</h1>
      <div class="muted">${esc(headline)}</div>
    </div>
    <span class="pill">Last ${plural(records.length, 'round')}, since the proxy started</span>
  </section>
  <section class="card kpis" aria-label="Headline metrics">
    ${kpi('Confirmed free', `${compact(freeTokens)} tok`, `${plural(free.length, 'round')} at $0`)}
    ${kpi('Success', pct(ok.length, records.length), `${ok.length} / ${records.length} rounds`)}
    ${kpi('Recovered', String(recovered), `of ${plural(recovered + failed, 'failed plan')}`)}
    ${kpi('Known cost', money(knownCost), `${plural(withUsage.length - priced.length, 'successful round')} price unknown`)}
    ${kpi('P50 TTFT', ms(ttft), 'streamed rounds only')}
    ${kpi('P95 latency', ms(p95), 'successful rounds')}
  </section>
  <section class="grid2">
    <div class="card">
      <div class="eyebrow">Newest first</div>
      <h2>Routing timeline</h2>
      <ul class="timeline">${timeline(records)}</ul>
    </div>
    <div class="card">
      <div class="eyebrow">Observed in these rounds</div>
      <h2>Model health</h2>
      ${health(records)}
    </div>
  </section>
  <section class="grid2">
    <div class="card">
      <div class="eyebrow">Share of rounds by tier</div>
      <h2>Intelligence used</h2>
      ${bars(countBy(records, (rec) => rec.tier), records.length)}
    </div>
    <div class="card">
      <div class="eyebrow">Successful rounds</div>
      <h2>Economics</h2>
      ${economics(records, baselineRates)}
    </div>
  </section>
  <section class="card">
    <div class="eyebrow">Policy rule that picked the tier</div>
    <h2>Why Sabi chose each route</h2>
    ${bars(countBy(records, (rec) => rec.rule), records.length)}
  </section>
  ${roundsTable(records)}
</main>
</body>
</html>`
}
