#!/usr/bin/env node
import { existsSync } from 'node:fs'
import path from 'node:path'
import { defaultConfigPath } from '@sabi/core'
import { runController } from './controller.ts'
import { discoverAgents } from './inventory.ts'
import { appendControllerDecision, defaultControllerLogPath, readControllerDecisions } from './log.ts'
import { gatherSignals } from './signals.ts'
import type { AgentHarness, AgentSession, ControllerDecisionRecord, ControllerOverride } from './types.ts'

type Command = 'route' | 'status' | 'agents' | 'doctor' | 'config' | 'logs'

const COMMANDS = new Set<Command>(['route', 'status', 'agents', 'doctor', 'config', 'logs'])

function flagValue(argv: string[], name: string): string | undefined {
  return argv.find((a) => a.startsWith(`${name}=`))?.slice(name.length + 1)
}

function commandAndArgs(argv: string[]): { command: Command; args: string[] } {
  const index = argv.findIndex((arg) => !arg.startsWith('--'))
  const candidate = index >= 0 ? argv[index] : undefined
  if (!candidate || !COMMANDS.has(candidate as Command)) return { command: 'route', args: argv }
  return { command: candidate as Command, args: argv.filter((_, position) => position !== index) }
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

function inventorySnapshot(cwd: string): Record<string, unknown> {
  const inventory = discoverAgents(cwd)
  return {
    cwd,
    runtime: { mode: 'local-cli', daemon: 'not-configured' },
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

function printStatus(snapshot: Record<string, unknown>, heading = 'Sabi status'): void {
  const orca = snapshot.orca as { available: boolean; errorCode?: string; worktreeCount: number }
  const active = snapshot.active as { agent: string; id: string; available: boolean; lifecycle?: string }
  const sessions = snapshot.sessions as Array<{ agent: string; id: string; available: boolean; lifecycle?: string }>
  const candidates = snapshot.spawnCandidates as Array<{ agent: string; available: boolean }>
  console.log(heading)
  console.log(`cwd: ${snapshot.cwd}`)
  console.log('runtime: local CLI (daemon not configured)')
  console.log(`Orca: ${orca.available ? 'available' : `unavailable${orca.errorCode ? ` (${orca.errorCode})` : ''}`} · worktrees ${orca.worktreeCount}`)
  console.log(`active: ${active.agent} · ${active.id} · ${active.available ? active.lifecycle ?? 'available' : 'unavailable'}`)
  console.log(`sessions: ${sessions.length ? sessions.map((session) => `${session.agent}=${session.available ? session.lifecycle ?? 'available' : 'unavailable'}`).join(', ') : 'none'}`)
  console.log(`spawn candidates: ${candidates.length ? candidates.map((candidate) => `${candidate.agent}${candidate.available ? '' : ' (unavailable)'}`).join(', ') : 'none'}`)
}

function printHelp(): void {
  console.log(`Usage:
  sabi route "<request>" [--cwd=<path>] [--json]
  sabi status [--cwd=<path>] [--json]
  sabi agents [--cwd=<path>] [--json]
  sabi doctor [--cwd=<path>] [--json]
  sabi config [--cwd=<path>] [--json]
  sabi logs [--cwd=<path>] [--tail=<n>] [--json]

The current CLI uses live Orca state when available. A user daemon and automatic
harness hooks are not installed by this package yet.`)
}

function resolvedCwd(argv: string[]): string {
  return path.resolve(flagValue(argv, '--cwd') ?? process.cwd())
}

function jsonRequested(argv: string[]): boolean {
  return argv.includes('--json')
}

async function runRoute(argv: string[]): Promise<void> {
  const cwd = resolvedCwd(argv)
  const orchestrateFlag = argv.includes('--orchestrate')
  const asJson = jsonRequested(argv)
  const waitMs = Number(flagValue(argv, '--wait-ms') ?? 5000)
  const override: ControllerOverride | undefined = (() => {
    const sessionId = flagValue(argv, '--session')
    const harness = flagValue(argv, '--harness') ?? flagValue(argv, '--agent')
    return sessionId || harness ? { ...(sessionId ? { sessionId } : {}), ...(harness ? { harness } : {}) } : undefined
  })()
  // Join every non-flag token instead of taking just the first — the documented invocation is a
  // quoted string, but an unquoted multi-word request must not silently truncate to its first word.
  const requestParts = argv.filter((a) => !a.startsWith('--'))
  const requestText = requestParts.length > 0 ? requestParts.join(' ') : undefined

  const signals = gatherSignals(cwd, requestText, orchestrateFlag)
  const result = await runController(requestText ?? '', cwd, signals, override, Number.isFinite(waitMs) && waitMs >= 0 ? waitMs : 5000)
  const record: ControllerDecisionRecord = {
    action: result.selection.action,
    rule: result.selection.rule,
    reason: result.selection.reason,
    ts: new Date().toISOString(),
    cwd,
    signals,
    ...(requestText ? { request: requestText } : {}),
    ...(override ? { override } : {}),
    handoff: result.handoff,
    target: result.selection.target,
    routing: result.routing,
    execution: result.execution,
  }
  appendControllerDecision(record, defaultControllerLogPath(cwd))

  if (asJson) {
    console.log(JSON.stringify(record, null, 2))
  } else {
    console.log(`[CONTROLLER] ${record.action} — ${record.rule}`)
    console.log(record.reason)
    console.log(`execution: ${record.execution?.status ?? 'unknown'}`)
  }

  if (result.execution.status === 'failed') process.exitCode = 1
}

function runStatus(command: 'status' | 'agents', argv: string[]): void {
  const snapshot = inventorySnapshot(resolvedCwd(argv))
  if (jsonRequested(argv)) console.log(JSON.stringify(snapshot, null, 2))
  else printStatus(snapshot, command === 'agents' ? 'Sabi agents' : 'Sabi status')
}

function runDoctor(argv: string[]): void {
  const cwd = resolvedCwd(argv)
  const snapshot = inventorySnapshot(cwd)
  const nodeMajor = Number(process.versions.node.split('.')[0])
  const orca = snapshot.orca as { available: boolean; errorCode?: string }
  const candidates = snapshot.spawnCandidates as unknown[]
  const checks = [
    { name: 'node', ok: nodeMajor >= 22, detail: `${process.versions.node} (requires >=22)` },
    { name: 'orca', ok: orca.available, detail: orca.available ? 'live inventory available' : orca.errorCode ?? 'unavailable' },
    { name: 'harness inventory', ok: candidates.length > 0, detail: candidates.length ? `${candidates.length} spawn candidate(s)` : 'requires a healthy Orca inventory' },
  ]
  const result = { cwd, runtime: snapshot.runtime, checks }
  if (jsonRequested(argv)) console.log(JSON.stringify(result, null, 2))
  else {
    console.log('Sabi doctor')
    console.log(`cwd: ${cwd}`)
    for (const check of checks) console.log(`${check.ok ? '✓' : '○'} ${check.name}: ${check.detail}`)
  }
}

function runConfig(argv: string[]): void {
  const cwd = resolvedCwd(argv)
  const configPath = defaultConfigPath({ cwd })
  const result = {
    cwd,
    configPath,
    configExists: existsSync(configPath),
    controllerLogPath: defaultControllerLogPath(cwd),
  }
  if (jsonRequested(argv)) console.log(JSON.stringify(result, null, 2))
  else {
    console.log(`Sabi config: ${result.configExists ? 'found' : 'not found'}`)
    console.log(`config: ${configPath}`)
    console.log(`controller log: ${result.controllerLogPath}`)
  }
}

function runLogs(argv: string[]): void {
  const cwd = resolvedCwd(argv)
  const requestedTail = Number(flagValue(argv, '--tail') ?? 20)
  const limit = Number.isFinite(requestedTail) && requestedTail >= 0 ? Math.floor(requestedTail) : 20
  const logFile = defaultControllerLogPath(cwd)
  const records = readControllerDecisions(logFile).slice(-limit)
  if (jsonRequested(argv)) {
    console.log(JSON.stringify({ logFile, records }, null, 2))
    return
  }
  console.log(`Sabi logs: ${logFile}`)
  if (!records.length) {
    console.log('no controller decisions recorded')
    return
  }
  for (const record of records) console.log(`${record.ts} ${record.action} ${record.request ?? '(no request)'}`)
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  if (argv.includes('--help') || argv.includes('-h')) {
    printHelp()
    return
  }
  const { command, args } = commandAndArgs(argv)
  if (command === 'status' || command === 'agents') return runStatus(command, args)
  if (command === 'doctor') return runDoctor(args)
  if (command === 'config') return runConfig(args)
  if (command === 'logs') return runLogs(args)
  await runRoute(args)
}

void main().catch((error: unknown) => {
  console.error(`[SABI] failed — ${(error as Error).message}`)
  process.exitCode = 1
})
