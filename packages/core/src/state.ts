import type { ChatMessage, ChatRequestBody, EvidenceCode, FailureLevel, RoundKind, TrajectoryState } from './types.ts'

const EXPLORE_TOOLS = new Set([
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

const EDIT_TOOLS = new Set(['edit_file', 'write_file'])

const SHELL_TOOL = 'shell_command'

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
 * Transport-level signals: a rate limit, quota or upstream timeout is not evidence that the
 * *task* is hard — the model/provider was too hot. These must never escalate a round to a
 * stronger tier (retry-vs-escalation), and the research explicitly says a 429 must not be
 * classified as a reasoning failure.
 */
const TRANSPORT_PATTERNS: Array<{ re: RegExp; label: EvidenceCode }> = [
  { re: /\b429\b/, label: 'rate-limited' },
  { re: /rate[- ]limit/i, label: 'rate-limited' },
  { re: /too many requests/i, label: 'rate-limited' },
  { re: /quota[- ]?exceeded/i, label: 'quota-exceeded' },
  { re: /insufficient_quota|insufficient quota/i, label: 'quota-exceeded' },
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

function isHarnessDenial(text: string): boolean {
  return HARNESS_DENIAL.test(text)
}

export function detectFailure(texts: string[]): { level: FailureLevel; evidence: string[] } {
  const evidence: string[] = []
  let hard = 0
  let soft = 0
  let transport = 0
  for (const raw of texts) {
    const text = String(raw ?? '')
    if (!text.trim()) continue
    if (isHarnessDenial(text)) {
      evidence.push('permission-denial')
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
      if (evidence.length < 4) evidence.push(pattern.label)
      break
    }
    if (textHard) continue
    // Transport signals (429/rate-limit/quota/timeout) take precedence over soft patterns
    // but never escalate like a hard failure.
    let textTransport = false
    for (const pattern of TRANSPORT_PATTERNS) {
      if (pattern.re.test(text)) {
        transport += 1
        textTransport = true
        if (evidence.length < 4) evidence.push(pattern.label)
        break
      }
    }
    if (textTransport) continue
    for (const pattern of SOFT_PATTERNS) {
      if (pattern.re.test(text)) {
        soft += 1
        if (evidence.length < 4) evidence.push(pattern.label)
        break
      }
    }
  }
  const level: FailureLevel =
    hard >= 1 ? 'hard' : transport >= 1 ? 'transport' : soft >= 2 ? 'soft' : 'none'
  return { level, evidence }
}

function shellKind(command: string | undefined): RoundKind {
  if (!command) return 'unclassified'
  if (VERIFY_COMMAND.test(command)) return 'verification'
  if (EXPLORE_COMMAND.test(command)) return 'exploration'
  return 'unclassified'
}

function callKind(name: string, args: string | undefined): RoundKind {
  if (EDIT_TOOLS.has(name)) return 'implementation'
  if (EXPLORE_TOOLS.has(name)) return 'exploration'
  if (name === SHELL_TOOL) {
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

export function extractTrajectoryState(body: ChatRequestBody): TrajectoryState {
  const messages: ChatMessage[] = Array.isArray(body.messages) ? body.messages : []
  let assistantTurns = 0
  let toolMessages = 0
  let contextChars = 0
  for (const message of messages) {
    const role = String(message?.role ?? '')
    if (role === 'assistant') assistantTurns += 1
    if (role === 'tool') toolMessages += 1
    contextChars += textOf(message?.content).length
    if (message?.tool_calls) contextChars += JSON.stringify(message.tool_calls).length
  }
  const lastRole = messages.length > 0 ? String(messages[messages.length - 1]?.role ?? '') : ''
  const toolNames = Array.isArray(body.tools)
    ? body.tools.map((tool) => String(tool?.function?.name ?? '')).filter((name) => name.length > 0)
    : []
  const calls = lastToolCalls(messages)
  let roundKind: RoundKind
  if (lastRole === 'user' || assistantTurns === 0) roundKind = 'first-turn'
  else if (lastRole === 'tool') roundKind = classifyRound(calls)
  else roundKind = 'unclassified'
  const failure = detectFailure(trailingToolTexts(messages))
  return {
    messageCount: messages.length,
    assistantTurns,
    toolMessages,
    lastRole,
    contextChars,
    estimatedTokens: Math.ceil(contextChars / 3.6),
    // The proxy only counts transcript chars and tool calls; tool schemas and the system prompt
    // are not measured, so an estimated model window is not a verified fit. Mark it unknown.
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
  }
}
