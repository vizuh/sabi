import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'deprecate-packages.mjs')

function run(args: string[]): { status: number | null; stdout: string } {
  const result = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' })
  return { status: result.status, stdout: `${result.stdout}${result.stderr}` }
}

test('the default run is a preview that writes nothing', () => {
  const preview = run([])
  assert.equal(preview.status, 0, preview.stdout)
  assert.match(preview.stdout, /would deprecate @vizuh\/sabi@0\.2\.2/)
  assert.match(preview.stdout, /dry run: \d+ deprecation\(s\) pending/)
  assert.doesNotMatch(preview.stdout, /\+ deprecated/, 'a preview must not perform the write')
})

test('every notice names a concrete successor and stops at a version boundary', () => {
  // A deprecation that does not say where to go is an annoyance, not a message: the whole point is
  // that the person installing sees the next thing to type.
  const preview = run([]).stdout
  for (const line of preview.split('\n')) {
    const target = line.match(/^would deprecate (\S+)/)?.[1]
    if (!target) continue
    const message = preview.split(`${target}\n`)[1]?.split('\n')[0] ?? ''
    assert.match(message, /@vizuh\/sabi/, `${target} must name a successor`)
  }
  // The product must never be caught by a package-wide deprecation: 0.3.1+ is the layer plus every
  // host, and a blanket `npm deprecate @vizuh/sabi` would mark all of it deprecated.
  assert.doesNotMatch(preview, /would deprecate @vizuh\/sabi\s/, 'the product needs a version-scoped target, not the whole package')
  assert.match(preview, /would deprecate @vizuh\/sabi@0\.2\.2\b/, 'the last mod-only release is the one to mark')
})
