import type { ControllerDecision, ControllerSignals } from './types.ts'

/**
 * Five branches, first match wins. Advisory only — the caller decides whether to act on the
 * recommendation; this function never has a side effect.
 *
 * `gitClean` is informational only (goes in the `reason` string), never a gate: a dirty tree is
 * the normal mid-work state and must not, by itself, push the default branch to ASK.
 *
 * The ASK branch is a conjunction of all three conditions, not three independent triggers —
 * missing just one signal (e.g. Orca simply isn't installed) must not alone produce ASK.
 */
export function decide(s: ControllerSignals): ControllerDecision {
  if (s.multiScope) {
    return {
      action: 'ORCHESTRATE',
      rule: 'multi-scope-request',
      reason: `Request scope trigger: ${s.multiScopeTrigger}.`,
    }
  }
  if (s.stuckSession) {
    return {
      action: 'SPAWN',
      rule: 'stuck-session',
      reason: `Most recent decision (of ${s.sabiLogSampled} sampled in the last 30m) shows a hard failure with no interceding clean round — fresh context recommended.`,
    }
  }
  if (s.orcaAvailable && (s.matchingWorktree || s.matchingTerminal)) {
    return {
      action: 'DELEGATE',
      rule: 'existing-session-match',
      reason: 'Orca reports an existing worktree/terminal already open on this exact path — avoid duplicating work.',
    }
  }
  if (!s.requestGiven && !s.orcaAvailable && s.sabiLogSampled === 0) {
    return {
      action: 'ASK',
      rule: 'insufficient-signal',
      reason: 'No request text, no recent Sabi decision history, and Orca is unavailable — nothing to route on.',
    }
  }
  return {
    action: 'CONTINUE',
    rule: 'default',
    reason: `No stuck session, no matching external session, nothing broad requested (git clean: ${s.gitClean ?? 'unknown'}).`,
  }
}
