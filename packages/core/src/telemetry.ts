import type { EvidenceCode, TelemetryConfig } from './types.ts'

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
 */
export function sanitizeError(error: string): string {
  return String(error ?? '')
    .split('\n')[0]
    ?.slice(0, 200)
    .replace(/\b(bearer|authorization|api[-_]?key|token)\b[=:\s][^\s]+/gi, '$1=REDACTED') ?? 'unknown error'
}

/** Best-effort canary: secret-like markers must never reach persisted decision bodies. */
const CANARY_PATTERNS = [
  /\b(BEGIN|END)\s+(RSA|OPENSSH|EC|DSA)\s+PRIVATE\s+KEY/i,
  /\bsk-[A-Za-z0-9_-]{16,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bAIza[0-9A-Za-z_-]{30,}\b/,
]

export function looksLikeCanary(text: string): boolean {
  return CANARY_PATTERNS.some((re) => re.test(text))
}