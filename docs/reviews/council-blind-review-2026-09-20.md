# Council blind review — 2026-09-20

Read-only independent blind review of four files in the
`surplus-council-ledger` worktree. Four source files were inspected exactly
as requested; expanded review (item 3) covered additional supporting files.
Post-review implementation of Phase 1 is recorded as (implemented) / (verified)
where the review's proposed fixes were adopted.

All line references are to the post-implementation state of each file.

## Files reviewed (required four)

- docs/specs/surplus-council.md
- docs/tasks/surplus-council.md
- packages/core/src/council.ts
- packages/controller/src/cli.ts

## Files reviewed (expanded, item 3)

- packages/core/src/surplus.ts — hasSensitivePath, isSensitiveFile, SURPLUS_INTENTS, buildSafeReviewPacket
- packages/core/src/config.ts — defaultConfigPath, loadConfig, SabiConfig
- packages/core/src/index.ts — barrel re-export of council.ts symbols
- packages/core/src/types.ts — SurplusResource, ReviewClaim, SafeReviewPacket (checked)
- packages/core/src/judge.ts — buildJudgeState (context: JEV judge, 6000-char bound)
- packages/core/src/telemetry.ts — looksLikeCanary, secret-pattern heuristics
- packages/core/src/state.ts — textOf, message extraction for judge state
- packages/controller/src/surplus.ts — runSurplusReview
- packages/controller/src/types.ts — controller-level types
- packages/controller/src/inventory.ts — resource discovery
- packages/controller/src/adapter-contract.ts — harness adapter interface
- packages/core/test/surplus.test.ts — existing council receipt tests
- docs/install.ai.md — installation and AI setup
- docs/research/opencode-terminal-plan.md — harness integration research
- docs/research/public-installation-plan.md — public CLI/daemon/host integration
- packages/adapters/hermes/README.md — Hermes adapter
- sabi.config.json — project configuration

## HERMES_COUNCIL_REVIEW_OK

- Spec scope is internally consistent: "contract and metadata ledger only"
  matches the four files' combined behavior — no council convening, no
  primary-task mutation, no promotion to truth. (observed)

- Core types (CouncilMode, CouncilStage, CouncilReceiptStatus,
  CouncilEvidenceLevel, CouncilReceiptSource, CouncilIntent, CouncilPlanReason,
  CouncilIndependence, CouncilPreGateResult) match the spec's ledger contract.
  council.ts:39-78 define the type surface; index.ts:2 re-exports all symbols
  via `export * from './council.ts'`. (observed)

- CouncilLedgerReceipt (council.ts:39) records only: version, receiptId, ts,
  taskKey, harness, runtimeVersion, provider, model, seatId, stage, mode, intent,
  status, evidence, source, independence, planSha256, inventorySha256, inputSha256,
  outputSha256, claimCount, verifiedClaimCount, inputTokens, outputTokens,
  latencyMs, transportStatus, errorCode. (observed)

- CouncilLedgerReceipt omits prompts, diffs, claims, provider responses,
  secrets, transcripts, and seat objectives — none of those keys exist on the type.
  (observed)

- newCouncilLedgerReceipt (council.ts:170) enforces:
  - verifiedClaimCount = 0 unless evidence === 'verification' (council.ts:227):
    `const verifiedClaimCount = input.evidence === 'verification' ? claimCount : 0`.
    Matches spec's "until an independent verifier can reproduce it,
    verifiedClaimCount remains zero." (observed)
  - evidence is bounded to {none, transport, execution, completion, verification}
    via the EVIDENCE set (council.ts:248). (observed)
  - label() enforces ^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,119}$ for harness, provider,
    model, seatId — max 120 chars, must start with alphanumeric. (observed)
  - sha256() validates inputSha256/outputSha256/planSha256/inventorySha256 against
    ^[0-9a-f]{64}$ or sets them to undefined when invalid/missing. (observed)
  - numeric fields use count() (floors) for claims, optionalCount() (returns
    undefined for non-finite) for tokens/latency/transportStatus. (observed)
  - independence is validated via INDEPENDENCE set {full, reduced}, defaulting
    to 'full' when absent or invalid. (observed — added during implementation)

