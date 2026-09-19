#!/usr/bin/env node
import { existsSync } from 'node:fs'
import path from 'node:path'
import { defaultConfigPath } from '@sabi/core'
import {
  controllerPreferencesPath,
  controllerStateDir,
  hasControllerPreferences,
  inspectControllerDaemon,
  requestControllerDaemon,
  runForegroundControllerDaemon,
  startControllerDaemon,
  stopControllerDaemon,
  writeControllerPreferences,
} from './daemon.ts'
import { configuredHarnesses } from './inventory.ts'
import { defaultControllerLogPath, readControllerDecisions } from './log.ts'
import { dispatchControllerRequest, inventorySnapshot } from './runtime.ts'
import { installHooks, runHookCommand, type InstalledHook } from './hooks.ts'
import type { ControllerDecisionRecord, ControllerOverride } from './types.ts'

type Command = 'route' | 'status' | 'agents' | 'doctor' | 'config' | 'logs' | 'setup' | 'daemon' | 'hooks' | 'hook'

const COMMANDS = new Set<Command>(['route', 'status', 'agents', 'doctor', 'config', 'logs', 'setup', 'daemon', 'hooks', 'hook'])

function flagValue(argv: string[], name: string): string | undefined {
  return argv.find((a) => a.startsWith(`${name}=`))?.slice(name.length + 1)
}

function commandAndArgs(argv: string[]): { command: Command; args: string[] } {
  const index = argv.findIndex((arg) => !arg.startsWith('--'))
  const candidate = index >= 0 ? argv[index] : undefined
  if (!candidate || !COMMANDS.has(candidate as Command)) return { command: 'route', args: argv }
  return { command: candidate as Command, args: argv.filter((_, position) => position !== index) }
}

