import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import type { ControllerConfig } from '@sabi/core'
import { planAgentRoute } from './agents.ts'
import { chooseActionWithJev } from './jev.ts'
import {
  createOrcaRun,
  createOrcaTerminal,
  closeOrcaTerminal,
  parseCreatedRunResult,
  parseCreatedTerminalResult,
  parseStartedWorkerResult,
  parseTerminalReadReceipt,
  parseTerminalSendReceipt,
  parseTerminalWaitReceipt,
  parseWorkerStatusResult,
  readOrcaTerminal,
  sendOrcaTerminal,
  showOrcaWorker,
  startOrcaWorker,
  waitOrcaTerminal,
} from './orca.ts'
import { discoverAgents, type AgentInventory } from './inventory.ts'
import { recordModelReceipt } from './model-health.ts'
import type {
  AgentHarness,
  AgentRoutePlan,
  AgentSession,
  ControllerAction,
  ControllerCandidateTelemetry,
  ControllerExecution,
  ControllerExecutionReceipt,
  ControllerOverride,
  ControllerReceiptPhase,
  ControllerRoutingTelemetry,
  HandoffSnapshot,
  JevDecisionTelemetry,
} from './types.ts'
import type { ControllerSignals } from './types.ts'

const DEFAULT_WAIT_MS = 5000
// ponytail: cap recovery at three replacement attempts; raise only with receipt-aware deduplication.
const MAX_REROUTES = 3

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

function preferenceRank(agent: AgentSession | AgentHarness, preferred: string[] | undefined): number {
  if (!preferred?.length) return 0
  const index = preferred.indexOf(agent.harness)
  return index < 0 ? preferred.length : index
}

function bestSession(sessions: AgentSession[], preferred?: string[]): AgentSession | undefined {
  return [...sessions]
    .filter((session) => session.available && session.lifecycle === 'idle')
    .sort((left, right) => capacityRank(left.capacity.status) - capacityRank(right.capacity.status) || preferenceRank(left, preferred) - preferenceRank(right, preferred) || (right.lastOutputAt ?? 0) - (left.lastOutputAt ?? 0) || left.id.localeCompare(right.id))[0]
}

function bestHarness(harnesses: AgentHarness[], preferred?: string[]): AgentHarness | undefined {
  return [...harnesses].filter((harness) => harness.available)
    .sort((left, right) => capacityRank(left.capacity.status) - capacityRank(right.capacity.status) || preferenceRank(left, preferred) - preferenceRank(right, preferred) || left.id.localeCompare(right.id))[0]
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
    capacity: {
      status: candidate.capacity.status,
      ...(candidate.capacity.resetAt !== undefined ? { resetAt: candidate.capacity.resetAt } : {}),
      ...(candidate.capacity.fallbackMode ? { fallbackMode: candidate.capacity.fallbackMode } : {}),
    },
    lifecycle: candidate.kind === 'session' ? candidate.lifecycle : undefined,
    dispatchable: candidate.kind === 'session' ? candidate.dispatchable : true,
    context: candidate.context?.slice(0, 160),
    model: candidate.model,
    modelHealth: candidate.kind === 'harness' ? candidate.modelHealth?.status : undefined,
  })
  return {
    active: describe(inventory.active),
    existingSessions: inventory.existingSessions.slice(0, 32).map(describe),
    spawnCandidates: inventory.spawnCandidates.slice(0, 16).map(describe),
  }
}