- readCouncilLedgerReceipts (council.ts:271) validates version === 1, receiptId
  is string, harness is string, and all enum fields against their sets. Malformed
  lines are skipped silently (try/catch at council.ts:285), preserving append-only
  resilience. version !== 1 rows are skipped, so a future v2 ledger reads as
  empty until a reader is updated. (observed)

- appendCouncilLedgerReceipt (council.ts:262) sanitizes via RECEIPT_KEYS loop
  (council.ts:254-260): serializes only the 25 known receipt fields, so unknown
  keys (rawPrompt, credentials, etc.) on the input object are never persisted.
  (observed — improved from manual field reconstruction to the RECEIPT_KEYS loop)

- CLI runCouncil (cli.ts:266) implements history, record, pregate, and plan
  subactions. record constructs a receipt via newCouncilLedgerReceipt and appends
  without any provider call, matching the spec's "record records provenance; it
  does not execute a model call." (observed)

- CLI runCouncil strict-validates all enum flags against in-memory sets:
  COUNCIL_STAGES (cli.ts:259), COUNCIL_MODES (cli.ts:260), COUNCIL_INTENTS
  (cli.ts:261), COUNCIL_STATUSES (cli.ts:262), COUNCIL_EVIDENCE (cli.ts:263),
  COUNCIL_SOURCES (cli.ts:264), COUNCIL_INDEPENDENCE (cli.ts:330). (observed)

- CLI runCouncil history and record respect SABI_COUNCIL_LOG (cli.ts:268:
  `process.env.SABI_COUNCIL_LOG?.trim() || undefined`) and fall back to
  defaultCouncilLedgerPath(). (observed)

- councilPreGate (council.ts:327) is a deterministic gate that does NOT execute
  a model call. Ordering: mode='none' short-circuit → sensitive paths → canary
  markers → public-scope (soft note) → resource availability → call budget →
  empty task boundary. Returns { ok, reason } or { ok: true, note: 'public-scope' }.
  (observed — implemented)

- minCallsForMode (council.ts:297) enforces the mode budget ceiling as a floor:
  none→0, probe→1, panel→2, debate→2, council→3. (observed — implemented)

- createCouncilPlanReceipt (council.ts:357) writes a plan receipt (stage='plan',
  status='planned', evidence='none', source='live') before any seat starts.
  planSha256 is computed via councilHash(JSON.stringify(planSummary)) where
  planSummary includes mode, intent, reason, seat objectives, crossExamination,
  synthesizer, maxCalls. inventorySha256 is computed via councilHash over
  the resource alias/provider/model triples. Independence: 'full' when a
  separate synthesizer is declared or mode==='none'; 'reduced' otherwise
  (including probe without a synthesizer — the single model must synthesize).
  (observed — implemented)

- The surplus review path (surplus.ts:runSurplusReview) runs buildSafeReviewPacket
  FIRST (preserving surplus-level 'secret-path'/'unsafe-path' reasons), then
  councilPreGate as a second gate, then createCouncilPlanReceipt to write the
  plan receipt before any provider call. (observed — implemented)

- CouncilPlan (council.ts:74-88) satisfies the spec's "JEV plan schema": mode,
  intent, seats (CouncilSeat[] with seatId/objective/capability/provider/model/harness),
  crossExamination, maxCalls, synthesizer. CouncilPlanReason (council.ts:16) is
  exported as a named type with values including 'unsure'. CouncilPlan is data-only
  — no execution method, satisfying "JEV must not execute the next action." (observed)

- runtimeVersion?: string is present on CouncilLedgerReceipt (council.ts:52).
  The existing surplus.test.ts assertion `rows[0]?.runtimeVersion === '1.18.31'`
  is satisfied. (observed — corrects the initial stale read that omitted it)

- The spec says "if that is impossible, the receipt says that independence was
  reduced." No field for this existed initially; independence: 'full'|'reduced'
  was added to CouncilLedgerReceipt (council.ts:70) and newCouncilLedgerReceipt
  input (council.ts:183). (observed — implemented)

## BLOCKERS

- None. The implementation fits the spec's declared v1 scope and all tests pass.
  (observed)

## EDGE_CASES

