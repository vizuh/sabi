import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { validateConfig } from '@sabi/core'

const repoRoot = fileURLToPath(new URL('../../', import.meta.url))
const pkgDir = path.join(repoRoot, 'packages/core/pkg')

/**
 * The published artifact is the product, so the suite proves it builds, is self-contained, and
 * routes. A bundle that only imports from inside this repository is not a library — it fails for the
 * first consumer, which is exactly the failure the packer's own guard cannot see.
 */
test('the Sabi package builds, carries every host integration, is self-contained, and routes', async () => {
  execFileSync(process.execPath, [path.join(repoRoot, 'packages/core/pack.mjs')], { cwd: repoRoot, stdio: 'pipe' })

  const manifest = JSON.parse(readFileSync(path.join(pkgDir, 'package.json'), 'utf8')) as {
    name: string; version: string; types: string; files: string[]
  }
  assert.equal(manifest.name, '@vizuh/sabi')
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/)
  assert.equal(manifest.types, './src/index.ts', 'the typed entry ships from source')
  for (const file of manifest.files) assert.equal(existsSync(path.join(pkgDir, file)), true, `${file} is in files but not built`)
  // The short name used to point at the Command Code mod alone. It now carries the layer *and* every
  // host integration, so an existing `cmd mods add -g npm:@vizuh/sabi` install keeps resolving a real
  // file — and Sabi is no longer "the Command Code thing".
  const packed = JSON.parse(readFileSync(path.join(pkgDir, 'package.json'), 'utf8')) as {
    commandcode?: { mods: string[] }; omi?: { extension: string }
    opencode?: { plugin: string }; orca?: { plugin: string; main: string }
  }
  for (const [host, entry] of Object.entries({
    commandcode: packed.commandcode?.mods?.[0], omi: packed.omi?.extension,
    opencode: packed.opencode?.plugin, orca: packed.orca?.plugin, 'orca-main': packed.orca?.main,
  })) {
    assert.ok(entry, `${host} declares no entry point in the published manifest`)
    assert.equal(existsSync(path.join(pkgDir, entry as string)), true, `${host} points at ${entry}, which is not in the package`)
  }

  // Loaded by path, not through the workspace: the bundle must stand on its own.
  const bundle = await import(pathToFileURL(path.join(pkgDir, 'dist/index.mjs')).href)
  assert.equal(typeof bundle.route, 'function')
  assert.equal(typeof bundle.validateConfig, 'function')

  const config = validateConfig({
    upstreams: { mock: { baseURL: 'http://127.0.0.1:1/v1', apiKey: false } },
    models: { cheap: { upstream: 'mock', model: 'fixture-cheap' } },
    aliases: { 'sabi-code': 'auto' },
    policy: { unclassified: 'cheap' },
  })
  const decision = bundle.route(
    { model: 'sabi-code', messages: [{ role: 'user', content: 'hello' }] } as never,
    config,
  )
  assert.equal(decision.tier, 'cheap')
  assert.equal(decision.upstreamModel, 'fixture-cheap')
})
