#!/usr/bin/env node
import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { spawnSync, type SpawnSyncReturns } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { configureFreeQuality, defaultConfigPath, loadConfig, parseEnvFile, promptSecretWithTimeout, promptWithTimeout, secretSearchPaths, validateConfig } from '@sabi/core'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const COMMAND_CODE_CONNECT = path.join(ROOT, 'packages/adapters/command-code/src/connect.ts')
const OPENCODE_CONNECT = path.join(ROOT, 'packages/adapters/opencode/src/connect.ts')
const HERMES_PLUGIN_DIR = path.join(ROOT, 'packages/adapters/hermes/plugin')
const HERMES_CONFIG_EXAMPLE = path.join(ROOT, 'packages/adapters/hermes/config.sabi.yaml.example')
const HERMES_SABI_CONFIG_EXAMPLE = path.join(ROOT, 'packages/adapters/hermes/sabi.config.json.example')
const HERMES_OPENROUTER_SABI_CONFIG_EXAMPLE = path.join(ROOT, 'packages/adapters/hermes/sabi.config.openrouter.json.example')

export type SetupLanguage = 'en' | 'pt-BR'
type HermesUpstream = 'hermes-nous' | 'openrouter'
type ExplainMode = 'none' | 'local' | 'ai'

export function resolveLanguage(argv: string[]): SetupLanguage {
  const value = flagValue(argv, '--language')?.toLowerCase()
  if (value === 'pt' || value === 'pt-br' || value === 'pt_br') return 'pt-BR'
  if (value === 'en' || value === 'en-us' || value === 'en-gb') return 'en'
  if (value !== undefined) {
    console.error(`Unrecognized --language=${value}. Use en or pt-BR.`)
    process.exitCode = 1
    return 'en'
  }
  const locale = process.env.LC_ALL ?? process.env.LC_MESSAGES ?? process.env.LANG ?? ''
  return locale.toLowerCase().startsWith('pt') ? 'pt-BR' : 'en'
}

function text(language: SetupLanguage, english: string, portuguese: string): string {
  return language === 'pt-BR' ? portuguese : english
}

/** A flag present in argv wins outright and never touches stdin; otherwise prompt with a safe fallback. */
export async function resolveYesNo(
  argv: string[],
  isTTY: boolean,
  yesFlag: string,
  noFlag: string,
  question: string,
  fallback: boolean,
): Promise<boolean> {
  if (argv.includes(yesFlag)) return true
  if (argv.includes(noFlag)) return false
  if (!isTTY) return fallback
  const answer = await promptWithTimeout(question)
  if (answer === undefined) return fallback
  return answer === 'y' || answer === 'yes' || answer === 's' || answer === 'sim'
}

type Harness = 'command-code' | 'opencode' | 'hermes'

function flagValue(argv: string[], name: string): string | undefined {
  return argv.find((arg) => arg.startsWith(`${name}=`))?.slice(name.length + 1)
}

/** No safe default harness exists — every choice writes a different file. Non-interactive + no
 * flag returns undefined and lets the caller print usage; an unrecognized flag value is a hard
 * error (exit 1), never silently treated as "no flag given". */
export async function resolveHarness(argv: string[], isTTY: boolean, language: SetupLanguage = 'en'): Promise<Harness | 'recipe-only' | undefined> {
  const flag = flagValue(argv, '--harness')
  if (flag !== undefined) {
    if (flag === 'command-code' || flag === 'opencode' || flag === 'hermes') return flag
    if (flag === 'kilo' || flag === 'prime-agent') return 'recipe-only'
    console.error(text(language,
      `Unrecognized --harness=${flag}. Use command-code, opencode, hermes, kilo, or prime-agent.`,
      `--harness=${flag} não reconhecido. Use command-code, opencode, hermes, kilo ou prime-agent.`,
    ))
    process.exitCode = 1
    return undefined
  }
  if (!isTTY) return undefined
  const answer = await promptWithTimeout(
    text(language,
      'Which harness?\n  [1] Command Code\n  [2] OpenCode\n  [3] Hermes\n  [4] Kilo / Prime Agent (recipe only)\n> ',
      'Qual harness?\n  [1] Command Code\n  [2] OpenCode\n  [3] Hermes\n  [4] Kilo / Prime Agent (somente receita)\n> ',
    ),
  )
  if (answer === '1') return 'command-code'
  if (answer === '2') return 'opencode'
  if (answer === '3') return 'hermes'
  if (answer === '4') return 'recipe-only'
  return undefined
}

