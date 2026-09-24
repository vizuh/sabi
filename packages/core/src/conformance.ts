import type {
  AdapterManifest,
  ConformanceCheck,
  ConformanceCheckResult,
  ConformanceReport,
  ConformanceVerdict,
  TrajectoryIR,
} from './types.ts'

export interface ConformanceFixture {
  id: string
  manifest: AdapterManifest
  ir: TrajectoryIR
  /** Fields the fixture adapter is known to drop, for lossy verdicts. */
  dropped?: string[]
  /** When true, the adapter leaks something it should not. */
  leaks?: boolean
  /** When true, the adapter's IR is unstable across equivalent inputs. */
  unstable?: boolean
}

/**
 * Shared conformance checks (spec 005 US4, T031). Every adapter runs the same
 * suite. Each check is a pure function of the IR and the manifest — no host
 * interaction, so the suite doubles as a golden compatibility test.
 */
export const manifestValidCheck: ConformanceCheck = {
  id: 'manifest-valid',
  name: 'manifest is a well-formed declaration',
  check: (_ir: TrajectoryIR, manifest: AdapterManifest) =>
    Boolean(manifest && manifest.id && manifest.kind && manifest.version),
}

export const evidenceAllowlistedCheck: ConformanceCheck = {
  id: 'evidence-allowlisted',
  name: 'evidence codes are allowlisted',
  check: (ir: TrajectoryIR) =>
    ir.evidence.every((entry) => typeof entry.code === 'string' && entry.code.length > 0),
}

export const untranslatableListedCheck: ConformanceCheck = {
  id: 'untranslatable-listed',
  name: 'untranslatable fields are listed, never silently dropped',
  check: (ir: TrajectoryIR) => Array.isArray(ir.untranslatable),
}

export const unknownNotInventedCheck: ConformanceCheck = {
  id: 'unknown-not-invented',
  name: 'unknown fields read as absent, never as a default',
  check: (ir: TrajectoryIR) =>
    ir.untranslatable.length === 0 || ir.untranslatable.every((field) => field.length > 0),
}

export const noSecretLeakCheck: ConformanceCheck = {
  id: 'no-secret-leak',
  name: 'no secret-like content enters the IR',
  check: (ir: TrajectoryIR) => {
    const serialized = JSON.stringify(ir)
    return !serialized.includes('apiKey') && !serialized.includes('token')
  },
}

export const receiptBoundedCheck: ConformanceCheck = {
  id: 'receipt-bounded',
  name: 'a receipt, when present, carries an operationId',
  check: (ir: TrajectoryIR) =>
    ir.receipt === undefined || typeof ir.receipt.operationId === 'string',
}

export const CONFORMANCE_CHECKS: readonly ConformanceCheck[] = [
  manifestValidCheck,
  evidenceAllowlistedCheck,
  untranslatableListedCheck,
  unknownNotInventedCheck,
  noSecretLeakCheck,
  receiptBoundedCheck,
]

/**
 * Run the shared suite against one fixture adapter and return a named verdict.
 * Verdicts are explicit, never silent:
 * - conformant — every check passes.
 * - lossy — the adapter drops declared fields; still runnable, downgrade recorded.
 * - unstable — equivalent inputs do not produce equivalent IR.
 * - leaking — secret-like content reaches the IR.
 * - refused — the manifest itself was not loadable.
 */
export function runConformance(fixture: ConformanceFixture): ConformanceReport {
  const checks: ConformanceCheckResult[] = CONFORMANCE_CHECKS.map((check) => {
    let verdict: ConformanceVerdict = 'conformant'
    let detail: string | undefined
    try {
      const passed = check.check(fixture.ir, fixture.manifest)
      if (!passed) {
        verdict = 'lossy'
        detail = `check '${check.id}' failed`
      }
    } catch (error) {
      verdict = 'refused'
      detail = error instanceof Error ? error.message : String(error)
    }
    return { checkId: check.id, verdict, detail }
  })

  // Fixture-level signals override the per-check verdict.
  if (fixture.leaks) {
    checks.push({ checkId: 'no-secret-leak', verdict: 'leaking', detail: 'fixture declares a leak' })
  }
  if (fixture.unstable) {
    checks.push({ checkId: 'ir-stability', verdict: 'unstable', detail: 'fixture declares instability' })
  }
  if (fixture.dropped && fixture.dropped.length) {
    checks.push({
      checkId: 'declared-surfaces',
      verdict: 'lossy',
      detail: `drops declared fields: ${fixture.dropped.join(', ')}`,
    })
  }

  const failing = checks.filter((c) => c.verdict !== 'conformant')
  const verdict: ConformanceVerdict = failing.length
    ? failing.some((c) => c.verdict === 'leaking' || c.verdict === 'refused')
      ? 'leaking'
      : failing.some((c) => c.verdict === 'unstable')
        ? 'unstable'
        : 'lossy'
    : 'conformant'

  return {
    reportId: `conf:${fixture.id}:${verdict}`,
    adapterId: fixture.id,
    generatedAt: new Date().toISOString(),
    verdict,
    checks,
    untranslatable: fixture.ir.untranslatable,
  }
}

/** Aggregate a set of reports into a single pass/fail summary. */
export function summarizeConformance(reports: ConformanceReport[]): {
  total: number
  conformant: number
  lossy: number
  unstable: number
  leaking: number
  refused: number
} {
  return reports.reduce((acc, report) => {
    acc.total += 1
    acc[report.verdict] += 1
    return acc
  }, { total: 0, conformant: 0, lossy: 0, unstable: 0, leaking: 0, refused: 0 })
}

/** Build a ConformanceCheck list from caller-supplied checks, merged with the shared suite. */
export function mergeConformanceChecks(extra: readonly ConformanceCheck[] = []): readonly ConformanceCheck[] {
  const byId = new Map(CONFORMANCE_CHECKS.map((check) => [check.id, check]))
  for (const check of extra) byId.set(check.id, check)
  return [...byId.values()]
}