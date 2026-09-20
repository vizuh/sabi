import path from 'node:path'
import { defaultConfigPath, loadConfig } from '@sabi/core'
import { appendControllerDecision, defaultControllerLogPath } from './log.ts'
import { runController } from './controller.ts'
import { gatherSignals, stuckSessionSignal } from './signals.ts'
import { discoverAgents } from './inventory.ts'
import type { AgentHarness, AgentSession, ControllerDecisionRecord, ControllerOverride } from './types.ts'

export interface RouteDispatchOptions {
  request: string
  cwd: string
  currentSession?: string
  currentHarness?: string
  orchestrate?: boolean
  override?: ControllerOverride
  waitMs?: number
  execute?: boolean
  idempotencyKey?: string
}

export interface InventoryRuntime {
  mode: 'local-cli' | 'daemon'
  daemon: 'running' | 'stopped' | 'not-configured'
}

function summarizeAgent(agent: AgentSession | AgentHarness): Record<string, unknown> {
  return {
    id: agent.id,
    agent: agent.agent,
    harness: agent.harness,
    available: agent.available,
    capacity: agent.capacity,
    worktree: agent.worktree,
    branch: agent.branch,
    context: agent.context,
    model: agent.model,
    ...(agent.kind === 'harness' && agent.catalog ? { catalog: agent.catalog } : {}),
    ...(agent.kind === 'session' ? { dispatchable: agent.dispatchable } : {}),
    ...(agent.kind === 'session'
      ? { kind: agent.kind, handle: agent.handle, lifecycle: agent.lifecycle, authenticated: agent.authenticated }
      : { kind: agent.kind, command: agent.command, launchCommand: agent.launchCommand }),
  }
}

function controllerConfigFor(cwd: string) {
  try {
    return loadConfig(defaultConfigPath({ cwd })).controller
  } catch {
    return undefined
  }
}

export function inventorySnapshot(cwd: string, runtime: InventoryRuntime): Record<string, unknown> {
  const inventory = discoverAgents(cwd, { controller: controllerConfigFor(cwd) })
  return {
    cwd,
    runtime,
    orca: {
      available: inventory.orcaAvailable,
      ...(inventory.errorCode ? { errorCode: inventory.errorCode } : {}),
      worktreeCount: inventory.worktreeCount,
      observedAt: inventory.observedAt,
      cached: inventory.cached,
      matchingWorktree: inventory.matchingWorktree,
      matchingTerminal: inventory.matchingTerminal,
    },
    active: summarizeAgent(inventory.active),
    sessions: inventory.existingSessions.map(summarizeAgent),
    spawnCandidates: inventory.spawnCandidates.map(summarizeAgent),
  }
}

async function dispatchControllerRequestOnce(options: RouteDispatchOptions): Promise<ControllerDecisionRecord> {
  const cwd = path.resolve(options.cwd)
  const request = options.request
  const orchestrate = options.orchestrate ?? false
  const waitMs = options.waitMs ?? 5000
  const controller = controllerConfigFor(cwd)
  const startedAt = Date.now()
  const sampledStuck = stuckSessionSignal(cwd)
  const inventory = discoverAgents(cwd, {
    stuckSession: sampledStuck.stuck,
    controller,
    currentSession: options.currentSession,
    currentHarness: options.currentHarness,
  })
  const signals = gatherSignals(cwd, request, orchestrate, inventory, sampledStuck)
  const result = await runController(
    request,
    cwd,
    signals,
    options.override,
    Number.isFinite(waitMs) && waitMs >= 0 ? waitMs : 5000,
    options.execute !== false,
    controller,
    options.currentSession,
    options.currentHarness,
    inventory,
    options.idempotencyKey,
  )
  const execution = { ...result.execution, durationMs: Math.max(0, Date.now() - startedAt) }
  const record: ControllerDecisionRecord = {
    traceVersion: 1,
    action: result.selection.action,
    rule: result.selection.rule,
    reason: result.selection.reason,
    ts: new Date().toISOString(),
    cwd,
    signals,
    ...(request ? { request } : {}),
    ...(execution.idempotencyKey ? { idempotencyKey: execution.idempotencyKey } : {}),
    ...(options.override ? { override: options.override } : {}),
    handoff: result.handoff,
    target: result.selection.target,
    routing: result.routing,
    execution,
  }
  appendControllerDecision(record, defaultControllerLogPath(cwd))
  return record
}

// ponytail: process-local receipt cache; add durable cross-process receipts when multiple daemon workers exist.
const completedRouteReceipts = new Map<string, ControllerDecisionRecord>()
const inFlightRouteReceipts = new Map<string, Promise<ControllerDecisionRecord>>()

export async function dispatchControllerRequest(options: RouteDispatchOptions): Promise<ControllerDecisionRecord> {
  const candidateKey = options.idempotencyKey?.trim()
  const key = options.execute === false || !candidateKey || !/^[A-Za-z0-9._:-]{1,128}$/.test(candidateKey)
    ? undefined
    : `${path.resolve(options.cwd)}\0${candidateKey}`
  if (!key) return dispatchControllerRequestOnce(options)
  const completed = completedRouteReceipts.get(key)
  if (completed) return completed
  const inFlight = inFlightRouteReceipts.get(key)
  if (inFlight) return inFlight
  const promise = dispatchControllerRequestOnce(options).then((record) => {
    completedRouteReceipts.set(key, record)
    while (completedRouteReceipts.size > 128) {
      const oldest = completedRouteReceipts.keys().next().value
      if (oldest === undefined) break
      completedRouteReceipts.delete(oldest)
    }
    return record
  }).finally(() => {
    inFlightRouteReceipts.delete(key)
  })
  inFlightRouteReceipts.set(key, promise)
  return promise
}