export async function resolveHermesUpstream(argv: string[], isTTY: boolean, language: SetupLanguage = 'en'): Promise<HermesUpstream> {
  const flag = flagValue(argv, '--upstream')
  if (flag === 'openrouter' || flag === 'hermes-nous') return flag
  if (flag !== undefined) {
    console.error(text(language,
      `Unrecognized --upstream=${flag}. Use openrouter or hermes-nous.`,
      `--upstream=${flag} não reconhecido. Use openrouter ou hermes-nous.`,
    ))
    process.exitCode = 1
    return 'hermes-nous'
  }
  if (!isTTY) return 'hermes-nous'
  const answer = await promptWithTimeout(text(language,
    'Hermes route?\n  [1] OpenRouter (one Sabi key; BYOK/fallback stays in OpenRouter)\n  [2] Hermes Nous login (uses the native Hermes profile)\n> ',
    'Rota do Hermes?\n  [1] OpenRouter (uma chave do Sabi; BYOK/fallback fica no OpenRouter)\n  [2] Login Hermes Nous (usa o perfil nativo do Hermes)\n> ',
  ))
  return answer === '1' ? 'openrouter' : 'hermes-nous'
}

export async function resolveExplainMode(argv: string[], isTTY: boolean, language: SetupLanguage = 'en'): Promise<ExplainMode> {
  const value = flagValue(argv, '--explain')
  if (value === 'ai') return 'ai'
  if (value === 'local' || argv.includes('--explain')) return 'local'
  if (value === 'none' || argv.includes('--no-explain')) return 'none'
  if (value !== undefined) {
    console.error(text(language, `Unrecognized --explain=${value}. Use ai, local, or none.`, `--explain=${value} não reconhecido. Use ai, local ou none.`))
    process.exitCode = 1
    return 'none'
  }
  if (!isTTY) return 'none'
  const answer = await promptWithTimeout(text(language,
    'Show a short Sabi explanation after setup? [y/N] ',
    'Mostrar uma explicação curta do Sabi depois do setup? [s/N] ',
  ))
  return answer === 'y' || answer === 'yes' || answer === 's' || answer === 'sim' ? 'local' : 'none'
}

async function resolveClass(argv: string[], isTTY: boolean, language: SetupLanguage = 'en'): Promise<'a' | 'b'> {
  const flag = flagValue(argv, '--class')
  if (flag === 'a' || flag === 'b') return flag
  if (!isTTY) return 'a'
  const answer = await promptWithTimeout(text(language,
    'Command Code: [a] mod (native subscription, no network) or [b] proxy (paid via upstream)? [a] ',
    'Command Code: [a] mod (assinatura nativa, sem rede) ou [b] proxy (pago pelo upstream)? [a] ',
  ))
  return answer === 'b' ? 'b' : 'a'
}

/** Surfaces a spawned writer's failure as this process's own exit code — a caller chaining
 * `npm run setup && start-agent` must see a non-zero status when the writer actually failed. */
function checkSpawn(result: SpawnSyncReturns<Buffer | string>): void {
  if (result.error) {
    console.error(`Failed to run the writer: ${result.error.message}`)
    process.exitCode = 1
  } else if (result.status !== 0) {
    process.exitCode = result.status ?? 1
  }
}

function userSecretsPath(): string {
  const explicit = process.env.SABI_SECRETS_FILE?.trim()
  if (explicit) return path.resolve(explicit)
  const configHome = process.env.XDG_CONFIG_HOME?.trim() || path.join(os.homedir(), '.config')
  return path.join(configHome, 'sabi', 'secrets.env')
}

function loadOpenRouterKeyIntoEnvironment(): boolean {
  if (process.env.OPENROUTER_API_KEY) return true
  for (const candidate of secretSearchPaths()) {
    if (!existsSync(candidate)) continue
    try {
      const value = parseEnvFile(readFileSync(candidate, 'utf8')).OPENROUTER_API_KEY
      if (value) {
        process.env.OPENROUTER_API_KEY = value
        return true
      }
    } catch {
      // Keep the value out of diagnostics; startup will report the file error if it is selected.
    }
  }
  return false
}