function printStatus(snapshot: Record<string, unknown>, heading = 'Sabi status'): void {
  const orca = snapshot.orca as { available: boolean; errorCode?: string; worktreeCount: number }
  const active = snapshot.active as { agent: string; id: string; available: boolean; lifecycle?: string }
  const sessions = snapshot.sessions as Array<{ agent: string; id: string; available: boolean; lifecycle?: string }>
  const candidates = snapshot.spawnCandidates as Array<{ agent: string; available: boolean }>
  const runtime = snapshot.runtime as { mode: string; daemon: string }
  console.log(heading)
  console.log(`cwd: ${snapshot.cwd}`)
  console.log(`runtime: ${runtime.mode} (daemon ${runtime.daemon})`)
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
  sabi setup [--no-start] [--hooks] [--json]
  sabi daemon [--status|--stop|--foreground] [--json]
  sabi hooks install [--claude] [--codex] [--opencode] [--json]
  sabi hook <claude|codex> [--event=UserPromptSubmit]

The current CLI uses live Orca state when available. Run "sabi setup --hooks"
once to enable the daemon and install the verified host hooks.`)
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

  const request = requestText ?? ''
  let record: ControllerDecisionRecord | undefined
  const stateDir = controllerStateDir()
  if (!argv.includes('--local') && hasControllerPreferences(stateDir)) {
    try {
      const info = await startControllerDaemon({ stateDir })
      const remote = await requestControllerDaemon('/route', {
        info,
        method: 'POST',
        body: { request, cwd, orchestrate: orchestrateFlag, override, waitMs },
      })
      if (remote && typeof remote.action === 'string' && remote.execution !== null && typeof remote.execution === 'object') record = remote as unknown as ControllerDecisionRecord
    } catch {
      // The local path remains a safe fallback when the user daemon cannot start or answer.
    }
  }
  record ??= await dispatchControllerRequest({ request, cwd, orchestrate: orchestrateFlag, override, waitMs })

  if (asJson) {
    console.log(JSON.stringify(record, null, 2))
  } else {
    console.log(`[CONTROLLER] ${record.action} — ${record.rule}`)
    console.log(record.reason)
    console.log(`execution: ${record.execution?.status ?? 'unknown'}`)
  }

  if (record.execution?.status === 'failed') process.exitCode = 1
}

async function runStatus(command: 'status' | 'agents', argv: string[]): Promise<void> {
  const cwd = resolvedCwd(argv)
  const daemon = await inspectControllerDaemon()
  const remote = daemon.state === 'running' ? await requestControllerDaemon(`/status?cwd=${encodeURIComponent(cwd)}`, { info: daemon.info }) : undefined
  const snapshot = remote ?? inventorySnapshot(cwd, { mode: 'local-cli', daemon: daemon.state })
  if (jsonRequested(argv)) console.log(JSON.stringify(snapshot, null, 2))
  else printStatus(snapshot, command === 'agents' ? 'Sabi agents' : 'Sabi status')
}

async function runDoctor(argv: string[]): Promise<void> {
  const cwd = resolvedCwd(argv)
  const daemon = await inspectControllerDaemon()
  const snapshot = inventorySnapshot(cwd, { mode: 'local-cli', daemon: daemon.state })
  const nodeMajor = Number(process.versions.node.split('.')[0])
  const orca = snapshot.orca as { available: boolean; errorCode?: string }
  const candidates = snapshot.spawnCandidates as unknown[]
  const checks = [
    { name: 'node', ok: nodeMajor >= 22, detail: `${process.versions.node} (requires >=22)` },
    { name: 'daemon', ok: daemon.state === 'running', detail: daemon.state },
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

async function runSetup(argv: string[]): Promise<void> {
  const stateDir = controllerStateDir()
  const detected = configuredHarnesses()
  const hooks = argv.includes('--hooks') ? installHooks({ stateDir }) : undefined
  const preferencesPath = writeControllerPreferences({
    version: 1,
    autoRoute: true,
    decisionEngine: 'rules',
    integrations: Object.fromEntries(detected.map(({ agent }) => [agent, true])),
    hooks: hooks ? 'installed' : 'not-installed',
  }, stateDir)
  let daemon: Awaited<ReturnType<typeof inspectControllerDaemon>>
  if (argv.includes('--no-start')) daemon = await inspectControllerDaemon(stateDir)
  else {
    try {
      const info = await startControllerDaemon({ stateDir })
      daemon = { state: 'running', info }
    } catch (error) {
      throw new Error(`setup saved preferences but could not start the daemon: ${(error as Error).message}`)
    }
  }
  const result = {
    stateDir,
    preferencesPath,
    automaticRouting: true,
    daemon: daemon.state,
    decisionEngines: { rules: 'available', jev: process.env.TYPESAFE_API_KEY ? 'configured' : 'not-configured', laya: 'not-configured' },
    detectedHarnesses: detected.map(({ agent, command }) => ({ agent, command })),
    integrations: 'not-installed',
    hooks: hooks ? hooks.map(({ harness, path: file }) => ({ harness, path: file })) : 'not-installed',
  }
  if (jsonRequested(argv)) {
    console.log(JSON.stringify(result, null, 2))
    return
  }
  console.log('Sabi setup')
  console.log(`state: ${stateDir}`)
  console.log(`daemon: ${daemon.state}`)
  console.log('automatic routing: ON')
  console.log(`decision engines: rules ✓ · Jev ${result.decisionEngines.jev} · Laya not-configured`)
  console.log(`harnesses: ${detected.length ? detected.map(({ agent }) => `${agent} ✓`).join(' · ') : 'none detected'}`)
  console.log(hooks ? `hooks: installed — ${hooks.map(({ harness }) => harness).join(', ')}` : 'hooks: not installed — pass --hooks to install them')
  console.log(`preferences: ${preferencesPath}`)
}

async function runHooks(argv: string[]): Promise<void> {
  const action = argv.find((arg) => !arg.startsWith('--')) ?? 'install'
  if (action !== 'install') throw new Error(`unsupported hooks action '${action}'`)
  const selected = (['claude', 'codex', 'opencode'] as InstalledHook[]).filter((harness) => argv.includes(`--${harness}`))
  const installed = installHooks({ harnesses: selected.length ? selected : undefined })
  if (jsonRequested(argv)) {
    console.log(JSON.stringify({ installed }, null, 2))
    return
  }
  console.log('Sabi hooks')
  for (const result of installed) console.log(`✓ ${result.harness}: ${result.path}${result.plugin ? ` (plugin ${result.plugin})` : ''}`)
}

async function runHook(argv: string[]): Promise<void> {
  const harness = argv.find((arg) => !arg.startsWith('--'))
  if (harness !== 'claude' && harness !== 'codex') throw new Error('hook harness must be claude or codex')
  await runHookCommand(harness, flagValue(argv, '--event') ?? 'UserPromptSubmit')
}

async function runDaemon(argv: string[]): Promise<void> {
  const stateDir = controllerStateDir()
  if (argv.includes('--foreground')) {
    await runForegroundControllerDaemon({ stateDir })
    return
  }
  if (argv.includes('--stop')) {
    const stopped = await stopControllerDaemon(stateDir)
    const result = { stateDir, stopped }
    if (jsonRequested(argv)) console.log(JSON.stringify(result, null, 2))
    else console.log(stopped ? 'Sabi daemon stopped' : 'Sabi daemon was not running')
    return
  }
  if (argv.includes('--status')) {
    const result = { stateDir, ...(await inspectControllerDaemon(stateDir)) }
    if (jsonRequested(argv)) console.log(JSON.stringify(result, null, 2))
    else console.log(`Sabi daemon: ${result.state}`)
    return
  }
  try {
    const info = await startControllerDaemon({ stateDir })
    const result = { stateDir, state: 'running', info }
    if (jsonRequested(argv)) console.log(JSON.stringify(result, null, 2))
    else console.log(`Sabi daemon running on http://${info.host}:${info.port}`)
  } catch (error) {
    throw new Error(`could not start Sabi daemon: ${(error as Error).message}`)
  }
}

function runConfig(argv: string[]): void {
  const cwd = resolvedCwd(argv)
  const configPath = defaultConfigPath({ cwd })
  const stateDir = controllerStateDir()
  const result = {
    cwd,
    configPath,
    configExists: existsSync(configPath),
    controllerLogPath: defaultControllerLogPath(cwd),
    controllerStateDir: stateDir,
    controllerPreferencesPath: controllerPreferencesPath(stateDir),
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
  if (command === 'setup') return runSetup(args)
  if (command === 'daemon') return runDaemon(args)
  if (command === 'hooks') return runHooks(args)
  if (command === 'hook') return runHook(args)
  await runRoute(args)
}

void main().catch((error: unknown) => {
  console.error(`[SABI] failed — ${(error as Error).message}`)
  process.exitCode = 1
})
