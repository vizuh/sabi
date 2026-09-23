import type { CapabilityFlag, ExecutionCapabilities } from './types.ts'

export const CAPABILITY_KEYS = [
  'repoMap',
  'incrementalContext',
  'deterministicEdit',
  'isolatedWorkspaces',
  'verifierReceipts',
  'eventDrivenChanges',
] as const satisfies readonly (keyof ExecutionCapabilities)[]

export type CapabilityKey = (typeof CAPABILITY_KEYS)[number]

export function isCapabilityFlag(value: unknown): value is CapabilityFlag {
  return value === true || value === false || value === 'unknown'
}

/** All-unknown declaration: omission means unknown, never assumed. */
export function defaultCapabilities(): ExecutionCapabilities {
  return {}
}

/** True only for an explicit `true`. `false`, `'unknown'`, and omission all gate off. */
export function isCapable(caps: ExecutionCapabilities | undefined, key: CapabilityKey): boolean {
  if (!caps || typeof caps !== 'object') return false
  return (caps as Record<string, unknown>)[key] === true
}

export interface CapabilityGate {
  ok: boolean
  missing: CapabilityKey[]
}

/**
 * Check a set of required capabilities. Returns every missing/unknown key so
 * the planner can record an explicit reason instead of failing silently.
 */
export function gateCapabilities(
  caps: ExecutionCapabilities | undefined,
  required: readonly CapabilityKey[],
): CapabilityGate {
  const missing = required.filter((key) => !isCapable(caps, key))
  return { ok: missing.length === 0, missing }
}