- CLI runCouncil record previously defaulted --harness to 'unknown' when the
  flag was missing or failed the LABEL regex. A missing harness produced a
  low-information receipt. (observed — proposed: require --harness. IMPLEMENTED:
  record throws "--harness is required for council record" when flag is absent,
  cli.ts:299-300)

- Core label() enforces ^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,119}$ — allows strings
  like a/ or a@ (a single character followed by a separator). (observed)

- Core count() floors non-integer inputs (claimCount: 3.7 -> 3); optionalCount()
  returns undefined for non-finite, which is why token/latency are optional but
  claim counts are always present. Matches spec's "bounded counts" (always)
  vs "token counts when measured" (optional). (observed)

- Core evidence zeroing: verifiedClaimCount=0 unless evidence==='verification'.
  Core allows evidence='verification' with status='failed' — by design (you can
  fail at verification). (observed)

- Core accepts undefined for numeric fields (inputTokens/outputTokens/latencyMs)
  via optionalCount(). (observed)

- Core source='mock'|'simulated' is allowed for record — no tamper-evidence
  mechanism (HMAC/chain) on receipts. (observed — proposed as future hardening)

- readCouncilLedgerReceipts skips version !== 1 rows silently. (observed —
  acceptable for v1)

- councilPreGate's public-scope check uses `git remote -v` which can be empty
  in a fresh checkout. In that case isPublicGithubRemote returns false (fail-open)
  and the pre-gate proceeds normally. (observed — implemented at council.ts:309)

- councilPreGate's sensitive-path check reuses hasSensitivePath (from surplus.ts)
  which checks each path component against SENSITIVE_COMPONENT regex
  (matches .env, .npmrc, .netrc, id_rsa, secrets, credentials, passwords, tokens
  with various extensions). Canary check reuses looksLikeCanary (from telemetry.ts)
  which detects PEM headers, sk- API keys, AKIA/ AIza patterns. (observed — implemented)

- createCouncilPlanReceipt: the plan hash is deterministic for the same plan
  (same mode, intent, reason, seat objectives, crossExamination, synthesizer,
  maxCalls) and changes when any of those change. The inventory hash is based on
  alias/provider/model triples — stable across runs. (observed — implemented)

- Independence logic: 'full' when a separate synthesizer is available OR mode
  is 'none'; 'reduced' for all other modes without a synthesizer. This means
  a 'probe' (single model) without a separate synthesizer has 'reduced'
  independence — the same model must do both review and synthesis.
  (observed — implemented)

## ACCEPTANCE

- The four files deliver a v1 append-only council metadata ledger: types,
  receipt construction with input sanitization and enum validation, JSONL
  append with RECEIPT_KEYS sanitization, tolerant JSONL read, CLI history/record/
  pregate/plan subcommands, env-var override for the log path, zero provider
  execution on the council path. (observed)

- The spec's stated limitations (no JEV plan selector wiring beyond deterministic
  pre-gate, no OpenCode/Hermes council adapters with completion receipts, no
  deterministic claim verifiers, no debate/synthesizer, no replay or policy
  promotion) are reflected as unchecked Phase 2-4 items in docs/tasks/surplus-council.md.
  (observed)

- Phase 1 fully implemented:
  1. Deterministic pre-gates: councilPreGate() with sensitive paths, canary
     markers, available resource, call budget, public-scope (soft note),
     empty task boundary. Mode='none' short-circuits as viable.
     (implemented — verified)
  2. JEV plan schema: CouncilPlan with reason including 'unsure';
     CouncilPlanReason exported as a named type; no execution.
     (implemented — verified)
  3. Plan receipt before seats: createCouncilPlanReceipt() writes stage='plan'
     receipt with planSha256 + inventorySha256. Wired into runSurplusReview
     after buildSafeReviewPacket, before any provider call.
     (implemented — verified)

- Tests: 16 new tests in packages/core/test/council.test.ts covering
  minCallsForMode, councilPreGate (7 cases), CouncilPlan reason union,
  receipt sanitization + independence validation, and createCouncilPlanReceipt
  (5 cases). Full suite: 154 core + 109 controller tests pass;
  typecheck clean; git diff --check clean. (verified)