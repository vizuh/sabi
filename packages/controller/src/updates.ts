import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { defaultConfigPath, loadConfig } from '@sabi/core'
import { controllerStateDir } from './daemon.ts'
import { checkHookHealth } from './hooks.ts'

export const SABI_PACKAGE_NAME = '@vizuh/sabi-controller'
export const UPDATE_INTERVAL_MS = 24 * 60 * 60 * 1_000
export const UPDATE_WARNING = 'Updating Sabi can change controller hooks, adapter contracts, config handling and local project logic; run `sabi updates --check` before `sabi upgrade`.'
const REGISTRY_URL = `https://registry.npmjs.org/${encodeURIComponent(SABI_PACKAGE_NAME)}/latest`
const CACHE_FILE = 'update-check.json'
const FETCH_TIMEOUT_MS = 5_000

type FetchLike = typeof fetch

type CachedUpdate = {
  packageName: string
  installedVersion: string
  latestVersion?: string
  status: 'up-to-date' | 'update-available' | 'unavailable'
  checkedAt: number
  nextCheckAt: number
  error?: string
}

export interface CompatibilityCheck {
  name: string
  ok: boolean
  detail: string
}

export interface UpdateCheckResult extends CachedUpdate {
  cached: boolean
  warning?: string
  compatibility?: {
    ok: boolean
    checks: CompatibilityCheck[]
  }
}

function versionParts(value: string): [number, number, number] | undefined {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+][0-9A-Za-z.-]+)?$/.exec(value.trim())
  if (!match) return undefined
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

function compareVersions(left: string, right: string): number {
  const a = versionParts(left)
  const b = versionParts(right)
  if (!a || !b) return 0
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return a[index] > b[index] ? 1 : -1
  }
  return 0
}

function cachePath(stateDir: string): string {
  return path.join(stateDir, CACHE_FILE)
}

function readCache(stateDir: string): CachedUpdate | undefined {
  try {
    const value = JSON.parse(readFileSync(cachePath(stateDir), 'utf8')) as Partial<CachedUpdate>
    if (value.packageName !== SABI_PACKAGE_NAME || typeof value.installedVersion !== 'string' ||
        typeof value.status !== 'string' || !['up-to-date', 'update-available', 'unavailable'].includes(value.status) ||
        !Number.isSafeInteger(value.checkedAt) || !Number.isSafeInteger(value.nextCheckAt)) return undefined
    return value as CachedUpdate
  } catch {
    return undefined
  }
}

function writeCache(stateDir: string, value: CachedUpdate): void {
  mkdirSync(stateDir, { recursive: true, mode: 0o700 })
  const temporary = `${cachePath(stateDir)}.tmp-${process.pid}`
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
  renameSync(temporary, cachePath(stateDir))
}

async function fetchLatest(fetchImpl: FetchLike): Promise<string> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const response = await fetchImpl(REGISTRY_URL, {
      headers: { accept: 'application/json' },
      signal: controller.signal,
    })
    if (!response.ok) throw new Error(`npm registry returned HTTP ${response.status}`)
    const payload = await response.json() as { version?: unknown }
    if (typeof payload.version !== 'string' || !versionParts(payload.version)) {
      throw new Error('npm registry returned an invalid latest version')
    }
    return payload.version
  } finally {
    clearTimeout(timeout)
  }
}

export function quickCompatibilityChecks(options: {
  cwd?: string
  env?: NodeJS.ProcessEnv
} = {}): { ok: boolean; checks: CompatibilityCheck[] } {
  const env = options.env ?? process.env
  const cwd = path.resolve(options.cwd ?? process.cwd())
  const nodeMajor = Number(process.versions.node.split('.')[0])
  const checks: CompatibilityCheck[] = [
    {
      name: 'node',
      ok: nodeMajor >= 22,
      detail: `${process.versions.node} (requires >=22)`,
    },
  ]

  const configPath = defaultConfigPath({ cwd, env })
  if (existsSync(configPath)) {
    try {
      loadConfig(configPath)
      checks.push({ name: 'config', ok: true, detail: configPath })
    } catch (error) {
      checks.push({ name: 'config', ok: false, detail: error instanceof Error ? error.message : 'invalid config' })
    }
  } else {
    checks.push({ name: 'config', ok: true, detail: 'not configured in this project' })
  }

  const hooks = checkHookHealth({ env })
  const staleHooks = hooks.filter(({ stale }) => stale)
  checks.push({
    name: 'hooks',
    ok: staleHooks.length === 0,
    detail: staleHooks.length ? staleHooks.map(({ harness, detail }) => `${harness} (${detail})`).join('; ') : 'no stale Sabi hooks',
  })

  return { ok: checks.every(({ ok }) => ok), checks }
}

export async function checkForUpdate(options: {
  env?: NodeJS.ProcessEnv
  stateDir?: string
  installedVersion?: string
  now?: number
  force?: boolean
  cwd?: string
  includeCompatibility?: boolean
  fetchImpl?: FetchLike
} = {}): Promise<UpdateCheckResult> {
  const env = options.env ?? process.env
  const now = options.now ?? Date.now()
  const stateDir = options.stateDir ?? controllerStateDir(env)
  const installedVersion = options.installedVersion ?? process.env.SABI_BUILD_VERSION ?? '0.0.0-dev'
  const cached = readCache(stateDir)
  let update: CachedUpdate

  if (!options.force && cached && cached.installedVersion === installedVersion && now < cached.nextCheckAt) {
    update = cached
  } else {
    try {
      const latestVersion = await fetchLatest(options.fetchImpl ?? fetch)
      update = {
        packageName: SABI_PACKAGE_NAME,
        installedVersion,
        latestVersion,
        status: compareVersions(latestVersion, installedVersion) > 0 ? 'update-available' : 'up-to-date',
        checkedAt: now,
        nextCheckAt: now + UPDATE_INTERVAL_MS,
      }
    } catch (error) {
      update = {
        packageName: SABI_PACKAGE_NAME,
        installedVersion,
        status: 'unavailable',
        checkedAt: now,
        nextCheckAt: now + UPDATE_INTERVAL_MS,
        error: error instanceof Error ? error.message : 'npm registry check failed',
      }
    }
    writeCache(stateDir, update)
  }

  const compatibility = options.includeCompatibility === false ? undefined : quickCompatibilityChecks({ cwd: options.cwd, env })
  return {
    ...update,
    cached: update === cached,
    ...(update.status === 'update-available' ? { warning: UPDATE_WARNING } : {}),
    ...(compatibility ? { compatibility } : {}),
  }
}

export function updateCachePath(env: NodeJS.ProcessEnv = process.env): string {
  return cachePath(controllerStateDir(env))
}

export function updateHomeDir(): string {
  return os.homedir()
}
