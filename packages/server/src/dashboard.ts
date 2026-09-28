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

export type DashboardLang = 'en' | 'pt-BR'

type Priced = DecisionRecord & { cost: NonNullable<DecisionRecord['cost']> }
type Plural = (n: number) => string

const plural = (one: string, many: string): Plural => (n) => `${n} ${n === 1 ? one : many}`

/** Every visible string, per language. Data (model names, rules, tiers, outcomes) is never translated. */
const COPY = {
  en: {
    title: 'Sabi Dashboard', proxy: 'Local proxy', langName: 'English', overview: 'Overview',
    waiting: 'Waiting for the first round.',
    headline: (success: string, free: string, recovered: number) =>
      `${success} successful · ${free} of tokens confirmed free · ${plural('round', 'rounds')(recovered)} recovered by fallback`,
    scope: (n: number) => `Last ${plural('round', 'rounds')(n)}, since the proxy started`,
    rounds: plural('round', 'rounds'), successfulRounds: plural('successful round', 'successful rounds'),
    failedPlans: plural('failed plan', 'failed plans'),
    metrics: 'Headline metrics', confirmedFree: 'Confirmed free', atZero: (n: number, zero: string) => `${plural('round', 'rounds')(n)} at ${zero}`,
    success: 'Success', recovered: 'Recovered', of: 'of', knownCost: 'Known cost', priceUnknown: 'price unknown',
    ttft: 'P50 TTFT', streamedOnly: 'streamed rounds only', p95: 'P95 latency', successful: 'successful rounds', successfulTitle: 'Successful rounds',
    newestFirst: 'Newest first', timeline: 'Routing timeline', planned: (tier: string, fallback: string) => `planned ${tier} failed · served by ${fallback}`,
    rule: 'rule', noRounds: 'No rounds yet.', noRoundsHint: 'No rounds yet. Send a request through the proxy and refresh.',
    observed: 'Observed in these rounds', health: 'Model health', noModels: 'No models observed yet.',
    healthy: 'healthy', degraded: 'degraded', failing: 'failing',
    tierShare: 'Share of rounds by tier', intelligence: 'Intelligence used',
    economics: 'Economics', paidTokens: 'Paid tokens', priceUnknownRow: 'Price unknown', baseline: 'Strong baseline',
    avoided: 'Avoided', coverage: 'Pricing coverage', ofTokens: (pct: string) => `${pct} of tokens`,
    noBaseline: 'No strong-tier price configured, so there is no baseline to compare against.',
    zeroBaseline: (zero: string) => `The strong tier is priced at ${zero}, so there is no paid inference to avoid. Configure a priced baseline to measure savings.`,
    noPriced: 'No successful round has a known price yet, so savings cannot be estimated.',
    ruleSource: 'Policy rule that picked the tier', why: 'Why Sabi chose each route',
    all: (n: number) => `All ${plural('round', 'rounds')(n)}`, recent: 'Recent rounds',
    cols: { time: 'Time', route: 'Route', tier: 'Tier', model: 'Model', rule: 'Rule', ttft: 'TTFT', latency: 'Latency', outcome: 'Outcome', cost: 'Cost', status: 'Status', success: 'Success', p50: 'P50' },
    units: ['k', 'M', 'B', 'T'],
  },
  'pt-BR': {
    title: 'Painel Sabi', proxy: 'Proxy local', langName: 'Português (BR)', overview: 'Visão geral',
    waiting: 'Aguardando a primeira rodada.',
    headline: (success: string, free: string, recovered: number) =>
      `${success} com sucesso · ${free} dos tokens confirmados gratuitos · ${plural('rodada recuperada', 'rodadas recuperadas')(recovered)} por fallback`,
    scope: (n: number) => `${plural('rodada', 'rodadas')(n)} desde o início do proxy`,
    rounds: plural('rodada', 'rodadas'), successfulRounds: plural('rodada com sucesso', 'rodadas com sucesso'),
    failedPlans: plural('plano com falha', 'planos com falha'),
    metrics: 'Métricas principais', confirmedFree: 'Gratuito confirmado', atZero: (n: number, zero: string) => `${plural('rodada', 'rodadas')(n)} a ${zero}`,
    success: 'Sucesso', recovered: 'Recuperadas', of: 'de', knownCost: 'Custo conhecido', priceUnknown: 'sem preço',
    ttft: 'TTFT P50', streamedOnly: 'só rodadas em streaming', p95: 'Latência P95', successful: 'rodadas com sucesso', successfulTitle: 'Rodadas com sucesso',
    newestFirst: 'Mais recentes primeiro', timeline: 'Linha do tempo de roteamento', planned: (tier: string, fallback: string) => `${tier} planejado falhou · atendido por ${fallback}`,
    rule: 'regra', noRounds: 'Nenhuma rodada ainda.', noRoundsHint: 'Nenhuma rodada ainda. Envie uma requisição pelo proxy e atualize a página.',
    observed: 'Observado nestas rodadas', health: 'Saúde dos modelos', noModels: 'Nenhum modelo observado ainda.',
    healthy: 'saudável', degraded: 'degradado', failing: 'falhando',
    tierShare: 'Parcela das rodadas por tier', intelligence: 'Inteligência usada',
    economics: 'Custos', paidTokens: 'Tokens pagos', priceUnknownRow: 'Sem preço', baseline: 'Referência strong',
    avoided: 'Evitado', coverage: 'Cobertura de preço', ofTokens: (pct: string) => `${pct} dos tokens`,
    noBaseline: 'O tier strong não tem preço configurado, então não há referência para comparar.',
    zeroBaseline: (zero: string) => `O tier strong custa ${zero} na configuração, então não há inferência paga a evitar. Configure uma referência com preço para medir a economia.`,
    noPriced: 'Nenhuma rodada com sucesso tem preço conhecido ainda, então não dá para estimar a economia.',
    ruleSource: 'Regra de política que escolheu o tier', why: 'Por que o Sabi escolheu cada rota',
    all: (n: number) => `Todas as rodadas (${n})`, recent: 'Rodadas recentes',
    cols: { time: 'Hora', route: 'Rota', tier: 'Tier', model: 'Modelo', rule: 'Regra', ttft: 'TTFT', latency: 'Latência', outcome: 'Resultado', cost: 'Custo', status: 'Status', success: 'Sucesso', p50: 'P50' },
    units: ['k', 'mi', 'bi', 'tri'],
  },
} satisfies Record<DashboardLang, unknown>

