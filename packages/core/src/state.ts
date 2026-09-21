import type { ChatMessage, ChatRequestBody, EvidenceCode, FailureLevel, ModelModality, RoundKind, TrajectoryState } from './types.ts'
import { decorateTrajectoryState } from './evidence.ts'

// Exact built-in names only: never strip MCP/server prefixes to guess a capability.
const EXPLORE_TOOLS = new Set([
  'read', // OpenCode/Kilo
  'webfetch',
  'websearch',
  'read_file',
  'read_directory',
  'glob',
  'grep',
  'web_search',
  'web_fetch',
  'shell_output',
  'shell_tasks',
  'get_diagnostics',
  'todo_write',
  'task_create',
  'task_update',
  'task_list',
  'task_get',
  'task_output',
  'task_stop',
  'sleep',
  'cron_create',
  'cron_list',
  'cron_delete',
  'schedule_wakeup',
  'activate_skill',
])

const EDIT_TOOLS = new Set(['edit_file', 'write_file', 'edit', 'write', 'apply_patch'])

const SHELL_TOOLS = new Set(['shell_command', 'bash'])

const VERIFY_COMMAND = /\b(test|tests|vitest|jest|pytest|build|tsc|typecheck|type-check|lint|eslint|check)\b/i

const EXPLORE_COMMAND = /(^|\s)(ls|cat|head|tail|find|rg|grep|wc|pwd)\b|\bgit\s+(status|diff|log|show|branch)\b/i

const KIND_RANK: Record<RoundKind, number> = {
  unclassified: 0,
  exploration: 1,
  implementation: 2,
  verification: 3,
  'first-turn': 4,
}

const HARD_PATTERNS: Array<{ re: RegExp; label: EvidenceCode; numeric?: boolean }> = [
  { re: /^\s*(?:Error|ERROR|error):/m, label: 'error-line' },
  { re: /Traceback \(most recent call last\)/, label: 'python-traceback' },
  { re: /\bpanic:/, label: 'panic' },
  {
    re: /AssertionError|TypeError|ReferenceError|SyntaxError|ImportError|ModuleNotFoundError|Cannot find module/,
    label: 'exception',
  },
  { re: /\berror TS\d+/, label: 'typescript-error' },
  { re: /\b(?:FAIL|FAILED|FAILURES|Failing)\b/, label: 'fail-marker' },
  { re: /\bcommand failed\b/i, label: 'command-failed' },
  { re: /exit (?:code|status)[:=\s]+([1-9]\d*)/i, label: 'nonzero-exit' },
  { re: /(\d+)\s+fail(?:ed|ing|ures)/i, label: 'failure-count', numeric: true },
  { re: /command not found/i, label: 'command-not-found' },
  { re: /permission denied/i, label: 'permission-denied' },
  { re: /no such file or directory/i, label: 'missing-file' },
]

const SOFT_PATTERNS: Array<{ re: RegExp; label: EvidenceCode }> = [
  { re: /warning/i, label: 'soft-warning' },
  { re: /deprecated/i, label: 'soft-deprecated' },
  { re: /retrying/i, label: 'soft-retrying' },
  { re: /timed out/i, label: 'soft-timeout' },
]

/**
 * Named transport conditions: a text that states a provider or subscription limit is describing
 * the provider or the plan, not the task — so it is checked BEFORE the hard patterns, even when
 * the same line also looks like an error ("Error: You've hit your session limit"). A plan wall is
 * not a reasoning failure: escalating to a stronger tier hits the same wall and spends more for it,
 * and a round whose only evidence is a limit must never reach the judge as "unclassified".
 *
 * Wording is what makes a signal strong. Status codes stay in TRANSPORT_PATTERNS below: a failing
 * test that happens to print "429", or a test that timed out, is a genuine task failure, so those
 * never outrank a hard pattern in the same text.
 */
