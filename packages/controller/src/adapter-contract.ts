import { execFileSync } from 'node:child_process'

export const ADAPTER_CONTRACT_VERSION = 1 as const

export const ADAPTER_OPERATIONS = [
  'detect',
  'install',
  'identify-session',
  'receive-prompt',
  'dispatch',
  'observe-outcome',
  'uninstall',
] as const

export type AdapterOperation = typeof ADAPTER_OPERATIONS[number]
export type AdapterOperationMode = 'native' | 'hook' | 'cli' | 'missing'
export type AdapterStatus = 'integrated' | 'partial' | 'inventory-only' | 'inference-only' | 'unsupported'

export interface HarnessAdapterManifest {
  contractVersion: 1
  id: string
  displayName: string
  command?: string
  status: AdapterStatus
  consent: 'required' | 'not-required' | 'unavailable'
  operations: Record<AdapterOperation, AdapterOperationMode>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function validateAdapterManifest(value: unknown): HarnessAdapterManifest {
  if (!isRecord(value)) throw new Error('adapter manifest must be an object')
  if (value.contractVersion !== ADAPTER_CONTRACT_VERSION) throw new Error('adapter manifest contractVersion must be 1')
  for (const field of ['id', 'displayName', 'status', 'consent'] as const) {
    if (typeof value[field] !== 'string' || !value[field].trim()) throw new Error(`adapter manifest ${field} must be a non-empty string`)
  }
  if (value.command !== undefined && (typeof value.command !== 'string' || !value.command.trim())) {
    throw new Error('adapter manifest command must be a non-empty string when present')
  }
  if (!['integrated', 'partial', 'inventory-only', 'inference-only', 'unsupported'].includes(value.status as string)) {
    throw new Error(`adapter manifest status '${String(value.status)}' is not supported`)
  }
  if (!['required', 'not-required', 'unavailable'].includes(value.consent as string)) {
    throw new Error(`adapter manifest consent '${String(value.consent)}' is not supported`)
  }
  if (!isRecord(value.operations)) throw new Error('adapter manifest operations must be an object')
  const operations = {} as Record<AdapterOperation, AdapterOperationMode>
  for (const operation of ADAPTER_OPERATIONS) {
    const mode = value.operations[operation]
    if (!['native', 'hook', 'cli', 'missing'].includes(mode as string)) {
      throw new Error(`adapter manifest operation '${operation}' must be native, hook, cli or missing`)
    }
    operations[operation] = mode as AdapterOperationMode
  }
  return {
    contractVersion: 1,
    id: value.id as string,
    displayName: value.displayName as string,
    ...(value.command ? { command: value.command as string } : {}),
    status: value.status as AdapterStatus,
    consent: value.consent as HarnessAdapterManifest['consent'],
    operations,
  }
}

const BUILTIN_ADAPTERS: HarnessAdapterManifest[] = [
  {
    contractVersion: 1,
    id: 'claude',
    displayName: 'Claude Code',
    command: 'claude',
    status: 'partial',
    consent: 'required',
    operations: {
      detect: 'native', install: 'hook', 'identify-session': 'missing', 'receive-prompt': 'hook',
      dispatch: 'cli', 'observe-outcome': 'cli', uninstall: 'hook',
    },
  },
  {
    contractVersion: 1,
    id: 'codex',
    displayName: 'Codex',
    command: 'codex',
    status: 'partial',
    consent: 'required',
    operations: {
      detect: 'native', install: 'hook', 'identify-session': 'missing', 'receive-prompt': 'hook',
      dispatch: 'cli', 'observe-outcome': 'cli', uninstall: 'hook',
    },
  },
  {
    contractVersion: 1,
    id: 'opencode',
    displayName: 'OpenCode',
    command: 'opencode',
    status: 'partial',
    consent: 'required',
    operations: {
      detect: 'native', install: 'hook', 'identify-session': 'missing', 'receive-prompt': 'hook',
      dispatch: 'cli', 'observe-outcome': 'cli', uninstall: 'hook',
    },
  },
  {
    contractVersion: 1,
    id: 'orca',
    displayName: 'Orca',
    command: 'orca-ide',
    status: 'inventory-only',
    consent: 'required',
    operations: {
      detect: 'cli', install: 'missing', 'identify-session': 'cli', 'receive-prompt': 'missing',
      dispatch: 'cli', 'observe-outcome': 'cli', uninstall: 'missing',
    },
  },
  {
    contractVersion: 1,
    id: 'command-code',
    displayName: 'Command Code',
    command: 'cmd',
    status: 'inference-only',
    consent: 'not-required',
    operations: {
      detect: 'native', install: 'missing', 'identify-session': 'missing', 'receive-prompt': 'missing',
      dispatch: 'missing', 'observe-outcome': 'missing', uninstall: 'missing',
    },
  },
  ...(['hermes', 'prime-agent', 'pi', 'omp'] as const).map((id): HarnessAdapterManifest => ({
    contractVersion: 1,
    id,
    displayName: id,
    status: 'unsupported',
    consent: 'unavailable',
    operations: {
      detect: 'missing', install: 'missing', 'identify-session': 'missing', 'receive-prompt': 'missing',
      dispatch: 'missing', 'observe-outcome': 'missing', uninstall: 'missing',
    },
  })),
]

export function builtInAdapterManifests(): HarnessAdapterManifest[] {
  return BUILTIN_ADAPTERS.map((manifest) => validateAdapterManifest(manifest))
}

export function commandAvailable(command: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const selected = command === 'orca-ide' ? env.ORCA_CLI_COMMAND?.trim() || command : command
  try {
    execFileSync(process.platform === 'win32' ? 'where' : 'which', [selected], { stdio: 'ignore', timeout: 2000 })
    return true
  } catch {
    return false
  }
}

export function adapterReady(manifest: HarnessAdapterManifest): boolean {
  return manifest.status === 'integrated' && ADAPTER_OPERATIONS.every((operation) => manifest.operations[operation] !== 'missing')
}