type Copy = (typeof COPY)['en']

const esc = (value: unknown): string =>
  String(value).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
const modelOf = (rec: DecisionRecord): string => rec.servedModel || rec.upstreamModel

/** Formatting bound to one language: numbers, tokens, money, durations, clock. */
function formatters(lang: DashboardLang) {
  const copy: Copy = COPY[lang]
  const sig3 = new Intl.NumberFormat(lang, { maximumSignificantDigits: 3 })
  const whole = new Intl.NumberFormat(lang)
  const percent = new Intl.NumberFormat(lang, { style: 'percent', maximumFractionDigits: 0 })
  const oneDecimal = new Intl.NumberFormat(lang, { maximumFractionDigits: 1 })

  /** 0–999 as-is, then k / M (mi) / B (bi) / T (tri) at 3 significant digits, never "1000k". */
  const tokens = (n: number): string => {
    if (n < 1000) return whole.format(n)
    let unit = -1
    let value = n
    while (unit < copy.units.length - 1 && Number(value.toPrecision(3)) >= 1000) {
      value /= 1000
      unit += 1
    }
    return `${sig3.format(value)}${copy.units[unit]}`
  }
  const tokensHtml = (n: number): string => `<span title="${esc(whole.format(n))} tokens">${esc(tokens(n))}</span>`
  const money = (n: number): string => {
    const digits = n === 0 ? 0 : n >= 100 ? 0 : n >= 1 ? 2 : 4
    return new Intl.NumberFormat(lang, { style: 'currency', currency: 'USD', minimumFractionDigits: Math.min(digits, 2), maximumFractionDigits: digits }).format(n)
  }
  const pct = (part: number, total: number): string => total === 0 ? '—' : percent.format(part / total)
  const ms = (n: number | undefined): string =>
    n === undefined ? '—' : n < 1000 ? `${whole.format(Math.round(n))} ms` : `${oneDecimal.format(n / 1000)} s`
  const clock = (ts: string): string => {
    const t = Date.parse(ts)
    return Number.isFinite(t) ? new Date(t).toLocaleTimeString(lang, { hour12: false }) : '—'
  }
  return { copy, tokens, tokensHtml, money, pct, ms, clock }
}

type Format = ReturnType<typeof formatters>

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

function outcomeLabel(rec: DecisionRecord): string {
  if (rec.outcome === 'ok') return '<span class="st good">✓ ok</span>'
  const detail = rec.transport ? `${rec.outcome} ${rec.transport}` : rec.outcome
  return `<span class="st bad">✕ ${esc(detail)}</span>`
}

function kpi(label: string, value: string, sub: string): string {
  return `<div class="kpi"><div class="eyebrow">${label}</div><div class="kpi-value">${value}</div><div class="muted">${sub}</div></div>`
}

function bars(f: Format, rows: Array<[string, number]>, total: number): string {
  if (rows.length === 0) return `<p class="empty">${f.copy.noRounds}</p>`
  return rows.map(([label, n]) => `
    <div class="bar-row">
      <span class="bar-label" title="${esc(label)}">${esc(label)}</span>
      <span class="bar-track"><span class="bar-fill" style="width:${((n / total) * 100).toFixed(1)}%"></span></span>
      <span class="bar-value">${f.pct(n, total)} <span class="muted">· ${n}</span></span>
    </div>`).join('')
}

