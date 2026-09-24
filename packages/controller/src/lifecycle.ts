import { spawnSync } from 'node:child_process'
import { existsSync, renameSync } from 'node:fs'
import { controllerStateDir, stopControllerDaemon } from './daemon.ts'
import { restoreHookBackups, type RestoredHookResult } from './hooks.ts'
import { removeUserService, type UserServiceResult } from './service.ts'

export interface UpgradeResult {
  version: string
  command: string
  status: number
  restarted: boolean
  /** Harnesses whose hook/plugin wiring was re-installed after the package was replaced. */
  refreshed?: string[]
  error?: string
}

export interface UninstallResult {
  stateDir: string
  archivedState?: string
  stopped: boolean
  service: UserServiceResult
  restored: RestoredHookResult[]
}

function safeVersion(value: string): string {
  const version = value.trim()
  if (!/^(?:latest|\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)$/.test(version)) {
    throw new Error(`invalid controller version '${value}'`)
  }
  return version
}

export function upgradeController(versionValue = 'latest', env: NodeJS.ProcessEnv = process.env): UpgradeResult {
  const version = safeVersion(versionValue)
  const command = env.SABI_NPM_COMMAND?.trim() || 'npm'
  const args = ['install', '--global', '--ignore-scripts', `@vizuh/sabi-controller@${version}`]
  const display = `${command} ${args.join(' ')}`
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    env,
  })
  const status = result.status ?? 1
  if (result.error) return { version, command: display, status, restarted: false, error: result.error.message }
  if (status !== 0) return { version, command: display, status, restarted: false }
  // The release workflow publishes with provenance, so verify the registry
  // signatures of what was just installed. `--ignore-scripts` above keeps an
  // arbitrary postinstall from running as the user either way.
  const manager = command.split(/[\\/]/).pop()?.toLowerCase() ?? ''
  if (manager === 'npm' || manager.startsWith('npm.')) {
    const audit = spawnSync(command, ['audit', 'signatures'], { stdio: 'inherit', env })
    if (audit.error) {
      return { version, command: display, status: audit.status ?? 1, restarted: false, error: `signature verification failed: ${audit.error.message}` }
    }
    if ((audit.status ?? 1) !== 0) {
      return { version, command: display, status: audit.status ?? 1, restarted: false, error: 'signature verification failed: npm audit signatures reported untrusted signatures' }
    }
  }
  return {
    version,
    command: display,
    status,
    restarted: false,
  }
}

function archiveState(stateDir: string): string | undefined {
  if (!existsSync(stateDir)) return undefined
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const archive = `${stateDir}.uninstalled-${stamp}-${process.pid}`
  renameSync(stateDir, archive)
  return archive
}

export async function uninstallController(options: { restore?: boolean; env?: NodeJS.ProcessEnv } = {}): Promise<UninstallResult> {
  const env = options.env ?? process.env
  const stateDir = controllerStateDir(env)
  const stopped = await stopControllerDaemon(stateDir)
  const service = removeUserService({ env })
  const restored = options.restore === false ? [] : restoreHookBackups({ env })
  const archivedState = archiveState(stateDir)
  return { stateDir, ...(archivedState ? { archivedState } : {}), stopped, service, restored }
}