const TRANSPORT_LIMIT_PATTERNS: Array<{ re: RegExp; label: EvidenceCode }> = [
  { re: /rate[-_ ]?limit/i, label: 'rate-limited' },
  { re: /too many requests/i, label: 'rate-limited' },
  { re: /\b(?:session|usage|weekly|monthly|daily|hourly|subscription|plan)\s+limit\b/i, label: 'quota-exceeded' },
  { re: /quota[- ]?exceeded/i, label: 'quota-exceeded' },
  { re: /insufficient_quota|insufficient quota/i, label: 'quota-exceeded' },
]

/**
 * Numeric/status transport signals. Ambiguous on their own — the same tokens appear as data in
 * test output — so for a given text the hard patterns are checked first.
 */
const TRANSPORT_PATTERNS: Array<{ re: RegExp; label: EvidenceCode }> = [
  { re: /\b429\b/, label: 'rate-limited' },
  { re: /timed out|timeout/i, label: 'timeout' },
]

const HARNESS_DENIAL =
  /\buser\b[^\n]{0,40}\b(?:denied|declined|rejected)\b|denied by (?:the )?user|\b(?:permission|tool call|request)[^\n]{0,30}\b(?:denied|declined|rejected)\b/i

export function textOf(content: unknown): string {
  if (content === null || content === undefined) return ''
  if (typeof content === 'string') return content
  if (typeof content === 'number' || typeof content === 'boolean') return String(content)
  if (Array.isArray(content)) return content.map((part) => textOf(part)).join('\n')
  if (typeof content === 'object') {
    const obj = content as Record<string, unknown>
    if (typeof obj.text === 'string') return obj.text
    if (obj.content !== undefined) return textOf(obj.content)
    if (typeof obj.output === 'string') return obj.output
  }
  return ''
}

export const CHARS_PER_TOKEN = 3.6

/**
 * The harness charges a flat bound per image instead of a byte count (its own estimator uses
 * 1500), because providers tokenize a decoded image by resolution, not by base64 length. Sabi
 * mirrors that number so its estimate stays comparable with the host's.
 */
export const MEDIA_TOKENS_PER_IMAGE = 1500

type MediaKind = Exclude<ModelModality, 'text'>

const MEDIA_PART_TYPES: Record<string, MediaKind> = {
  image: 'image',
  image_url: 'image',
  input_image: 'image',
  input_audio: 'audio',
  audio_url: 'audio',
  video_url: 'video',
  file: 'file',
}

export interface MediaTally {
  counts: Partial<Record<MediaKind, number>>
  /** Serialized size of non-image payloads, the upper-bound proxy for their tokens. */
  payloadChars: number
}

function payloadCharsOf(part: Record<string, unknown>): number {
  try {
    return JSON.stringify(part).length
  } catch {
    return 0
  }
}

/**
 * Collects media content parts. Parts are read where they actually appear: an OpenAI-shaped
 * content array, and the nested `content` of a tool_result-style block, where a tool can return a
 * screenshot. Images are charged the host's per-image bound; other media by payload size, which is
 * an upper bound rather than a tokenizer (a remote URL is charged only its URL length).
 */
export function tallyMedia(content: unknown, tally: MediaTally, depth = 0): void {
  if (depth > 3 || !Array.isArray(content)) return
  for (const part of content) {
    if (!part || typeof part !== 'object') continue
    const record = part as Record<string, unknown>
    const kind = typeof record.type === 'string' ? MEDIA_PART_TYPES[record.type] : undefined
    if (kind) {
      tally.counts[kind] = (tally.counts[kind] ?? 0) + 1
      if (kind !== 'image') tally.payloadChars += payloadCharsOf(record)
      continue
    }
    if (record.content !== undefined) tallyMedia(record.content, tally, depth + 1)
  }
}

export function mediaTokens(tally: MediaTally): number {
  const images = tally.counts.image ?? 0
  return images * MEDIA_TOKENS_PER_IMAGE + Math.ceil(tally.payloadChars / CHARS_PER_TOKEN)
}