function handoffState(handoff: HandoffSnapshot): Record<string, unknown> {
  return {
    objective: handoff.objective.slice(0, 1200),
    originalRequest: handoff.originalRequest.slice(0, 1200),
    sourceSession: handoff.sourceSession,
    repo: handoff.repo,
    branch: handoff.branch,
    progress: handoff.progress.slice(0, 240),
    changedFileCount: handoff.changedFiles.length,
    testsRun: handoff.testsRun.slice(0, 8).map((value) => value.slice(0, 160)),
    latestResults: handoff.latestResults.slice(0, 8).map((value) => value.slice(0, 160)),
    unresolvedWorkCount: handoff.unresolvedWork.length,
    nextAction: handoff.nextAction.slice(0, 1200),
    ...(handoff.latestFailure ? { latestFailure: handoff.latestFailure.slice(0, 240) } : {}),
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
    model: candidate.model,
    catalog: candidate.kind === 'harness' ? candidate.catalog : undefined,
    modelHealth: candidate.kind === 'harness' ? candidate.modelHealth : undefined,
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
  controller?: ControllerConfig,
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
    preferredHarnesses: controller?.preferredHarnesses,
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
    const target = bestHarness(inventory.spawnCandidates, controller?.preferredHarnesses)
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

  const session = bestSession(inventory.existingSessions, controller?.preferredHarnesses)
  const harness = bestHarness(inventory.spawnCandidates, controller?.preferredHarnesses)
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
      state: { request: request.slice(0, 2000), validActions, inventory: candidateState(inventory), handoff: handoffState(handoff) },
    })
    const target = jev.action === 'DELEGATE' ? session : inventory.active
    const plan = handoffForAction(basePlan, jev.action, target)
    return { action: jev.action, rule: jev.telemetry.status === 'ok' ? 'jev-closed-action-choice' : 'existing-session-suitability', reason: jev.telemetry.status === 'ok' ? `Jev selected ${jev.action} from the valid action set` : `${jev.action} selected by deterministic fallback`, target, plan, validActions, decisionSource: jev.telemetry.status === 'ok' ? 'jev' : 'deterministic', jev: jev.telemetry }
  }

  return { action: 'CONTINUE', rule: 'current-session-sufficient', reason: 'current healthy session is the smallest sufficient route', target: inventory.active, plan: basePlan, validActions: ['CONTINUE'], decisionSource: 'deterministic', jev: { ...noJev, validActions: ['CONTINUE'] } }
}

