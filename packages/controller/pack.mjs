import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync, chmodSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const packageDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(packageDir, '../..')
const sourcePackage = JSON.parse(readFileSync(path.join(packageDir, 'package.json'), 'utf8'))
const rawVersion = process.env.SABI_CONTROLLER_VERSION?.trim() || sourcePackage.version
const version = rawVersion.replace(/^controller-v/, '')
const stagingDir = path.join(packageDir, 'pkg')
const distDir = path.join(stagingDir, 'dist')
const resourcesDir = path.join(stagingDir, 'resources')

rmSync(stagingDir, { recursive: true, force: true })
mkdirSync(distDir, { recursive: true })
mkdirSync(path.join(resourcesDir, 'opencode'), { recursive: true })
mkdirSync(path.join(resourcesDir, 'orca'), { recursive: true })

await build({
  entryPoints: [path.join(packageDir, 'src/cli.ts')],
  outfile: path.join(distDir, 'cli.mjs'),
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  sourcemap: false,
  define: { 'process.env.SABI_BUILD_VERSION': JSON.stringify(version) },
})

copyFileSync(
  path.join(repoRoot, 'packages/adapters/opencode/src/sabi-hook.mjs'),
  path.join(resourcesDir, 'opencode/sabi-hook.mjs'),
)
for (const file of ['orca-plugin.json', 'main.mjs', 'README.md']) {
  copyFileSync(path.join(repoRoot, 'packages/adapters/orca', file), path.join(resourcesDir, 'orca', file))
}
copyFileSync(path.join(repoRoot, 'LICENSE'), path.join(stagingDir, 'LICENSE'))
copyFileSync(path.join(packageDir, 'README.md'), path.join(stagingDir, 'README.md'))

const manifest = {
  name: '@vizuh/sabi-controller',
  version,
  description: 'User-level Sabi controller for routing work across coding harnesses.',
  type: 'module',
  bin: { sabi: 'dist/cli.mjs' },
  files: ['dist', 'resources', 'README.md', 'LICENSE'],
  engines: { node: '>=22.6' },
  license: 'MIT',
  repository: { type: 'git', url: 'git+https://github.com/vizuh/sabi.git', directory: 'packages/controller' },
  homepage: 'https://github.com/vizuh/sabi#readme',
}
writeFileSync(path.join(stagingDir, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`)
chmodSync(path.join(distDir, 'cli.mjs'), 0o755)
console.log(`packed ${manifest.name}@${version} at ${stagingDir}`)
