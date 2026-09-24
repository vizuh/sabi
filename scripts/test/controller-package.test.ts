import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = fileURLToPath(new URL('../../', import.meta.url))

function fakeHarnessPath(root: string, harnesses: string[]): string {
  const bin = path.join(root, 'bin')
  mkdirSync(bin, { recursive: true })
  for (const harness of harnesses) {
    const command = path.join(bin, process.platform === 'win32' ? `${harness}.cmd` : harness)
    writeFileSync(command, process.platform === 'win32' ? '@echo off\r\nexit /b 0\r\n' : '#!/bin/sh\nexit 0\n')
    if (process.platform !== 'win32') chmodSync(command, 0o755)
  }
  return `${bin}${path.delimiter}${process.env.PATH ?? ''}`
}

test('controller bundle installs and runs from a clean npm prefix', () => {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'sabi-controller-package-'))
  const packDir = path.join(tempRoot, 'pack')
  const installDir = path.join(tempRoot, 'install')
  const controllerHome = path.join(tempRoot, 'state')
  try {
    const expectedVersion = (JSON.parse(readFileSync(path.join(repoRoot, 'packages/controller/package.json'), 'utf8')) as { version: string }).version
    execFileSync(process.execPath, ['packages/controller/pack.mjs'], { cwd: repoRoot, stdio: 'pipe' })
    mkdirSync(packDir, { recursive: true })
    const packOutput = execFileSync('npm', ['pack', 'packages/controller/pkg', '--pack-destination', packDir], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: 'pipe',
      env: { ...process.env, npm_config_update_notifier: 'false', npm_config_fund: 'false' },
    })
    const tarball = readdirSync(packDir).find((name) => name.endsWith('.tgz'))
    assert.ok(tarball, packOutput)

    execFileSync('npm', ['install', '--prefix', installDir, '--no-save', '--ignore-scripts', path.join(packDir, tarball)], {
      cwd: repoRoot,
      stdio: 'pipe',
      env: { ...process.env, npm_config_update_notifier: 'false', npm_config_fund: 'false' },
    })

    const installedCli = path.join(installDir, 'node_modules', '@vizuh', 'sabi-controller', 'dist', 'cli.mjs')
    assert.equal(existsSync(installedCli), true)
    // The proxy ships with the controller: `sabi serve` must not need a checkout of the repo.
    const installedServer = path.join(installDir, 'node_modules', '@vizuh', 'sabi-controller', 'dist', 'server.mjs')
    assert.equal(existsSync(installedServer), true, 'the controller package carries the server bundle')
    assert.match(
      execFileSync(process.execPath, [installedCli, '--help'], { encoding: 'utf8' }),
      /sabi serve/,
      'the installed CLI advertises the serve command',
    )
    const installedPackage = JSON.parse(readFileSync(path.join(installDir, 'node_modules', '@vizuh', 'sabi-controller', 'package.json'), 'utf8')) as { publishConfig?: { access?: string } }
    assert.equal(installedPackage.publishConfig?.access, 'public')
    assert.equal(execFileSync(process.execPath, [installedCli, '--version'], { encoding: 'utf8' }).trim(), expectedVersion)

    const claudeSettings = path.join(tempRoot, 'claude', 'settings.json')
    const codexHooks = path.join(tempRoot, 'codex', 'hooks.json')
    const openCodeConfig = path.join(tempRoot, 'opencode', 'opencode.json')
    const harnessPath = fakeHarnessPath(tempRoot, ['claude', 'codex', 'opencode'])
    execFileSync(process.execPath, [installedCli, 'setup', '--no-start', '--hooks', '--json'], {
      cwd: tempRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        SABI_CONTROLLER_HOME: controllerHome,
        SABI_CLAUDE_SETTINGS: claudeSettings,
        SABI_CODEX_HOOKS: codexHooks,
        SABI_OPENCODE_CONFIG: openCodeConfig,
        PATH: harnessPath,
        SABI_CONTROLLER_HARNESSES: 'claude,codex,opencode',
        ORCA_CLI_COMMAND: path.join(tempRoot, 'missing-orca'),
      },
    })
    const installedClaude = JSON.parse(readFileSync(claudeSettings, 'utf8')) as { hooks: { UserPromptSubmit: Array<{ hooks: Array<{ command: string }> }> } }
    assert.match(installedClaude.hooks.UserPromptSubmit[0]!.hooks[0]!.command, new RegExp(installedCli.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    const installedOpenCode = JSON.parse(readFileSync(openCodeConfig, 'utf8')) as { plugin: string[] }
    assert.equal(existsSync(installedOpenCode.plugin[0]!), true)
    assert.match(readFileSync(installedOpenCode.plugin[0]!, 'utf8'), /chat\.message/)

    const doctor = JSON.parse(
      execFileSync(process.execPath, [installedCli, 'doctor', '--json'], {
        encoding: 'utf8',
        env: {
          ...process.env,
          SABI_CONTROLLER_HOME: controllerHome,
          ORCA_CLI_COMMAND: path.join(tempRoot, 'missing-orca'),
        },
      }),
    ) as { checks: Array<{ name: string; ok: boolean }> }
    assert.equal(doctor.checks.find((check) => check.name === 'node')?.ok, true)
    assert.equal(doctor.checks.find((check) => check.name === 'orca')?.ok, false)
  } finally {
    rmSync(tempRoot, { recursive: true, force: true })
  }
})
