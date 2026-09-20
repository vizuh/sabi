import { createHash } from 'node:crypto'
import { keyReferenceName, loadConfiguredSecrets, resolveKey } from './config.ts'
import type { ModelModality, SabiConfig } from './types.ts'

const MODALITIES = new Set<ModelModality>(['text', 'image', 'audio', 'video', 'file'])

export interface OpenRouterCatalogModel {
  id?: unknown
  context_length?: unknown
  pricing?: { prompt?: unknown; completion?: unknown }
  architecture?: { input_modalities?: unknown; output_modalities?: unknown }
  supported_parameters?: unknown
  top_provider?: { context_length?: unknown; max_completion_tokens?: unknown }
}

export interface FreeQualityCandidate {
  id: string
  contextWindow: number
  maxOutputTokens?: number
  inputModalities: ModelModality[]
  supportedParameters: string[]
  score: number
  supportsStructuredOutput: boolean
}

export interface OpenRouterCatalog {
  url: string
  observedAt: string
  sha256: string
  models: OpenRouterCatalogModel[]
}

export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
    ? value
    : typeof value === 'string' && /^\d+$/.test(value) && Number(value) > 0 && Number.isSafeInteger(Number(value))
      ? Number(value)
      : undefined
}

function zeroPrice(value: unknown): boolean {
  if (typeof value === 'number') return Number.isFinite(value) && value === 0
  if (typeof value !== 'string' || !value.trim()) return false
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed === 0
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim() !== '') : []
}

function modalities(value: unknown): ModelModality[] {
  return strings(value).filter((item): item is ModelModality => MODALITIES.has(item as ModelModality))
}

function catalogModelId(model: OpenRouterCatalogModel): string | undefined {
  return typeof model.id === 'string' && model.id.trim() ? model.id.trim() : undefined
}

/**
 * Free means the catalog reports exact zero prompt and completion prices. The `:free` suffix is
 * useful evidence but is not the gate: catalog pricing is the source of truth for this refresh.
 */
export function isExplicitlyFree(model: OpenRouterCatalogModel): boolean {
  return zeroPrice(model.pricing?.prompt) && zeroPrice(model.pricing?.completion)
}

/** Select only models that can plausibly serve a tool-using quality round. */
export function freeQualityCandidates(models: OpenRouterCatalogModel[]): FreeQualityCandidate[] {
  const candidates: FreeQualityCandidate[] = []
  for (const model of models) {
    const id = catalogModelId(model)
    const inputModalities = modalities(model.architecture?.input_modalities)
    const outputModalities = modalities(model.architecture?.output_modalities)
    const supportedParameters = [...new Set(strings(model.supported_parameters))]
    const supported = new Set(supportedParameters)
    const contextWindow = positiveInteger(model.top_provider?.context_length) ?? positiveInteger(model.context_length)
    const maxOutputTokens = positiveInteger(model.top_provider?.max_completion_tokens)
    if (!id || !isExplicitlyFree(model) || !inputModalities.includes('text') || !outputModalities.includes('text')) continue
    if (!supported.has('tools') || (!supported.has('max_tokens') && !supported.has('max_completion_tokens'))) continue
    if (!contextWindow) continue

    let score = 5 // tool calls are the non-negotiable quality-lane capability
    const supportsStructuredOutput = supported.has('structured_outputs')
    if (supportsStructuredOutput || supported.has('response_format')) score += 3
    if (supported.has('reasoning_effort') || supported.has('reasoning')) score += 2
    if (contextWindow >= 131_072) score += 2
    if (inputModalities.includes('image')) score += 1
    if (maxOutputTokens && maxOutputTokens >= 16_384) score += 1
    candidates.push({ id, contextWindow, maxOutputTokens, inputModalities, supportedParameters, score, supportsStructuredOutput })
  }
  return candidates.sort((a, b) =>
    b.score - a.score ||
    b.contextWindow - a.contextWindow ||
    (b.maxOutputTokens ?? 0) - (a.maxOutputTokens ?? 0) ||
    a.id.localeCompare(b.id),
  )
}

export function selectFreeQualityModel(models: OpenRouterCatalogModel[]): FreeQualityCandidate | undefined {
  return freeQualityCandidates(models)[0]
}

export function catalogSha256(payload: unknown): string {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex')
}

function modelsFromPayload(payload: unknown): OpenRouterCatalogModel[] {
  const body = record(payload)
  if (!Array.isArray(body?.data)) throw new Error('OpenRouter /models returned no data array')
  return body.data.filter((item): item is OpenRouterCatalogModel => record(item) !== undefined)
}

function modelsURL(baseURL: string): string {
  return `${baseURL.replace(/\/+$/, '')}/models`
}

export async function fetchOpenRouterCatalog(
  config: SabiConfig,
  fetchImpl: FetchLike = fetch,
  now = new Date(),
): Promise<OpenRouterCatalog> {
  const upstream = config.upstreams.openrouter
  if (!upstream || upstream.enabled === false) throw new Error("OpenRouter upstream is not enabled")
  loadConfiguredSecrets(config)
  const key = resolveKey(upstream.apiKey)
  if (!key) {
    const name = keyReferenceName(upstream.apiKey) ?? 'OPENROUTER_API_KEY'
    throw new Error(`OpenRouter credential ${name} is not configured; set it before --free-quality`)
  }
  const url = modelsURL(upstream.baseURL)
  let response: Response
  try {
    response = await fetchImpl(url, {
      headers: { ...upstream.headers, Accept: 'application/json', Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(20_000),
    })
  } catch (error) {
    throw new Error(`OpenRouter catalog request failed: ${(error as Error).message}`)
  }
  if (!response.ok) throw new Error(`OpenRouter catalog request failed: HTTP ${response.status}`)
  const payload = await response.json() as unknown
  return {
    url,
    observedAt: now.toISOString(),
    sha256: catalogSha256(payload),
    models: modelsFromPayload(payload),
  }
}

export function applyFreeQualityConfig(
  raw: Record<string, unknown>,
  candidate: FreeQualityCandidate,
  catalog: Pick<OpenRouterCatalog, 'url' | 'observedAt' | 'sha256'>,
): Record<string, unknown> {
  const models = record(raw.models) ?? {}
  const aliases = record(raw.aliases) ?? {}
  const policy = record(raw.policy) ?? {}
  const capabilities: Record<string, unknown> = {
    tools: true,
    inputModalities: candidate.inputModalities,
    outputModalities: ['text'],
    supportedParameters: candidate.supportedParameters,
  }
  if (candidate.supportsStructuredOutput) capabilities.structuredOutput = ['json_schema']
  const quality: Record<string, unknown> = {
    upstream: 'openrouter',
    model: candidate.id,
    contextWindow: candidate.contextWindow,
    capabilities,
    cost: { input: 0, output: 0 },
  }
  if (candidate.maxOutputTokens) quality.maxOutputTokens = candidate.maxOutputTokens
  const previous = typeof raw.provenance === 'string' && raw.provenance.trim() ? `${raw.provenance.trim()} ` : ''
  const provenance = `${previous}OpenRouter free-quality catalog observed ${catalog.observedAt}; endpoint ${catalog.url}; catalog sha256 ${catalog.sha256}; selected ${candidate.id}.`
  return {
    ...raw,
    provenance,
    models: { ...models, quality },
    aliases: { ...aliases, 'sabi-quality': 'quality' },
    policy: { ...policy, verification: 'quality' },
  }
}
