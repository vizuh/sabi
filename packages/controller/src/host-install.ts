import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync } from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * One install, every host.
 *
 * Sabi ships its own host integrations, so setup installs the files it already has rather than
 * asking people to copy paths out of a checkout. The order is deliberate and total, and it applies
 * uniformly — a step that ships nothing for a given host is simply absent for that host:
 *
 *   1. an explicit override — `SABI_OPENCODE_HOOK_SOURCE`, then `SABI_PACKAGE_DIR`; tests and
 *      anyone vendoring the package.
 *   2. the controller's own bundled `resources/` — it leads the package steps because this file is
 *      loaded by the controller that shipped it, so the bundled copy is the one whose protocol
 *      matches the daemon it will talk to. A checkout has no `resources/`, so in development this
 *      step is absent.
 *   3. the installed `@vizuh/sabi` — the product, which carries every host.
 *   4. the installed `@vizuh/sabi-commandcode` — the stand-alone mod slice.
 *   5. this checkout — so a clone keeps working, which is how the repository's own tests run.
 *
 * Every artifact is read from the declaring package's own manifest, so a published package that
 * forgets a host resolves to nothing for that host rather than quietly installing something older.
 */

export type SabiHost = 'command-code' | 'oh-my-pi' | 'opencode' | 'orca'

export interface ResolvedArtifact {
  host: SabiHost
  source: 'override' | 'bundled' | 'package' | 'slice' | 'checkout'
  file: string
  version?: string
}

const PRODUCT = '@vizuh/sabi'
const SLICE = '@vizuh/sabi-commandcode'
const requireFromHere = createRequire(import.meta.url)

function moduleDir(): string {
  return path.dirname(fileURLToPath(import.meta.url))
}

function checkoutRoot(): string {
  return path.resolve(moduleDir(), '../../..')
}

function manifestOf(dir: string): Record<string, unknown> | undefined {
  const file = path.join(dir, 'package.json')
  if (!existsSync(file)) return undefined
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'))
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : undefined
  } catch {
    return undefined
  }
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

/** The path a package declares for this host, read from that package's own manifest. */
function stringAt(value: Record<string, unknown> | undefined, key: string): string | undefined {
  const found = value?.[key]
  return typeof found === 'string' ? found : undefined
}

function declaredPath(manifest: Record<string, unknown>, host: SabiHost): string | undefined {
  if (host === 'command-code') {
    const mods = record(manifest.commandcode)?.mods
    const first = Array.isArray(mods) ? mods[0] : undefined
    return typeof first === 'string' ? first : undefined
  }
  if (host === 'oh-my-pi') return stringAt(record(manifest.omi), 'extension')
  if (host === 'opencode') return stringAt(record(manifest.opencode), 'plugin')
  return stringAt(record(manifest.orca), 'plugin')
}

/**
 * The controller's own copy of a host artifact. Leading the package steps is the point: see the
 * order in the module comment. Only the hosts the controller pack actually ships appear here.
 */
function fromBundled(host: SabiHost): ResolvedArtifact | undefined {
  const shipped: Record<SabiHost, string[]> = {
    'command-code': [],
    'oh-my-pi': [],
    opencode: ['opencode/sabi-hook.mjs'],
    orca: ['orca/orca-plugin.json'],
  }
  const dir = moduleDir()
  for (const relative of shipped[host]) {
    for (const base of [path.resolve(dir, '..'), dir]) {
      const file = path.join(base, 'resources', relative)
      if (existsSync(file)) return { host, source: 'bundled', file }
    }
  }
  return undefined
}

function fromPackage(name: string, host: SabiHost, source: ResolvedArtifact['source']): ResolvedArtifact | undefined {
  let manifestPath: string
  try {
    manifestPath = requireFromHere.resolve(`${name}/package.json`)
  } catch {
    return undefined
  }
  const dir = path.dirname(manifestPath)
  const manifest = manifestOf(dir)
  if (!manifest) return undefined
  const declared = declaredPath(manifest, host)
  if (!declared) return undefined
  const file = path.join(dir, declared)
  if (!existsSync(file)) return undefined
  const version = typeof manifest.version === 'string' ? manifest.version : undefined
  return { host, source, file, ...(version ? { version } : {}) }
}

function fromCheckout(host: SabiHost): ResolvedArtifact | undefined {
  const root = checkoutRoot()
  const candidates: Record<SabiHost, string[]> = {
    // The built mod first: it is what a packaged install has, and it is what `cmd mods add` is given.
    'command-code': [
      path.join(root, 'packages/adapters/command-code/pkg/mod/sabi.mjs'),
      path.join(root, 'packages/adapters/command-code/mod/sabi.ts'),
    ],
    'oh-my-pi': [path.join(root, 'packages/adapters/oh-my-pi/src/sabi-extension.mjs')],
    opencode: [path.join(root, 'packages/adapters/opencode/src/sabi-hook.mjs')],
    orca: [path.join(root, 'packages/adapters/orca/orca-plugin.json')],
  }
  const file = candidates[host].find((candidate) => existsSync(candidate))
  return file ? { host, source: 'checkout', file } : undefined
}