/** Store only the provider reference outside Git; never echo or put the key in a generated config. */
export function saveOpenRouterKey(key: string): string {
  const value = key.trim()
  if (!value || /[\r\n]/.test(value)) throw new Error('OpenRouter key must be one non-empty line')
  const file = userSecretsPath()
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
  const existing = existsSync(file) ? readFileSync(file, 'utf8') : ''
  const lines = existing.split(/\r?\n/)
  let replaced = false
  const next = lines.map((line) => {
    if (/^\s*(?:export\s+)?OPENROUTER_API_KEY\s*=/.test(line)) {
      replaced = true
      return `OPENROUTER_API_KEY=${JSON.stringify(value)}`
    }
    return line
  })
  if (!replaced) next.push(`OPENROUTER_API_KEY=${JSON.stringify(value)}`)
  writeFileSync(file, `${next.join('\n').replace(/\n+$/, '')}\n`, { mode: 0o600 })
  chmodSync(file, 0o600)
  return file
}

async function ensureOpenRouterKey(argv: string[], isTTY: boolean, language: SetupLanguage): Promise<boolean> {
  if (loadOpenRouterKeyIntoEnvironment()) {
    console.log(text(language, 'OpenRouter credential: found (value not displayed).', 'Credencial do OpenRouter: encontrada (valor não exibido).'))
    return true
  }
  if (argv.includes('--no-openrouter-key')) {
    console.log(text(language, 'OpenRouter credential: skipped by --no-openrouter-key.', 'Credencial do OpenRouter: ignorada por --no-openrouter-key.'))
    return false
  }
  if (!isTTY) {
    console.log(text(language,
      'OpenRouter credential: not configured. Set OPENROUTER_API_KEY or SABI_SECRETS_FILE before starting Sabi.',
      'Credencial do OpenRouter: não configurada. Defina OPENROUTER_API_KEY ou SABI_SECRETS_FILE antes de iniciar o Sabi.',
    ))
    return false
  }
  const key = await promptSecretWithTimeout(text(language,
    'OpenRouter API key (hidden; press Enter to skip): ',
    'Chave da API do OpenRouter (oculta; Enter para ignorar): ',
  ))
  if (!key) {
    console.log(text(language, 'No key saved. Sabi will start only after you configure OpenRouter.', 'Nenhuma chave salva. O Sabi só iniciará depois que o OpenRouter for configurado.'))
    return false
  }
  const file = saveOpenRouterKey(key)
  console.log(text(language, `OpenRouter credential saved outside the repository: ${file}`, `Credencial do OpenRouter salva fora do repositório: ${file}`))
  return true
}

function printExplanation(language: SetupLanguage): void {
  console.log(text(language,
    'Sabi is an adaptive inference scheduler: the host keeps its own tools, history, permissions and loop; Sabi chooses the next model/provider for each eligible round. Use sabi-code for adaptive routing and sabi-cheap/sabi-mid/sabi-strong for fixed baselines. Native subscriptions stay native; an OpenRouter key is only for the proxy path.',
    'Sabi é um scheduler adaptativo de inferência: o host mantém suas ferramentas, histórico, permissões e loop; o Sabi escolhe o próximo modelo/provedor em cada rodada elegível. Use sabi-code para roteamento adaptativo e sabi-cheap/sabi-mid/sabi-strong como referências fixas. Assinaturas nativas continuam nativas; a chave do OpenRouter serve apenas para o caminho de proxy.',
  ))
}

