import path from 'node:path'
import { appendControllerDecision, defaultControllerLogPath } from './log.ts'
import { runController } from './controller.ts'
import { gatherSignals } from './signals.ts'
import { discoverAgents } from './inventory.ts'
import type { AgentHarness, AgentSession, ControllerDecisionRecord, ControllerOverride } from './types.ts'

export interface RouteDispatchOptions {
  request: string
  cwd: string
  orchestrate?: boolean
  override?: ControllerOverride
  waitMs?: number
  execute?: boolean
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
    ...(agent.kind === 'session'
      ? { kind: agent.kind, handle: agent.handle, lifecycle: agent.lifecycle, authenticated: agent.authenticated }
      : { kind: agent.kind, command: agent.command }),
  }
}

export function inventorySnapshot(cwd: string, runtime: InventoryRuntime): Record<string, unknown> {
  const inventory = discoverAgents(cwd)
  return {
    cwd,
    runtime,
    orca: {
      available: inventory.orcaAvailable,
      ...(inventory.errorCode ? { errorCode: inventory.errorCode } : {}),
      worktreeCount: inventory.worktreeCount,
    },
    active: summarizeAgent(inventory.active),
    sessions: inventory.existingSessions.map(summarizeAgent),
    spawnCandidates: inventory.spawnCandidates.map(summarizeAgent),
  }
}

export async function dispatchControllerRequest(options: RouteDispatchOptions): Promise<ControllerDecisionRecord> {
  const cwd = path.resolve(options.cwd)
  const request = options.request
  const orchestrate = options.orchestrate ?? false
  const waitMs = options.waitMs ?? 5000
  const signals = gatherSignals(cwd, request, orchestrate)
  const result = await runController(
    request,
    cwd,
    signals,
    options.override,
    Number.isFinite(waitMs) && waitMs >= 0 ? waitMs : 5000,
    options.execute !== false,
  )
  const record: ControllerDecisionRecord = {
    action: result.selection.action,
    rule: result.selection.rule,
    reason: result.selection.reason,
    ts: new Date().toISOString(),
    cwd,
    signals,
    ...(request ? { request } : {}),
    ...(options.override ? { override: options.override } : {}),
    handoff: result.handoff,
    target: result.selection.target,
    routing: result.routing,
    execution: result.execution,
  }
  appendControllerDecision(record, defaultControllerLogPath(cwd))
  return record
}
