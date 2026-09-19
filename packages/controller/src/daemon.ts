import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { createServer, request as httpRequest, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { inventorySnapshot, dispatchControllerRequest } from './runtime.ts'
import { heartbeatSession, recordSessionOutcome, registerSession } from './registry.ts'

const PROTOCOL = 1
const DEFAULT_PORT = 7433
const REQUEST_TIMEOUT_MS = 30_000
const BODY_LIMIT = 1_048_576

export interface ControllerDaemonInfo {
  protocol: 1
  pid: number
  host: string
  port: number
  startedAt: string
  stateDir: string
  token: string
}

export interface ControllerDaemon {
  info: ControllerDaemonInfo
  server: Server
  close(): Promise<void>
}

export type ControllerDaemonState = 'running' | 'stopped' | 'not-configured'

export interface ControllerDaemonStatus {
  state: ControllerDaemonState
  info?: ControllerDaemonInfo
}

interface DaemonOptions {
  stateDir?: string
  host?: string
  port?: number
}

interface DaemonRequestOptions {
  stateDir?: string
  info?: ControllerDaemonInfo
  method?: 'GET' | 'POST'
  body?: unknown
  timeoutMs?: number
}

function configuredNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed >= 0 && parsed <= 65_535 ? parsed : fallback
}

export function controllerStateDir(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = env.SABI_CONTROLLER_HOME?.trim()
  if (explicit) return path.resolve(explicit)
  if (process.platform === 'win32') {
    return path.join(env.LOCALAPPDATA?.trim() || path.join(os.homedir(), 'AppData', 'Local'), 'sabi')
  }
  const stateHome = env.XDG_STATE_HOME?.trim() || path.join(os.homedir(), '.local', 'state')
  return path.join(stateHome, 'sabi')
}

export function controllerPreferencesPath(stateDir = controllerStateDir()): string {
  return path.join(stateDir, 'controller.json')
}

export function daemonInfoPath(stateDir = controllerStateDir()): string {
  return path.join(stateDir, 'daemon.json')
}

export function hasControllerPreferences(stateDir = controllerStateDir()): boolean {
  return existsSync(controllerPreferencesPath(stateDir))
}

export function writeControllerPreferences(
  preferences: Record<string, unknown>,
  stateDir = controllerStateDir(),
): string {
  mkdirSync(stateDir, { recursive: true, mode: 0o700 })
  const file = controllerPreferencesPath(stateDir)
  writeFileSync(file, `${JSON.stringify(preferences, null, 2)}\n`, { mode: 0o600 })
  return file
}

export function readDaemonInfo(stateDir = controllerStateDir()): ControllerDaemonInfo | undefined {
  try {
    const parsed: unknown = JSON.parse(readFileSync(daemonInfoPath(stateDir), 'utf8'))
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined
    const value = parsed as Record<string, unknown>
    if (value.protocol !== PROTOCOL || typeof value.pid !== 'number' || !Number.isSafeInteger(value.pid) ||
        typeof value.host !== 'string' || typeof value.port !== 'number' || !Number.isSafeInteger(value.port) ||
        typeof value.startedAt !== 'string' || typeof value.stateDir !== 'string' || typeof value.token !== 'string' || value.token.length < 32) return undefined
    return {
      protocol: PROTOCOL,
      pid: value.pid,
      host: value.host,
      port: value.port,
      startedAt: value.startedAt,
      stateDir: value.stateDir,
      token: value.token,
    }
  } catch {
    return undefined
  }
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(body)
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > BODY_LIMIT) throw new Error('request body too large')
    chunks.push(buffer)
  }
  if (!chunks.length) return {}
  const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('request body must be a JSON object')
  return parsed as Record<string, unknown>
}

function safeCwd(value: unknown): string {
  return typeof value === 'string' && value.trim() ? path.resolve(value) : process.cwd()
}

function controllerOverride(value: unknown): { sessionId?: string; harness?: string } | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  const object = value as Record<string, unknown>
  const sessionId = typeof object.sessionId === 'string' && object.sessionId.trim() ? object.sessionId.trim() : undefined
  const harness = typeof object.harness === 'string' && object.harness.trim() ? object.harness.trim() : undefined
  return sessionId || harness ? { ...(sessionId ? { sessionId } : {}), ...(harness ? { harness } : {}) } : undefined
}

