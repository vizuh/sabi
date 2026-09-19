import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export type UserServiceBackend = 'systemd-user' | 'launch-agent' | 'unsupported'

export interface UserServiceResult {
  backend: UserServiceBackend
  installed: boolean
  running: boolean
  path?: string
  detail?: string
}

function commandPath(command: string, env: NodeJS.ProcessEnv): string | undefined {
  try {
    return execFileSync(process.platform === 'win32' ? 'where' : 'which', [command], {
      encoding: 'utf8',
      timeout: 2000,
      env,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim().split('\n')[0] || undefined
  } catch {
    return undefined
  }
}

function serviceEntrypoint(entrypoint = process.argv[1]): string {
  if (!entrypoint) throw new Error('cannot install a user service without a CLI entrypoint')
  return path.resolve(entrypoint)
}

function systemdQuote(value: string): string {
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}` + '"'
}

export function systemdUnit(entrypoint: string, stateDir: string): string {
  return `[Unit]
Description=Sabi controller daemon
After=default.target

[Service]
Type=simple
ExecStart=${systemdQuote(process.execPath)} ${systemdQuote(serviceEntrypoint(entrypoint))} daemon --foreground
Environment=SABI_CONTROLLER_HOME=${systemdQuote(path.resolve(stateDir))}
Restart=on-failure
RestartSec=2

[Install]
WantedBy=default.target
`
}

function systemdPath(env: NodeJS.ProcessEnv): string {
  return path.join(env.XDG_CONFIG_HOME?.trim() || path.join(os.homedir(), '.config'), 'systemd', 'user', 'sabi-controller.service')
}

function systemd(args: string[], env: NodeJS.ProcessEnv): void {
  const binary = env.SABI_SYSTEMCTL?.trim() || 'systemctl'
  execFileSync(binary, ['--user', ...args], { env, stdio: 'ignore', timeout: 15_000 })
}

function installSystemd(entrypoint: string, stateDir: string, env: NodeJS.ProcessEnv): UserServiceResult {
  const binary = env.SABI_SYSTEMCTL?.trim() || commandPath('systemctl', env)
  if (!binary) return { backend: 'systemd-user', installed: false, running: false, detail: 'systemctl not found' }
  const file = systemdPath(env)
  try {
    mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
    writeFileSync(file, systemdUnit(entrypoint, stateDir), { mode: 0o600 })
    systemd(['daemon-reload'], env)
    systemd(['enable', '--now', 'sabi-controller.service'], env)
    return { backend: 'systemd-user', installed: true, running: true, path: file }
  } catch (error) {
    try { rmSync(file, { force: true }) } catch { /* preserve the original service error */ }
    return { backend: 'systemd-user', installed: false, running: false, path: file, detail: (error as Error).message }
  }
}

function removeSystemd(env: NodeJS.ProcessEnv): UserServiceResult {
  const file = systemdPath(env)
  try {
    if (commandPath('systemctl', env) || env.SABI_SYSTEMCTL) {
      try { systemd(['disable', '--now', 'sabi-controller.service'], env) } catch { /* already stopped */ }
      try { systemd(['daemon-reload'], env) } catch { /* user bus unavailable */ }
    }
    rmSync(file, { force: true })
    return { backend: 'systemd-user', installed: false, running: false, path: file }
  } catch (error) {
    return { backend: 'systemd-user', installed: existsSync(file), running: false, path: file, detail: (error as Error).message }
  }
}

function launchAgentPath(): string {
  return path.join(os.homedir(), 'Library', 'LaunchAgents', 'com.vizuh.sabi-controller.plist')
}

export function installUserService(options: { entrypoint?: string; stateDir: string; env?: NodeJS.ProcessEnv } ): UserServiceResult {
  const env = options.env ?? process.env
  if (env.SABI_SERVICE_MODE?.trim() === 'disabled') return { backend: 'unsupported', installed: false, running: false, detail: 'disabled by environment' }
  if (process.platform === 'linux') return installSystemd(serviceEntrypoint(options.entrypoint), options.stateDir, env)
  if (process.platform === 'darwin') return { backend: 'launch-agent', installed: false, running: false, path: launchAgentPath(), detail: 'launch-agent installer not yet validated on this host' }
  return { backend: 'unsupported', installed: false, running: false, detail: `no user service installer for ${process.platform}` }
}

export function removeUserService(options: { env?: NodeJS.ProcessEnv } = {}): UserServiceResult {
  const env = options.env ?? process.env
  if (env.SABI_SERVICE_MODE?.trim() === 'disabled') return { backend: 'unsupported', installed: false, running: false, detail: 'disabled by environment' }
  if (process.platform === 'linux') return removeSystemd(env)
  if (process.platform === 'darwin') return { backend: 'launch-agent', installed: existsSync(launchAgentPath()), running: false, path: launchAgentPath(), detail: 'launch-agent removal not yet validated on this host' }
  return { backend: 'unsupported', installed: false, running: false, detail: `no user service installer for ${process.platform}` }
}
