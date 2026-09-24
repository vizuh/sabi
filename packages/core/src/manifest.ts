import type {
  AdapterCapability,
  AdapterKind,
  AdapterManifest,
  AdapterRefusal,
} from './types.ts'

export interface ManifestLoadResult {
  ok: boolean
  manifest?: AdapterManifest
  refusals: AdapterRefusal[]
  downgrades: AdapterCapability[]
}

export interface ManifestLoaderOptions {
  /** Minimum adapter protocol Sabi understands. */
  minProtocol?: number
  /** Capability keys Sabi refuses to grant without an explicit declaration. */
  requiredCapabilities?: readonly string[]
}

const CURRENT_PROTOCOL = 2

/**
 * Load and validate an adapter manifest. A manifest is a declaration, not a
 * capability probe: Sabi consumes it, never verifies it against a live host.
 *
 * Outcomes are explicit, never silent:
 * - accept — protocol current, claims bounded, no refusals.
 * - refuse — protocol stale or the manifest over-claims a surface Sabi forbids.
 * - downgrade — a declared capability is unsupported by Sabi's minimum; the
 *   adapter still loads, in degraded mode, with the downgrade recorded.
 */
export function loadAdapterManifest(
  raw: unknown,
  options: ManifestLoaderOptions = {},
): ManifestLoadResult {
  const minProtocol = options.minProtocol ?? CURRENT_PROTOCOL
  const required = new Set(options.requiredCapabilities ?? [])
  const refusals: AdapterRefusal[] = []
  const downgrades: AdapterCapability[] = []

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, refusals: [{ surface: 'manifest', reason: 'manifest must be a JSON object' }] }
  }
  const m = raw as Record<string, unknown>

  const id = typeof m.id === 'string' && m.id.trim() ? m.id.trim() : undefined
  const kind = isAdapterKind(m.kind) ? m.kind : undefined
  const version = typeof m.version === 'string' && m.version.trim() ? m.version.trim() : undefined
  const loop = isLoop(m.loop) ? m.loop : undefined

  if (!id) refusals.push({ surface: 'id', reason: 'manifest.id is required' })
  if (!kind) refusals.push({ surface: 'kind', reason: 'manifest.kind is required and unknown' })
  if (!version) refusals.push({ surface: 'version', reason: 'manifest.version is required' })
  if (!loop) refusals.push({ surface: 'loop', reason: 'manifest.loop must be native, proxy or mod' })

  const protocol = typeof m.adapterProtocol === 'number' && Number.isFinite(m.adapterProtocol)
    ? Math.floor(m.adapterProtocol)
    : undefined
  if (protocol === undefined) {
    refusals.push({ surface: 'adapterProtocol', reason: 'manifest.adapterProtocol is required' })
  } else if (protocol < minProtocol) {
    refusals.push({
      surface: 'adapterProtocol',
      reason: `adapter protocol ${protocol} is older than Sabi's minimum ${minProtocol}; upgrade the adapter before loading`,
    })
  }

  const capabilities = normalizeCapabilities(m.capabilities)

  // Every required capability must be present AND declared. A capability that
  // is absent from the manifest is refused just as loudly as one that is
  // present but undeclared — silence is not a downgrade.
  for (const key of required) {
    const declared = capabilities.some((cap) => cap.key === key && cap.declared)
    if (!declared) {
      refusals.push({ surface: key, reason: `capability '${key}' is required but not declared by the adapter` })
    }
  }

  for (const cap of capabilities) {
    if (!cap.declared) {
      downgrades.push(cap)
    }
  }

  if (refusals.length) {
    return { ok: false, refusals, downgrades }
  }

  return {
    ok: true,
    manifest: {
      id: id ?? '',
      kind: kind ?? 'unknown',
      version: version ?? '',
      loop: loop ?? 'native',
      capabilities: capabilities.length ? capabilities : undefined,
      refusals: Array.isArray(m.refusals)
        ? m.refusals.filter((item): item is AdapterRefusal =>
          item && typeof item === 'object' && typeof (item as Record<string, unknown>).surface === 'string')
        : undefined,
    },
    refusals,
    downgrades,
  }
}

function normalizeCapabilities(raw: unknown): AdapterCapability[] {
  if (Array.isArray(raw)) {
    return raw.filter((item): item is AdapterCapability =>
      item && typeof item === 'object' && typeof (item as Record<string, unknown>).key === 'string')
  }
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return Object.entries(raw as Record<string, unknown>)
      .filter(([, value]) => value === true || value === false || value === 'partial')
      .map(([key, value]) => ({ key, declared: value === true || value === 'partial' }))
  }
  return []
}

function isAdapterKind(value: unknown): value is AdapterKind {
  return typeof value === 'string' && [
    'command-code', 'opencode', 'hermes', 'oh-my-pi', 'prime-agent',
    'deepseek-harness', 'orca', 'claude-code', 'codex', 'unknown',
  ].includes(value)
}

function isLoop(value: unknown): value is AdapterManifest['loop'] {
  return value === 'native' || value === 'proxy' || value === 'mod'
}