function receipt(phase: ControllerReceiptPhase, requestId?: string): ControllerExecutionReceipt {
  return {
    phase,
    observedAt: new Date().toISOString(),
    ...(requestId ? { requestId } : {}),
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
  idempotencyKey?: string,
): ControllerExecution {
  const outbound = handoff && targetWorktree && path.resolve(targetWorktree) !== path.resolve(handoff.worktree)
    ? structuredHandoff(request, handoff)
    : request
  const sent = sendOrcaTerminal(handle, outbound)
  if (!sent.ok) return {
    status: 'failed',
    targetId,
    terminalHandle: handle,
    operation,
    ...(idempotencyKey ? { idempotencyKey } : {}),
    receipt: receipt('failed'),
    retryable: true,
    error: sent.detail ?? sent.errorCode,
  }
  const sendReceipt = parseTerminalSendReceipt(sent.result)
  if (!sendReceipt) return {
    status: 'unverifiable',
    targetId,
    terminalHandle: handle,
    operation,
    ...(idempotencyKey ? { idempotencyKey } : {}),
    receipt: receipt('unknown'),
    error: 'unrecognized-terminal-send-receipt',
  }
  const waited = waitOrcaTerminal(handle, 'tui-idle', waitMs)
  const screen = readOrcaTerminal(handle)
  const readReceipt = parseTerminalReadReceipt(screen.result)
  const rawTail = readReceipt?.terminal.tail
  const lines = rawTail?.length
  const outputText = rawTail?.join('\n') ?? ''
  const recentOutput = rawTail?.slice(-16).join('\n') ?? ''
  const normalizeScreenText = (value: string): string => value.replace(/\s+/g, ' ').trim()
  const normalizedOutput = normalizeScreenText(outputText)
  const normalizedRecentOutput = normalizeScreenText(recentOutput)
  const capacityFailure = /(?:you(?:'|’)ve reached|usage|weekly|session) limit|quota(?: exhausted|[-_ ]exceeded)?|insufficient_quota|rate[- ]?limit|too many requests|HTTP 429/i.test(normalizedRecentOutput)
  const normalizedRequest = normalizeScreenText(request)
  const requestObserved = normalizedOutput.includes(normalizedRequest)
  const outputAfterRequest = requestObserved ? normalizedOutput.slice(normalizedOutput.lastIndexOf(normalizedRequest) + normalizedRequest.length) : ''
  const completionObserved = requestObserved && /(?:✻|●).*(?:done|worked|baked|cooked|churned|sautéed|roasted|simmered)\b/i.test(outputAfterRequest)
  const waitReceipt = parseTerminalWaitReceipt(waited.result)
  const cursorValue = readReceipt?.latestCursor ?? readReceipt?.nextCursor
  const cursor = typeof cursorValue === 'number' ? cursorValue : cursorValue === undefined ? undefined : Number(cursorValue)
  const satisfied = waitReceipt?.satisfied
  return {
    status: capacityFailure && !requestObserved ? 'failed' : satisfied === true && requestObserved || completionObserved ? 'completed' : requestObserved || sendReceipt.turnStarted === true ? 'started' : 'unverifiable',
    targetId,
    terminalHandle: handle,
    operation,
    ...(idempotencyKey ? { idempotencyKey } : {}),
    ...(sendReceipt.requestId ? { requestId: sendReceipt.requestId } : {}),
    ...(sendReceipt.inputAccepted !== undefined ? { inputAccepted: sendReceipt.inputAccepted } : {}),
    ...(sendReceipt.turnStarted !== undefined ? { turnStarted: sendReceipt.turnStarted } : {}),
    receipt: receipt(
      capacityFailure && !requestObserved ? 'failed' : satisfied === true && requestObserved || completionObserved ? 'completed' : requestObserved || sendReceipt.turnStarted === true ? 'started' : 'unknown',
      sendReceipt.requestId,
    ),
    requestObserved,
    waitSatisfied: satisfied,
    observedStatus: capacityFailure ? 'quota-or-rate-limit' : completionObserved ? 'completed' : waitReceipt?.status ?? (waited.ok ? 'observed' : waited.errorCode),
    observedOutputLines: lines,
    outputCursor: cursor,
    ...(capacityFailure && !requestObserved && sendReceipt.inputAccepted !== true && sendReceipt.turnStarted !== true ? { retryable: true } : {}),
    ...(capacityFailure ? { error: 'target-reported-quota-or-rate-limit' } : {}),
    ...(!readReceipt ? { error: 'unrecognized-terminal-read-receipt' } : {}),
  }
}

function executeSpawn(target: AgentHarness, cwd: string, request: string, waitMs: number, idempotencyKey?: string): ControllerExecution {
  const created = createOrcaTerminal(cwd, target.launchCommand ?? target.command, `sabi-controller:${target.agent}`)
  if (!created.ok) return { status: 'failed', targetId: target.id, operation: 'terminal-spawn', ...(idempotencyKey ? { idempotencyKey } : {}), receipt: receipt('failed'), retryable: true, error: created.detail ?? created.errorCode }
  const handle = parseCreatedTerminalResult(created.result)?.handle
  if (!handle) return { status: 'unverifiable', targetId: target.id, operation: 'terminal-spawn', ...(idempotencyKey ? { idempotencyKey } : {}), receipt: receipt('unknown'), error: 'unrecognized-terminal-create-receipt' }
  const ready = waitOrcaTerminal(handle, 'tui-idle', Math.max(waitMs, 30_000))
  const readyReceipt = parseTerminalWaitReceipt(ready.result)
  if (!ready.ok || readyReceipt?.satisfied === false) {
    closeOrcaTerminal(handle)
    return { status: 'failed', targetId: target.id, terminalHandle: handle, operation: 'terminal-spawn', ...(idempotencyKey ? { idempotencyKey } : {}), receipt: receipt('failed'), retryable: true, error: ready.detail ?? ready.errorCode ?? 'spawn-not-ready' }
  }
  if (!readyReceipt) {
    closeOrcaTerminal(handle)
    return { status: 'unverifiable', targetId: target.id, terminalHandle: handle, operation: 'terminal-spawn', ...(idempotencyKey ? { idempotencyKey } : {}), receipt: receipt('unknown'), error: 'unrecognized-terminal-wait-receipt' }
  }
  const execution = sessionExecution(handle, target.id, request, 'terminal-spawn', waitMs, undefined, undefined, idempotencyKey)
  if (execution.status === 'failed' && execution.retryable === true) closeOrcaTerminal(handle)
  return execution
}

function orchestrationAgent(target: AgentSession | AgentHarness | undefined): string {
  const value = target?.agent
  if (value && ['codex', 'claude', 'opencode', 'command-code', 'hermes', 'omp', 'pi', 'grok'].includes(value)) return value
  return 'codex'
}

function executeOrchestration(target: AgentSession | AgentHarness | undefined, cwd: string, request: string, handoff: HandoffSnapshot, idempotencyKey: string): ControllerExecution {
  const from = process.env.ORCA_TERMINAL_HANDLE?.trim() || undefined
  const run = createOrcaRun(request, from)
  if (!run.ok) return { status: 'failed', operation: 'orchestration', idempotencyKey, receipt: receipt('failed'), retryable: true, error: run.detail ?? run.errorCode }
  const runId = parseCreatedRunResult(run.result)?.runId
  if (!runId) return { status: 'unverifiable', operation: 'orchestration', idempotencyKey, receipt: receipt('unknown'), error: 'unrecognized-orchestration-run-receipt' }
  const spec = [
    `Objective: ${request}`,
    `Repository: ${handoff.repo}`,
    `Worktree: ${handoff.worktree}`,
    'Use the real Orca child worktree and report the outcome through the supervised worker contract.',
    `Handoff: ${JSON.stringify(handoff)}`,
  ].join('\n')
  const started = startOrcaWorker({ runId, spec, agent: orchestrationAgent(target), repo: cwd, name: `sabi-controller-${Date.now()}` })
  if (!started.ok) return { status: 'failed', operation: 'orchestration', runId, idempotencyKey, receipt: receipt('failed'), retryable: true, error: started.detail ?? started.errorCode }
  const dispatchId = parseStartedWorkerResult(started.result)?.dispatchId
  if (!dispatchId) return { status: 'unverifiable', operation: 'orchestration', runId, idempotencyKey, receipt: receipt('unknown'), error: 'unrecognized-worker-start-receipt' }
  const observed = dispatchId ? showOrcaWorker(dispatchId) : undefined
  const observation = observed?.result
  const workerStatus = parseWorkerStatusResult(observation)
  return {
    status: 'started',
    operation: 'orchestration',
    runId,
    dispatchId,
    idempotencyKey,
    receipt: receipt('started'),
    observedStatus: workerStatus?.status ?? (observed?.ok ? 'dispatched' : observed?.errorCode),
  }
}

function executeSelection(selection: RouteSelection, inventory: AgentInventory, cwd: string, request: string, handoff: HandoffSnapshot, waitMs: number, idempotencyKey: string): ControllerExecution {
  if (selection.action === 'ASK') return { status: 'awaiting-user', targetId: selection.target?.id, operation: undefined, idempotencyKey, error: selection.reason }
  if (selection.action === 'ORCHESTRATE') return executeOrchestration(selection.target, cwd, request, handoff, idempotencyKey)
  if (selection.action === 'SPAWN' && selection.target?.kind === 'harness') return executeSpawn(selection.target, cwd, request, waitMs, idempotencyKey)
  const target = selection.target?.kind === 'session' ? selection.target : inventory.active
  if (!target.handle) {
    if (selection.action === 'CONTINUE' && target.dispatchable === false) {
      return { status: 'not-started', targetId: target.id, operation: 'terminal-send', idempotencyKey, observedStatus: 'host-native', error: 'current request remains with the harness' }
    }
    return { status: 'failed', targetId: target.id, operation: 'terminal-send', idempotencyKey, receipt: receipt('failed'), retryable: true, error: 'target-session-handle-missing' }
  }
  return sessionExecution(target.handle, target.id, request, 'terminal-send', waitMs, handoff, target.worktree, idempotencyKey)
}

function fallbackTarget(inventory: AgentInventory, failedTargetIds: Set<string>, preferred?: string[]): AgentSession | AgentHarness | undefined {
  const targetKey = (candidate: AgentSession | AgentHarness): string => `${candidate.id}\0${candidate.model ?? ''}`
  const session = bestSession(inventory.existingSessions.filter((candidate) => !failedTargetIds.has(targetKey(candidate))), preferred)
  if (session) return session
  if (!failedTargetIds.has(targetKey(inventory.active)) && inventory.active.available) return inventory.active
  return bestHarness(inventory.spawnCandidates.filter((candidate) => !failedTargetIds.has(targetKey(candidate))), preferred)
}

function recordModelExecution(
  target: AgentSession | AgentHarness | undefined,
  execution: ControllerExecution,
  startedAt: number,
): ControllerExecution {
  if (target?.kind !== 'harness' || !target.model) return execution
  const outcome = execution.status === 'failed'
    ? 'failed'
    : execution.status === 'started' || execution.status === 'completed' || execution.status === 'rerouted'
      ? 'ok'
      : 'unverifiable'
  const health = recordModelReceipt({
    harness: target.harness,
    model: target.model,
    outcome,
    latencyMs: Date.now() - startedAt,
  })
  return { ...execution, model: target.model, modelHealth: health }
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
  controller?: ControllerConfig,
  currentSession?: string,
  currentHarness?: string,
  inventoryOverride?: AgentInventory,
  requestedIdempotencyKey?: string,
): Promise<ControllerRunResult> {
  const candidateKey = requestedIdempotencyKey?.trim()
  const idempotencyKey = candidateKey && /^[A-Za-z0-9._:-]{1,128}$/.test(candidateKey) ? candidateKey : randomUUID()
  let inventory = inventoryOverride ?? discoverAgents(cwd, { stuckSession: signals.stuckSession, controller, currentSession, currentHarness })
  const handoff = buildHandoff(cwd, request, inventory.active, signals.stuckSession)
  const selection = await selectRoute(request, cwd, signals, inventory, handoff, override, controller)
  const initialExecutionStartedAt = Date.now()
  let execution: ControllerExecution = execute
    ? recordModelExecution(selection.target, executeSelection(selection, inventory, cwd, request, handoff, waitMs, idempotencyKey), initialExecutionStartedAt)
    : { status: 'not-started', idempotencyKey }

  if (execute && execution.status === 'failed' && execution.retryable === true && selection.action !== 'ASK' && selection.action !== 'ORCHESTRATE' && selection.decisionSource !== 'override') {
    const failedTargetIds = new Set<string>()
    let rerouteCount = 0
    while (execution.status === 'failed' && rerouteCount < MAX_REROUTES) {
      if (execution.targetId) failedTargetIds.add(`${execution.targetId}\0${execution.model ?? ''}`)
      const refreshed = discoverAgents(cwd, { stuckSession: signals.stuckSession, controller, currentSession, currentHarness, refresh: true })
      inventory = refreshed
      const fallback = fallbackTarget(refreshed, failedTargetIds, controller?.preferredHarnesses)
      if (!fallback) break
      const previousTargetId = execution.targetId
      const retryStartedAt = Date.now()
      const retry = fallback.kind === 'session'
        ? fallback.handle
          ? sessionExecution(fallback.handle, fallback.id, request, 'terminal-send', waitMs, handoff, fallback.worktree, idempotencyKey)
          : { status: 'failed' as const, targetId: fallback.id, operation: 'terminal-send' as const, retryable: true, idempotencyKey, receipt: receipt('failed'), error: 'target-session-handle-missing' }
        : executeSpawn(fallback, cwd, request, waitMs, idempotencyKey)
      const observedRetry = recordModelExecution(fallback, retry, retryStartedAt)
      rerouteCount += 1
      execution = {
        ...observedRetry,
        status: observedRetry.status === 'failed' ? 'failed' : 'rerouted',
        ...(previousTargetId ? { reroutedFrom: previousTargetId } : {}),
        rerouteCount,
      }
    }
  }

  const routing: ControllerRoutingTelemetry = {
    inventory: {
      orcaAvailable: inventory.orcaAvailable,
      worktreeCount: inventory.worktreeCount,
      sessionCount: inventory.existingSessions.length + (inventory.active.handle ? 1 : 0),
      harnessCount: inventory.spawnCandidates.length,
      activeSessionId: inventory.active.handle ? inventory.active.id : undefined,
      observedAt: inventory.observedAt,
      cached: inventory.cached,
    },
    validActions: selection.validActions,
    candidates: candidateTelemetry(inventory),
    decisionSource: selection.decisionSource,
    deterministicRule: selection.rule,
    jev: selection.jev,
  }
  return { selection, handoff, routing, execution }
}
