import test from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  installCommandCode,
  installOhMyPi,
  ompExtensionPath,
  resolveHostArtifact,
} from '../src/host-install.ts'

function workspace(): string {
  return mkdtempSync(path.join(os.tmpdir(), 'sabi-host-'))
}

/** A staged package that declares the hosts it actually carries, with the files to back it up. */
function stagedPackage(root: string, hosts: Array<'oh-my-pi' | 'command-code'>): string {
  const dir = path.join(root, 'pkg')
  mkdirSync(path.join(dir, 'mods/command-code'), { recursive: true })
  mkdirSync(path.join(dir, 'mods/oh-my-pi'), { recursive: true })
  const manifest: Record<string, unknown> = { name: '@vizuh/sabi', version: '9.9.9' }
  if (hosts.includes('command-code')) {
    writeFileSync(path.join(dir, 'mods/command-code/sabi.mjs'), 'export const mod = true\n')
    manifest.commandcode = { mods: ['./mods/command-code/sabi.mjs'] }
  }
  if (hosts.includes('oh-my-pi')) {
    writeFileSync(path.join(dir, 'mods/oh-my-pi/sabi-extension.mjs'), 'export const extension = true\n')
    manifest.omi = { extension: './mods/oh-my-pi/sabi-extension.mjs' }
  }
  writeFileSync(path.join(dir, 'package.json'), JSON.stringify(manifest))
  return dir
}

function fakeCommandCode(root: string, exit = 0): { bin: string; log: string } {
  const bin = path.join(root, 'bin')
  mkdirSync(bin, { recursive: true })
  const log = path.join(root, 'cmd-args.txt')
  writeFileSync(path.join(bin, 'cmd'), `#!/bin/sh\necho "$@" > ${log}\nexit ${exit}\n`)
  chmodSync(path.join(bin, 'cmd'), 0o755)
  return { bin, log }
}

test('a host resolves from the package manifest, and a package that omits a host does not claim it', () => {
  const root = workspace()
  try {
    const both = stagedPackage(root, ['oh-my-pi', 'command-code'])
    const env = { SABI_PACKAGE_DIR: both }
    for (const host of ['oh-my-pi', 'command-code'] as const) {
      const artifact = resolveHostArtifact(host, env)
      assert.equal(artifact?.source, 'override')
      assert.equal(artifact?.version, '9.9.9')
      assert.equal(existsSync(artifact?.file ?? ''), true)
    }

    // The manifest is the inventory: a package that ships one host must never resolve the other,
    // or setup would install a path the package does not contain. Resolution falls through instead —
    // to the checkout here, because this test runs inside the repository.
    const only = path.join(root, 'only-omp')
    mkdirSync(only, { recursive: true })
    writeFileSync(path.join(only, 'package.json'), JSON.stringify({ name: '@vizuh/sabi', version: '1.0.0', omi: { extension: './missing.mjs' } }))
    for (const host of ['oh-my-pi', 'command-code'] as const) {
      const artifact = resolveHostArtifact(host, { SABI_PACKAGE_DIR: only })
      assert.equal(artifact?.source, 'checkout', `${host} is not declared here, so it falls through`)
      assert.equal(artifact?.file.startsWith(only), false, `${host} did not resolve to a path inside a package that does not ship it`)
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('the Oh My Pi extension installs where OMP discovers it, and nothing is left half-written', () => {
  const root = workspace()
  try {
    const home = path.join(root, 'home')
    mkdirSync(home, { recursive: true })
    const pkg = stagedPackage(root, ['oh-my-pi'])
    const result = installOhMyPi({ HOME: home, SABI_PACKAGE_DIR: pkg })

    assert.equal(result.installed, true, result.detail)
    assert.equal(result.source, 'override')
    assert.equal(result.path, ompExtensionPath({ HOME: home }))
    assert.match(result.path, /\.omp\/agent\/extensions\/sabi\.ts$/, 'OMP only discovers .ts and .js there')
    assert.match(readFileSync(result.path ?? '', 'utf8'), /extension = true/)

    // Re-running is idempotent, and the write-beside-then-rename leaves no debris.
    assert.equal(installOhMyPi({ HOME: home, SABI_PACKAGE_DIR: pkg }).installed, true)
    assert.deepEqual(readdirSync(path.dirname(result.path ?? '')), ['sabi.ts'], 'no .sabi-* temporary left behind')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('the Command Code mod is registered by name, through the command on PATH', () => {
  const root = workspace()
  try {
    const home = path.join(root, 'home')
    mkdirSync(home, { recursive: true })
    const stub = fakeCommandCode(root, 0)
    const env = { HOME: home, SABI_PACKAGE_DIR: stagedPackage(root, ['command-code']), PATH: `${stub.bin}:${process.env.PATH ?? ''}` }
    const result = installCommandCode(env)
    assert.equal(result.installed, true, result.detail)
    assert.equal(readFileSync(stub.log, 'utf8').trim(), 'mods add -g npm:@vizuh/sabi')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a failing `cmd` or a missing one is reported, never thrown', () => {
  const root = workspace()
  try {
    const home = path.join(root, 'home')
    mkdirSync(home, { recursive: true })
    const pkg = stagedPackage(root, ['command-code'])
    const failing = fakeCommandCode(root, 3)
    const failed = installCommandCode({
      HOME: home, SABI_PACKAGE_DIR: pkg, PATH: `${failing.bin}:${process.env.PATH ?? ''}`,
    })
    assert.equal(failed.installed, false)
    assert.match(failed.detail, /cmd mods add failed/)

    const absent = installCommandCode({ HOME: home, SABI_PACKAGE_DIR: pkg, PATH: path.join(root, 'empty') })
    assert.equal(absent.installed, false)
    assert.match(absent.detail, /not on PATH/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('with no package declaring the host, resolution falls through to the checkout', () => {
  const root = workspace()
  try {
    const home = path.join(root, 'home')
    mkdirSync(home, { recursive: true })
    // An override directory that declares nothing: the package steps cannot help, and this
    // checkout's own adapter file is what the last step finds.
    const empty = path.join(root, 'empty-pkg')
    mkdirSync(empty, { recursive: true })
    writeFileSync(path.join(empty, 'package.json'), JSON.stringify({ name: '@vizuh/sabi' }))
    const result = installOhMyPi({ HOME: home, SABI_PACKAGE_DIR: empty })
    assert.equal(result.installed, true, 'the checkout fallback is the point of the last step')
    assert.equal(result.source, 'checkout')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
