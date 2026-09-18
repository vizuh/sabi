/** Isolated, synthetic Prime Agent 0.9.5 compatibility fixtures. Not a native adapter. */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateConfig, type SabiConfig } from '@sabi/core'

export const probeRoot = fileURLToPath(new URL('../../../../.sabi/compat/prime-agent/', import.meta.url))
export const probeVariants = ['transport', 'native', 'native-followup', 'proxy'] as const
export type ProbeVariant = typeof probeVariants[number]

export function probeEnvironment(variant: ProbeVariant): NodeJS.ProcessEnv {
  return {
    PATH: `${path.dirname(process.execPath)}:/usr/bin:/bin`,
    HOME: path.join(probeRoot, 'home'),
    XDG_CACHE_HOME: path.join(probeRoot, 'cache'),
    XDG_CONFIG_HOME: path.join(probeRoot, 'config'),
    XDG_DATA_HOME: path.join(probeRoot, 'data'),
    XDG_RUNTIME_DIR: path.join(probeRoot, 'runtime'),
    TMPDIR: path.join(probeRoot, 'tmp'),
    PRIME_AGENT_CODING_AGENT_DIR: path.join(probeRoot, 'a'),
    PRIME_AGENT_SESSION_DIR: path.join(probeRoot, 'sessions'),
    PI_OFFLINE: '1', PI_SKIP_VERSION_CHECK: '1', PRIME_AGENT_TELEMETRY: '0',
    DO_NOT_TRACK: '1', NO_COLOR: '1', LANG: 'C.UTF-8',
    SABI_PRIME_PROBE_VARIANT: variant,
    SABI_PRIME_PROBE_EVENTS: path.join(probeRoot, `${variant}-extension.jsonl`),
  }
}

export function probeSettings() {
  return {
    telemetry: { enabled: false },
    retry: { enabled: false, provider: { timeoutMs: 4000, waitForUsage: { enabled: false } } },
    compaction: { enabled: false }, packages: [], extensions: [], skills: [],
    prompts: [], themes: [], enableBuiltinSkills: false,
  }
}

function loopbackUrl(port: number): string {
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error('invalid mock port')
  return `http://127.0.0.1:${port}/v1`
}

export function probeModels(port: number) {
  return { providers: { 'sabi-local-probe': {
    baseUrl: loopbackUrl(port), api: 'openai-completions', apiKey: 'sabi-local-placeholder',
    headers: { 'X-Sabi-Client': 'prime-agent' },
    compat: { supportsDeveloperRole: false, supportsReasoningEffort: true,
      supportsUsageInStreaming: true, maxTokensField: 'max_tokens' },
    models: ['sabi-code', 'probe-first', 'probe-second'].map(id => ({
      id, reasoning: true, input: ['text'], contextWindow: 32000, maxTokens: 2048,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    })),
  } } }
}

/** All capabilities, bounds and zero prices below belong only to the synthetic mock. */
export function mockSabiConfig(port: number): SabiConfig {
  const mockModel = (model: string) => ({
    upstream: 'mock', model, contextWindow: 32000, maxOutputTokens: 2048,
    contextAccounting: { textTokensPerByte: 1, requestOverheadTokens: 100, perMessageOverheadTokens: 20 },
    capabilities: {
      tools: true, parallelTools: true, strictTools: true,
      inputModalities: ['text'], outputModalities: ['text'], reasoningEfforts: ['medium'],
      supportedParameters: ['max_tokens', 'stream_options', 'reasoning_effort', 'tools', 'tool_choice', 'store', 'parallel_tool_calls'],
    },
    cost: { input: 0, output: 0 },
  })
  return validateConfig({
    compatibility: { mode: 'strict' },
    upstreams: { mock: { baseURL: loopbackUrl(port), apiKey: false, streamUsage: true } },
    models: { cheap: mockModel('mock-cheap'), mid: mockModel('mock-mid'), strong: mockModel('mock-strong') },
    aliases: { 'sabi-code': 'auto' },
    policy: { failure: 'strong', stuck: 'mid', 'context-pressure': 'mid', transport: 'mid',
      'first-turn': 'mid', verification: 'mid', implementation: 'mid', exploration: 'cheap', unclassified: 'cheap' },
    judge: { enabled: false }, telemetry: { allowlistOnly: true, captureSnippets: false },
  })
}
