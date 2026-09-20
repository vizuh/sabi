import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))
const packageJson = JSON.parse(readFileSync(join(root, '..', 'package.json'), 'utf8'))
const patch = readFileSync(join(root, '..', 'cordis.patch.yml'), 'utf8')
const readme = readFileSync(join(root, '..', 'README.md'), 'utf8')

test('publishes a DSH bundle with one explicit Sabi route', () => {
  assert.equal(packageJson.name, '@vizuh/sabi-deepseek-harness')
  assert.equal(packageJson.private, undefined)
  assert.equal(packageJson.publishConfig.access, 'public')
  assert.equal(packageJson.dsh.bundle.patch, './cordis.patch.yml')
  assert.deepEqual(packageJson.files, ['README.md', 'cordis.patch.yml', 'package.json'])
  assert.match(patch, /id: llm-pi-ai/u)
  assert.match(patch, /name: '@deepseek-ai\/dsh-llm-pi-ai'/u)
  assert.match(patch, /providers:\s+sabi:/u)
  assert.match(patch, /baseURL: !!js process\.env\.SABI_DSH_BASE_URL/u)
  assert.match(patch, /X-Sabi-Client: deepseek-harness/u)
  assert.match(patch, /id: sabi-code/u)
  assert.doesNotMatch(patch, /(?:sk-[A-Za-z0-9]|api[_-]?key\s*:)/iu)
})

test('documents the pinned preview boundary and unverified live evidence', () => {
  assert.match(readme, /0\.1\.6-alpha\.2/u)
  assert.match(readme, /ddefc45fbc7f8e46dd73185e68295696d1297887/u)
  assert.match(readme, /developer preview/u)
  assert.match(readme, /inference-only adapter/u)
  assert.match(readme, /remain\s+unverified/u)
})
