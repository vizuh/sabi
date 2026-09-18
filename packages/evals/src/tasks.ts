import type { ChatMessage } from '@sabi/core'

export interface EvalTask {
  id: string
  /** Short human label, e.g. "auth refactor". */
  name: string
  /** The fixed user prompt for this task. */
  instruction: string
  /** The tool-only transcript for this task (no assistant reasoning), replayed per round. */
  messages: ChatMessage[]
  /** Quality outcome observed when this task was recorded (pass/fail/blocked). */
  outcome: 'pass' | 'fail' | 'blocked'
  /** Human note on how the outcome was judged. */
  note: string
  /** True when the task required any tool call that reported its own error. */
  hadFailure?: boolean
  /**
   * Round ordinal after which the host rewrote (compacted) the transcript. The replay keeps the
   * linear transcript — the rewrite happens host-side — but performs the same invalidation the
   * adapters do when the transcript they observe shrinks: the failure streak restarts and the
   * context generation advances.
   */
  compactedAfterRound?: number
}

const tools = (): Array<{ function: { name: string } }> => [
  { function: { name: 'read_file' } },
  { function: { name: 'grep' } },
  { function: { name: 'shell_command' } },
  { function: { name: 'edit_file' } },
]

const system: ChatMessage = { role: 'system', content: 'you are a coding agent' }

/**
 * Frozen task set for the offline eval harness. Each task carries a recorded quality
 * outcome so routing economics can be gates by task success, per the competitive
 * scorecard: "do not infer correctness from a rule name".
 */
export const TASK_SET: EvalTask[] = [
  {
    id: 'explore-small-grep',
    name: 'grep for auth code',
    instruction: 'Find where the auth token is validated.',
    messages: [
      system,
      { role: 'user', content: 'Find where the auth token is validated.' },
      { role: 'assistant', tool_calls: [{ function: { name: 'grep', arguments: '{"pattern":"auth"}' } }] },
      { role: 'tool', content: '3 matches in 2 files' },
    ],
    outcome: 'pass',
    note: 'grep returns matches; cheap round suffices',
  },
  {
    id: 'read-hard-reasoning',
    name: 'read security-sensitive file',
    instruction: 'Read src/security.ts and summarize the auth flow.',
    messages: [
      system,
      { role: 'user', content: 'Read src/security.ts and summarize the auth flow.' },
      { role: 'assistant', tool_calls: [{ function: { name: 'read_file', arguments: '{"absolute_path":"/repo/src/security.ts"}' } }] },
      { role: 'tool', content: 'export function validate(token) { … crypto timingSafeEqual … }' },
    ],
    // The review flagged: reading a complex security-sensitive file can select the
    // exploration tier. This task records that the next step is hard reasoning.
    outcome: 'pass',
    note: 'hard reasoning after read; quality gate should exercise it',
  },
  {
    id: 'edit-implementation',
    name: 'fix a small bug',
    instruction: 'Fix the typo in the function name.',
    messages: [
      system,
      { role: 'user', content: 'Fix the typo in the function name.' },
      { role: 'assistant', tool_calls: [{ function: { name: 'edit_file', arguments: '{"file_path":"/repo/src/b.ts","content":"…"}' } }] },
      { role: 'tool', content: 'file updated' },
    ],
    outcome: 'pass',
    note: 'edit round; mid tier',
  },
  {
    id: 'verify-failing-test',
    name: 'run tests that fail',
    instruction: 'Run the test suite and fix the failing test.',
    messages: [
      system,
      { role: 'user', content: 'Run the test suite and fix the failing test.' },
      { role: 'assistant', tool_calls: [{ function: { name: 'shell_command', arguments: '{"command":"npm test"}' } }] },
      { role: 'tool', content: 'Tests: 2 failed, 10 passed\nexit code: 1' },
    ],
    outcome: 'fail',
    hadFailure: true,
    note: 'verified failure; should escalate to strong',
  },
  {
    id: 'expected-failure-user',
    name: 'user-requested failing command',
    instruction: 'Run node app.js and show me the output even if it fails.',
    messages: [
      system,
      { role: 'user', content: 'Run node app.js and show me the output even if it fails.' },
      { role: 'assistant', tool_calls: [{ function: { name: 'shell_command', arguments: '{"command":"node app.js"}' } }] },
      { role: 'tool', content: 'Error: ECONNREFUSED\nexit code: 1' },
    ],
    outcome: 'pass',
    hadFailure: true,
    note: 'expected failure; Jev veto should keep it cheap',
  },
  {
    id: 'stuck-repeated-failure',
    name: 'repeated identical test failure',
    instruction: 'Fix the failing test (it keeps failing the same way).',
    messages: [
      system,
      { role: 'user', content: 'Fix the failing test (it keeps failing the same way).' },
      { role: 'assistant', tool_calls: [{ function: { name: 'shell_command', arguments: '{"command":"npm test"}' } }] },
      { role: 'tool', content: 'Tests: 1 failed, 11 passed\nexit code: 1' },
      { role: 'assistant', tool_calls: [{ function: { name: 'shell_command', arguments: '{"command":"npm test"}' } }] },
      { role: 'tool', content: 'Tests: 1 failed, 11 passed\nexit code: 1' },
    ],
    outcome: 'fail',
    hadFailure: true,
    note: 'repeated failure; should route to stuck tier, not escalate forever',
  },
  {
    id: 'rate-limited-upstream',
    name: 'model upstream rate limit',
    instruction: 'Continue the task (the model call hit a rate limit).',
    messages: [
      system,
      { role: 'user', content: 'Continue the task (the model call hit a rate limit).' },
      { role: 'assistant', tool_calls: [{ function: { name: 'shell_command', arguments: '{"command":"curl api"}' } }] },
      { role: 'tool', content: 'HTTP 429 too many requests: rate limit exceeded' },
    ],
    outcome: 'pass',
    hadFailure: true,
    note: 'transport signal; must route to the transport tier, never escalate to strong',
  },
  {
    id: 'compaction-reset',
    name: 'same failure repeated across a host compaction',
    instruction: 'Fix the failing test suite.',
    messages: [
      system,
      { role: 'user', content: 'Fix the failing test suite.' },
      { role: 'assistant', tool_calls: [{ function: { name: 'shell_command', arguments: '{"command":"npm test"}' } }] },
      { role: 'tool', content: 'Tests: 1 failed, 11 passed\nexit code: 1' },
      // The host rewrote everything above into a summary before this round. The first failure is
      // no longer part of the attempt the model is continuing, so it must not become a streak.
      { role: 'assistant', tool_calls: [{ function: { name: 'shell_command', arguments: '{"command":"npm test"}' } }] },
      { role: 'tool', content: 'Tests: 1 failed, 11 passed\nexit code: 1' },
    ],
    compactedAfterRound: 1,
    outcome: 'fail',
    hadFailure: true,
    note: 'the identical second failure is not a continuation: after a rewrite the streak restarts at 1, so the rule stays failure instead of stuck',
  },
]