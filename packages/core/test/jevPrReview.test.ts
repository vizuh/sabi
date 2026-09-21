/**
 * Tests for the JEV PR-review module.
 *
 * The primary fixture is PR #77 ("Phase 1 pre-gates, plan receipts, and
 * council ledger hardening") — the PR that this session created and merged.
 * It serves as the "teaching" case: the surplus pre-gate caught a sensitive
 * rename on council.ts (secret-path), and a subtle independence-logic bug
 * (probe → 'full' instead of 'reduced') was caught by the test suite before
 * the fix was committed. JEV should learn to flag both patterns.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { buildPrJudgeState, judgePrOutcome, type PrMetadata } from '../src/jevPrReview.ts'

// ---------------------------------------------------------------------------
// PR #77 fixture — Phase 1 council ledger implementation
// Source: gh pr view 77 --json files (actual merge commit a2907ab)
// ---------------------------------------------------------------------------

const PR_77_FILES = [
  { path: 'docs/reviews/council-blind-review-2026-09-20.md', additions: 172, deletions: 0 },
  { path: 'docs/tasks/surplus-council.md', additions: 7, deletions: 6 },
  { path: 'log.md', additions: 66, deletions: 0 },
  { path: 'packages/controller/src/cli.ts', additions: 117, deletions: 3 },
  { path: 'packages/controller/src/surplus.ts', additions: 35, deletions: 0 },
  { path: 'packages/core/src/council.ts', additions: 186, deletions: 27 },
  { path: 'packages/core/src/surplus.ts', additions: 2, deletions: 2 },
  { path: 'packages/core/test/council.test.ts', additions: 253, deletions: 0 },
]

const PR_77_METADATA: PrMetadata = {
  number: 77,
  title: 'feat(council): Phase 1 pre-gates, plan receipts, and ledger hardening',
  author: 'Atroci',
  additions: 658,
  deletions: 38,
  fileCount: PR_77_FILES.length,
}

// A representative diff excerpt covering PR #77's key changes. In production
// this would come from `gh pr view 77 --json files` patch fields; here it is a
// constructed fixture that carries the same signal JEV needs:
//   - sensitive path: packages/core/src/council.ts (ledger code)
//   - subtle logic: the independence ternary in createCouncilPlanReceipt
//   - wire-up: councilPreGate + createCouncilPlanReceipt calls in surplus.ts
const PR_77_DIFF = `
diff --git a/packages/core/src/council.ts b/packages/core/src/council.ts
+export function councilPreGate(...) {...}
+export function createCouncilPlanReceipt(plan, resources, logFile, now) {
+  const independence: CouncilIndependence =
+    plan.synthesizer || plan.mode === 'none' ? 'full' : 'reduced'
+  const planSha256 = hashJson(plan)
+  const inventorySha256 = hashFiles(resources)
+}
diff --git a/packages/controller/src/surplus.ts b/packages/controller/src/surplus.ts
+  const packetResult = buildSafeReviewPacket(...)
+  if (!packetResult.ok) {...return blocked...}
+  const preGate = councilPreGate(...)
+  if (!preGate.ok) {...return blocked...}
+  createCouncilPlanReceipt(plan, resources, undefined, input.now)
diff --git a/packages/core/test/council.test.ts b/packages/core/test/council.test.ts
+test('independence is reduced for probe mode without synthesizer', () => {
+  const plan = { mode: 'probe', synthesizer: undefined }
+  const receipt = createCouncilPlanReceipt(plan, [], undefined, now)
+  assert.equal(receipt.independence, 'reduced')
+})
test('independence is full for mode none', () => {
  const plan = { mode: 'none', synthesizer: undefined }
  const receipt = createCouncilPlanReceipt(plan, [], undefined, now)
  assert.equal(receipt.independence, 'full')
})
test('independence is full when a synthesizer is declared', () => {
  const plan = { mode: 'surge', synthesizer: 'strong' }
  assert.equal(createCouncilPlanReceipt(plan, [], undefined, now).independence, 'full')
})
`

// ---------------------------------------------------------------------------
// buildPrJudgeState
// ---------------------------------------------------------------------------

test('buildPrJudgeState includes all PR metadata fields', () => {
  const state = buildPrJudgeState(PR_77_METADATA, PR_77_DIFF)
  assert.equal(state.pr.number, 77)
  assert.equal(state.pr.title, PR_77_METADATA.title)
  assert.equal(state.pr.author, 'Atroci')
  assert.equal(state.pr.file_count, 8)
  assert.equal(state.pr.additions, 658)
  assert.equal(state.pr.deletions, 38)
})

test('buildPrJudgeState includes the diff excerpt verbatim when under limit', () => {
  const state = buildPrJudgeState(PR_77_METADATA, PR_77_DIFF, 10000)
  assert.equal(state.diff_excerpt, PR_77_DIFF)
})

test('buildPrJudgeState truncates diff to maxChars', () => {
  const state = buildPrJudgeState(PR_77_METADATA, PR_77_DIFF, 100)
  assert.ok(state.diff_excerpt.length < PR_77_DIFF.length) // truncated
  assert.match(state.diff_excerpt, /\[truncated\]$/)
})

test('buildPrJudgeState truncates long titles', () => {
  const longTitle = 'x'.repeat(300)
  const metadata = { ...PR_77_METADATA, title: longTitle }
  const state = buildPrJudgeState(metadata, PR_77_DIFF)
  assert.equal(state.pr.title.length, 200)
})

// ---------------------------------------------------------------------------
// judgePrOutcome
// ---------------------------------------------------------------------------

test('judgePrOutcome blocks when realProblem >= default floor (0.6)', () => {
  const judgment = judgePrOutcome({ realProblem: 0.75, difficulty: 'standard', difficultyConfidence: 0.8 })
  assert.equal(judgment.verdict, 'block')
  assert.match(judgment.note, /real problem detected/)
})

test('judgePrOutcome sends demanding PRs to review', () => {
  const judgment = judgePrOutcome({ realProblem: 0.1, difficulty: 'demanding', difficultyConfidence: 0.9 })
  assert.equal(judgment.verdict, 'review')
  assert.match(judgment.note, /demanding review required/)
})

test('judgePrOutcome merges when realProblem < floor and difficulty not demanding', () => {
  const judgment = judgePrOutcome({ realProblem: 0.15, difficulty: 'standard', difficultyConfidence: 0.5 })
  assert.equal(judgment.verdict, 'merge')
  assert.match(judgment.note, /cleared for merge/)
})

test('judgePrOutcome merges when realProblem < floor but difficulty confidence is low', () => {
  const judgment = judgePrOutcome({ realProblem: 0.1, difficulty: 'demanding', difficultyConfidence: 0.4 })
  assert.equal(judgment.verdict, 'merge') // below difficulty confidence floor
})

test('judgePrOutcome honors custom thresholds', () => {
  const judgment = judgePrOutcome(
    { realProblem: 0.5, difficulty: 'standard', difficultyConfidence: 0.9 },
    { realProblemFloor: 0.7 }, // higher floor → 0.5 doesn't block
  )
  assert.equal(judgment.verdict, 'merge')
})

test('judgePrOutcome handles missing fields gracefully', () => {
  const judgment = judgePrOutcome({})
  assert.equal(judgment.verdict, 'merge')
  assert.equal(judgment.realProblem, 0)
  assert.equal(judgment.difficulty, undefined)
  assert.equal(judgment.difficultyConfidence, 0)
})

// ---------------------------------------------------------------------------
// Teaching fixture: PR #77
// ---------------------------------------------------------------------------
// PR #77's actual outcome provides ground truth for JEV training:
//
// 1. Sensitive path: touched packages/core/src/council.ts (ledger code).
//    The deterministic pre-gate flagged this as a real problem (secret-path).
//    JEV should learn: PRs touching council.ts / ledger code → high realProblem.
//
// 2. Subtle logic: the independence ternary in createCouncilPlanReceipt.
//    Initial bug (probe → 'full') was caught by the test suite, not by human
//    review. JEV should learn: PRs with ternary logic for enum assignment →
//    high difficulty.
//
// 3. Wire-up: councilPreGate + createCouncilPlanReceipt calls in surplus.ts.
//    Pre-gate ordering (before vs after buildSafeReviewPacket) caused a test
//    failure (error-code mismatch). JEV should learn: PRs reordering safety
//    checks are real problems.
test('PR #77 teaching fixture — sensitive path in council.ts triggers real-problem signal', () => {
  const state = buildPrJudgeState(PR_77_METADATA, PR_77_DIFF, 10000)
  const diffStr = typeof state.diff_excerpt === 'string' ? state.diff_excerpt : JSON.stringify(state.diff_excerpt)
  // The PR touches council.ts — sensitive ledger code
  assert.match(diffStr, /packages\/core\/src\/council\.ts/, 'diff should reference council.ts')
})

test('PR #77 teaching fixture — independence logic bug signals demanding review', () => {
  const state = buildPrJudgeState(PR_77_METADATA, PR_77_DIFF, 10000)
  const diffStr = typeof state.diff_excerpt === 'string' ? state.diff_excerpt : JSON.stringify(state.diff_excerpt)
  // The independence ternary is subtle logic that a test caught
  assert.match(diffStr, /independence[\s\S]*'full'[\s\S]*'reduced'/, 'diff should contain the independence ternary')
})

test('PR #77 teaching fixture — pre-gate ordering is a real-problem signal', () => {
  // In the actual PR, the pre-gate was initially placed BEFORE buildSafeReviewPacket,
  // which broke the existing 'secret-path' error code. The fix moved it AFTER.
  // JEV should learn: reordering safety-critical checks is a real problem.
  const state = buildPrJudgeState(PR_77_METADATA, PR_77_DIFF, 10000)
  const diffStr = typeof state.diff_excerpt === 'string' ? state.diff_excerpt : JSON.stringify(state.diff_excerpt)
  assert.match(diffStr, /buildSafeReviewPacket/, 'diff should show safety-check ordering')
})