async function printAiExplanation(language: SetupLanguage): Promise<void> {
  if (!loadOpenRouterKeyIntoEnvironment()) {
    printExplanation(language)
    return
  }
  const key = process.env.OPENROUTER_API_KEY
  if (!key) {
    printExplanation(language)
    console.log(text(language, 'AI explanation skipped: the key exists only in the secrets file; start Sabi first or use --explain=local.', 'Explicação por IA ignorada: a chave existe apenas no arquivo de secrets; inicie o Sabi primeiro ou use --explain=local.'))
    return
  }
  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      redirect: 'error',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: process.env.SABI_EXPLAIN_MODEL?.trim() || '~openai/gpt-latest',
        max_tokens: 220,
        messages: [{
          role: 'user',
          content: language === 'pt-BR'
            ? 'Explique em português do Brasil, em até 5 frases, o que é o Sabi, o que significa sabi-code e como começar. Diga que o host mantém ferramentas, histórico e permissões; não prometa troca de assinatura.'
            : 'Explain in up to 5 sentences what Sabi is, what sabi-code means, and how to start. Say that the host keeps tools, history and permissions; do not promise subscription switching.',
        }],
      }),
      signal: AbortSignal.timeout(15_000),
    })
    const body = await response.json() as { choices?: Array<{ message?: { content?: unknown } }> }
    const content = body.choices?.[0]?.message?.content
    if (!response.ok || typeof content !== 'string' || !content.trim()) throw new Error(`OpenRouter returned HTTP ${response.status}`)
    console.log(content.trim())
  } catch (error) {
    printExplanation(language)
    console.log(text(language, `AI explanation unavailable; local explanation shown (${(error as Error).message}).`, `Explicação por IA indisponível; explicação local exibida (${(error as Error).message}).`))
  }
}

function runCommandCodeClassA(): void {
  console.log('Class A (mod) is registered per-project, not globally. Run this in the project you want Sabi active in:')
  console.log('')
  console.log(`  cmd mods add ${path.relative(process.cwd(), path.join(ROOT, 'packages/adapters/command-code'))}`)
  console.log('  cmd mods list   # confirm: sabi · project · from local:...')
  console.log('')
  console.log('No network, no key, no proxy — nothing written by this wizard.')
}

async function runCommandCodeClassB(argv: string[], isTTY: boolean): Promise<void> {
  const paid = await resolveYesNo(
    argv,
    isTTY,
    '--paid',
    '--free',
    'Route paid upstream models (real API credits) through Command Code? [y/N] ',
    false,
  )
  const extra = argv.includes('--include-local') ? ['--include-local'] : []
  checkSpawn(spawnSync(process.execPath, [COMMAND_CODE_CONNECT, paid ? '--paid' : '--free', ...extra], { stdio: 'inherit' }))
}

function runOpenCode(argv: string[]): void {
  const extra = [
    ...(argv.includes('--set-default') ? ['--set-default'] : []),
    ...(argv.includes('--include-local') ? ['--include-local'] : []),
  ]
  checkSpawn(spawnSync(process.execPath, [OPENCODE_CONNECT, ...extra], { stdio: 'inherit' }))
}

