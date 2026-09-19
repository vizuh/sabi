#!/usr/bin/env node
import { defaultConfigPath, defaultLogPath, loadConfig, loadConfiguredSecrets, resolveKey } from '@sabi/core'
import { createSabiServer } from './server.ts'

const config = loadConfig()
const secretLoad = loadConfiguredSecrets(config)
const host = process.env.SABI_HOST ?? config.server?.host ?? '127.0.0.1'
const port = Number(process.env.SABI_PORT ?? config.server?.port ?? 8787)
const logFile = defaultLogPath()

const missingKeys: string[] = []
for (const [name, upstream] of Object.entries(config.upstreams)) {
  if (upstream.apiKey === false) continue
  try {
    if (!resolveKey(upstream.apiKey)) missingKeys.push(`${name} (${String(upstream.apiKey)})`)
  } catch (error) {
    missingKeys.push(`${name} (${(error as Error).message})`)
  }
}
const judge = config.judge
if (judge?.enabled) {
  try {
    if (!resolveKey(judge.apiKey)) missingKeys.push(`judge (${String(judge.apiKey)})`)
  } catch (error) {
    missingKeys.push(`judge (${(error as Error).message})`)
  }
}

const sabi = createSabiServer({ config, logFile })
const actualPort = await sabi.listen(port, host)

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
if (missingKeys.length) {
  console.log(`  WARN   : missing upstream credentials for ${missingKeys.join(', ')} — those requests will fail`)
}

const shutdown = (): void => {
  console.log('\nSabi stopping…')
  void sabi.close().then(() => process.exit(0))
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