export function modalitiesOf(counts: Partial<Record<MediaKind, number>>): ModelModality[] {
  const kinds = (Object.keys(counts) as MediaKind[]).filter((kind) => (counts[kind] ?? 0) > 0).sort()
  return ['text', ...kinds]
}

function isHarnessDenial(text: string): boolean {
  return HARNESS_DENIAL.test(text)
}

export function detectFailure(texts: string[]): { level: FailureLevel; evidence: string[] } {
  const evidence: string[] = []
  let hard = 0
  let soft = 0
  let transport = 0
  const note = (label: string): void => {
    if (evidence.length < 4) evidence.push(label)
  }
  for (const raw of texts) {
    const text = String(raw ?? '')
    if (!text.trim()) continue
    if (isHarnessDenial(text)) {
      note('permission-denial')
      continue
    }
    // A named limit (rate limit, session/usage/quota limit) is a provider or plan condition, not
    // task evidence — it outranks an error-looking line in the same text.
    const namedLimit = TRANSPORT_LIMIT_PATTERNS.find((pattern) => pattern.re.test(text))
    if (namedLimit) {
      transport += 1
      note(namedLimit.label)
      continue
    }
    let textHard = false
    for (const pattern of HARD_PATTERNS) {
      const match = text.match(pattern.re)
      if (!match) continue
      if (pattern.numeric) {
        const count = Number((match[1] ?? '').replace(/\D/g, ''))
        if (!(count > 0)) continue
      }
      hard += 1
      textHard = true
      note(pattern.label)
      break
    }
    if (textHard) continue
    // Numeric transport signals (429, timeout) rank above soft patterns but never outrank a hard
    // failure in the same text: a test that prints a 429 or times out is still a failing test.
    const statusSignal = TRANSPORT_PATTERNS.find((pattern) => pattern.re.test(text))
    if (statusSignal) {
      transport += 1
      note(statusSignal.label)
      continue
    }
    for (const pattern of SOFT_PATTERNS) {
      if (pattern.re.test(text)) {
        soft += 1
        note(pattern.label)
        break
      }
    }
  }
  const level: FailureLevel =
    hard >= 1 ? 'hard' : transport >= 1 ? 'transport' : soft >= 2 ? 'soft' : 'none'
  return { level, evidence }
}

/**
 * RTK (github.com/rtk-ai/rtk) rewrites shell commands to `rtk [<wrapper>] <command>` before the
 * harness runs them, so the command string Sabi classifies is the wrapper's, not the command's.
 * Classify what the command does: `rtk cargo test` is still verification, `rtk read` is still a read.
 * Without this, RTK-rewritten rounds fall to `unclassified`, which the proxy consults the judge on.
 */
const RTK_WRAPPERS = new Set(['err', 'test', 'proxy', 'summary'])
const RTK_READ_VERBS = new Set(['read', 'smart', 'json', 'env', 'log', 'deps', 'session', 'gain', 'discover', 'recall'])

export function unwrapRtk(command: string): string {
  const parts = command.trim().split(/\s+/)
  if ((parts[0] ?? '').toLowerCase() !== 'rtk') return command.trim()
  const rest = parts.slice(1)
  // A wrapper verb takes the real command as its argument; with none, `rtk <verb>` is the command.
  if (rest.length > 1 && RTK_WRAPPERS.has((rest[0] ?? '').toLowerCase())) rest.shift()
  return rest.join(' ')
}

function shellKind(command: string | undefined): RoundKind {
  if (!command) return 'unclassified'
  const wrapped = command.trim().toLowerCase().startsWith('rtk ')
  const unwrapped = unwrapRtk(command)
  const verb = (unwrapped.split(/\s+/)[0] ?? '').toLowerCase()
  if (wrapped && RTK_READ_VERBS.has(verb)) return 'exploration'
  if (VERIFY_COMMAND.test(unwrapped)) return 'verification'
  if (EXPLORE_COMMAND.test(unwrapped)) return 'exploration'
  return 'unclassified'
}