function runHermes(argv: string[], jevEnabled: boolean, upstream: HermesUpstream, language: SetupLanguage): void {
  // Validate the config exists and parses *before* any filesystem side effect below, so a
  // missing/invalid sabi.config.json fails cleanly instead of aborting mid-way through creating
  // HERMES_HOME with no indication that the plugin/config.yaml it just wrote are actually fine.
  try {
    loadConfig()
  } catch (error) {
    console.error((error as Error).message)
    process.exitCode = 1
    return
  }

  const sabiConfigExample = upstream === 'openrouter'
    ? HERMES_OPENROUTER_SABI_CONFIG_EXAMPLE
    : HERMES_SABI_CONFIG_EXAMPLE
  try {
    loadConfig(sabiConfigExample)
  } catch (error) {
    console.error((error as Error).message)
    process.exitCode = 1
    return
  }

  const home = path.resolve(flagValue(argv, '--hermes-home') ?? path.join(process.cwd(), '.sabi', 'hermes-home'))
  if (existsSync(home) && readdirSync(home).length > 0) {
    console.error(`Refusing to use ${home}: it exists and is not empty. Pass --hermes-home=<path> for a fresh one.`)
    process.exitCode = 1
    return
  }
  mkdirSync(path.join(home, 'plugins'), { recursive: true })
  cpSync(HERMES_PLUGIN_DIR, path.join(home, 'plugins', 'sabi-metadata'), {
    recursive: true,
    filter: (src) => !src.includes('__pycache__'),
  })
  copyFileSync(HERMES_CONFIG_EXAMPLE, path.join(home, 'config.yaml'))
  const sabiConfigPath = path.join(home, 'sabi.config.json')
  copyFileSync(sabiConfigExample, sabiConfigPath)
  if (jevEnabled) setJevEnabled(sabiConfigPath, true)

  console.log(`Created ${home}`)
  console.log(`  plugin copied to ${path.join(home, 'plugins', 'sabi-metadata')}`)
  console.log(`  config.yaml written to ${path.join(home, 'config.yaml')}.`)
  console.log(`  Sabi config written to ${sabiConfigPath}.`)
  console.log(text(language, '  The profile is isolated; no provider key was copied.', '  O perfil é isolado; nenhuma chave de provedor foi copiada.'))
  if (jevEnabled) reportJev(sabiConfigPath, true)
  console.log('')
  if (upstream === 'openrouter') {
    console.log(text(language,
      'OpenRouter is the only Sabi credential for this profile. Configure it in the environment or the discovered secrets file; provider BYOK/priority/fallback stays in OpenRouter.',
      'O OpenRouter é a única credencial do Sabi neste perfil. Configure no ambiente ou no arquivo de secrets descoberto; BYOK/prioridade/fallback do provedor ficam no OpenRouter.',
    ))
    console.log('')
    console.log(text(language, 'Use two terminals:', 'Use dois terminais:'))
    console.log(`  SABI_CONFIG=${sabiConfigPath} npm start`)
    console.log(`  HERMES_HOME=${home} hermes chat`)
  } else {
    console.log(text(language, 'Login once in this profile:', 'Faça login uma vez neste perfil:'))
    console.log(`  HERMES_HOME=${home} hermes auth add nous --type oauth`)
    console.log('')
    console.log(text(language, 'Then use three terminals:', 'Depois use três terminais:'))
    console.log(`  HERMES_HOME=${home} hermes proxy start`)
    console.log(`  SABI_CONFIG=${sabiConfigPath} npm start`)
    console.log(`  HERMES_HOME=${home} hermes chat`)
  }
  console.log(text(language, 'The generated Hermes model is already sabi-code.', 'O modelo gerado do Hermes já é sabi-code.'))
  console.log(text(language, 'OpenCode Go and ChatGPT Plus remain native Hermes providers when selected with hermes model.', 'OpenCode Go e ChatGPT Plus continuam como providers nativos do Hermes quando selecionados com hermes model.'))
}

function isInsideGitRepo(filePath: string): boolean {
  let dir = path.dirname(filePath)
  while (true) {
    if (existsSync(path.join(dir, '.git'))) return true
    const parent = path.dirname(dir)
    if (parent === dir) return false
    dir = parent
  }
}

/** Always sets judge.enabled to the resolved answer — declining must actively turn Jev off, not
 * leave whatever the config already had (the shipped sabi.config.json ships judge.enabled: true,
 * so a no-op here would silently ignore "no"). Never reads, prints, or writes the literal
 * TYPESAFE_API_KEY value — sabi.config.json's apiKey fields hold "$ENV_VAR" references only. */
export function setJevEnabled(configPath: string, enabled: boolean): void {
  const raw = readFileSync(configPath, 'utf8')
  const parsed = JSON.parse(raw) as Record<string, unknown>
  const judge = (parsed.judge ?? {}) as Record<string, unknown>
  parsed.judge = {
    ...judge,
    enabled,
    baseURL: judge.baseURL ?? 'https://api.typesafe.ai/v1',
    apiKey: judge.apiKey ?? '$TYPESAFE_API_KEY',
  }
  validateConfig(parsed, configPath)
  const backupPath = `${configPath}.sabi-backup`
  if (!existsSync(backupPath)) copyFileSync(configPath, backupPath)
  writeFileSync(configPath, `${JSON.stringify(parsed, null, 2)}\n`)
}

function reportJev(configPath: string, enabled: boolean): void {
  console.log(`Updated ${configPath}: judge.enabled = ${enabled}`)
  if (isInsideGitRepo(configPath)) console.log('This file is git-tracked — review the diff before committing.')
  if (enabled && !process.env.TYPESAFE_API_KEY) {
    if (secretSearchPaths().some((candidate) => existsSync(candidate))) {
      console.log('TYPESAFE_API_KEY is not in this shell; Sabi will check the discovered secrets file when it starts.')
    } else {
      console.log('TYPESAFE_API_KEY is not set in this shell or a discovered secrets file. Export it or set SABI_SECRETS_FILE before starting Sabi.')
    }
  }
}

