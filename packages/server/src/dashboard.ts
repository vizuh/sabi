import { estimateCost, type CostRates, type DecisionRecord } from '@sabi/core'
import { SABI_LOGO_DATA_URI } from './dashboard-logo.ts'

/**
 * The `/dashboard` page: a read-only view over recorded rounds, organised around whether Sabi
 * routed well — success, recovery, confirmed-free compute, latency, and why each route was
 * chosen — before which model spent how many tokens.
 *
 * Every number is computed from `records`. A round without a finite, non-negative cost is
 * "price unknown", never $0; a savings figure only counts rounds where both the actual price and
 * the baseline price are known, and says how much of the traffic that covers.
 */

export type DashboardLang = 'en' | 'pt-BR'
/** Selectable windows, in hours. */
export const DASHBOARD_WINDOWS = [24, 48, 168] as const
export type DashboardWindow = (typeof DASHBOARD_WINDOWS)[number]

export interface DashboardOptions {
  baselineRates?: CostRates
  lang?: DashboardLang
  hours?: DashboardWindow
  /** Where `records` came from: the decision log, or only this process's memory. */
  source?: 'log' | 'memory'
  now?: number
}

type Priced = DecisionRecord & { cost: NonNullable<DecisionRecord['cost']> }
type Plural = (n: number) => string

const TABLE_LIMIT = 200
const plural = (one: string, many: string): Plural => (n) => `${n} ${n === 1 ? one : many}`
const windowLabel = (hours: number): string => hours % 24 === 0 && hours > 48 ? `${hours / 24}d` : `${hours}h`