async function handleRequest(req: IncomingMessage, res: ServerResponse, info: ControllerDaemonInfo): Promise<void> {
  const url = new URL(req.url ?? '/', `http://${info.host}:${info.port}`)
  try {
    if (req.headers.authorization !== `Bearer ${info.token}`) {
      sendJson(res, 401, { error: 'unauthorized' })
      return
    }
    if (req.method === 'GET' && url.pathname === '/health') {
      sendJson(res, 200, { ok: true, service: 'sabi-controller', protocol: PROTOCOL, pid: info.pid, startedAt: info.startedAt })
      return
    }
    if (req.method === 'GET' && url.pathname === '/status') {
      sendJson(res, 200, inventorySnapshot(safeCwd(url.searchParams.get('cwd')), { mode: 'daemon', daemon: 'running' }))
      return
    }
    if (req.method === 'POST' && (url.pathname === '/route' || url.pathname === '/plan')) {
      const body = await readJson(req)
      const request = typeof body.request === 'string' ? body.request : ''
      const waitMs = typeof body.waitMs === 'number' ? body.waitMs : undefined
      const record = await dispatchControllerRequest({
        request,
        cwd: safeCwd(body.cwd),
        orchestrate: body.orchestrate === true,
        override: controllerOverride(body.override),
        waitMs,
        execute: url.pathname === '/route',
      })
      sendJson(res, 200, record)
      return
    }
    if (req.method === 'POST' && url.pathname === '/v1/sessions/register') {
      const body = await readJson(req)
      sendJson(res, 200, { ok: true, session: registerSession(info.stateDir, body) })
      return
    }
    if (req.method === 'POST' && url.pathname === '/v1/sessions/heartbeat') {
      const body = await readJson(req)
      sendJson(res, 200, { ok: true, session: heartbeatSession(info.stateDir, body) })
      return
    }
    if (req.method === 'POST' && url.pathname === '/v1/sessions/outcome') {
      const body = await readJson(req)
      const outcome = body.outcome
      if (outcome !== 'started' && outcome !== 'completed' && outcome !== 'failed' && outcome !== 'unverifiable') {
        throw new Error('outcome must be started, completed, failed or unverifiable')
      }
      sendJson(res, 200, { ok: true, session: recordSessionOutcome(info.stateDir, { ...body, outcome }) })
      return
    }
    sendJson(res, 404, { error: 'not found' })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'daemon request failed'
    sendJson(res, 400, { error: message.slice(0, 300) })
  }
}

export async function createControllerDaemon(options: DaemonOptions = {}): Promise<ControllerDaemon> {
  const stateDir = path.resolve(options.stateDir ?? controllerStateDir())
  const host = options.host ?? process.env.SABI_CONTROLLER_HOST?.trim() ?? '127.0.0.1'
  const requestedPort = options.port ?? configuredNumber(process.env.SABI_CONTROLLER_PORT, DEFAULT_PORT)
  mkdirSync(stateDir, { recursive: true, mode: 0o700 })

  // ponytail: keep the authenticated IPC loopback-only; add a Unix socket only when cross-platform
  // client support no longer needs the current TCP transport.
  let info: ControllerDaemonInfo | undefined
  const server = createServer((req, res) => {
    if (!info) {
      sendJson(res, 503, { error: 'daemon is starting' })
      return
    }
    void handleRequest(req, res, info).catch(() => {
      if (!res.headersSent) sendJson(res, 500, { error: 'daemon request failed' })
      else res.destroy()
    })
  })
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error): void => {
      server.off('listening', onListening)
      reject(error)
    }
    const onListening = (): void => {
      server.off('error', onError)
      resolve()
    }
    server.once('error', onError)
    server.once('listening', onListening)
    server.listen(requestedPort, host)
  })
  const address = server.address()
  if (address === null || typeof address === 'string') {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    throw new Error('daemon did not receive a TCP address')
  }
  info = {
    protocol: PROTOCOL,
    pid: process.pid,
    host,
    port: address.port,
    startedAt: new Date().toISOString(),
    stateDir,
    token: randomBytes(32).toString('hex'),
  }
  writeFileSync(daemonInfoPath(stateDir), `${JSON.stringify(info, null, 2)}\n`, { mode: 0o600 })
  let closed = false
  return {
    info,
    server,
    close: async () => {
      if (closed) return
      closed = true
      const current = readDaemonInfo(stateDir)
      if (current?.pid === info?.pid) {
        try { unlinkSync(daemonInfoPath(stateDir)) } catch { /* already removed */ }
      }
      if (!server.listening) return
      await new Promise<void>((resolve) => server.close(() => resolve()))
    },
  }
}

