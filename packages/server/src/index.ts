#!/usr/bin/env node
import { defaultConfigPath, defaultLogPath, effectiveMode, loadConfig, loadConfiguredSecrets } from '@sabi/core'
import { createSabiServer, credentialWarnings } from './server.ts'

const config = loadConfig()
// Explicit opt-in: startup is the one place that installs workspace secrets into process.env.
const secretLoad = loadConfiguredSecrets(config, { install: true })
const host = process.env.SABI_HOST ?? config.server?.host ?? '127.0.0.1'
const port = Number(process.env.SABI_PORT ?? config.server?.port ?? 8787)
const logFile = defaultLogPath()

const missingKeys = credentialWarnings(config)

const sabi = createSabiServer({ config, logFile })
let actualPort: number
try {
  actualPort = await sabi.listen(port, host)
} catch (error) {
  if ((error as NodeJS.ErrnoException).code === 'EADDRINUSE') {
    console.error(`Sabi port ${port} on ${host} is already in use — stop the other instance or set SABI_PORT to a free port`)
  } else {
    console.error(`Sabi failed to listen on ${host}:${port} — ${(error as Error).message}`)
  }
  process.exit(1)
}

const judge = config.judge
console.log(`Sabi listening on http://${host}:${actualPort}/v1`)
console.log(`  config : ${defaultConfigPath()}`)
console.log(`  log    : ${logFile}`)
console.log(`  models : ${Object.keys(config.aliases).join(', ')}`)
if (secretLoad.loaded.length) {
  console.log(`  credentials: loaded ${secretLoad.loaded.length} configured key(s) from ${secretLoad.file}`)
} else if (secretLoad.error) {
  console.log(`  WARN   : ${secretLoad.error}`)
}
for (const [tier, model] of Object.entries(config.models)) {
  console.log(`    ${tier.padEnd(7)} -> ${model.upstream}/${model.model}`)
}
if (judge?.enabled) {
  console.log(`  judge  : ${judge.model ?? 'jev-latest'} at ${judge.baseURL} (on: ${(judge.callOn ?? ['failure', 'unclassified']).join(', ')})`)
}
// The effort schedule is observational in this build: the percentage and the level are recorded per
// round, but `reasoning_effort` on the wire is still exactly what the client sent. A mode that says
// otherwise is a configuration that promises an injection this build does not perform, so it says so
// out loud instead of silently ignoring `fill`/`override`.
const effortMode = effectiveMode(config)
console.log(`[sabi] effort : ${effortMode} (percentual 0-100 sobre a escada do tier; sem injecao no corpo nesta build)`)
if (effortMode === 'fill' || effortMode === 'override') {
  console.log(`  WARN   : effort mode '${effortMode}' declara injecao, que nao existe nesta build — o valor do cliente e preservado`)
}
if (missingKeys.length) {
  console.log(`  WARN   : missing upstream credentials for ${missingKeys.join(', ')} — those requests will fail`)
}

const shutdown = (): void => {
  console.log('\nSabi stopping…')
  void sabi.close().then(() => process.exit(0))
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
