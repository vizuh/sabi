import test from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  installUserService,
  installUserServiceForPlatform,
  launchAgentPlist,
  removeUserServiceForPlatform,
  restartUserServiceForPlatform,
  systemdUnit,
  windowsTaskLauncher,
  windowsTaskRun,
} from '../src/service.ts'

test('systemd user unit uses absolute paths and the user-scoped state directory', () => {
  const unit = systemdUnit('/tmp/Sabi Install/dist/cli.mjs', '/tmp/sabi state')
  assert.match(unit, /ExecStart=.*\/tmp\/Sabi Install\/dist\/cli\.mjs.*daemon --foreground/)
  assert.match(unit, /Environment=SABI_CONTROLLER_HOME=.*\/tmp\/sabi state/)
  assert.match(unit, /Restart=on-failure/)
})

test('service installation can be explicitly disabled without touching the host', () => {
  const result = installUserService({
    stateDir: '/tmp/sabi-test-state',
    entrypoint: '/tmp/sabi/cli.mjs',
    env: { ...process.env, SABI_SERVICE_MODE: 'disabled' },
  })
  assert.deepEqual(result, { backend: 'unsupported', installed: false, running: false, detail: 'disabled by environment' })
})

test('systemd service restart uses the installed user unit instead of a detached daemon', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'sabi-controller-systemd-restart-'))
  try {
    const calls = path.join(root, 'calls')
    const systemctl = path.join(root, 'systemctl')
    writeFileSync(systemctl, '#!/bin/sh\nprintf "%s\\n" "$*" >> "$SABI_CALLS"\n')
    chmodSync(systemctl, 0o755)
    const configHome = path.join(root, 'config')
    const unit = path.join(configHome, 'systemd', 'user', 'sabi-controller.service')
    mkdirSync(path.dirname(unit), { recursive: true })
    writeFileSync(unit, '[Service]\n')
    const result = restartUserServiceForPlatform('linux', {
      stateDir: path.join(root, 'state'),
      env: { ...process.env, XDG_CONFIG_HOME: configHome, SABI_SYSTEMCTL: systemctl, SABI_CALLS: calls },
    })
    assert.equal(result.installed, true)
    assert.equal(result.running, true)
    assert.match(readFileSync(calls, 'utf8'), /--user daemon-reload/)
    assert.match(readFileSync(calls, 'utf8'), /--user restart sabi-controller\.service/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('launch agent renderer uses absolute entrypoint and user-scoped state', () => {
  const plist = launchAgentPlist('/tmp/Sabi Install/dist/cli.mjs', '/tmp/sabi state', { PATH: '/opt/bin' })
  assert.match(plist, /com\.vizuh\.sabi-controller/)
  assert.match(plist, /<string>\/tmp\/Sabi Install\/dist\/cli\.mjs<\/string>/)
  assert.match(plist, /<key>SABI_CONTROLLER_HOME<\/key>\s*<string>\/tmp\/sabi state<\/string>/)
  assert.match(plist, /<key>PATH<\/key>\s*<string>\/opt\/bin<\/string>/)
})

test('macOS launch agent service installs and removes through launchctl', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'sabi-controller-launch-agent-'))
  try {
    const launchctl = path.join(root, 'launchctl')
    writeFileSync(launchctl, '#!/bin/sh\nexit 0\n')
    chmodSync(launchctl, 0o755)
    const env = { ...process.env, HOME: root, SABI_UID: '501', SABI_LAUNCHCTL: launchctl }
    const installed = installUserServiceForPlatform('darwin', { entrypoint: '/tmp/sabi/cli.mjs', stateDir: path.join(root, 'state'), env })
    assert.equal(installed.backend, 'launch-agent')
    assert.equal(installed.installed, true)
    assert.match(readFileSync(installed.path!, 'utf8'), /SABI_CONTROLLER_HOME/)
    const removed = removeUserServiceForPlatform('darwin', { env })
    assert.equal(removed.installed, false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('Windows task service uses a user-owned launcher and supports removal', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'sabi-controller-windows-task-'))
  try {
    const schtasks = path.join(root, 'schtasks')
    writeFileSync(schtasks, '#!/bin/sh\nexit 0\n')
    chmodSync(schtasks, 0o755)
    const stateDir = path.join(root, 'state with spaces')
    const env = { ...process.env, SABI_SCHTASKS: schtasks, ComSpec: 'cmd.exe' }
    const installed = installUserServiceForPlatform('win32', { entrypoint: '/tmp/sabi/cli.mjs', stateDir, env })
    assert.equal(installed.backend, 'windows-task')
    assert.equal(installed.installed, true)
    assert.match(readFileSync(installed.path!, 'utf8'), /SABI_CONTROLLER_HOME=/)
    assert.match(windowsTaskRun(stateDir, env), /cmd\.exe .*sabi-controller\.cmd/)
    assert.match(windowsTaskLauncher('/tmp/Sabi Install/cli.mjs', stateDir), /daemon --foreground/)
    const removed = removeUserServiceForPlatform('win32', { env })
    assert.equal(removed.installed, false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
