#!/usr/bin/env node
import { defaultConfigPath, defaultLogPath, loadConfig, loadConfiguredSecrets } from '@sabi/core'
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
if (config.jev?.enabled) {
  console.log(`  jev-routing: ${config.jev.model ?? 'jev-latest'} at ${config.jev.baseURL} (shadow: ${config.jev.shadow}, on: ${(config.jev.callOn ?? ['auto']).join(', ')})`)
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
