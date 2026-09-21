import { execFileSync } from 'node:child_process'
import {
  appendSurplusReviewReceipt,
  buildSafeReviewPacket,
  councilPreGate,
  createCouncilPlanReceipt,
  defaultSurplusLogPath,
  newSurplusReviewReceipt,
  parseReviewClaims,
  surplusResources,
  textOf,
  type CouncilPlan,
  type SafeReviewPacket,
  type SabiConfig,
  type SurplusResource,
  type SurplusReviewIntent,
  type SurplusReviewReceipt,
  type ReviewClaim,
} from '@sabi/core'

export interface SurplusReviewResult {
  receipt: SurplusReviewReceipt
  claims: ReviewClaim[]
  logFile: string
  resource?: SurplusResource
  packet?: Pick<SafeReviewPacket, 'intent' | 'changedFiles' | 'diffSha256' | 'truncated'>
}

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>

function git(cwd: string, args: string[]): string {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', timeout: 5000, maxBuffer: 4 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    throw new Error('git diff is unavailable in this workspace')
  }
}

function changedFilesFromStatus(status: string): string[] {
  const entries = status.split('\0').filter(Boolean)
  const files: string[] = []
  for (let index = 0; index < entries.length;) {
    const code = entries[index++] ?? ''
    const pathCount = code[0] === 'R' || code[0] === 'C' ? 2 : 1
    for (let pathIndex = 0; pathIndex < pathCount && index < entries.length; pathIndex += 1) {
      files.push(entries[index++]!)
    }
  }
  return files
}

function reviewInput(cwd: string): { diff: string; changedFiles: string[] } {
  return {
    diff: git(cwd, ['diff', '--no-ext-diff', '--unified=3', 'HEAD', '--']),
    changedFiles: changedFilesFromStatus(git(cwd, ['diff', '--name-status', '--find-renames=50%', '-z', 'HEAD', '--'])),
  }
}

function proxyURL(config: SabiConfig): string {
  const host = process.env.SABI_HOST?.trim() || config.server?.host || '127.0.0.1'
  const clientHost = host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host
  const port = Number(process.env.SABI_PORT ?? config.server?.port ?? 8787)
  return `http://${clientHost}:${Number.isFinite(port) && port > 0 ? port : 8787}/v1/chat/completions`
}

async function boundedText(response: Response, cap = 128 * 1024): Promise<string> {
  if (!response.body) return ''
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > cap) throw new Error('response-too-large')
      chunks.push(value)
    }
    return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}

function responseContent(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return undefined
  const choices = (payload as Record<string, unknown>).choices
  if (!Array.isArray(choices) || !choices.length) return undefined
  const message = choices[0]
  if (!message || typeof message !== 'object' || Array.isArray(message)) return undefined
  const content = (message as Record<string, unknown>).message
  if (!content || typeof content !== 'object' || Array.isArray(content)) return undefined
  const value = (content as Record<string, unknown>).content
  return typeof value === 'string' ? value : textOf(value) || undefined
}

function systemPrompt(intent: SurplusReviewIntent): string {
  const focus = intent === 'bug-hunt'
    ? 'Find one concrete correctness risk that the primary implementation may have missed.'
    : intent === 'test-gap'
      ? 'Find one concrete behavior changed by the diff that lacks a meaningful test.'
      : 'Find one concrete mismatch between the changed code and an API, type, or data contract visible in the diff.'
  return `You are a read-only adversarial reviewer in Sabi shadow mode. ${focus} Return only JSON in the form {"claims":[{"category":"bug|test-gap|api-contract|other","severity":"low|medium|high","claim":"...","file":"relative/path","line":1,"evidence":"...","confidence":0.0}]}. Use an empty claims array when there is no concrete finding. Do not suggest edits, invoke tools, repeat secrets, or claim that a finding is verified.`
}

function resourceFor(resources: SurplusResource[], alias?: string): SurplusResource | undefined {
  if (alias) return resources.find((resource) => resource.alias === alias)
  return resources.find((resource) => resource.alias === 'sabi-quality') ?? resources[0]
}

