#!/usr/bin/env node
// Applies the deprecation notices the registry needs but a git history cannot carry.
//
// Why this is version-scoped: `npm deprecate <package>` marks *every* version, so running it on
// `@vizuh/sabi` would have labelled 0.3.1+ — the product — as deprecated. Only the releases that
// mean something different now are marked: 0.1.0–0.2.2, which were the Command Code mod alone.
//
// Dry-run by default; `--apply` is the only way it writes. npm deprecate is idempotent, so this is
// safe to re-run and safe to leave in the repository as the record of what was announced.
import { spawnSync } from 'node:child_process'

/** @type {ReadonlyArray<{ target: string, message: string }>} */
const DEPRECATIONS = [
  {
    target: '@vizuh/sabi@0.2.2',
    message:
      'This release is the Command Code mod alone. Sabi is now @vizuh/sabi 0.3.1+ — the routing layer, ' +
      'carrying the Command Code, Oh My Pi, OpenCode and Orca integrations. If you installed the mod from ' +
      'this version, install @vizuh/sabi and re-run sabi setup. The mod on its own is @vizuh/sabi-commandcode.',
  },
  {
    target: '@vizuh/sabi-router@0.1.0',
    message:
      'Superseded before anyone could depend on it: Sabi is @vizuh/sabi, the routing layer with every host ' +
      'integration. @vizuh/sabi-router was a working name during the packaging change and is not maintained.',
  },
]

const apply = process.argv.includes('--apply')
let failed = 0
for (const { target, message } of DEPRECATIONS) {
  if (!target || !message) {
    console.error(`invalid deprecation entry: ${JSON.stringify({ target, message })}`)
    failed += 1
    continue
  }
  if (!apply) {
    console.log(`would deprecate ${target}\n  ${message}\n`)
    continue
  }
  const result = spawnSync('npm', ['deprecate', target, message], { stdio: 'inherit' })
  if (result.status !== 0) {
    console.error(`npm deprecate ${target} failed (${result.status ?? result.signal})`)
    failed += 1
  }
}

if (failed) process.exitCode = 1
console.log(apply ? `applied ${DEPRECATIONS.length} deprecation(s)` : `dry run: ${DEPRECATIONS.length} deprecation(s) pending`)
