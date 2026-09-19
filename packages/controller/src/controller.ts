import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { planAgentRoute } from './agents.ts'
import { chooseActionWithJev } from './jev.ts'
import {
  createOrcaRun,
  createOrcaTerminal,
  closeOrcaTerminal,
  readOrcaTerminal,
  sendOrcaTerminal,
  showOrcaWorker,
  startOrcaWorker,
  waitOrcaTerminal,
} from './orca.ts'
import { discoverAgents, type AgentInventory } from './inventory.ts'
import type {
  AgentHarness,
  AgentRoutePlan,
  AgentSession,
  ControllerAction,
  ControllerCandidateTelemetry,
  ControllerExecution,
  ControllerOverride,
  ControllerRoutingTelemetry,
  HandoffSnapshot,
  JevDecisionTelemetry,
} from './types.ts'
import type { ControllerSignals } from './types.ts'

const DEFAULT_WAIT_MS = 5000

interface RouteSelection {
  action: ControllerAction
  rule: string
  reason: string
  target?: AgentSession | AgentHarness
  plan: AgentRoutePlan
  validActions: ControllerAction[]
  decisionSource: 'deterministic' | 'jev' | 'override'
  jev: JevDecisionTelemetry
}

function recordOf(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function nestedResult(value: unknown): Record<string, unknown> | undefined {
  const root = recordOf(value)
  return recordOf(root?.result) ?? root
}

function findString(value: unknown, keys: string[]): string | undefined {
  const wanted = new Set(keys)
  const visit = (node: unknown, depth: number): string | undefined => {
    if (depth > 5) return undefined
    const object = recordOf(node)
    if (!object) return undefined
    for (const key of wanted) {
      if (typeof object[key] === 'string' && object[key]) return object[key] as string
    }
    for (const child of Object.values(object)) {
      const found = visit(child, depth + 1)
      if (found) return found
    }
    return undefined
  }
  return visit(value, 0)
}

function findBoolean(value: unknown, keys: string[]): boolean | undefined {
  const wanted = new Set(keys)
  const visit = (node: unknown, depth: number): boolean | undefined => {
    if (depth > 5) return undefined
    const object = recordOf(node)
    if (!object) return undefined
    for (const key of wanted) {
      if (typeof object[key] === 'boolean') return object[key] as boolean
    }
    for (const child of Object.values(object)) {
      const found = visit(child, depth + 1)
      if (found !== undefined) return found
    }
    return undefined
  }
  return visit(value, 0)
}

function findNumber(value: unknown, keys: string[]): number | undefined {
  const wanted = new Set(keys)
  const visit = (node: unknown, depth: number): number | undefined => {
    if (depth > 5) return undefined
    const object = recordOf(node)
    if (!object) return undefined
    for (const key of wanted) {
      if (typeof object[key] === 'number' && Number.isFinite(object[key])) return object[key] as number
    }
    for (const child of Object.values(object)) {
      const found = visit(child, depth + 1)
      if (found !== undefined) return found
    }
    return undefined
  }
  return visit(value, 0)
}

function gitOutput(cwd: string, args: string[]): string | undefined {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return undefined
  }
}

function changedFiles(cwd: string): string[] {
  const output = gitOutput(cwd, ['status', '--porcelain'])
  if (!output) return []
  return output.split('\n').map((line) => line.slice(3).trim()).filter(Boolean)
}

function buildHandoff(cwd: string, request: string, active: AgentSession, stuck: boolean): HandoffSnapshot {
  const repoRoot = gitOutput(cwd, ['rev-parse', '--show-toplevel']) ?? cwd
  const branch = gitOutput(cwd, ['branch', '--show-current']) || active.branch || 'unknown'
  const files = changedFiles(cwd)
  const diff = gitOutput(cwd, ['diff', '--stat']) ?? ''
  return {
    objective: request,
    originalRequest: request,
    sourceSession: active.handle ?? active.id,
    repo: path.basename(repoRoot),
    progress: 'request received; live inventory discovered',
    workCompleted: files.length ? `existing worktree changes preserved (${files.length} files)` : 'no local changes detected',
    changedFiles: files,
    branch,
    worktree: path.resolve(cwd),
    testsRun: [],
    latestResults: [],
    unresolvedWork: [request],
    latestFailure: stuck ? 'recent Sabi session failure is still unresolved' : undefined,
    relevantDiff: diff,
    nextAction: request,
  }
}