function callKind(name: string, args: string | undefined): RoundKind {
  if (EDIT_TOOLS.has(name)) return 'implementation'
  if (EXPLORE_TOOLS.has(name)) return 'exploration'
  if (SHELL_TOOLS.has(name)) {
    let command: string | undefined
    if (args) {
      try {
        const parsed = JSON.parse(args) as { command?: unknown }
        if (typeof parsed.command === 'string') command = parsed.command
      } catch {
        command = undefined
      }
    }
    return shellKind(command)
  }
  return 'unclassified'
}

export function classifyRound(calls: Array<{ name: string; args?: string }>): RoundKind {
  if (!calls.length) return 'unclassified'
  let best: RoundKind = 'unclassified'
  for (const call of calls) {
    const kind = callKind(call.name, call.args)
    // A known read mixed with an unknown action is not evidence of a read-only round.
    if (kind === 'unclassified') return 'unclassified'
    if (KIND_RANK[kind] > KIND_RANK[best]) best = kind
  }
  return best
}

export function lastToolCalls(messages: ChatMessage[]): Array<{ name: string; args?: string }> {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    if (!message || message.role !== 'assistant') continue
    const calls = Array.isArray(message.tool_calls) ? message.tool_calls : []
    return calls
      .map((call) => ({
        name: String(call?.function?.name ?? ''),
        args: typeof call?.function?.arguments === 'string' ? call.function.arguments : undefined,
      }))
      .filter((call) => call.name.length > 0)
  }
  return []
}

export function trailingToolTexts(messages: ChatMessage[], limit = 4, maxChars = 4000): string[] {
  const texts: string[] = []
  for (let i = messages.length - 1; i >= 0 && texts.length < limit; i--) {
    const message = messages[i]
    if (!message || message.role !== 'tool') break
    texts.push(textOf(message.content).slice(0, maxChars))
  }
  return texts
}

/** What a transcript actually carries, counted once for the proxy, the mod and the offline replay. */
export interface TranscriptStats {
  messageCount: number
  assistantTurns: number
  toolMessages: number
  contextChars: number
  media: MediaTally
}

export function transcriptStats(messages: readonly unknown[] | undefined): TranscriptStats {
  let assistantTurns = 0
  let toolMessages = 0
  let contextChars = 0
  const media: MediaTally = { counts: {}, payloadChars: 0 }
  const list = messages ?? []
  for (const raw of list) {
    const message = raw as ChatMessage | null | undefined
    const role = String(message?.role ?? '')
    if (role === 'assistant') assistantTurns += 1
    if (role === 'tool') toolMessages += 1
    contextChars += textOf(message?.content).length
    if (message?.tool_calls) contextChars += JSON.stringify(message.tool_calls).length
    tallyMedia(message?.content, media)
  }
  return { messageCount: list.length, assistantTurns, toolMessages, contextChars, media }
}