export async function runSurplusReview(input: {
  cwd: string
  config: SabiConfig
  intent: SurplusReviewIntent
  alias?: string
  logFile?: string
  fetchImpl?: FetchLike
  now?: Date
}): Promise<SurplusReviewResult> {
  const resources = surplusResources(input.config)
  const resource = resourceFor(resources, input.alias)
  const logFile = input.logFile ?? defaultSurplusLogPath()
  if (!resource) {
    const unavailable = { alias: input.alias ?? 'none', tier: 'none', provider: 'none', model: 'none', trust: 'external-free' as const, cost: { input: 0 as const, output: 0 as const }, capabilities: { text: true as const, tools: false } }
    const receipt = newSurplusReviewReceipt({
      intent: input.intent,
      resource: unavailable,
      status: 'unavailable',
      parseStatus: 'not-run',
      claimCount: 0,
      errorCode: 'no-zero-cost-resource',
      now: input.now,
    })
    appendSurplusReviewReceipt(receipt, logFile)
    return {
      logFile,
      claims: [],
      receipt,
    }
  }

  const source = reviewInput(input.cwd)
  const packetResult = buildSafeReviewPacket({ intent: input.intent, changedFiles: source.changedFiles, diff: source.diff })
  if (!packetResult.ok) {
    const receipt = newSurplusReviewReceipt({ intent: input.intent, resource, status: 'blocked', parseStatus: 'not-run', claimCount: 0, errorCode: packetResult.reason, now: input.now })
    appendSurplusReviewReceipt(receipt, logFile)
    return { receipt, claims: [], logFile, resource }
  }

  const preGate = councilPreGate({
    intent: input.intent,
    mode: 'probe',
    maxCalls: 1,
    changedFiles: source.changedFiles,
    diff: source.diff,
    resources,
  }, input.cwd)
  if (!preGate.ok) {
    const blockedReceipt = newSurplusReviewReceipt({
      intent: input.intent, resource, status: 'blocked', parseStatus: 'not-run',
      claimCount: 0, errorCode: preGate.reason, now: input.now,
    })
    appendSurplusReviewReceipt(blockedReceipt, logFile)
    return { receipt: blockedReceipt, claims: [], logFile, resource }
  }

  const plan: CouncilPlan = {
    version: 1,
    mode: 'probe',
    intent: input.intent,
    reason: preGate.note === 'public-scope' ? 'unsure' : 'single-uncertainty',
    seats: [{
      seatId: 'surplus-seat-0',
      objective: 'surplus-inference-shadow-review',
      capability: 'text',
    }],
    crossExamination: false,
    maxCalls: 1,
  }
  createCouncilPlanReceipt(plan, resources, undefined, input.now)
  const packet = packetResult.packet
  if (!packet.diff.trim()) {
    const receipt = newSurplusReviewReceipt({ intent: input.intent, resource, status: 'skipped', parseStatus: 'not-run', claimCount: 0, packetSha256: packet.diffSha256, errorCode: 'no-tracked-diff', now: input.now })
    appendSurplusReviewReceipt(receipt, logFile)
    return { receipt, claims: [], logFile, resource, packet }
  }

  const started = Date.now()
  let response: Response
  try {
    response = await (input.fetchImpl ?? fetch)(proxyURL(input.config), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-sabi-client': 'sabi-surplus',
        'x-sabi-session': 'surplus-review',
        'x-sabi-turn': input.intent,
      },
      body: JSON.stringify({
        model: resource.alias,
        stream: false,
        max_tokens: 1200,
        messages: [
          { role: 'system', content: systemPrompt(input.intent) },
          { role: 'user', content: JSON.stringify({ intent: packet.intent, changedFiles: packet.changedFiles, diff: packet.diff, truncated: packet.truncated }) },
        ],
      }),
      signal: AbortSignal.timeout(30_000),
    })
  } catch {
    const receipt = newSurplusReviewReceipt({ intent: input.intent, resource, status: 'unavailable', parseStatus: 'not-run', claimCount: 0, packetSha256: packet.diffSha256, latencyMs: Date.now() - started, errorCode: 'proxy-unreachable', now: input.now })
    appendSurplusReviewReceipt(receipt, logFile)
    return { receipt, claims: [], logFile, resource, packet }
  }

  if (!response.ok) {
    const receipt = newSurplusReviewReceipt({ intent: input.intent, resource, status: response.status === 429 || response.status >= 500 ? 'unavailable' : 'error', parseStatus: 'not-run', claimCount: 0, packetSha256: packet.diffSha256, latencyMs: Date.now() - started, transportStatus: response.status, errorCode: `http-${response.status}`, now: input.now })
    await response.body?.cancel().catch(() => {})
    appendSurplusReviewReceipt(receipt, logFile)
    return { receipt, claims: [], logFile, resource, packet }
  }

  let payload: unknown
  try {
    payload = JSON.parse(await boundedText(response)) as unknown
  } catch {
    const receipt = newSurplusReviewReceipt({ intent: input.intent, resource, status: 'unverifiable', parseStatus: 'unverifiable', claimCount: 0, packetSha256: packet.diffSha256, latencyMs: Date.now() - started, errorCode: 'invalid-response', now: input.now })
    appendSurplusReviewReceipt(receipt, logFile)
    return { receipt, claims: [], logFile, resource, packet }
  }
  const content = responseContent(payload)
  const parsed = content === undefined ? { status: 'unverifiable' as const, claims: [] } : parseReviewClaims(content)
  const receipt = newSurplusReviewReceipt({ intent: input.intent, resource, status: parsed.status === 'ok' ? 'ok' : 'unverifiable', parseStatus: parsed.status, claimCount: parsed.claims.length, packetSha256: packet.diffSha256, latencyMs: Date.now() - started, errorCode: content === undefined ? 'missing-assistant-content' : undefined, now: input.now })
  appendSurplusReviewReceipt(receipt, logFile)
  return { receipt, claims: parsed.claims, logFile, resource, packet }
}