/** Where this host's integration comes from, in the order documented above. */
export function resolveHostArtifact(host: SabiHost, env: NodeJS.ProcessEnv = process.env): ResolvedArtifact | undefined {
  // Kept for compatibility: it predates the shared order and names a concrete file, so it stays
  // authoritative and unchecked — the caller reports a path that is not there.
  if (host === 'opencode') {
    const direct = env.SABI_OPENCODE_HOOK_SOURCE?.trim()
    if (direct) return { host, source: 'override', file: path.resolve(direct) }
  }
  const override = env.SABI_PACKAGE_DIR?.trim()
  if (override) {
    const dir = path.resolve(override)
    const manifest = manifestOf(dir)
    const declared = manifest && declaredPath(manifest, host)
    if (declared) {
      const file = path.join(dir, declared)
      if (existsSync(file)) {
        const version = typeof manifest?.version === 'string' ? manifest.version : undefined
        return { host, source: 'override', file, ...(version ? { version } : {}) }
      }
    }
  }
  return fromBundled(host)
    ?? fromPackage(PRODUCT, host, 'package')
    ?? fromPackage(SLICE, host, 'slice')
    ?? fromCheckout(host)
}

export function ompExtensionPath(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(env.HOME?.trim() || os.homedir(), '.omp', 'agent', 'extensions', 'sabi.ts')
}

export interface HostInstallResult {
  host: SabiHost
  installed: boolean
  source?: ResolvedArtifact['source']
  path?: string
  detail: string
}

/**
 * Install the Oh My Pi extension into OMP's user extension directory. It lands as `.ts` because
 * that is the suffix OMP's directory scanner accepts — a copied `.mjs` there is never discovered,
 * which is how an integration can be installed and still not load.
 */
export function installOhMyPi(
  env: NodeJS.ProcessEnv = process.env,
  artifact = resolveHostArtifact('oh-my-pi', env),
): HostInstallResult {
  if (!artifact) {
    return { host: 'oh-my-pi', installed: false, detail: 'no Oh My Pi extension found in @vizuh/sabi, @vizuh/sabi-commandcode or this checkout' }
  }
  const target = ompExtensionPath(env)
  try {
    mkdirSync(path.dirname(target), { recursive: true })
    // Write beside the target and rename: an interrupted copy must not leave a half-written extension
    // that OMP would load without complaint.
    const temporary = `${target}.sabi-${process.pid}`
    copyFileSync(artifact.file, temporary)
    renameSync(temporary, target)
  } catch (error) {
    return { host: 'oh-my-pi', installed: false, source: artifact.source, detail: `copy failed: ${(error as Error).message}` }
  }
  return {
    host: 'oh-my-pi', installed: true, source: artifact.source, path: target,
    detail: `extension installed from ${artifact.source}${artifact.version ? ` ${artifact.version}` : ''} — run omp with --model sabi/sabi-code`,
  }
}

export function commandCodeAvailable(env: NodeJS.ProcessEnv = process.env): boolean {
  return spawnSync(process.platform === 'win32' ? 'where' : 'which', ['cmd'], { stdio: 'ignore', env }).status === 0
}

/**
 * Install the Command Code mod. Its registry is an npm spec, so the product is named rather than a
 * file path: the package carries the mod, and `mods add` is idempotent.
 */
export function installCommandCode(
  env: NodeJS.ProcessEnv = process.env,
  artifact = resolveHostArtifact('command-code', env),
): HostInstallResult {
  if (!artifact) {
    return { host: 'command-code', installed: false, detail: 'no Command Code mod found in @vizuh/sabi, @vizuh/sabi-commandcode or this checkout' }
  }
  if (!commandCodeAvailable(env)) {
    return { host: 'command-code', installed: false, source: artifact.source, detail: 'Command Code (`cmd`) is not on PATH — install it, then run sabi hooks install --command-code' }
  }
  const result = spawnSync('cmd', ['mods', 'add', '-g', `npm:${PRODUCT}`], { stdio: 'pipe', encoding: 'utf8', env })
  if (result.status !== 0) {
    const detail = `${result.stderr ?? ''}${result.stdout ?? ''}`.split('\n').filter(Boolean).slice(-1)[0] ?? 'unknown error'
    return { host: 'command-code', installed: false, source: artifact.source, detail: `cmd mods add failed: ${detail}` }
  }
  return { host: 'command-code', installed: true, source: artifact.source, detail: `mod registered from ${artifact.source}${artifact.version ? ` ${artifact.version}` : ''}` }
}