function printUsage(): void {
  console.log('Usage: npm run setup -- --harness=command-code|opencode|hermes [--class=a|b] [--upstream=openrouter|hermes-nous] [--language=en|pt-BR] [--explain[=ai|local]] [--no-openrouter-key] [--jev|--no-jev] [--paid|--free] [--free-quality]')
  console.log('No harness flag and no TTY to prompt on — nothing written. Pick one explicitly.')
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const isTTY = Boolean(process.stdin.isTTY)
  const language = resolveLanguage(argv)
  if (process.exitCode === 1) return

  const harness = await resolveHarness(argv, isTTY, language)
  if (!harness) {
    if (process.exitCode !== 1) printUsage()
    return
  }
  if (harness === 'recipe-only') {
    console.log('Kilo and Prime Agent are recipe-only today — see docs/harnesses.md.')
    return
  }

  // Jev is opt-in and never part of the default key flow. The only credential this wizard asks for
  // is OpenRouter; a TypeSafe key is accepted only when the user explicitly passes --jev.
  const commandCodeClass = harness === 'command-code' ? await resolveClass(argv, isTTY, language) : undefined
  const hermesUpstream = harness === 'hermes' ? await resolveHermesUpstream(argv, isTTY, language) : undefined
  if (process.exitCode === 1) return
  const explainMode = await resolveExplainMode(argv, isTTY, language)
  if (process.exitCode === 1) return
  const jevRelevant = harness !== 'command-code' || commandCodeClass === 'b'
  const freeQualityRequested = argv.includes('--free-quality')
  if (freeQualityRequested && !jevRelevant) {
    console.error('--free-quality requires the proxy path (Command Code --class=b, OpenCode, or Hermes). The Class A mod does not use sabi.config.json.')
    process.exitCode = 1
    return
  }

  const wantJev = argv.includes('--jev')
  if (jevRelevant && (argv.includes('--jev') || argv.includes('--no-jev'))) {
    let configPath: string
    try {
      configPath = defaultConfigPath()
      loadConfig(configPath) // throws a friendly "not found" error before any write is attempted
    } catch (error) {
      console.error((error as Error).message)
      process.exitCode = 1
      return
    }
    if (harness !== 'hermes') {
      setJevEnabled(configPath, wantJev)
      reportJev(configPath, wantJev)
    }
  } else if (freeQualityRequested) {
    let configPath: string
    try {
      configPath = defaultConfigPath()
      loadConfig(configPath)
      const result = await configureFreeQuality(configPath)
      console.log(`Updated ${configPath}: quality lane = ${result.model}`)
      console.log(`  OpenRouter catalog observed ${result.observedAt} · sha256 ${result.catalogSha256}`)
      console.log('  alias: sabi-quality · policy: verification → quality · pricing: catalog-reported zero')
      console.log('  This is availability/configuration evidence, not a model-quality benchmark.')
      if (isInsideGitRepo(configPath)) console.log('This file is git-tracked — review the diff before committing.')
    } catch (error) {
      console.error((error as Error).message)
      process.exitCode = 1
      return
    }
  } else if (!jevRelevant) {
    console.log('Jev is proxy-only and unavailable on the Command Code mod (Class A) — skipping.')
  } else if (!wantJev) {
    console.log(text(language, 'Jev is off by default. Pass --jev only after configuring a TypeSafe key.', 'Jev fica desligado por padrão. Passe --jev somente depois de configurar uma chave TypeSafe.'))
  }

  const needsOpenRouter = explainMode === 'ai' || harness === 'opencode' || commandCodeClass === 'b' || hermesUpstream === 'openrouter'
  if (needsOpenRouter) await ensureOpenRouterKey(argv, isTTY, language)

  if (harness === 'command-code') {
    if (commandCodeClass === 'a') runCommandCodeClassA()
    else await runCommandCodeClassB(argv, isTTY)
  } else if (harness === 'opencode') runOpenCode(argv)
  else runHermes(argv, wantJev, hermesUpstream ?? 'hermes-nous', language)

  if (explainMode === 'local') printExplanation(language)
  if (explainMode === 'ai') await printAiExplanation(language)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main()
}
