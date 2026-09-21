/**
 * JEV PR Review — uses the TypeSafe judge (JEV) to review GitHub PRs
 * before merge.
 *
 * JEV's `JUDGE_QUESTIONS` / `JudgeOutcome` (from judge.ts) were designed
 * for agent tool-result routing. The same two semantic questions — "is this
 * a real problem?" and "how hard is this to handle?" — transfer directly
 * to PR review: a PR that touches sensitive paths or introduces subtle
 * logic bugs is a real problem; a PR with many files and subtle changes is
 * demanding to review.
 *
 * This module builds the bounded judge state from a PR diff, and
 * interprets a `JudgeOutcome` into a PR-specific verdict. The actual
 * TypeSafe API call is left to the caller (the server / CLI), which has
 * the JudgeConfig and TypesafeClient — core must not depend on the server
 * package.
 */

import type { JudgeOutcome } from './judge.ts'

/** Minimal PR metadata sourced from `gh pr view --json`. */
export interface PrMetadata {
  number: number
  title: string
  author: string
  additions: number
  deletions: number
  fileCount: number
}

/** Truncated diff + metadata, shaped like `buildJudgeState` output in judge.ts. */
export interface PrJudgeState {
  pr: {
    number: number
    title: string
    author: string
    file_count: number
    additions: number
    deletions: number
  }
  diff_excerpt: string
}

/**
 * Build a bounded judge state from a PR diff, suitable for passing to a
 * TypeSafe `ask()` call alongside `JUDGE_QUESTIONS`. Diff is truncated to
 * `maxChars` (default 6000, matching `buildJudgeState` in judge.ts) to keep the
 * judge call within token limits.
 */
export function buildPrJudgeState(
  pr: PrMetadata,
  diff: string,
  maxChars = 6000,
): PrJudgeState {
  return {
    pr: {
      number: pr.number,
      title: pr.title.slice(0, 200),
      author: pr.author,
      file_count: pr.fileCount,
      additions: pr.additions,
      deletions: pr.deletions,
    },
    diff_excerpt: diff.length > maxChars ? `${diff.slice(0, maxChars)}…[truncated]` : diff,
  }
}

export type PrReviewVerdict = 'block' | 'review' | 'merge'

export interface PrReviewJudgment {
  verdict: PrReviewVerdict
  realProblem: number
  difficulty: string | undefined
  difficultyConfidence: number
  note: string
}

export interface PrReviewThresholds {
  /** Probability >= this → block (default 0.6, matches judge.ts realProblemFloor). */
  realProblemFloor?: number
  /** Probability < this → merge without escalation (default 0.25, matches judge.ts vetoFloor). */
  realProblemVeto?: number
  /** Confidence >= this for a demanding difficulty override (default 0.6). */
  difficultyFloor?: number
}

/**
 * Interpret a `JudgeOutcome` (what TypeSafe returns for `JUDGE_QUESTIONS`)
 * into a PR-specific verdict:
 *
 * - `'block'` when `realProblem >= realProblemFloor` — JEV sees a genuine
 *   problem (security risk, sensitive-path changes, bug introduction).
 * - `'review'` when `difficulty === 'demanding'` at confidence `>= difficultyFloor`
 *   — too subtle for a rubber-stamp; needs a senior reviewer.
 * - `'merge'` otherwise.
 *
 * Thresholds mirror the defaults in `applyJudge` (judge.ts:131-133) so the
 * PR-review verdict is consistent with the routing-tier verdict.
 */
export function judgePrOutcome(
  outcome: JudgeOutcome,
  thresholds: PrReviewThresholds = {},
): PrReviewJudgment {
  const rpFloor = thresholds.realProblemFloor ?? 0.6
  const rpVeto = thresholds.realProblemVeto ?? 0.25
  const dcFloor = thresholds.difficultyFloor ?? 0.6

  const rp = outcome.realProblem ?? 0
  const dc = outcome.difficultyConfidence ?? 0
  const diff = outcome.difficulty

  let verdict: PrReviewVerdict
  let note: string

  if (rp >= rpFloor) {
    verdict = 'block'
    note = `JEV: real problem detected (probability ${rp.toFixed(2)} >= ${rpFloor})`
  } else if (diff === 'demanding' && dc >= dcFloor) {
    verdict = 'review'
    note = `JEV: demanding review required (difficulty=${diff}, confidence ${dc.toFixed(2)} >= ${dcFloor})`
  } else {
    verdict = 'merge'
    note = `JEV: cleared for merge (real_problem ${rp.toFixed(2)} < ${rpFloor}${rp < rpVeto ? ', below veto floor' : ''})`
  }

  return {
    verdict,
    realProblem: rp,
    difficulty: diff,
    difficultyConfidence: dc,
    note,
  }
}
