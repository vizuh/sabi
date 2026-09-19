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
  const result = spawnSync(command, ['install', '--global', `@vizuh/sabi-controller@${version}`], {
    stdio: 'inherit',
    env,
  })
  const status = result.status ?? 1
  return {
    version,
    command: `${command} install --global @vizuh/sabi-controller@${version}`,
    status,
    restarted: false,
    ...(result.error ? { error: result.error.message } : {}),
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
