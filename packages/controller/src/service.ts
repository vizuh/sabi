import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export type UserServiceBackend = 'systemd-user' | 'launch-agent' | 'windows-task' | 'unsupported'

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
StartLimitIntervalSec=60
StartLimitBurst=5

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

export interface SystemdUnitState {
  activeState: string
  subState: string
  restarts: number
}

function parseSystemdShow(output: string): Record<string, string> {
  const result: Record<string, string> = {}
  for (const line of output.split('\n')) {
    const separator = line.indexOf('=')
    if (separator === -1) continue
    result[line.slice(0, separator)] = line.slice(separator + 1)
  }
  return result
}

// Best-effort visibility for `sabi doctor`: a healthy daemon reachable over
// loopback says nothing about *how* it got there — a unit stuck restart-looping
// on a port conflict looks identical to a normal daemon once something else
// happens to hold the port. Returns undefined (never throws) when systemctl or
// the unit itself is unavailable, so callers just skip the check.
export function inspectSystemdUnit(env: NodeJS.ProcessEnv = process.env): SystemdUnitState | undefined {
  const binary = env.SABI_SYSTEMCTL?.trim() || commandPath('systemctl', env)
  if (!binary) return undefined
  try {
    const output = execFileSync(binary, ['--user', 'show', 'sabi-controller.service', '-p', 'ActiveState', '-p', 'SubState', '-p', 'NRestarts'], {
      encoding: 'utf8',
      env,
      timeout: 5000,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    const parsed = parseSystemdShow(output)
    const restarts = Number(parsed.NRestarts)
    if (!parsed.ActiveState || !Number.isFinite(restarts)) return undefined
    return { activeState: parsed.ActiveState, subState: parsed.SubState ?? '', restarts }
  } catch {
    return undefined
  }
}

function restartSystemd(env: NodeJS.ProcessEnv): UserServiceResult {
  const file = systemdPath(env)
  if (!existsSync(file)) return { backend: 'systemd-user', installed: false, running: false, path: file, detail: 'service not installed' }
  if (!env.SABI_SYSTEMCTL?.trim() && !commandPath('systemctl', env)) {
    return { backend: 'systemd-user', installed: true, running: false, path: file, detail: 'systemctl not found' }
  }
  try {
    systemd(['daemon-reload'], env)
    systemd(['restart', 'sabi-controller.service'], env)
    return { backend: 'systemd-user', installed: true, running: true, path: file }
  } catch (error) {
    return { backend: 'systemd-user', installed: true, running: false, path: file, detail: (error as Error).message }
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

const LAUNCH_AGENT_LABEL = 'com.vizuh.sabi-controller'
const WINDOWS_TASK_NAME = 'Sabi Controller'

function launchAgentPath(env: NodeJS.ProcessEnv): string {
  return path.join(env.HOME?.trim() || os.homedir(), 'Library', 'LaunchAgents', `${LAUNCH_AGENT_LABEL}.plist`)
}

function xmlEscape(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;')
}

export function launchAgentPlist(entrypoint: string, stateDir: string, env: NodeJS.ProcessEnv = process.env): string {
  const argumentsXml = [process.execPath, serviceEntrypoint(entrypoint), 'daemon', '--foreground']
    .map((value) => `    <string>${xmlEscape(value)}</string>`)
    .join('\n')
  const environmentXml = [
    ['SABI_CONTROLLER_HOME', path.resolve(stateDir)],
    ...(env.PATH ? [['PATH', env.PATH]] : []),
  ]
    .map(([key, value]) => `    <key>${xmlEscape(key)}</key>\n    <string>${xmlEscape(value)}</string>`)
    .join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LAUNCH_AGENT_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${argumentsXml}
  </array>
  <key>EnvironmentVariables</key>
  <dict>
${environmentXml}
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
</dict>
</plist>
`
}

function numericUserId(env: NodeJS.ProcessEnv): string {
  const value = env.SABI_UID?.trim() || execFileSync('id', ['-u'], { encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'ignore'], timeout: 2000 }).trim()
  if (!/^\d+$/.test(value)) throw new Error('could not determine the macOS user id')
  return value
}

function launchctl(args: string[], env: NodeJS.ProcessEnv): void {
  const binary = env.SABI_LAUNCHCTL?.trim() || commandPath('launchctl', env)
  if (!binary) throw new Error('launchctl not found')
  execFileSync(binary, args, { env, stdio: 'ignore', timeout: 15_000 })
}

function installLaunchAgent(entrypoint: string, stateDir: string, env: NodeJS.ProcessEnv): UserServiceResult {
  const file = launchAgentPath(env)
  try {
    mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
    writeFileSync(file, launchAgentPlist(entrypoint, stateDir, env), { mode: 0o600 })
    const domain = `gui/${numericUserId(env)}`
    try { launchctl(['bootout', `${domain}/${LAUNCH_AGENT_LABEL}`], env) } catch { /* idempotent reinstall */ }
    launchctl(['bootstrap', domain, file], env)
    launchctl(['kickstart', '-k', `${domain}/${LAUNCH_AGENT_LABEL}`], env)
    return { backend: 'launch-agent', installed: true, running: true, path: file }
  } catch (error) {
    try { rmSync(file, { force: true }) } catch { /* preserve the original service error */ }
    return { backend: 'launch-agent', installed: false, running: false, path: file, detail: (error as Error).message }
  }
}

function removeLaunchAgent(env: NodeJS.ProcessEnv): UserServiceResult {
  const file = launchAgentPath(env)
  try {
    const binary = env.SABI_LAUNCHCTL?.trim() || commandPath('launchctl', env)
    if (binary) {
      const domain = `gui/${numericUserId(env)}`
      try { launchctl(['bootout', `${domain}/${LAUNCH_AGENT_LABEL}`], env) } catch { /* already stopped */ }
    }
    rmSync(file, { force: true })
    return { backend: 'launch-agent', installed: false, running: false, path: file }
  } catch (error) {
    return { backend: 'launch-agent', installed: existsSync(file), running: false, path: file, detail: (error as Error).message }
  }
}

function restartLaunchAgent(env: NodeJS.ProcessEnv): UserServiceResult {
  const file = launchAgentPath(env)
  if (!existsSync(file)) return { backend: 'launch-agent', installed: false, running: false, path: file, detail: 'service not installed' }
  if (!env.SABI_LAUNCHCTL?.trim() && !commandPath('launchctl', env)) {
    return { backend: 'launch-agent', installed: true, running: false, path: file, detail: 'launchctl not found' }
  }
  try {
    const domain = `gui/${numericUserId(env)}`
    launchctl(['kickstart', '-k', `${domain}/${LAUNCH_AGENT_LABEL}`], env)
    return { backend: 'launch-agent', installed: true, running: true, path: file }
  } catch (error) {
    return { backend: 'launch-agent', installed: true, running: false, path: file, detail: (error as Error).message }
  }
}

function windowsTaskLauncherPath(stateDir: string): string {
  return path.join(path.resolve(stateDir), 'sabi-controller.cmd')
}

function batchValue(value: string): string {
  return value.replaceAll('%', '%%').replaceAll('"', '""')
}

export function windowsTaskLauncher(entrypoint: string, stateDir: string): string {
  return `@echo off\r\nset "SABI_CONTROLLER_HOME=${batchValue(path.resolve(stateDir))}"\r\n"${batchValue(process.execPath)}" "${batchValue(serviceEntrypoint(entrypoint))}" daemon --foreground\r\n`
}

export function windowsTaskRun(stateDir: string, env: NodeJS.ProcessEnv = process.env): string {
  const command = env.ComSpec?.trim() || env.COMSPEC?.trim() || 'cmd.exe'
  return `${command} /d /c "${windowsTaskLauncherPath(stateDir)}"`
}

function schtasks(args: string[], env: NodeJS.ProcessEnv): void {
  const binary = env.SABI_SCHTASKS?.trim() || commandPath('schtasks', env)
  if (!binary) throw new Error('schtasks not found')
  execFileSync(binary, args, { env, stdio: 'ignore', timeout: 15_000 })
}

function installWindowsTask(entrypoint: string, stateDir: string, env: NodeJS.ProcessEnv): UserServiceResult {
  const launcher = windowsTaskLauncherPath(stateDir)
  try {
    mkdirSync(path.dirname(launcher), { recursive: true, mode: 0o700 })
    writeFileSync(launcher, windowsTaskLauncher(entrypoint, stateDir), { mode: 0o600 })
    try { schtasks(['/Delete', '/TN', WINDOWS_TASK_NAME, '/F'], env) } catch { /* idempotent reinstall */ }
    schtasks(['/Create', '/TN', WINDOWS_TASK_NAME, '/TR', windowsTaskRun(stateDir, env), '/SC', 'ONLOGON', '/F'], env)
    return { backend: 'windows-task', installed: true, running: true, path: launcher }
  } catch (error) {
    try { rmSync(launcher, { force: true }) } catch { /* preserve the original service error */ }
    return { backend: 'windows-task', installed: false, running: false, path: launcher, detail: (error as Error).message }
  }
}

function removeWindowsTask(env: NodeJS.ProcessEnv): UserServiceResult {
  try {
    const binary = env.SABI_SCHTASKS?.trim() || commandPath('schtasks', env)
    if (binary) {
      try { schtasks(['/Delete', '/TN', WINDOWS_TASK_NAME, '/F'], env) } catch { /* already removed */ }
    }
    return { backend: 'windows-task', installed: false, running: false, path: WINDOWS_TASK_NAME }
  } catch (error) {
    return { backend: 'windows-task', installed: false, running: false, path: WINDOWS_TASK_NAME, detail: (error as Error).message }
  }
}

function restartWindowsTask(stateDir: string, env: NodeJS.ProcessEnv): UserServiceResult {
  const launcher = windowsTaskLauncherPath(stateDir)
  if (!existsSync(launcher)) return { backend: 'windows-task', installed: false, running: false, path: launcher, detail: 'service not installed' }
  if (!env.SABI_SCHTASKS?.trim() && !commandPath('schtasks', env)) {
    return { backend: 'windows-task', installed: true, running: false, path: launcher, detail: 'schtasks not found' }
  }
  try {
    try { schtasks(['/End', '/TN', WINDOWS_TASK_NAME], env) } catch { /* task may already be stopped */ }
    schtasks(['/Run', '/TN', WINDOWS_TASK_NAME], env)
    return { backend: 'windows-task', installed: true, running: true, path: launcher }
  } catch (error) {
    return { backend: 'windows-task', installed: true, running: false, path: launcher, detail: (error as Error).message }
  }
}

export function installUserServiceForPlatform(platform: NodeJS.Platform, options: { entrypoint?: string; stateDir: string; env?: NodeJS.ProcessEnv }): UserServiceResult {
  const env = options.env ?? process.env
  if (env.SABI_SERVICE_MODE?.trim() === 'disabled') return { backend: 'unsupported', installed: false, running: false, detail: 'disabled by environment' }
  if (platform === 'linux') return installSystemd(serviceEntrypoint(options.entrypoint), options.stateDir, env)
  if (platform === 'darwin') return installLaunchAgent(serviceEntrypoint(options.entrypoint), options.stateDir, env)
  if (platform === 'win32') return installWindowsTask(serviceEntrypoint(options.entrypoint), options.stateDir, env)
  return { backend: 'unsupported', installed: false, running: false, detail: `no user service installer for ${platform}` }
}

export function installUserService(options: { entrypoint?: string; stateDir: string; env?: NodeJS.ProcessEnv } ): UserServiceResult {
  return installUserServiceForPlatform(process.platform, options)
}

export function restartUserServiceForPlatform(platform: NodeJS.Platform, options: { stateDir: string; env?: NodeJS.ProcessEnv }): UserServiceResult {
  const env = options.env ?? process.env
  if (env.SABI_SERVICE_MODE?.trim() === 'disabled') return { backend: 'unsupported', installed: false, running: false, detail: 'disabled by environment' }
  if (platform === 'linux') return restartSystemd(env)
  if (platform === 'darwin') return restartLaunchAgent(env)
  if (platform === 'win32') return restartWindowsTask(options.stateDir, env)
  return { backend: 'unsupported', installed: false, running: false, detail: `no user service installer for ${platform}` }
}

export function restartUserService(options: { stateDir: string; env?: NodeJS.ProcessEnv }): UserServiceResult {
  return restartUserServiceForPlatform(process.platform, options)
}

export function removeUserServiceForPlatform(platform: NodeJS.Platform, options: { env?: NodeJS.ProcessEnv } = {}): UserServiceResult {
  const env = options.env ?? process.env
  if (env.SABI_SERVICE_MODE?.trim() === 'disabled') return { backend: 'unsupported', installed: false, running: false, detail: 'disabled by environment' }
  if (platform === 'linux') return removeSystemd(env)
  if (platform === 'darwin') return removeLaunchAgent(env)
  if (platform === 'win32') return removeWindowsTask(env)
  return { backend: 'unsupported', installed: false, running: false, detail: `no user service installer for ${platform}` }
}

export function removeUserService(options: { env?: NodeJS.ProcessEnv } = {}): UserServiceResult {
  return removeUserServiceForPlatform(process.platform, options)
}