function timeline(f: Format, records: DecisionRecord[]): string {
  if (records.length === 0) return `<p class="empty">${f.copy.noRoundsHint}</p>`
  return records.slice(-12).reverse().map((rec) => `
    <li>
      <div class="tl-head">
        <span class="tl-time">${esc(f.clock(rec.ts))}</span>
        <span class="badge">${esc(rec.tier)}</span>
        <span class="tl-model" title="${esc(modelOf(rec))}">${esc(modelOf(rec))}</span>
        ${outcomeLabel(rec)}
      </div>
      <div class="tl-sub muted">
        ${rec.fallback ? `<span class="recovered">↳ ${esc(f.copy.planned(rec.tier, rec.fallback))}</span> · ` : ''}
        ${f.copy.rule} <b>${esc(rec.rule)}</b>${rec.usage ? ` · ${f.tokensHtml(rec.usage.totalTokens)} tok` : ''}${rec.latencyMs !== undefined ? ` · ${f.ms(rec.latencyMs)}` : ''}
      </div>
    </li>`).join('')
}

function health(f: Format, records: DecisionRecord[]): string {
  const { copy } = f
  const models = new Map<string, DecisionRecord[]>()
  for (const rec of records) models.set(modelOf(rec), [...(models.get(modelOf(rec)) ?? []), rec])
  if (models.size === 0) return `<p class="empty">${copy.noModels}</p>`
  const rows = [...models].map(([model, recs]) => {
    const ok = recs.filter((rec) => rec.outcome === 'ok').length
    const last = recs[recs.length - 1]
    // ponytail: status is a heuristic over these rounds only; the controller's live health is a separate process.
    const status = ok === 0 ? ['bad', `✕ ${copy.failing}`] : last.outcome !== 'ok' || ok < recs.length ? ['warn', `! ${copy.degraded}`] : ['good', `● ${copy.healthy}`]
    const p50 = percentile(recs.flatMap((rec) => rec.latencyMs !== undefined && rec.outcome === 'ok' ? [rec.latencyMs] : []), 50)
    return `<tr>
      <td class="model" title="${esc(model)}">${esc(model)}</td>
      <td><span class="st ${status[0]}">${status[1]}</span></td>
      <td>${f.pct(ok, recs.length)} <span class="muted">${ok}/${recs.length}</span></td>
      <td>${f.ms(p50)}</td>
    </tr>`
  }).join('')
  return `<div class="table"><table>
    <thead><tr><th>${copy.cols.model}</th><th>${copy.cols.status}</th><th>${copy.cols.success}</th><th>${copy.cols.p50}</th></tr></thead>
    <tbody>${rows}</tbody></table></div>`
}

function economics(f: Format, records: DecisionRecord[], baselineRates: CostRates | undefined): string {
  const { copy } = f
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
    ? `<p class="note">${copy.noBaseline}</p>`
    : baselineRates.input === 0 && baselineRates.output === 0
      ? `<p class="note">${copy.zeroBaseline(f.money(0))}</p>`
      : covered.length === 0
        ? `<p class="note">${copy.noPriced}</p>`
        : `<div class="econ-row"><span>${copy.baseline}</span><b>${f.money(baseline)}</b></div>
           <div class="econ-row"><span>${copy.avoided}</span><b${baseline >= coveredActual ? ' class="good-ink"' : ''}>${f.money(baseline - coveredActual)} · ${f.pct(baseline - coveredActual, baseline)}</b></div>
           <div class="econ-row"><span>${copy.coverage}</span><b>${copy.ofTokens(f.pct(coveredTokens, tokens))}</b></div>`
  return `
    <div class="econ-row"><span>${copy.knownCost}</span><b>${f.money(actual)}</b></div>
    <div class="econ-row"><span>${copy.paidTokens}</span><b>${f.tokensHtml(paidTokens)}</b></div>
    <div class="econ-row"><span>${copy.priceUnknownRow}</span><b>${copy.rounds(ok.length - priced.length)}</b></div>
    ${avoided}`
}