export async function runForegroundControllerDaemon(options: DaemonOptions = {}): Promise<void> {
  const daemon = await createControllerDaemon(options)
  console.log(`Sabi controller daemon listening on http://${daemon.info.host}:${daemon.info.port}`)
  console.log(`  state: ${daemon.info.stateDir}`)
  await new Promise<void>((resolve) => {
    let shuttingDown = false
    const shutdown = (): void => {
      if (shuttingDown) return
      shuttingDown = true
      void daemon.close().then(resolve)
    }
    process.once('SIGINT', shutdown)
    process.once('SIGTERM', shutdown)
  })
}

export async function requestControllerDaemon(
  pathname: string,
  options: DaemonRequestOptions = {},
): Promise<Record<string, unknown> | undefined> {
  const info = options.info ?? readDaemonInfo(options.stateDir)
  if (!info) return undefined
  const method = options.method ?? 'GET'
  const body = options.body === undefined ? undefined : JSON.stringify(options.body)
  const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS
  return await new Promise((resolve) => {
    const request = httpRequest({
      host: info.host,
      port: info.port,
      path: pathname,
      method,
      timeout: timeoutMs,
      headers: {
        authorization: `Bearer ${info.token}`,
        ...(body === undefined ? {} : {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(body),
        }),
      },
    }, (response) => {
      const chunks: Buffer[] = []
      response.on('data', (chunk: Buffer) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
      response.on('end', () => {
        try {
          const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
          resolve(parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : undefined)
        } catch {
          resolve(undefined)
        }
      })
      response.on('error', () => resolve(undefined))
    })
    request.on('error', () => resolve(undefined))
    request.on('timeout', () => request.destroy())
    if (body !== undefined) request.write(body)
    request.end()
  })
}

export async function inspectControllerDaemon(stateDir = controllerStateDir()): Promise<ControllerDaemonStatus> {
  const info = readDaemonInfo(stateDir)
  if (!info) return { state: hasControllerPreferences(stateDir) ? 'stopped' : 'not-configured' }
  const health = await requestControllerDaemon('/health', { info, timeoutMs: 1000 })
  return health?.ok === true && health.service === 'sabi-controller' && health.pid === info.pid
    ? { state: 'running', info }
    : { state: 'stopped', info }
}

export async function startControllerDaemon(options: DaemonOptions & { entrypoint?: string; waitMs?: number } = {}): Promise<ControllerDaemonInfo> {
  const stateDir = path.resolve(options.stateDir ?? controllerStateDir())
  const current = await inspectControllerDaemon(stateDir)
  if (current.state === 'running' && current.info) return current.info
  try { unlinkSync(daemonInfoPath(stateDir)) } catch { /* stale or absent */ }
  const entrypoint = options.entrypoint ?? process.argv[1]
  if (!entrypoint) throw new Error('cannot start the daemon without a CLI entrypoint')
  const host = options.host ?? process.env.SABI_CONTROLLER_HOST?.trim() ?? '127.0.0.1'
  const port = options.port ?? configuredNumber(process.env.SABI_CONTROLLER_PORT, DEFAULT_PORT)
  const child = spawn(process.execPath, [path.resolve(entrypoint), 'daemon', '--foreground'], {
    detached: true,
    stdio: 'ignore',
    env: {
      ...process.env,
      SABI_CONTROLLER_HOME: stateDir,
      SABI_CONTROLLER_HOST: host,
      SABI_CONTROLLER_PORT: String(port),
    },
  })
  child.unref()
  const deadline = Date.now() + (options.waitMs ?? 5000)
  while (Date.now() < deadline) {
    const info = readDaemonInfo(stateDir)
    const health = info ? await requestControllerDaemon('/health', { info, timeoutMs: 500 }) : undefined
    if (info && health?.ok === true && health.service === 'sabi-controller' && health.pid === info.pid) return info
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(`Sabi daemon did not become healthy in ${options.waitMs ?? 5000}ms`)
}

export async function stopControllerDaemon(stateDir = controllerStateDir(), waitMs = 3000): Promise<boolean> {
  const info = readDaemonInfo(stateDir)
  if (!info) return false
  const health = await requestControllerDaemon('/health', { info, timeoutMs: 500 })
  if (health?.ok !== true || health.pid !== info.pid) {
    if (health === undefined) {
      try { unlinkSync(daemonInfoPath(stateDir)) } catch { /* already removed */ }
      return true
    }
    return false
  }
  try { process.kill(info.pid, 'SIGTERM') } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
  }
  const deadline = Date.now() + waitMs
  while (Date.now() < deadline) {
    if ((await requestControllerDaemon('/health', { info, timeoutMs: 200 })) === undefined) {
      try { unlinkSync(daemonInfoPath(stateDir)) } catch { /* already removed */ }
      return true
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  return false
}
