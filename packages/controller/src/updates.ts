import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { defaultConfigPath, loadConfig } from '@sabi/core'
import { controllerStateDir } from './daemon.ts'
import { checkHookHealth } from './hooks.ts'

/** The package that ships the `sabi` binary — the thing a user is actually running. */
export const SABI_PACKAGE_NAME = '@vizuh/sabi-controller'
/** One registry check per day: cheap enough for an agent to call on every session. */
export const UPDATE_INTERVAL_MS = 24 * 60 * 60 * 1_000
export const UPDATE_WARNING =
  'upgrading Sabi can change hook wiring, adapter contracts, config handling and local project logic — re-run `sabi doctor` and `sabi hooks install` after an upgrade'
const REGISTRY_ORIGIN = 'https://registry.npmjs.org'
const CACHE_FILE = 'update-check.json'
const FETCH_TIMEOUT_MS = 5_000
/** packages/controller/pkg/package.json declares `engines.node: >=22.6`. */
const MINIMUM_NODE = { major: 22, minor: 6 }

export type UpdateStatus = 'up-to-date' | 'update-available' | 'unavailable'

export interface CachedUpdate {
  packageName: string
  installedVersion: string
  latestVersion?: string
  status: UpdateStatus
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
  /** The cached answer is past its window, so `--check` would tell you something new. */
  stale: boolean
  warning?: string
  compatibility: { ok: boolean; checks: CompatibilityCheck[] }
}

type FetchLike = typeof fetch

export interface UpdateCheckOptions {
  env?: NodeJS.ProcessEnv
  stateDir?: string
  installedVersion?: string
  now?: number
  cwd?: string
  /**
   * `true` contacts the npm registry and rewrites the cache. `false` (the default) only reads
   * the cache: a plain `sabi updates` must never surprise a user with outbound traffic.
   */
  refresh?: boolean
  fetchImpl?: FetchLike
}

function versionParts(value: string): [number, number, number] | undefined {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+][0-9A-Za-z.-]+)?$/.exec(value.trim())
  if (!match) return undefined
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

/** Registry-order comparison of two release triples; unparseable versions compare equal. */
function compareVersions(left: string, right: string): number {
  const a = versionParts(left)
  const b = versionParts(right)
  if (!a || !b) return 0
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return a[index] > b[index] ? 1 : -1
  }
  return 0
}

/** Scoped names must be percent-encoded: `%40vizuh%2Fsabi-controller`. */
export function latestVersionUrl(packageName = SABI_PACKAGE_NAME): string {
  return `${REGISTRY_ORIGIN}/${encodeURIComponent(packageName)}/latest`
}

export function updateCachePath(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(controllerStateDir(env), CACHE_FILE)
}

function readCache(file: string): CachedUpdate | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return undefined
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined
  const value = parsed as Partial<CachedUpdate>
  if (
    typeof value.packageName !== 'string' ||
    typeof value.installedVersion !== 'string' ||
    !['up-to-date', 'update-available', 'unavailable'].includes(String(value.status)) ||
    !Number.isSafeInteger(value.checkedAt) ||
    !Number.isSafeInteger(value.nextCheckAt)
  ) {
    return undefined
  }
  if (value.latestVersion !== undefined && typeof value.latestVersion !== 'string') return undefined
  return value as CachedUpdate
}

function writeCache(file: string, value: CachedUpdate): void {
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
  const temporary = `${file}.tmp-${process.pid}`
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
  renameSync(temporary, file)
}

async function fetchLatestVersion(fetchImpl: FetchLike, packageName: string): Promise<string> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const response = await fetchImpl(latestVersionUrl(packageName), {
      headers: { accept: 'application/json' },
      signal: controller.signal,
    })
    if (!response.ok) throw new Error(`npm registry returned HTTP ${response.status}`)
    const payload = (await response.json()) as { version?: unknown }
    if (typeof payload.version !== 'string' || !versionParts(payload.version)) {
      throw new Error('npm registry returned an unreadable latest version')
    }
    return payload.version
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * Pre-upgrade preflight. Three cheap local facts decide whether an upgrade is safe to attempt
 * unattended: the Node the package declares, the project config the running server would load,
 * and whether installed hooks still resolve. It never mutates anything.
 */