export function extractTrajectoryState(body: ChatRequestBody): TrajectoryState {
  const messages: ChatMessage[] = Array.isArray(body.messages) ? body.messages : []
  const stats = transcriptStats(messages)
  const lastRole = stats.messageCount > 0 ? String(messages[stats.messageCount - 1]?.role ?? '') : ''
  const toolNames = Array.isArray(body.tools)
    ? body.tools.map((tool) => String(tool?.function?.name ?? '')).filter((name) => name.length > 0)
    : []
  const calls = lastToolCalls(messages)
  let roundKind: RoundKind
  if (lastRole === 'user' || stats.assistantTurns === 0) roundKind = 'first-turn'
  else if (lastRole === 'tool') roundKind = classifyRound(calls)
  else roundKind = 'unclassified'
  const failure = detectFailure(trailingToolTexts(messages))
  const hasMedia = Object.keys(stats.media.counts).length > 0
  // Tool schemas are part of what the provider charges for; the system prompt arrives as a
  // message and was counted with the transcript. Both belong in the estimate — never in
  // `contextTokens`, which only billed usage may fill.
  const contextChars = stats.contextChars + (Array.isArray(body.tools) ? JSON.stringify(body.tools).length : 0)
  const state: TrajectoryState = {
    messageCount: stats.messageCount,
    assistantTurns: stats.assistantTurns,
    toolMessages: stats.toolMessages,
    lastRole,
    contextChars,
    // Media is not text, so it adds no chars — but it is context. Charging it here is what keeps
    // the context-pressure rule and the decision log from treating a screenshot round as tiny.
    estimatedTokens: Math.ceil(contextChars / CHARS_PER_TOKEN) + mediaTokens(stats.media),
    // A character estimate is not a measured size. `applyMeasuredContext` promotes it only when
    // the provider billed a previous round of the same session.
    contextTokens: undefined,
    contextKnown: false,
    hasTools: toolNames.length > 0,
    toolNames,
    lastToolNames: calls.map((call) => call.name),
    roundKind,
    failure: failure.level,
    failureEvidence: failure.evidence,
    repeatedFailure: false,
    failureStreak: 0,
    inputModalities: modalitiesOf(stats.media.counts),
    ...(hasMedia ? { mediaCounts: stats.media.counts } : {}),
  }
  const scope = body.scope ?? (body.requestedScope || body.observedScope
    ? { expected: body.requestedScope, observed: body.observedScope }
    : undefined)
  const contextGeneration = typeof body.contextGeneration === 'number' && Number.isSafeInteger(body.contextGeneration) && body.contextGeneration >= 0
    ? body.contextGeneration
    : undefined
  if (contextGeneration !== undefined) state.contextGeneration = contextGeneration
  return decorateTrajectoryState(state, {
    generation: contextGeneration,
    summaryClaim: body.summaryClaim === true,
    verificationReceipt: body.verificationReceipt,
    scope,
  })
}

export interface MeasuredUsage {
  promptTokens?: number
  completionTokens?: number
  totalTokens?: number
}

/**
 * The context size the provider actually charged for the round that just finished. The next
 * request repeats that prompt and adds to it, so a billed total is a measured floor — the
 * character estimate stays a fallback, not the source of truth. Unknown stays unknown.
 */
export function measuredContextTokens(usage: MeasuredUsage | undefined): number | undefined {
  if (!usage) return undefined
  const total = usage.totalTokens ?? ((usage.promptTokens ?? 0) + (usage.completionTokens ?? 0))
  return Number.isFinite(total) && total > 0 ? Math.floor(total) : undefined
}

/**
 * Folds what the session actually observed into an estimated state: a billed total floors the
 * estimate (`contextKnown` is set only then), and a host compaction advances the generation. The
 * generation reaches the judge state, so a verdict formed before a transcript rewrite can never
 * be served from cache after it.
 */
export function applyMeasuredContext(
  state: TrajectoryState,
  context: { measuredContextTokens?: number; contextGeneration?: number } = {},
): TrajectoryState {
  const measured = context.measuredContextTokens
  if (typeof measured === 'number' && Number.isFinite(measured) && measured > 0) {
    state.contextTokens = Math.max(Math.floor(measured), state.estimatedTokens)
    state.contextKnown = true
  }
  const generation = context.contextGeneration
  if (typeof generation === 'number' && Number.isSafeInteger(generation) && generation > 0) {
    state.contextGeneration = generation
    if (state.verification) {
      state.verification = {
        ...state.verification,
        ...(state.verification.generation !== undefined && state.verification.generation !== generation && state.verification.status !== 'not-required'
          ? { status: 'unknown' as const, reason: 'stale-generation' as const, receiptId: undefined }
          : {}),
        generation,
      }
    }
    state.evidence = decorateTrajectoryState(state, { generation }).evidence
  }
  return state
}