/** Every visible string, per language. Data (model names, rules, tiers, outcomes) is never translated. */
const COPY = {
  en: {
    title: 'Sabi Dashboard', proxy: 'Local proxy', langName: 'English', overview: 'Overview',
    waiting: 'No rounds in this window yet.',
    headline: (success: string, free: string, recovered: number) =>
      `${success} successful · ${free} of tokens confirmed free · ${plural('round', 'rounds')(recovered)} recovered by fallback`,
    scope: (n: number, hours: number) => `${plural('round', 'rounds')(n)} in the last ${hours > 48 ? `${hours / 24} days` : `${hours} hours`}`,
    memoryOnly: 'No decision log found: showing rounds held in memory since the proxy started.',
    windowNav: 'Time window',
    rounds: plural('round', 'rounds'), successfulRounds: plural('successful round', 'successful rounds'),
    failedPlans: plural('failed plan', 'failed plans'),
    metrics: 'Headline metrics', freeLane: 'Free-lane hit rate', freeLaneSub: (n: number, total: number, tok: string) => `${n} / ${plural('round', 'rounds')(total)} done at $0 · ${tok} tok`,
    noFailures: 'No failures in this window', allPriced: 'every successful round priced',
    success: 'Success', recovered: 'Recovered', of: 'of', knownCost: 'Known cost', priceUnknown: 'price unknown',
    ttft: 'P50 TTFT', streamedOnly: 'streamed rounds only', p95: 'P95 latency', successful: 'successful rounds', successfulTitle: 'Successful rounds',
    activity: 'Activity', perBucket: (hours: number) => hours === 1 ? 'Rounds per hour' : `Rounds per ${hours} hours`,
    okSeries: 'successful', failedSeries: 'failed',
    newestFirst: 'Newest first', timeline: 'Routing timeline', planned: (tier: string, fallback: string) => `planned ${tier} failed · served by ${fallback}`,
    refusal: { unconfigured: 'key not set', credential: 'key rejected', 'not-entitled': 'not on plan', quota: 'quota spent', transient: 'provider error' },
    rule: 'rule', noRounds: 'No rounds in this window.',
    observed: 'Past results in this window, not live availability', health: 'Model health', noModels: 'No models observed in this window.',
    healthy: 'healthy', degraded: 'degraded', failing: 'failing',
    tierShare: 'Share of rounds by tier', intelligence: 'Intelligence used',
    economics: 'Economics', paidTokens: 'Paid tokens', priceUnknownRow: 'Price unknown', baseline: 'Strong baseline',
    avoided: 'Avoided', coverage: 'Pricing coverage', ofTokens: (pct: string) => `${pct} of tokens`,
    noBaseline: 'No strong-tier price configured, so there is no baseline to compare against.',
    zeroBaseline: (zero: string) => `The strong tier is priced at ${zero}, so there is no paid inference to avoid. Configure a priced baseline to measure savings.`,
    noPriced: 'No successful round has a known price yet, so savings cannot be estimated.',
    ruleSource: 'What drove each routing decision (hover for the rule)', why: 'Why Sabi chose each route',
    all: (shown: number, n: number) => shown === n ? `All ${plural('round', 'rounds')(n)}` : `Newest ${shown} of ${n} rounds`, recent: 'Recent rounds',
    cols: { time: 'Time', route: 'Route', tier: 'Tier', model: 'Model', rule: 'Rule', ttft: 'TTFT', latency: 'Latency', outcome: 'Outcome', cost: 'Cost', status: 'Status', success: 'Success', p50: 'P50', lastSeen: 'Last seen' },
    units: ['k', 'M', 'B', 'T'],
    reasons: {
      'alias': 'Client asked for this model', 'first-turn': 'First turn of a task', 'exploration': 'Exploring the codebase',
      'implementation': 'Implementation work', 'verification': 'Verification step', 'context-pressure': 'Context window nearly full',
      'failure': 'Previous attempt failed', 'stuck': 'Repeated failures', 'repeated-failure': 'Repeated failures',
      'transport': 'Provider error on the last round', 'transport-fallback': 'Planned provider failed, rerouted',
      'output-capacity': 'Needed a larger output limit', 'capacity-eligible': 'Host compute available',
      'capacity-unavailable': 'Host compute unavailable', 'fallback-capacity': 'Fell back to available capacity',
      'quota-exhausted': 'Quota exhausted', 'rate-limited': 'Rate limited', 'unclassified': 'No specific signal',
      'fallback': 'No specific signal', 'default': 'Default route',
    } as Record<string, string>,
  },
  'pt-BR': {
    title: 'Painel Sabi', proxy: 'Proxy local', langName: 'Português (BR)', overview: 'Visão geral',
    waiting: 'Nenhuma rodada nesta janela ainda.',
    headline: (success: string, free: string, recovered: number) =>
      `${success} com sucesso · ${free} dos tokens confirmados gratuitos · ${plural('rodada recuperada', 'rodadas recuperadas')(recovered)} por fallback`,
    scope: (n: number, hours: number) => `${plural('rodada', 'rodadas')(n)} ${hours > 48 ? `nos últimos ${hours / 24} dias` : `nas últimas ${hours} horas`}`,
    memoryOnly: 'Nenhum log de decisões encontrado: mostrando as rodadas em memória desde o início do proxy.',
    windowNav: 'Janela de tempo',
    rounds: plural('rodada', 'rodadas'), successfulRounds: plural('rodada com sucesso', 'rodadas com sucesso'),
    failedPlans: plural('plano com falha', 'planos com falha'),
    metrics: 'Métricas principais', freeLane: 'Acerto na faixa gratuita', freeLaneSub: (n: number, total: number, tok: string) => `${n} / ${plural('rodada', 'rodadas')(total)} concluídas a US$ 0 · ${tok} tok`,
    noFailures: 'Nenhuma falha nesta janela', allPriced: 'todas as rodadas com sucesso têm preço',
    success: 'Sucesso', recovered: 'Recuperadas', of: 'de', knownCost: 'Custo conhecido', priceUnknown: 'sem preço',
    ttft: 'TTFT P50', streamedOnly: 'só rodadas em streaming', p95: 'Latência P95', successful: 'rodadas com sucesso', successfulTitle: 'Rodadas com sucesso',
    activity: 'Atividade', perBucket: (hours: number) => hours === 1 ? 'Rodadas por hora' : `Rodadas a cada ${hours} horas`,
    okSeries: 'com sucesso', failedSeries: 'com falha',
    newestFirst: 'Mais recentes primeiro', timeline: 'Linha do tempo de roteamento', planned: (tier: string, fallback: string) => `${tier} planejado falhou · atendido por ${fallback}`,
    refusal: { unconfigured: 'chave não definida', credential: 'chave recusada', 'not-entitled': 'fora do plano', quota: 'cota esgotada', transient: 'erro do provedor' },
    rule: 'regra', noRounds: 'Nenhuma rodada nesta janela.',
    observed: 'Resultados passados nesta janela, não disponibilidade ao vivo', health: 'Saúde dos modelos', noModels: 'Nenhum modelo observado nesta janela.',
    healthy: 'saudável', degraded: 'degradado', failing: 'falhando',
    tierShare: 'Parcela das rodadas por tier', intelligence: 'Inteligência usada',
    economics: 'Custos', paidTokens: 'Tokens pagos', priceUnknownRow: 'Sem preço', baseline: 'Referência strong',
    avoided: 'Evitado', coverage: 'Cobertura de preço', ofTokens: (pct: string) => `${pct} dos tokens`,
    noBaseline: 'O tier strong não tem preço configurado, então não há referência para comparar.',
    zeroBaseline: (zero: string) => `O tier strong custa ${zero} na configuração, então não há inferência paga a evitar. Configure uma referência com preço para medir a economia.`,
    noPriced: 'Nenhuma rodada com sucesso tem preço conhecido ainda, então não dá para estimar a economia.',
    ruleSource: 'O que motivou cada decisão (passe o mouse para ver a regra)', why: 'Por que o Sabi escolheu cada rota',
    all: (shown: number, n: number) => shown === n ? `Todas as rodadas (${n})` : `${shown} mais recentes de ${n} rodadas`, recent: 'Rodadas recentes',
    cols: { time: 'Hora', route: 'Rota', tier: 'Tier', model: 'Modelo', rule: 'Regra', ttft: 'TTFT', latency: 'Latência', outcome: 'Resultado', cost: 'Custo', status: 'Status', success: 'Sucesso', p50: 'P50', lastSeen: 'Visto por último' },
    units: ['k', 'mi', 'bi', 'tri'],
    reasons: {
      'alias': 'Cliente pediu este modelo', 'first-turn': 'Primeiro turno da tarefa', 'exploration': 'Explorando o código',
      'implementation': 'Trabalho de implementação', 'verification': 'Etapa de verificação', 'context-pressure': 'Janela de contexto quase cheia',
      'failure': 'Tentativa anterior falhou', 'stuck': 'Falhas repetidas', 'repeated-failure': 'Falhas repetidas',
      'transport': 'Erro do provedor na rodada anterior', 'transport-fallback': 'Provedor falhou, rota trocada',
      'output-capacity': 'Precisou de limite de saída maior', 'capacity-eligible': 'Capacidade local disponível',
      'capacity-unavailable': 'Capacidade local indisponível', 'fallback-capacity': 'Recorreu à capacidade disponível',
      'quota-exhausted': 'Cota esgotada', 'rate-limited': 'Limite de requisições atingido', 'unclassified': 'Sem sinal específico',
      'fallback': 'Sem sinal específico', 'default': 'Rota padrão',
    } as Record<string, string>,
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
  const relative = new Intl.RelativeTimeFormat(lang, { numeric: 'auto', style: 'short' })
  const ago = (ms: number): string => {
    const s = Math.max(0, Math.round(ms / 1000))
    return s < 60 ? relative.format(-s, 'second') : s < 3600 ? relative.format(-Math.round(s / 60), 'minute')
      : s < 86_400 ? relative.format(-Math.round(s / 3600), 'hour') : relative.format(-Math.round(s / 86_400), 'day')
  }
  const dayTime = new Intl.DateTimeFormat(lang, { weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false })
  const time = new Intl.DateTimeFormat(lang, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })

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
  // A non-zero share never rounds to "0%": that would read as none.
  const pct = (part: number, total: number): string =>
    total === 0 ? '—' : part > 0 && part / total < 0.005 ? `<${percent.format(0.01)}` : percent.format(part / total)
  const ms = (n: number | undefined): string =>
    n === undefined ? '—' : n < 1000 ? `${whole.format(Math.round(n))} ms` : `${oneDecimal.format(n / 1000)} s`
  const clock = (ts: string): string => {
    const t = Date.parse(ts)
    return Number.isFinite(t) ? time.format(t) : '—'
  }
  return { copy, lang, ago, whole, tokens, tokensHtml, money, pct, ms, clock, dayTime: (t: number) => dayTime.format(t) }
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

// A fallback rewrites `tier`, so only the route receipt (spec 021) knows what was planned.
const plannedTier = (rec: DecisionRecord): string => rec.route?.requested.tier ?? rec.tier

/** Label for the planned upstream's refusal; a class this build does not know renders nothing. */
const refusalLabel = (f: Format, rec: DecisionRecord): string | undefined =>
  rec.upstreamRefusal ? (f.copy.refusal as Record<string, string>)[rec.upstreamRefusal.class] : undefined

function outcomeLabel(f: Format, rec: DecisionRecord): string {
  if (rec.outcome === 'ok') return '<span class="st good">✓ ok</span>'
  const detail = rec.transport ? `${rec.outcome} ${rec.transport}` : rec.outcome
  const refusal = refusalLabel(f, rec)
  return `<span class="st bad">✕ ${esc(detail)}${refusal ? ` · ${esc(refusal)}` : ''}</span>`
}

/** `planned → served (why)` for a round a fallback moved. */
function movedLabel(f: Format, rec: DecisionRecord): string {
  const refusal = refusalLabel(f, rec)
  return `${esc(plannedTier(rec))}${rec.fallback ? ` → ${esc(rec.fallback)}` : ''}${rec.fallback && refusal ? ` (${esc(refusal)})` : ''}`
}

function kpi(label: string, value: string, sub: string): string {
  return `<div class="kpi"><div class="eyebrow">${label}</div><div class="kpi-value">${value}</div><div class="muted">${sub}</div></div>`
}

function bars(f: Format, rows: Array<[string, number]>, total: number, name: (key: string) => string = (key) => key): string {
  if (rows.length === 0) return `<p class="empty">${f.copy.noRounds}</p>`
  return rows.map(([key, n]) => `
    <div class="bar-row">
      <span class="bar-label" title="${esc(key)}">${esc(name(key))}</span>
      <span class="bar-track"><span class="bar-fill" style="width:${((n / total) * 100).toFixed(1)}%"></span></span>
      <span class="bar-value">${f.pct(n, total)} <span class="muted">· ${f.whole.format(n)}</span></span>
    </div>`).join('')
}

function niceMax(n: number): number {
  if (n <= 0) return 1
  const pow = 10 ** Math.floor(Math.log10(n))
  return ([1, 2, 2.5, 5, 10].find((step) => step * pow >= n) ?? 10) * pow
}

/** Rounds per time bucket across the whole window, successful and failed stacked. */
function activity(f: Format, records: DecisionRecord[], hours: number, now: number): string {
  const { copy } = f
  const bucketHours = hours > 48 ? 4 : 1
  const count = Math.ceil(hours / bucketHours)
  const start = now - hours * 3_600_000
  const buckets = Array.from({ length: count }, () => ({ ok: 0, failed: 0 }))
  for (const rec of records) {
    // A round stamped exactly at `now` belongs to the last bucket, as it does in the headline.
    const i = Math.min(count - 1, Math.floor((Date.parse(rec.ts) - start) / (bucketHours * 3_600_000)))
    if (i >= 0) buckets[i][rec.outcome === 'ok' ? 'ok' : 'failed'] += 1
  }
  const [W, H, left, right, top, bottom] = [960, 190, 36, 8, 10, 164]
  const max = niceMax(Math.max(...buckets.map((b) => b.ok + b.failed)))
  const slot = (W - left - right) / count
  const barW = Math.max(2, slot - 2)
  const y = (v: number) => ((bottom - top) * v) / max
  const grid = [0, 0.5, 1].map((frac) => {
    const gy = bottom - y(max * frac)
    return `<line class="grid" x1="${left}" x2="${W - right}" y1="${gy}" y2="${gy}"/><text class="axis" x="${left - 8}" y="${gy + 4}" text-anchor="end">${f.whole.format(max * frac)}</text>`
  }).join('')
  const cols = buckets.map((b, i) => {
    const x = left + i * slot + 1
    const okH = y(b.ok)
    const failH = y(b.failed)
    const gap = b.ok && b.failed ? 2 : 0
    const label = `${f.dayTime(start + i * bucketHours * 3_600_000)} · ${b.ok} ${copy.okSeries} · ${b.failed} ${copy.failedSeries}`
    return `<g><title>${esc(label)}</title>
      <rect class="hit" x="${x - 1}" y="${top}" width="${slot}" height="${bottom - top}"/>
      ${b.ok ? `<rect class="ok" x="${x}" y="${(bottom - okH).toFixed(1)}" width="${barW}" height="${okH.toFixed(1)}" rx="1.5"/>` : ''}
      ${b.failed ? `<rect class="fail" x="${x}" y="${(bottom - okH - gap - failH).toFixed(1)}" width="${barW}" height="${failH.toFixed(1)}" rx="1.5"/>` : ''}
    </g>`
  }).join('')
  const ticks = [0, Math.floor(count / 2), count - 1].map((i, n) =>
    `<text class="axis" x="${left + i * slot + slot / 2}" y="${H - 6}" text-anchor="${['start', 'middle', 'end'][n]}">${esc(f.dayTime(start + i * bucketHours * 3_600_000))}</text>`).join('')
  return `
    <div class="legend"><span><i class="sw ok"></i>${copy.okSeries}</span><span><i class="sw fail"></i>${copy.failedSeries}</span></div>
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(copy.perBucket(bucketHours))}">${grid}${cols}${ticks}</svg>`
}

function timeline(f: Format, records: DecisionRecord[]): string {
  if (records.length === 0) return `<p class="empty">${f.copy.noRounds}</p>`
  return records.slice(-12).reverse().map((rec) => `
    <li>
      <div class="tl-head">
        <span class="tl-time">${esc(f.clock(rec.ts))}</span>
        <span class="badge">${esc(rec.tier)}</span>
        <span class="tl-model" title="${esc(modelOf(rec))}">${esc(modelOf(rec))}</span>
        ${outcomeLabel(f, rec)}
      </div>
      <div class="tl-sub muted">
        ${rec.fallback ? `<span class="recovered">↳ ${esc(f.copy.planned(plannedTier(rec), rec.fallback))}${refusalLabel(f, rec) ? ` (${esc(refusalLabel(f, rec)!)})` : ''}</span> · ` : ''}
        ${f.copy.rule} <b>${esc(rec.rule)}</b>${rec.usage ? ` · ${f.tokensHtml(rec.usage.totalTokens)} tok` : ''}${rec.latencyMs !== undefined ? ` · ${f.ms(rec.latencyMs)}` : ''}
      </div>
    </li>`).join('')
}

function health(f: Format, records: DecisionRecord[], now: number): string {
  const { copy } = f
  const models = new Map<string, DecisionRecord[]>()
  // The same model id can be served by more than one provider; each pairing is its own row.
  for (const rec of records) {
    const key = `${rec.upstream}\u0000${modelOf(rec)}`
    const list = models.get(key)
    if (list) list.push(rec)
    else models.set(key, [rec])
  }
  if (models.size === 0) return `<p class="empty">${copy.noModels}</p>`
  const rows = [...models.values()].sort((a, b) => b.length - a.length).map((recs) => {
    const model = modelOf(recs[0])
    const ok = recs.filter((rec) => rec.outcome === 'ok').length
    // ponytail: success-rate bands over this window only; the controller's live health is a separate process.
    const rate = ok / recs.length
    const status = rate >= 0.9 ? ['good', `● ${copy.healthy}`] : rate >= 0.5 ? ['warn', `! ${copy.degraded}`] : ['bad', `✕ ${copy.failing}`]
    const p50 = percentile(recs.flatMap((rec) => rec.latencyMs !== undefined && rec.outcome === 'ok' ? [rec.latencyMs] : []), 50)
    return `<tr>
      <td class="model" title="${esc(model)}">${esc(model)}<div class="via muted">${esc(recs[0].upstream)}</div></td>
      <td><span class="st ${status[0]}">${status[1]}</span></td>
      <td>${f.pct(ok, recs.length)} <span class="muted">${f.whole.format(ok)}/${f.whole.format(recs.length)}</span></td>
      <td>${f.ms(p50)}</td>
      <td class="muted">${esc(f.ago(now - Date.parse(recs[recs.length - 1].ts)))}</td>
    </tr>`
  }).join('')
  return `<div class="table"><table>
    <thead><tr><th>${copy.cols.model}</th><th>${copy.cols.status}</th><th>${copy.cols.success}</th><th>${copy.cols.p50}</th><th>${copy.cols.lastSeen}</th></tr></thead>
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
           <div class="econ-row"><span>${copy.avoided}</span><b${baseline >= coveredActual ? ' class="good"' : ''}>${f.money(baseline - coveredActual)} · ${f.pct(baseline - coveredActual, baseline)}</b></div>
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
  // ponytail: the window can hold thousands of rounds; the table shows the newest TABLE_LIMIT.
  const shown = records.slice(-TABLE_LIMIT).reverse()
  const rows = shown.map((rec) => `<tr>
    <td>${esc(f.clock(rec.ts))}</td>
    <td>${esc(rec.alias)}</td>
    <td>${movedLabel(f, rec)}</td>
    <td class="model" title="${esc(modelOf(rec))}">${esc(modelOf(rec))}</td>
    <td title="${esc(rec.reason)}">${esc(rec.rule)}</td>
    <td>${f.ms(rec.ttftMs)}</td>
    <td>${f.ms(rec.latencyMs)}</td>
    <td>${outcomeLabel(f, rec)}</td>
    <td>${isPriced(rec) ? f.money(rec.cost.total) : '—'}</td>
  </tr>`).join('')
  return `<details class="card"><summary><span class="eyebrow">${f.copy.all(shown.length, records.length)}</span><h2>${f.copy.recent}</h2></summary>
    <div class="table"><table>
      <thead><tr><th>${cols.time}</th><th>${cols.route}</th><th>${cols.tier}</th><th>${cols.model}</th><th>${cols.rule}</th><th>${cols.ttft}</th><th>${cols.latency}</th><th>${cols.outcome}</th><th>${cols.cost}</th></tr></thead>
      <tbody>${rows}</tbody></table></div></details>`
}

export function renderDashboard(all: DecisionRecord[], options: DashboardOptions = {}): string {
  const { baselineRates, lang = 'en', hours = 48, source = 'log', now = Date.now() } = options
  const f = formatters(lang)
  const { copy } = f
  const since = now - hours * 3_600_000
  const records = all.filter((rec) => {
    const t = Date.parse(rec.ts)
    return t >= since && t <= now
  })
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
  const windows = DASHBOARD_WINDOWS.map((h) =>
    `<a href="?hours=${h}&amp;lang=${lang}"${h === hours ? ' class="on" aria-current="page"' : ''}>${windowLabel(h)}</a>`).join('')

  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${copy.title}</title>
<style>
  /* SABI identity sheet v1.0: graphite and slate surfaces, one signal green, amber only for attention. */
  :root {
    color-scheme: dark;
    --bg: #0b0f0e; --card: #111827; --raised: #1f2937;
    --line: rgba(148, 163, 184, 0.17); --zebra: rgba(148, 163, 184, 0.05);
    --ink: #f8fafc; --muted: #94a3b8; --neutral: rgba(148, 163, 184, 0.5);
    --signal: #22c55e; --signal-soft: rgba(34, 197, 94, 0.14); --signal-border: rgba(34, 197, 94, 0.44);
    --amber: #f59e0b; --bad: #ef4444;
    --radius: 12px; --radius-sm: 8px;
    --mono: "Geist Mono", ui-monospace, "SF Mono", "Cascadia Code", Menlo, monospace;
    font-family: Inter, system-ui, -apple-system, "Segoe UI", sans-serif;
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--ink); font-size: 14px; line-height: 1.5; }
  a { color: inherit; }
  .bar { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 14px 32px; border-bottom: 1px solid var(--line); }
  .bar img { display: block; height: 32px; width: auto; }
  .bar-right { display: flex; align-items: center; gap: 12px; }
  .lang, .pills a { padding: 7px 12px; border-radius: var(--radius-sm); border: 1px solid var(--line); text-decoration: none; font-size: 13px; }
  .lang:hover, .lang:focus-visible, .pills a:hover, .pills a:focus-visible { border-color: var(--signal-border); }
  .pills { display: flex; gap: 6px; }
  .pills a { color: var(--muted); font-family: var(--mono); }
  .pills a.on { background: var(--signal-soft); border-color: var(--signal-border); color: var(--signal); }
  main { max-width: 1280px; margin: 0 auto; padding: 32px; display: grid; gap: 16px; }
  .head { display: flex; flex-wrap: wrap; align-items: end; justify-content: space-between; gap: 16px; }
  h1 { margin: 0; font-size: 26px; font-weight: 600; letter-spacing: -0.02em; }
  h2 { margin: 4px 0 16px; font-size: 18px; font-weight: 600; letter-spacing: -0.01em; }
  .muted { color: var(--muted); }
  .eyebrow { color: var(--muted); font-family: var(--mono); font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; }
  .card { background: var(--card); border: 1px solid var(--line); border-radius: var(--radius); padding: 24px; min-width: 0; }
  .kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); padding: 8px 0; }
  .kpi { padding: 14px 24px; border-left: 1px solid var(--line); min-width: 0; }
  .kpi:first-child { border-left: 0; }
  .kpi-value { margin: 8px 0 4px; font-size: 30px; font-weight: 600; letter-spacing: -0.03em; line-height: 1.1; }
  .badge { flex: none; padding: 1px 8px; border-radius: 999px; border: 1px solid var(--line); background: var(--raised); font-family: var(--mono); font-size: 11px; }
  .grid2 { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
  .st { white-space: nowrap; font-weight: 500; }
  .good { color: var(--signal); } .warn { color: var(--amber); } .bad { color: var(--bad); }
  .note-inline { color: var(--amber); }
  .legend { display: flex; gap: 16px; margin: -4px 0 8px; color: var(--muted); font-size: 13px; }
  .sw { display: inline-block; width: 10px; height: 10px; border-radius: 3px; margin-right: 6px; vertical-align: -1px; }
  .sw.ok, rect.ok { background: var(--signal); fill: var(--signal); }
  .sw.fail, rect.fail { background: var(--bad); fill: var(--bad); }
  rect.hit { fill: transparent; }
  g:hover rect.hit { fill: var(--zebra); }
  svg { display: block; width: 100%; height: auto; }
  .grid { stroke: var(--line); stroke-dasharray: 3 4; }
  .axis { fill: var(--muted); font-size: 11px; font-family: var(--mono); }
  .timeline { list-style: none; margin: 0; padding: 0; }
  .timeline li { padding: 12px 0; border-top: 1px solid var(--line); }
  .timeline li:first-child { border-top: 0; padding-top: 0; }
  .tl-head { display: flex; align-items: center; gap: 10px; min-width: 0; }
  .tl-time { font-family: var(--mono); font-size: 12px; color: var(--muted); }
  .tl-model { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .tl-sub { margin: 4px 0 0 76px; font-size: 13px; }
  .tl-sub b { font-weight: 500; color: var(--ink); font-family: var(--mono); font-size: 12px; }
  .recovered { color: var(--signal); }
  .bar-row { display: grid; grid-template-columns: minmax(80px, 260px) 1fr auto; align-items: center; gap: 12px; padding: 6px 0; }
  .bar-label { font-family: var(--mono); font-size: 12px; }
  .bar-label, .model { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .bar-track { height: 8px; border-radius: 999px; background: var(--raised); overflow: hidden; }
  .bar-fill { display: block; height: 100%; border-radius: 999px; background: var(--neutral); }
  .bar-value { font-variant-numeric: tabular-nums; min-width: 84px; text-align: right; }
  .econ-row { display: flex; justify-content: space-between; gap: 12px; padding: 10px 0; border-top: 1px solid var(--line); }
  .econ-row:first-of-type { border-top: 0; }
  .econ-row b { font-weight: 600; font-variant-numeric: tabular-nums; }
  .note { margin: 12px 0 0; padding: 12px 14px; border-radius: var(--radius-sm); background: var(--raised); color: var(--muted); }
  .table { border: 1px solid var(--line); border-radius: var(--radius-sm); overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; }
  th, td { padding: 11px 14px; text-align: left; white-space: nowrap; }
  th { font-family: var(--mono); font-size: 11px; font-weight: 500; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); border-bottom: 1px solid var(--line); }
  tbody tr:nth-child(even) { background: var(--zebra); }
  td { font-variant-numeric: tabular-nums; }
  .model { max-width: 200px; }
  .via { font-family: var(--mono); font-size: 11px; }
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
  <img src="${SABI_LOGO_DATA_URI}" alt="SABI" width="122" height="32">
  <span class="bar-right"><span class="muted">${copy.proxy}</span><a class="lang" href="?lang=${other}&amp;hours=${hours}" hreflang="${other}" lang="${other}">${COPY[other].langName}</a></span>
</header>
<main>
  <section class="head">
    <div>
      <h1>${copy.overview}</h1>
      <div class="muted">${esc(headline)}</div>
      <div class="muted">${copy.scope(records.length, hours)}${source === 'memory' ? ` · <span class="note-inline">${copy.memoryOnly}</span>` : ''}</div>
    </div>
    <nav class="pills" aria-label="${copy.windowNav}">${windows}</nav>
  </section>
  <section class="card kpis" aria-label="${copy.metrics}">
    ${kpi(copy.freeLane, f.pct(free.length, records.length), copy.freeLaneSub(free.length, records.length, f.tokensHtml(freeTokens)))}
    ${kpi(copy.success, f.pct(ok.length, records.length), `${f.whole.format(ok.length)} / ${copy.rounds(records.length)}`)}
    ${recovered + failed === 0 ? kpi(copy.recovered, '—', copy.noFailures) : kpi(copy.recovered, f.whole.format(recovered), `${copy.of} ${copy.failedPlans(recovered + failed)}`)}
    ${kpi(copy.knownCost, f.money(knownCost), withUsage.length === priced.length ? copy.allPriced : `${copy.successfulRounds(withUsage.length - priced.length)} ${copy.priceUnknown}`)}
    ${kpi(copy.ttft, f.ms(ttft), copy.streamedOnly)}
    ${kpi(copy.p95, f.ms(p95), copy.successful)}
  </section>
  <section class="card">
    <div class="eyebrow">${copy.perBucket(hours > 48 ? 4 : 1)}</div>
    <h2>${copy.activity}</h2>
    ${activity(f, records, hours, now)}
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
      ${health(f, records, now)}
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
    ${bars(f, countBy(records, (rec) => rec.rule), records.length, (rule) => copy.reasons[rule] ?? rule)}
  </section>
  ${roundsTable(f, records)}
</main>
</body>
</html>`
}