export function quickCompatibilityChecks(options: { cwd?: string; env?: NodeJS.ProcessEnv } = {}): {
  ok: boolean
  checks: CompatibilityCheck[]
} {
  const env = options.env ?? process.env
  const cwd = path.resolve(options.cwd ?? process.cwd())
  const { major, minor } = process.versions.node ? splitNodeVersion(process.versions.node) : { major: 0, minor: 0 }
  const checks: CompatibilityCheck[] = [
    {
      name: 'node',
      ok: major > MINIMUM_NODE.major || (major === MINIMUM_NODE.major && minor >= MINIMUM_NODE.minor),
      detail: `${process.versions.node} (requires >=${MINIMUM_NODE.major}.${MINIMUM_NODE.minor})`,
    },
  ]

  const configPath = defaultConfigPath({ cwd, env })
  if (!existsSync(configPath)) {
    checks.push({ name: 'config', ok: true, detail: 'no config in this project' })
  } else {
    try {
      loadConfig(configPath)
      checks.push({ name: 'config', ok: true, detail: configPath })
    } catch (error) {
      checks.push({
        name: 'config',
        ok: false,
        detail: `${configPath} (${error instanceof Error ? error.message : 'invalid config'})`,
      })
    }
  }

  const hooks = checkHookHealth({ env })
  const stale = hooks.filter(({ stale: isStale }) => isStale)
  checks.push({
    name: 'hooks',
    ok: stale.length === 0,
    detail: stale.length
      ? stale.map(({ harness, detail }) => `${harness}: ${detail}`).join('; ')
      : `${hooks.filter(({ installed }) => installed).length} harness hook(s) resolve`,
  })

  return { ok: checks.every(({ ok }) => ok), checks }
}

function splitNodeVersion(version: string): { major: number; minor: number } {
  const [major, minor] = version.split('.')
  return { major: Number(major) || 0, minor: Number(minor) || 0 }
}

/** Cache-only read: no network, no writes. */
export function readCachedUpdate(options: { env?: NodeJS.ProcessEnv; stateDir?: string } = {}): CachedUpdate | undefined {
  const stateDir = options.stateDir ?? controllerStateDir(options.env ?? process.env)
  return readCache(path.join(stateDir, CACHE_FILE))
}

export async function checkForUpdate(options: UpdateCheckOptions = {}): Promise<UpdateCheckResult> {
  const env = options.env ?? process.env
  const now = options.now ?? Date.now()
  const stateDir = options.stateDir ?? controllerStateDir(env)
  const installedVersion = options.installedVersion ?? env.SABI_BUILD_VERSION ?? '0.0.0-dev'
  const cached = readCache(path.join(stateDir, CACHE_FILE))

  let update: CachedUpdate
  if (options.refresh) {
    try {
      const latestVersion = await fetchLatestVersion(options.fetchImpl ?? fetch, SABI_PACKAGE_NAME)
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
    writeCache(path.join(stateDir, CACHE_FILE), update)
  } else if (cached && cached.installedVersion === installedVersion) {
    update = cached
  } else {
    update = {
      packageName: SABI_PACKAGE_NAME,
      installedVersion,
      status: 'unavailable',
      checkedAt: 0,
      nextCheckAt: 0,
      error: 'no cached check for this version; run `sabi updates --check`',
    }
  }

  return {
    ...update,
    stale: now >= update.nextCheckAt,
    ...(update.status === 'update-available' ? { warning: UPDATE_WARNING } : {}),
    compatibility: quickCompatibilityChecks({ cwd: options.cwd, env }),
  }
}