function roundsTable(f: Format, records: DecisionRecord[]): string {
  if (records.length === 0) return ''
  const { cols } = f.copy
  const rows = [...records].reverse().map((rec) => `<tr>
    <td>${esc(f.clock(rec.ts))}</td>
    <td>${esc(rec.alias)}</td>
    <td>${esc(rec.tier)}${rec.fallback ? ` → ${esc(rec.fallback)}` : ''}</td>
    <td class="model" title="${esc(modelOf(rec))}">${esc(modelOf(rec))}</td>
    <td title="${esc(rec.reason)}">${esc(rec.rule)}</td>
    <td>${f.ms(rec.ttftMs)}</td>
    <td>${f.ms(rec.latencyMs)}</td>
    <td>${outcomeLabel(rec)}</td>
    <td>${isPriced(rec) ? f.money(rec.cost.total) : '—'}</td>
  </tr>`).join('')
  return `<details class="card"><summary><span class="eyebrow">${f.copy.all(records.length)}</span><h2>${f.copy.recent}</h2></summary>
    <div class="table"><table>
      <thead><tr><th>${cols.time}</th><th>${cols.route}</th><th>${cols.tier}</th><th>${cols.model}</th><th>${cols.rule}</th><th>${cols.ttft}</th><th>${cols.latency}</th><th>${cols.outcome}</th><th>${cols.cost}</th></tr></thead>
      <tbody>${rows}</tbody></table></div></details>`
}

export function renderDashboard(records: DecisionRecord[], baselineRates?: CostRates, lang: DashboardLang = 'en'): string {
  const f = formatters(lang)
  const { copy } = f
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
  const headline = records.length === 0 ? copy.waiting : copy.headline(f.pct(ok.length, records.length), f.pct(freeTokens, tokens), recovered)
  const other: DashboardLang = lang === 'en' ? 'pt-BR' : 'en'

  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${copy.title}</title>
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
  .bar { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 14px 32px; background: var(--card); border-bottom: 1px solid var(--line); }
  .bar-right { display: flex; align-items: center; gap: 12px; }
  .brand { display: inline-flex; align-items: center; gap: 8px; padding: 8px 14px; border-radius: 12px; background: var(--accent-soft); color: var(--accent); font-weight: 600; }
  .brand i { width: 14px; height: 14px; border-radius: 4px; background: var(--accent); }
  .lang { padding: 8px 14px; border-radius: 12px; border: 1px solid var(--line); color: var(--ink); text-decoration: none; font-weight: 500; }
  .lang:hover, .lang:focus-visible { border-color: var(--accent); color: var(--accent); }
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
    .bar-right .muted { display: none; }
    .kpi { border-left: 0; border-top: 1px solid var(--line); }
    .kpi:first-child { border-top: 0; }
    .tl-sub { margin-left: 0; }
  }
</style>
</head>
<body>
<header class="bar">
  <span class="brand"><i></i>Sabi</span>
  <span class="bar-right"><span class="muted">${copy.proxy}</span><a class="lang" href="?lang=${other}" hreflang="${other}" lang="${other}">${COPY[other].langName}</a></span>
</header>
<main>
  <section class="head">
    <div>
      <h1>${copy.overview}</h1>
      <div class="muted">${esc(headline)}</div>
    </div>
    <span class="pill">${copy.scope(records.length)}</span>
  </section>
  <section class="card kpis" aria-label="${copy.metrics}">
    ${kpi(copy.confirmedFree, `${f.tokensHtml(freeTokens)} tok`, copy.atZero(free.length, f.money(0)))}
    ${kpi(copy.success, f.pct(ok.length, records.length), `${ok.length} / ${copy.rounds(records.length)}`)}
    ${kpi(copy.recovered, String(recovered), `${copy.of} ${copy.failedPlans(recovered + failed)}`)}
    ${kpi(copy.knownCost, f.money(knownCost), `${copy.successfulRounds(withUsage.length - priced.length)} ${copy.priceUnknown}`)}
    ${kpi(copy.ttft, f.ms(ttft), copy.streamedOnly)}
    ${kpi(copy.p95, f.ms(p95), copy.successful)}
  </section>
  <section class="grid2">
    <div class="card">
      <div class="eyebrow">${copy.newestFirst}</div>
      <h2>${copy.timeline}</h2>
      <ul class="timeline">${timeline(f, records)}</ul>
    </div>
    <div class="card">
      <div class="eyebrow">${copy.observed}</div>
      <h2>${copy.health}</h2>
      ${health(f, records)}
    </div>
  </section>
  <section class="grid2">
    <div class="card">
      <div class="eyebrow">${copy.tierShare}</div>
      <h2>${copy.intelligence}</h2>
      ${bars(f, countBy(records, (rec) => rec.tier), records.length)}
    </div>
    <div class="card">
      <div class="eyebrow">${copy.successfulTitle}</div>
      <h2>${copy.economics}</h2>
      ${economics(f, records, baselineRates)}
    </div>
  </section>
  <section class="card">
    <div class="eyebrow">${copy.ruleSource}</div>
    <h2>${copy.why}</h2>
    ${bars(f, countBy(records, (rec) => rec.rule), records.length)}
  </section>
  ${roundsTable(f, records)}
</main>
</body>
</html>`
}
