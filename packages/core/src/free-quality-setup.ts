import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { applyFreeQualityConfig, fetchOpenRouterCatalog, freeQualityCandidates } from './free-quality.ts'
import { defaultConfigPath, loadConfig, validateConfig } from './config.ts'
import type { FetchLike } from './free-quality.ts'

export async function configureFreeQuality(
  configPath = defaultConfigPath(),
  fetchImpl: FetchLike = fetch,
  now = new Date(),
): Promise<{ configPath: string; model: string; observedAt: string; catalogSha256: string }> {
  const config = loadConfig(configPath)
  const catalog = await fetchOpenRouterCatalog(config, fetchImpl, now)
  const candidate = freeQualityCandidates(catalog.models)[0]
  if (!candidate) throw new Error('OpenRouter catalog has no zero-priced text/tool model for quality checks')

  const raw = JSON.parse(readFileSync(configPath, 'utf8')) as Record<string, unknown>
  const patched = applyFreeQualityConfig(raw, candidate, catalog)
  validateConfig(patched, configPath)
  const backupPath = `${configPath}.sabi-backup`
  if (!existsSync(backupPath)) copyFileSync(configPath, backupPath)
  writeFileSync(configPath, `${JSON.stringify(patched, null, 2)}\n`)
  return { configPath, model: candidate.id, observedAt: catalog.observedAt, catalogSha256: catalog.sha256 }
}
