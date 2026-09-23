import type { ChatRequestBody, EffortSource, EvidenceCode, TelemetryConfig } from './types.ts'

/**
 * Telemetry policy for decision records. By default reasons and evidence carry only
 * allowlisted codes, never raw tool output. Snippets are an explicit opt-in.
 */

const ALLOWLIST: ReadonlySet<string> = new Set<EvidenceCode>([
  'error-line',
  'python-traceback',
  'panic',
  'exception',
  'typescript-error',
  'fail-marker',
  'command-failed',
  'nonzero-exit',
  'failure-count',
  'command-not-found',
  'permission-denied',
  'missing-file',
  'soft-warning',
  'soft-deprecated',
  'soft-retrying',
  'soft-timeout',
  'tool-error',
  'permission-denial',
  'rate-limited',
  'quota-exceeded',
  'timeout',
  'mutation',
  'verification-receipt',
  'summary-claim',
  'scope-observed',
  'constraint',
  'prior-failure',
  'context-boundary',
  'observation',
])

/** Codes can be full exact labels or a string in `code: detail` form; only the code is kept. */
export function allowlisted(value: string): boolean {
  const code = value.split(':')[0]?.trim()
  return ALLOWLIST.has(code)
}

export interface TelemetryPolicy {
  allowlisted(value: string): boolean
  /** Truncate evidence/reason to the configured snippet budget, if capture is enabled. */
  snippet(value: string): string
  captureSnippets: boolean
}

export function telemetryPolicy(config?: TelemetryConfig | undefined): TelemetryPolicy {
  const captureSnippets = config?.captureSnippets === true
  const captureChars = config?.captureChars ?? 800
  return {
    captureSnippets,
    allowlisted: (value) => allowlisted(value),
    snippet: (value) => (captureSnippets ? String(value).slice(0, captureChars) : ''),
  }
}

/**
 * Keep a decision reason content-free: if capture is enabled, retain the reason; otherwise
 * either keep the allowlist-only reason or strip it when it embeds raw text.
 *
 * Reasons come from `policy.ts` and follow either `code` or `fixed phrase: code` shapes.
 * We accept a split on `:` (there is no embedded colons in evidence codes), then require
 * the *last* segment to be an allowlisted code — that is the routing evidence, not content.
 */
export function sanitizeReason(reason: string, policy: TelemetryPolicy): string {
  if (!policy.captureSnippets) {
    if (!reason || allowlisted(reason)) return reason
    const segments = reason.split(':').map((segment) => segment.trim())
    const last = segments[segments.length - 1] ?? ''
    if (allowlisted(last)) return reason
    return 'reason withheld (telemetry.allowlistOnly)'
  }
  return policy.snippet(reason)
}

/**
 * Sanitize an upstream/provider error string before it lands in a decision record. Keeps an
 * error kind and a redacted status, never the raw provider body.
 *
 * Two layers: a quote-tolerant keyword redaction (`"api_key": "sk-…"`, `token ghp_…`) and a
 * bare-token redaction for known secret shapes (`sk-…`, `AKIA…`, `ghp_…`, credential URLs).
 * Anything still matching `looksLikeCanary` afterwards (e.g. a private-key block) is dropped
 * to a generic placeholder — a persisted error must never carry a secret.
 */
const KEYWORD_REDACT = /\b(bearer|authorization|api[-_]?\s*key|token|secret|password|passwd)\b["']?\s*[:=\s]\s*["']?[^\s"'{},\]]+/gi
const BARE_TOKEN_REDACT: Array<[RegExp, string]> = [
  [/\bsk-[A-Za-z0-9_-]{8,}\b/g, 'sk-[REDACTED]'],
  [/\bAKIA[0-9A-Z]{16}\b/g, 'AKIA[REDACTED]'],
  [/\bAIza[0-9A-Za-z_-]{30,}\b/g, 'AIza[REDACTED]'],
  [/\bghp_[A-Za-z0-9]{8,}\b/g, 'ghp_[REDACTED]'],
  [/\bghu_[A-Za-z0-9]{8,}\b/g, 'ghu_[REDACTED]'],
  [/\bghs_[A-Za-z0-9]{8,}\b/g, 'ghs_[REDACTED]'],
  [/\bgithub_pat_[A-Za-z0-9_]{8,}\b/g, 'github_pat_[REDACTED]'],
]
const CREDENTIAL_URL_REDACT = /([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)[^:@\s/]+:[^@\s/]+@/g

export function sanitizeError(error: string): string {
  const first = String(error ?? '').split('\n')[0]?.slice(0, 200) ?? ''
  if (!first.trim()) return 'unknown error'
  let redacted = first.replace(KEYWORD_REDACT, '$1=REDACTED')
  for (const [pattern, replacement] of BARE_TOKEN_REDACT) redacted = redacted.replace(pattern, replacement)
  redacted = redacted.replace(CREDENTIAL_URL_REDACT, '$1REDACTED@')
  if (looksLikeCanary(redacted)) return 'upstream error redacted (possible secret)'
  return redacted || 'unknown error'
}

/** Best-effort canary: secret-like markers must never reach persisted decision bodies. */
const CANARY_PATTERNS = [
  /\b(BEGIN|END)\s+(RSA|OPENSSH|EC|DSA)\s+PRIVATE\s+KEY/i,
  /\bsk-[A-Za-z0-9_-]{8,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bAIza[0-9A-Za-z_-]{30,}\b/,
  /\bghp_[A-Za-z0-9]{8,}\b/,
  /\bghu_[A-Za-z0-9]{8,}\b/,
  /\bghs_[A-Za-z0-9]{8,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{8,}\b/,
  /[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^:@\s/]+:[^@\s/]+@/,
  /(?:password|passwd|pwd|secret)\s*[:=]\s*\S+/i,
]

export function looksLikeCanary(text: string): boolean {
  return CANARY_PATTERNS.some((re) => re.test(text))
}

export interface EffortObservation {
  value?: string
  source: EffortSource
}

/**
 * Record-only observation of the reasoning effort a round requested. Mirrors the
 * compatibility gate's single-form rule (`reasoning_effort` xor `reasoning.effort`):
 * exactly one nonempty effort string observes as `client`; anything else — absent,
 * conflicting, or malformed — observes as `unspecified`. This never routes, injects,
 * or rewrites anything; it only gives per-route telemetry the evidence a future
 * effort-scheduling slice needs first.
 */
export function observeEffort(body: ChatRequestBody): EffortObservation {
  const flat = typeof body.reasoning_effort === 'string' && body.reasoning_effort.trim()
    ? body.reasoning_effort.trim()
    : undefined
  const reasoning = body.reasoning !== null && typeof body.reasoning === 'object' && !Array.isArray(body.reasoning)
    ? body.reasoning as Record<string, unknown>
    : undefined
  const nested = typeof reasoning?.effort === 'string' && reasoning.effort.trim()
    ? reasoning.effort.trim()
    : undefined
  if (flat !== undefined && nested !== undefined) return { source: 'unspecified' }
  if (flat !== undefined) return { value: flat, source: 'client' }
  if (nested !== undefined) return { value: nested, source: 'client' }
  return { source: 'unspecified' }
}