function isTrivialRequest(request: string): boolean {
  const normalized = request.trim().toLowerCase()
  return normalized.length <= 80 && /^(?:what is|what's|calculate|compute|say|hello|hi)\b/.test(normalized)
}

function explicitlyDelegates(request: string): boolean {
  return /\b(?:delegate|handoff|hand off|another agent|different agent|independent|existing session|fresh reviewer)\b/i.test(request)
}

function requestsFreshHarness(request: string): boolean {
  return /\b(?:spawn|fresh harness|new harness|new session|no active session)\b/i.test(request)
}

function capacityRank(status: AgentSession['capacity']['status']): number {
  return status === 'available' ? 0 : status === 'degraded' ? 1 : status === 'rate_limited' ? 2 : status === 'quota_exhausted' ? 3 : 4
}

function bestSession(sessions: AgentSession[]): AgentSession | undefined {
  return [...sessions]
    .filter((session) => session.available && session.lifecycle === 'idle')
    .sort((left, right) => capacityRank(left.capacity.status) - capacityRank(right.capacity.status) || (right.lastOutputAt ?? 0) - (left.lastOutputAt ?? 0) || left.id.localeCompare(right.id))[0]
}

function bestHarness(harnesses: AgentHarness[]): AgentHarness | undefined {
  return [...harnesses].filter((harness) => harness.available)
    .sort((left, right) => capacityRank(left.capacity.status) - capacityRank(right.capacity.status) || left.id.localeCompare(right.id))[0]
}

function handoffForAction(plan: AgentRoutePlan, action: ControllerAction, target: AgentSession | AgentHarness | undefined): AgentRoutePlan {
  if (action === 'DELEGATE' || action === 'SPAWN') {
    return { ...plan, action, target, currentEligible: false }
  }
  return { ...plan, action: action === 'CONTINUE' ? 'CONTINUE' : plan.action }
}

function candidateState(inventory: AgentInventory): Record<string, unknown> {
  const describe = (candidate: AgentSession | AgentHarness): Record<string, unknown> => ({
    id: candidate.id,
    agent: candidate.agent,
    harness: candidate.harness,
    available: candidate.available,
    capacity: candidate.capacity,
    worktree: candidate.worktree,
    branch: candidate.branch,
    lifecycle: candidate.kind === 'session' ? candidate.lifecycle : undefined,
    dispatchable: candidate.kind === 'session' ? candidate.dispatchable : true,
    context: candidate.context,
  })
  return {
    active: describe(inventory.active),
    existingSessions: inventory.existingSessions.map(describe),
    spawnCandidates: inventory.spawnCandidates.map(describe),
  }
}

function candidateTelemetry(inventory: AgentInventory): ControllerCandidateTelemetry[] {
  const describe = (
    action: ControllerCandidateTelemetry['action'],
    candidate: AgentSession | AgentHarness,
  ): ControllerCandidateTelemetry => ({
    action,
    id: candidate.id,
    agent: candidate.agent,
    kind: candidate.kind,
    available: candidate.available,
    dispatchable: candidate.kind === 'session' ? candidate.dispatchable : true,
    capacity: candidate.capacity,
    lifecycle: candidate.kind === 'session' ? candidate.lifecycle : undefined,
    context: candidate.context,
  })
  // ponytail: cap the trace at 32 candidates; add paged inventory storage if large Orca pools appear.
  return [
    describe('CONTINUE', inventory.active),
    ...inventory.existingSessions.map((candidate) => describe('DELEGATE', candidate)),
    ...inventory.spawnCandidates.map((candidate) => describe('SPAWN', candidate)),
  ].slice(0, 32)
}

export async function selectRoute(
  request: string,
  cwd: string,
  signals: ControllerSignals,
  inventory: AgentInventory,
  handoff: HandoffSnapshot,
  override: ControllerOverride | undefined,
): Promise<RouteSelection> {
  const costs = {
    handoffMs: 10_000,
    replacementExecutionMs: 60_000,
    rateLimitThresholdMs: 120_000,
  }
  const basePlan = planAgentRoute({
    now: Date.now(),
    active: inventory.active,
    existingSessions: inventory.existingSessions,
    spawnCandidates: inventory.spawnCandidates,
    requiredCapabilities: ['coding'],
    costs,
    handoff,
  })
  const noJev: JevDecisionTelemetry = { status: 'not-consulted', validActions: [] }

  if (!request.trim()) {
    return {
      action: 'ASK',
      rule: 'missing-request',
      reason: 'no request text was supplied; the controller cannot execute safely',
      plan: { ...basePlan, action: 'ASK' },
      validActions: ['ASK'],
      decisionSource: 'deterministic',
      jev: { ...noJev, validActions: ['ASK'] },
    }
  }

  if (override?.sessionId) {
    const target = inventory.active.id === override.sessionId || inventory.active.handle === override.sessionId
      ? inventory.active
      : inventory.existingSessions.find((session) => session.id === override.sessionId || session.handle === override.sessionId)
    if (!target || !target.available) {
      return { action: 'ASK', rule: 'pinned-session-unavailable', reason: `pinned session '${override.sessionId}' is unavailable`, plan: { ...basePlan, action: 'ASK' }, validActions: ['ASK'], decisionSource: 'override', jev: { ...noJev, validActions: ['ASK'] } }
    }
    const action = target.id === inventory.active.id ? 'CONTINUE' : 'DELEGATE'
    const plan = handoffForAction(basePlan, action, target)
    return { action, rule: 'pinned-session', reason: `user pinned ${target.agent} session`, target, plan, validActions: [action], decisionSource: 'override', jev: { ...noJev, validActions: [action] } }
  }

  if (override?.harness) {
    const target = inventory.existingSessions.find((session) => session.agent === override.harness && session.available) ??
      inventory.spawnCandidates.find((harness) => harness.agent === override.harness && harness.available)
    if (!target) {
      return { action: 'ASK', rule: 'pinned-harness-unavailable', reason: `pinned harness '${override.harness}' is unavailable`, plan: { ...basePlan, action: 'ASK' }, validActions: ['ASK'], decisionSource: 'override', jev: { ...noJev, validActions: ['ASK'] } }
    }
    const action = target.kind === 'session' ? 'DELEGATE' : 'SPAWN'
    const plan = handoffForAction(basePlan, action, target)
    return { action, rule: 'pinned-harness', reason: `user pinned ${target.agent}`, target, plan, validActions: [action], decisionSource: 'override', jev: { ...noJev, validActions: [action] } }
  }

  if (signals.multiScope) {
    const target = bestHarness(inventory.spawnCandidates)
    if (!target) {
      return { action: 'ASK', rule: 'no-orchestration-target', reason: 'request requires orchestration but no available Orca harness can be selected safely', plan: { ...basePlan, action: 'ASK' }, validActions: ['ASK'], decisionSource: 'deterministic', jev: { ...noJev, validActions: ['ASK'] } }
    }
    return { action: 'ORCHESTRATE', rule: 'multi-scope-request', reason: `request requires Orca orchestration (${signals.multiScopeTrigger ?? 'multi-scope'})`, target, plan: basePlan, validActions: ['ORCHESTRATE'], decisionSource: 'deterministic', jev: { ...noJev, validActions: ['ORCHESTRATE'] } }
  }

  if (basePlan.action === 'DELEGATE' || basePlan.action === 'SPAWN' || basePlan.action === 'ASK') {
    const target = basePlan.target
    return { action: basePlan.action, rule: basePlan.rule, reason: basePlan.reason, target, plan: basePlan, validActions: [basePlan.action], decisionSource: 'deterministic', jev: { ...noJev, validActions: [basePlan.action] } }
  }

  if (isTrivialRequest(request)) {
    return { action: 'CONTINUE', rule: 'trivial-current-session', reason: 'trivial request stays in the current healthy session', target: inventory.active, plan: basePlan, validActions: ['CONTINUE'], decisionSource: 'deterministic', jev: { ...noJev, validActions: ['CONTINUE'] } }
  }

  const session = bestSession(inventory.existingSessions)
  const harness = bestHarness(inventory.spawnCandidates)
  if (requestsFreshHarness(request) && harness) {
    const plan = handoffForAction(basePlan, 'SPAWN', harness)
    return { action: 'SPAWN', rule: 'fresh-harness-request', reason: `request explicitly asks for a fresh harness; spawn ${harness.agent}`, target: harness, plan, validActions: ['SPAWN'], decisionSource: 'deterministic', jev: { ...noJev, validActions: ['SPAWN'] } }
  }

  if (session && (explicitlyDelegates(request) || !inventory.active.available)) {
    const validActions: ControllerAction[] = ['CONTINUE', 'DELEGATE']
    const fallback: ControllerAction = explicitlyDelegates(request) ? 'DELEGATE' : 'CONTINUE'
    const jev = await chooseActionWithJev({
      cwd,
      request,
      validActions,
      fallback,
      state: { request, validActions, inventory: candidateState(inventory), handoff },
    })
    const target = jev.action === 'DELEGATE' ? session : inventory.active
    const plan = handoffForAction(basePlan, jev.action, target)
    return { action: jev.action, rule: jev.telemetry.status === 'ok' ? 'jev-closed-action-choice' : 'existing-session-suitability', reason: jev.telemetry.status === 'ok' ? `Jev selected ${jev.action} from the valid action set` : `${jev.action} selected by deterministic fallback`, target, plan, validActions, decisionSource: jev.telemetry.status === 'ok' ? 'jev' : 'deterministic', jev: jev.telemetry }
  }

  return { action: 'CONTINUE', rule: 'current-session-sufficient', reason: 'current healthy session is the smallest sufficient route', target: inventory.active, plan: basePlan, validActions: ['CONTINUE'], decisionSource: 'deterministic', jev: { ...noJev, validActions: ['CONTINUE'] } }
}

function sendEvidence(value: unknown): Pick<ControllerExecution, 'requestId' | 'inputAccepted' | 'turnStarted'> {
  return {
    requestId: findString(value, ['requestId', 'request_id']),
    inputAccepted: findBoolean(value, ['inputAccepted', 'input_accepted', 'accepted']),
    turnStarted: findBoolean(value, ['turnStarted', 'turn_started']),
  }
}

export function structuredHandoff(request: string, handoff: HandoffSnapshot): string {
  const payload = {
    objective: handoff.objective,
    originalRequest: handoff.originalRequest,
    sourceSession: handoff.sourceSession,
    repo: handoff.repo,
    worktree: handoff.worktree,
    branch: handoff.branch,
    progress: handoff.progress,
    filesChanged: handoff.changedFiles,
    tests: handoff.testsRun,
    results: handoff.latestResults,
    unresolvedWork: handoff.unresolvedWork,
    diff: handoff.relevantDiff,
    nextSuggestedStep: handoff.nextAction,
  }
  return `[SABI HANDOFF]\n${JSON.stringify(payload)}\n[REQUEST]\n${request}\n[/SABI HANDOFF]`
}

function sessionExecution(
  handle: string,
  targetId: string,
  request: string,
  operation: 'terminal-send' | 'terminal-spawn',
  waitMs: number,
  handoff?: HandoffSnapshot,
  targetWorktree?: string,
): ControllerExecution {
  const outbound = handoff && targetWorktree && path.resolve(targetWorktree) !== path.resolve(handoff.worktree)
    ? structuredHandoff(request, handoff)
    : request
  const sent = sendOrcaTerminal(handle, outbound)
  if (!sent.ok) return { status: 'failed', targetId, terminalHandle: handle, operation, error: sent.detail ?? sent.errorCode }
  const evidence = sendEvidence(sent.result)
  const waited = waitOrcaTerminal(handle, 'tui-idle', waitMs)
  const screen = readOrcaTerminal(handle)
  const result = nestedResult(screen.result)
  const tail = recordOf(result?.terminal)
  const rawTail = tail?.tail
  const lines = Array.isArray(rawTail) ? rawTail.length : undefined
  const outputText = Array.isArray(rawTail) ? rawTail.filter((line): line is string => typeof line === 'string').join('\n') : ''
  const recentOutput = Array.isArray(rawTail)
    ? rawTail.filter((line): line is string => typeof line === 'string').slice(-16).join('\n')
    : ''
  const normalizeScreenText = (value: string): string => value.replace(/\s+/g, ' ').trim()
  const normalizedOutput = normalizeScreenText(outputText)
  const normalizedRecentOutput = normalizeScreenText(recentOutput)
  const capacityFailure = /(?:you(?:'|’)ve reached|usage|weekly|session) limit|quota(?: exhausted|[-_ ]exceeded)?|insufficient_quota|rate[- ]?limit|too many requests|HTTP 429/i.test(normalizedRecentOutput)
  const normalizedRequest = normalizeScreenText(request)
  const requestObserved = normalizedOutput.includes(normalizedRequest)
  const outputAfterRequest = requestObserved ? normalizedOutput.slice(normalizedOutput.lastIndexOf(normalizedRequest) + normalizedRequest.length) : ''
  const completionObserved = requestObserved && /(?:✻|●).*(?:done|worked|baked|cooked|churned|sautéed|roasted|simmered)\b/i.test(outputAfterRequest)
  const cursor = findNumber(screen.result, ['latestCursor', 'nextCursor'])
  const satisfied = findBoolean(waited.result, ['satisfied'])
  return {
    status: capacityFailure ? 'failed' : satisfied === true && requestObserved || completionObserved ? 'completed' : requestObserved ? 'started' : 'unverifiable',
    targetId,
    terminalHandle: handle,
    operation,
    ...evidence,
    requestObserved,
    waitSatisfied: satisfied,
    observedStatus: capacityFailure ? 'quota-or-rate-limit' : completionObserved ? 'completed' : findString(waited.result, ['status']) ?? (waited.ok ? 'observed' : waited.errorCode),
    observedOutputLines: lines,
    outputCursor: cursor,
    ...(capacityFailure ? { error: 'target-reported-quota-or-rate-limit' } : {}),
  }
}

function executeSpawn(target: AgentHarness, cwd: string, request: string, waitMs: number): ControllerExecution {
  const created = createOrcaTerminal(cwd, target.command, `sabi-controller:${target.agent}`)
  if (!created.ok) return { status: 'failed', targetId: target.id, operation: 'terminal-spawn', error: created.detail ?? created.errorCode }
  const handle = findString(created.result, ['handle'])
  if (!handle) return { status: 'failed', targetId: target.id, operation: 'terminal-spawn', error: 'spawn-receipt-missing-handle' }
  const ready = waitOrcaTerminal(handle, 'tui-idle', Math.max(waitMs, 30_000))
  if (!ready.ok || findBoolean(ready.result, ['satisfied']) === false) {
    closeOrcaTerminal(handle)
    return { status: 'failed', targetId: target.id, terminalHandle: handle, operation: 'terminal-spawn', error: ready.detail ?? ready.errorCode ?? 'spawn-not-ready' }
  }
  const execution = sessionExecution(handle, target.id, request, 'terminal-spawn', waitMs)
  if (execution.status === 'failed') closeOrcaTerminal(handle)
  return execution
}

function orchestrationAgent(target: AgentSession | AgentHarness | undefined): string {
  const value = target?.agent
  if (value && ['codex', 'claude', 'opencode', 'omp', 'pi', 'grok'].includes(value)) return value
  return 'codex'
}

function executeOrchestration(target: AgentSession | AgentHarness | undefined, cwd: string, request: string, handoff: HandoffSnapshot): ControllerExecution {
  const from = process.env.ORCA_TERMINAL_HANDLE?.trim() || undefined
  const run = createOrcaRun(request, from)
  if (!run.ok) return { status: 'failed', operation: 'orchestration', error: run.detail ?? run.errorCode }
  const runId = findString(run.result, ['runId', 'run_id', 'id'])
  const spec = [
    `Objective: ${request}`,
    `Repository: ${handoff.repo}`,
    `Worktree: ${handoff.worktree}`,
    'Use the real Orca child worktree and report the outcome through the supervised worker contract.',
    `Handoff: ${JSON.stringify(handoff)}`,
  ].join('\n')
  const started = startOrcaWorker({ runId, spec, agent: orchestrationAgent(target), repo: cwd, name: `sabi-controller-${Date.now()}` })
  if (!started.ok) return { status: 'failed', operation: 'orchestration', runId, error: started.detail ?? started.errorCode }
  const dispatchId = findString(started.result, ['dispatchId', 'dispatch_id', 'id'])
  const observed = dispatchId ? showOrcaWorker(dispatchId) : undefined
  const observation = observed?.result
  return {
    status: 'started',
    operation: 'orchestration',
    runId,
    dispatchId,
    observedStatus: findString(observation, ['status', 'state']) ?? (observed?.ok ? 'dispatched' : observed?.errorCode),
  }
}

function executeSelection(selection: RouteSelection, inventory: AgentInventory, cwd: string, request: string, handoff: HandoffSnapshot, waitMs: number): ControllerExecution {
  if (selection.action === 'ASK') return { status: 'awaiting-user', targetId: selection.target?.id, operation: undefined, error: selection.reason }
  if (selection.action === 'ORCHESTRATE') return executeOrchestration(selection.target, cwd, request, handoff)
  if (selection.action === 'SPAWN' && selection.target?.kind === 'harness') return executeSpawn(selection.target, cwd, request, waitMs)
  const target = selection.target?.kind === 'session' ? selection.target : inventory.active
  if (!target.handle) {
    if (selection.action === 'CONTINUE' && target.dispatchable === false) {
      return { status: 'not-started', targetId: target.id, operation: 'terminal-send', observedStatus: 'host-native', error: 'current request remains with the harness' }
    }
    return { status: 'failed', targetId: target.id, operation: 'terminal-send', error: 'target-session-handle-missing' }
  }
  return sessionExecution(target.handle, target.id, request, 'terminal-send', waitMs, handoff, target.worktree)
}

function fallbackTarget(inventory: AgentInventory, failedTargetId: string | undefined): AgentSession | undefined {
  return bestSession(inventory.existingSessions.filter((session) => session.id !== failedTargetId)) ??
    (inventory.active.id !== failedTargetId && inventory.active.available ? inventory.active : undefined)
}

export interface ControllerRunResult {
  selection: RouteSelection
  handoff: HandoffSnapshot
  routing: ControllerRoutingTelemetry
  execution: ControllerExecution
}

export async function runController(
  request: string,
  cwd: string,
  signals: ControllerSignals,
  override?: ControllerOverride,
  waitMs = DEFAULT_WAIT_MS,
  execute = true,
  currentSession?: string,
  currentHarness?: string,
): Promise<ControllerRunResult> {
  const inventory = discoverAgents(cwd, { stuckSession: signals.stuckSession, currentSession, currentHarness })
  const handoff = buildHandoff(cwd, request, inventory.active, signals.stuckSession)
  const selection = await selectRoute(request, cwd, signals, inventory, handoff, override)
  let execution: ControllerExecution = execute
    ? executeSelection(selection, inventory, cwd, request, handoff, waitMs)
    : { status: 'not-started' }

  if (execute && execution.status === 'failed' && selection.action !== 'ASK' && selection.action !== 'ORCHESTRATE' && selection.decisionSource !== 'override') {
    const refreshed = discoverAgents(cwd, { stuckSession: signals.stuckSession, currentSession, currentHarness })
    const fallback = fallbackTarget(refreshed, execution.targetId)
    if (fallback?.handle) {
      const retry = sessionExecution(fallback.handle, fallback.id, request, 'terminal-send', waitMs, handoff, fallback.worktree)
      execution = { ...retry, status: retry.status === 'failed' ? 'failed' : 'rerouted', reroutedFrom: execution.targetId }
    }
  }

  const routing: ControllerRoutingTelemetry = {
    inventory: {
      orcaAvailable: inventory.orcaAvailable,
      worktreeCount: inventory.worktreeCount,
      sessionCount: inventory.existingSessions.length + (inventory.active.handle ? 1 : 0),
      harnessCount: inventory.spawnCandidates.length,
      activeSessionId: inventory.active.handle ? inventory.active.id : undefined,
    },
    validActions: selection.validActions,
    candidates: candidateTelemetry(inventory),
    decisionSource: selection.decisionSource,
    deterministicRule: selection.rule,
    jev: selection.jev,
  }
  return { selection, handoff, routing, execution }
}
