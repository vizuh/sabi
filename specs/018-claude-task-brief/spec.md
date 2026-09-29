# Feature Specification: Claude Task Brief

**Feature Branch**: `spec/claude-task-brief`
**Created**: 2026-09-28
**Status**: Draft

**Input**: Prepare a task on the free lane, then hand Claude a short, verified
brief to execute from a fresh session. Hugo, 2026-09-28: "Sabi can build the
task briefly and pass to Claude with free tokens, then Claude should have a
better prepared path and tasks … using Anthropic prompt guidelines."

The product line this serves: **spend free inference to make the expensive
agent's first token better**, rather than replacing its calls one for one.
Stated as a mechanism: Sabi compiles cheap exploration into verified context
for an expensive executor. Hermes, OMP and Claude Code are the first
occupants of those roles, not the feature; the task brief is a Sabi Control
primitive that any preparer and any executor can plug into.

**Relationship to existing work**

- **Controller handoff (001).** This is not a new subsystem: the Claude start
  is a controller `SPAWN` whose `HandoffSnapshot` carries a generated capsule.
  `HandoffSnapshot` (`packages/controller/src/types.ts`) already has
  `objective`, `originalRequest`, `repo`, `changedFiles` and `nextAction`;
  `RecoveryCapsule` ("compact cross-context handoff") already has
  `verifiedFacts` and `verifiedNonSolutions` as provenance-tagged items, plus
  `attemptedApproaches`. The brief renders those fields; new fields are added
  only where the brief needs something they lack (see Brief format).
- **Claude adapter.** `packages/controller/src/adapter-contract.ts` declares
  Claude Code `dispatch: 'cli'` and `receive-prompt: 'hook'`. The brief uses
  those two surfaces and nothing else.
- **Control decision interface (016).** "Sabi recommends, host applies." The
  host harness does the exploring and runs the commands; Sabi receives its
  findings, checks what it can check by reading, and assembles the brief. Sabi
  does not become a shell, a filesystem layer, or a planning engine
  (`docs/prd.md`, "Sabi does not own").
- **Jev (TypeSafe judge).** `evidenceRedundant` is recorded in shadow on judged
  rounds (`packages/core/src/judge.ts`), but it scores *the last tool result of
  a proxy round*, not an arbitrary evidence item. Ranking brief items needs a
  new per-item judge question, or a mapping from each item back to the round
  that produced it (see Open questions).
- **Borrowed-harness auth.** Not used, by any role. Preparers reach models
  through Sabi's normal `sabi/sabi-code` provider with Sabi's configured
  upstream authentication; borrowed credentials stay a separate transport
  capability this feature does not depend on. The workflow never proxies,
  edits, or compresses a live Claude session.

---

## Problem

A Claude Code session starts cold. It spends its first rounds reading files,
finding the test command, and reconstructing constraints that another model
could have gathered for free. Those rounds cost subscription capacity and grow
the context the rest of the session carries.

Long contexts may also cost instruction fidelity. Hugo reports Claude
consistently drifting from instructions as sessions grow, visible as missed
`VIZUH` canaries that the Stop hook forces Claude to reissue. This is a report,
not yet a measurement; SC-004 counts it.

What Sabi cannot do is fix that from inside a running session. Rewriting or
compressing Claude's history in flight would:

- invalidate the prompt cache, so the full context is re-read at full price;
- invalidate earlier thinking blocks on current models (edited history is
  rejected outright on accounts created on or after 2026-08-31);
- break Sabi's own boundary: the harness loop stays native, and on the borrowed
  route the request is forwarded unchanged apart from `model`.

The boundary where compression is safe is **before** the session: a fresh
Claude session that starts from a small, verified brief.

## Workflow

```text
TASK
 │
 ▼
PREPARER                 any harness on the free tier (Hermes first, then OMP, others later)
 │                       runs in a disposable isolated worktree
 │ structured findings
 ▼
EVIDENCE GATE            source + provenance + verification (Sabi reads; never runs commands)
 │
 ▼
BRIEF COMPILER           deterministic, bounded
 │   verified facts · relevant surface · ruled out · uncertainties
 │   constraints · success criteria · proposed path
 ▼
SABI CONTROL             SPAWN with the brief
 │
 ▼
EXECUTOR                 Claude Code, fresh context, on the user's real worktree
 │
 ▼
RECEIPT                  tokens, turns, outcome, bounds applied
```

1. **Intake.** `sabi brief "<task>"` is the canonical entry point and the
   only implementation. Every other entry calls it; there is no second code
   path. Three Claude-side entry modes, all on that primitive:
   - `sabi brief "<task>"`: prepare, write the brief, then spawn Claude.
   - `sabi claude "<task>"`: a convenience wrapper with the same behaviour,
     named for the executor. Name to confirm at implementation.
   - **Already inside Claude Code:** the prompt hook runs under a 10-second
     budget (`HOOK_TIMEOUT_SECONDS` in `packages/controller/src/hooks.ts`), so
     it MUST NOT prepare synchronously. It may only recommend a brief for a
     next handoff, or start preparation in the background for one. The
     current Claude turn is never made to wait on, or be changed by,
     preparation.

   A later mode, not part of this slice: Claude itself decides a task needs
   repository-wide reconnaissance and invokes `sabi brief` mid-session, then
   continues from the returned brief.
2. **Preparation in an isolated worktree.** Sabi creates a disposable,
   detached git worktree at the user's current `HEAD` and starts the preparer
   there. The preparer explores with its own tools: it locates the files the
   task touches, finds and runs the test or build command, and reproduces the
   failure if there is one. Commands can rewrite snapshots, generated files or
   lockfiles, which is why they never run in the user's worktree. Sabi routes
   the preparer's inference; it does not run tools. The preparer returns
   structured findings, each with an evidence reference (see Evidence model).
   The worktree is removed afterwards. If the user's worktree has uncommitted
   changes, preparation saw `HEAD` without them; `<repo_state>` says so.
3. **Evidence gate.** Sabi checks what it can check by reading. A file
   reference is re-read **in the user's live worktree**, so a fact about a line
   the user has since changed does not pass. A command reference counts as
   verified only when it comes from the preparer's recorded tool result in the
   isolated worktree, and it is labelled with that worktree's base commit;
   Sabi never reruns commands. Everything else goes under `<uncertainties>`. A
   free model's claim never enters the brief as a fact without one of those
   checks.
4. **Selection.** Evidence is bounded, as an experimental default to be tuned
   from receipts, not a protocol limit: at most 20 items and 8 KB per brief,
   and at most 1 KB per item, so one large command output cannot take the
   whole budget. Excerpts over the per-item bound are truncated and marked.
   The receipt records `included`, `dropped`, `bytesBefore` and `bytesAfter`.
   A Jev-based ranking, if adopted, runs in shadow first: it records what it
   would drop while the brief keeps everything within bounds.
5. **Assembly.** Code, not a model, renders the brief from a fixed template
   (see Brief format), so its structure is testable and does not drift.
6. **Handoff.** Sabi dispatches a fresh Claude Code session through the
   adapter's CLI surface, for example
   `claude --name sabi-brief-<id> --effort <level> "<pointer prompt>"`
   (`claude "query"`, `--name` and `--effort` are documented CLI surface). The
   prompt is short and points at the brief files; Claude reads them itself.
   Current models recover state from files and git well, and a pointer keeps
   the first prompt small. Claude verifies the evidence its plan depends on
   before building on it.
7. **Receipt.** The controller records the dispatch receipt and, when
   available, the session's outcome, token use and turn count, in the existing
   evidence layers (source/tests, installed config, live activation, real
   execution), never promoting one into another.

**Fail-open.** If the free lane fails, times out, or yields nothing verified,
Sabi hands Claude the plain task and says the brief was not built. It never
blocks the user's task on preparation.

## Harness mapping

**A free model is not a preparer.** A model behind OpenRouter cannot read a
file or run a test on its own, and Sabi does not own a shell. Preparation
always runs inside a harness, with its own tools, whose inference Sabi routes
to free or cheap models.

**Strategy comes from capabilities, not from harness names.** The task-brief
strategy is selected from the capabilities declared or proven for the active
harness: the operations in `packages/controller/src/adapter-contract.ts` and
the model-selection fields in spec 017 (`canApplyRecommendation`,
`selectionScope`, `reportsCatalog`). This specification does not introduce a
separate capability manifest; unifying those sources is spec 019. Claude Code,
Hermes, OMP and other hosts may therefore take different preparation paths
while producing the same verified brief boundary. A capability that has not
been declared or probed counts as unavailable.

The workflow has two roles, **preparer** (explores on the free tier) and
**executor** (does the work from the brief). Each harness reaches Sabi through a
different surface, so what Sabi can see, verify and deliver differs. Nothing
below is assumed to carry across harnesses; each row cites where it was
established, and anything not yet exercised is marked open.

| | Claude Code | Hermes | OMP (oh-my-pi) |
|---|---|---|---|
| Role here | Executor | Preparer | Preparer |
| How Sabi sees its inference | It doesn't. Subscription traffic goes straight to Anthropic; the borrowed route is not wired (`sabi doctor`: passthrough ○, 2026-09-28) | Every round, through the proxy with `llm_request` attribution middleware (`docs/adapters/hermes.md`) | Every round, through the proxy via the normal `sabi/sabi-code` provider with Sabi's configured upstream auth (`docs/adapters/oh-my-pi.md`); the borrowed-credential override is not used |
| Controller surface | Manifest `partial`: `receive-prompt: hook`, `dispatch: cli`, `observe-outcome: cli` (`adapter-contract.ts`) | Inventory only (`inventory.ts` lists `hermes`); no controller manifest | Extension: no turn boundary, no catalog read, `setModel` only in a user action (spec 017, OMP 18.4.1). RPC mode: `omp --mode rpc` takes `{"type":"prompt","message":…}`; `set_model` field name not pinned (decisions, 2026-09-28) |
| How a session starts | `claude --name … --effort … "<pointer>"` (CLI reference) | `HERMES_HOME=… hermes chat` with the generated `custom:sabi` profile (`docs/install.ai.md`) | `omp --extension … ` interactively, or an RPC `prompt` for a scripted preparation run |
| How findings leave the harness | n/a | Open: no export path today. Candidates: a Hermes skill that writes findings to the brief directory, or a registered tool | Open. Candidate: `registerTool` (on the probed extension surface) adds a `sabi_record_finding` tool the preparing agent calls with source and claim |
| Tying a finding to its round | n/a | Likely: attribution middleware already tags rounds; to confirm per finding | Open: whether override rounds carry a session identity Sabi can join on |
| Instruction files it loads | `CLAUDE.md` chain (imports `AGENTS.md` here), skills in `~/.claude/skills/` | Open: not mapped yet | Open: not mapped yet |
| Known limits | Sabi cannot read Claude's token use directly; SC-001 needs a source (transcript or status line), open | Extra capability-discovery GETs; auxiliary and subagent paths are separate, unverified gates | Entitlements are not extractable; OMP's "openrouter" models are served via `opencode.ai`, not OpenRouter (decisions, 2026-09-28) |

What follows from the table:

- **Preparation belongs where Sabi sees the rounds.** Hermes and OMP both
  route every round through the proxy, which is what makes round-level
  telemetry, cost at $0, and a finding-to-round link (for any Jev ranking)
  possible. Claude Code offers none of that on the current wiring, so it is
  executor only.
- **Each preparer needs its own findings channel.** A structured tool call
  (source plus claim) is preferred over parsing prose, because it makes FR-002
  checkable. The channel is harness-specific and is the first thing each
  slice must prove.
- **OMP has two different surfaces.** The extension surface cannot start or
  steer a run; RPC mode can. A scripted preparation run on OMP should use RPC
  once the `set_model` field is pinned, not the extension.
- **The executor side is Claude-specific in this spec.** Codex and OpenCode
  have the same `partial` controller manifest and could be executors later;
  that is a follow-up, not part of the first slice.

Slice order proposed: (1) Hermes preparer + Claude executor, because Hermes has
the most verified proxy path; (2) OMP preparer through RPC; (3) other executors.

## Evidence model

"Facts require evidence" has to hold in the data, not only in the wording.
Today `RecoveryCapsuleItem` is `{ label, status, source }`, where `source` is a
category (`'tool' | 'user' | 'harness' | 'judge' | 'summary'`,
`packages/core/src/types.ts`). It cannot carry a `file:line` or a command and
its exit code, so a rendered brief would lose the provenance the gate checked.

The item gains an optional structured reference:

```ts
interface EvidenceRef {
  kind: 'file' | 'command'
  // file
  path?: string          // repository-relative
  lineStart?: number
  lineEnd?: number
  // command
  command?: string
  exitCode?: number
  baseCommit?: string    // the isolated worktree's HEAD
  // provenance
  roundId?: string       // the proxy round that produced the finding, when known
  preparer?: string      // harness id, e.g. 'hermes'
}

interface RecoveryCapsuleItem {
  label: string
  status: EvidenceStatus
  source: EvidenceSource
  ref?: EvidenceRef      // required when status is 'verified' in a task brief
}
```

`ref` is optional so existing recovery capsules stay valid. In a task brief,
an item without a `ref` cannot have `status: 'verified'`; the gate demotes it
to `<uncertainties>`.

## Brief format

The template follows Anthropic's published prompting guidance (Sources below):
long material first and the request last; one XML tag per kind of content;
context and the reason behind each constraint, not pressure language; outcomes
and verification rather than step-by-step choreography; and a fresh context
window that starts from files and git state rather than a compacted transcript.

Files, under a user-scoped directory outside the target repository
(proposal: `~/.config/sabi/briefs/<id>/`), so briefs never appear as untracked
files in a client or product repo. Claude Code must be able to read that path;
the dispatch prompt names it explicitly.

- `brief.md`: the brief Claude reads first.
- `state.json`: structured state, including the verification checklist and the
  status of each item (`not_started` | `passing` | `failing`).
- `progress.md`: free-form notes Claude appends to across context windows.

`brief.md` sections, in this order. Long material comes first, the request
last. Where a section maps to an existing field, the field is named.

| Section | Holds | Existing field |
|---|---|---|
| `<repo_state>` | branch, commit, working-tree status, relevant environment | `HandoffSnapshot.repo`, `changedFiles` |
| `<verified_facts>` | fact → evidence reference (`file:line`, or command + recorded exit code) | `RecoveryCapsule.verifiedFacts` |
| `<relevant_surface>` | files, functions, tests and commands likely involved | new |
| `<ruled_out>` | what was tried, and the evidence it failed | `attemptedApproaches`, `verifiedNonSolutions` |
| `<uncertainties>` | what the free lane claimed but Sabi could not check | new |
| `<proposed_path>` | a short ordered plan, labelled as a hypothesis | new |
| `<context>` | who this is for, what the result enables, why now | `objective` |
| `<constraints>` | constraints specific to this task, each with its reason | new |
| `<task>` | the outcome to reach, as a checkable goal | `originalRequest` |
| `<success_criteria>` | observable conditions for done: command, expected result, where to record it | new |
| `<first_action>` | the best next thing to inspect or run | `nextAction` |

**The rule the template enforces: facts require evidence; plans do not become
facts.** "The bug is probably in `auth.ts`" is a hypothesis and goes in
`<proposed_path>`. It enters `<verified_facts>` only when the harness opened
the file, and Sabi confirmed the quoted line. This is what protects Claude from
a cheap model's mistakes while keeping most of the saving.

What the template deliberately leaves out, and why:

- No step lists for judgement work; current models plan better than a script
  written in advance.
- No MUST/NEVER emphasis; current models over-apply it.
- No transcript, raw tool output beyond bounded excerpts, credentials, or
  anything from `secrets/` or `.env`.
- No restatement of the repository's instruction files; Claude Code loads them
  itself, and a second copy would compete with the original.

## User Scenarios & Testing

### User Story 1 - Brief, then execute (Priority: P1)

Hugo gives a bug-fix task. The free lane finds the failing test, the two files
involved and the test command; Sabi writes the brief and starts Claude, which
fixes the bug without re-exploring.

**Why this priority**: This is the whole value; everything else refines it.

**Independent Test**: Run on a fixture repository with a known failing test;
assert the brief's `<verified_facts>` holds the verified test command and failing
assertion, and that the dispatched Claude prompt points at `brief.md`.

**Acceptance Scenarios**:

1. **Given** a task and a reachable free lane, **When** preparation succeeds,
   **Then** `brief.md`, `state.json` and `progress.md` exist, every `<verified_facts>`
   item has a source and `status="verified"`, and one Claude session is
   dispatched with a prompt under the size bound.
2. **Given** a free model claims a file or line that does not exist, **When**
   Sabi verifies it, **Then** the claim appears only under `<uncertainties>`.

### User Story 2 - Fail open (Priority: P1)

**Why this priority**: Preparation must never cost the user their task.

**Independent Test**: Make the free lane return 429 on every model; assert
Claude is dispatched with the plain task and a note that no brief was built.

### User Story 3 - Measured, not assumed (Priority: P2)

Hugo can compare briefed and cold sessions on the same tasks.

**Independent Test**: `sabi report` (or the dashboard) shows, per task,
Claude input tokens, turns, outcome, and whether a brief was used.

### Edge Cases

- The task is conversational, not a change: no brief; pass through.
- The repository has no test command: `<success_criteria>` states that, and the
  brief asks Claude to establish one first.
- Evidence exceeds bounds: lowest-ranked items are dropped and counted.
- The brief directory already exists for the task: a new `<id>`; old briefs
  are never overwritten.

## Requirements

### Functional Requirements

- **FR-001**: Preparation MUST run in a disposable isolated worktree, never the
  user's active worktree. The user's worktree is read-only to this feature:
  Sabi MUST record its `git status` before and after preparation and report any
  difference as a failure. The preparer MUST NOT commit, push, or install
  packages globally. Sabi itself runs no commands other than creating and
  removing the isolated worktree.
- **FR-002**: Every item in `<verified_facts>` MUST carry an `EvidenceRef` and MUST have been
  checked by Sabi's code, not only asserted by a model.
- **FR-003**: The brief MUST be rendered by a deterministic template; the same
  inputs produce byte-identical output.
- **FR-004**: The brief MUST NOT contain credentials, transcripts, or content
  from `secrets/` or `.env`; the existing telemetry secret canary applies.
- **FR-005**: The Claude handoff MUST use the adapter's declared CLI dispatch
  and MUST start a fresh session. Sabi MUST NOT modify, proxy, or compress an
  existing Claude session for this feature.
- **FR-006**: Preparation failure MUST fall back to dispatching the plain task,
  with the reason recorded.
- **FR-007**: Any model-based evidence selection (Jev or otherwise) MUST start
  in shadow: record what it would drop, drop nothing, until SC-002 has data.
- **FR-008**: The feature MUST be opt-in per task or per config, off by
  default.
- **FR-009**: The receipt MUST record whether a brief was used, its size, the
  free-lane rounds and their cost, the bounds applied (`included`, `dropped`,
  `bytesBefore`, `bytesAfter`), the isolated worktree's base commit and
  whether the user's worktree was unchanged, and the Claude session's outcome
  when observable.
- **FR-010**: Preparer inference MUST use Sabi's configured upstream
  authentication through the normal `sabi/sabi-code` provider, not a borrowed
  harness credential.
- **FR-011**: Every entry point MUST call the single `sabi brief` primitive.
- **FR-012**: A harness prompt hook MUST NOT run preparation synchronously.
  It may recommend a brief or start background preparation for a later
  handoff, and MUST return within the hook's budget either way.

### Key Entities

- **Task brief**: `<id>`, task text, evidence items (source, excerpt, status),
  unverified claims, constraints with reasons, goal, verification checklist,
  creation time.
- **Evidence item**: `RecoveryCapsuleItem` with a structured `EvidenceRef`
  (see Evidence model), a bounded excerpt, and a Jev redundancy score when
  available.
- **Brief receipt**: brief `<id>`, dispatch receipt, free-lane rounds and cost,
  Claude outcome, tokens and turns when observable.

## Success Criteria

These are hypotheses to test, not claims. None of the numbers below has been
measured yet.

- **SC-001**: On a fixed set of at least 10 real tasks, briefed Claude sessions
  use fewer Claude input tokens than cold sessions for the same tasks, at equal
  or better task success.
- **SC-002**: With Jev selection in shadow, dropping its would-drop items would
  not have removed evidence Claude actually used (checked against the session's
  file reads).
- **SC-003**: Free-lane preparation costs $0 at configured prices on at least
  90% of briefs.
- **SC-004**: `VIZUH` canary misses per session are counted for briefed and
  cold sessions, so the drift question is answered with numbers. Data source:
  the Stop hook (`~/.claude/hooks/canary-vizuh-stop.sh`, outside this repo)
  appends one line per miss holding only `timestamp`, `session_id` and
  `canary_miss=true`: no prompt, source code, Claude output or transcript.
  Hugo approved this shape on 2026-09-29; the hook change ships with the
  implementation, not with this spec.

## Assumptions

- Claude Code accepts an initial prompt through its CLI and reads files it is
  pointed at; the adapter manifest marks it `partial`, so the dispatch path must
  be exercised before this is relied on.
- The free lane's current reliability (54% round success over 48 hours on
  2026-09-28, dashboard) is enough for read-only exploration with Sabi's
  verification and fallback; SC-003 tests this.
- Shorter starting context reduces drift. Plausible but unmeasured; SC-004
  tests it.

## Decisions (Hugo, 2026-09-29)

- Entry point: both, with `sabi brief` as the single canonical primitive and
  harness-triggered preparation layered on top (FR-011).
- Bounds: 20 items / 8 KB per brief and 1 KB per item, as an experimental
  default tuned from receipts.
- Evidence: structured `EvidenceRef` provenance (Evidence model).
- Isolation: preparation runs in a disposable worktree (FR-001).
- OMP authentication: Sabi's configured upstream auth, not borrowed
  credentials (FR-010).
- Canary instrumentation: approved, logging only timestamp, session id and a
  miss flag (SC-004).
- Scope of this PR: specification only; implementation follows separately.

## Open Questions

- Which free models run preparation inside Hermes and OMP: the existing
  `cheap` tier, or a dedicated `prep` tier with models chosen for tool use?
- Findings channel per preparer (see Harness mapping): Hermes skill or tool;
  OMP `registerTool` or RPC. Each needs a probe before it is relied on.
- Claude token source for SC-001: session transcript, status line, or
  Claude's own usage report?
- Evidence ranking: a new per-item Jev question, or map each item back to the
  proxy round that produced it and reuse `evidenceRedundant`?
- Effort for the dispatched session: the CLI takes `--effort`. Which level
  should a briefed session use by default? A good brief may justify a lower
  level than a cold start.
- Claude-side packaging: a personal skill (`~/.claude/skills/sabi-brief/`)
  that tells Claude how to consume a brief, loaded only when triggered, would
  keep the pointer prompt to one line. Worth doing in the first slice, or
  after the plain pointer prompt is measured?

## Out of Scope

- Switching models inside a running Claude session.
- Compressing or rewriting any live session's context.
- Serving Claude rounds through the borrowed-credential proxy.

## Sources

- Anthropic, "Prompting best practices" (fetched 2026-09-28):
  https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices
  — sections "Be clear and direct", "Add context to improve performance",
  "Structure prompts with XML tags", "Long context prompting" (long material at
  the top, query at the end), "Workflows across multiple context windows" and
  "State management best practices" (fresh window from files and git; structured
  state in JSON, free-form progress notes), "Minimizing hallucinations in
  agentic coding".
- Anthropic, "Effective context engineering for AI agents" (2025-09-29,
  fetched 2026-09-28):
  https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents
  — the goal is "the smallest possible set of high-signal tokens that maximize
  the likelihood of some desired outcome"; structured note-taking; just-in-time
  retrieval; sub-agents return "a condensed, distilled summary of its work".
- Anthropic, "Effective harnesses for long-running agents" (2025-11-26, fetched
  2026-09-28):
  https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents
  — "compaction isn't sufficient"; an initializer session prepares the
  environment, a progress file and a git commit, so later fresh sessions
  "quickly understand the state of work".
- Claude Code CLI reference (fetched 2026-09-28):
  https://code.claude.com/docs/en/cli-usage — `claude "query"` starts an
  interactive session with an initial prompt; `--name`, `--effort`, `--model`,
  `--resume`, `--append-system-prompt-file`.
- Agent Skills overview (fetched 2026-09-28):
  https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview
  — Claude Code discovers skills in `~/.claude/skills/` and `.claude/skills/`;
  instructions load only when a skill triggers.
- Anthropic `claude-api` skill, bundled model-migration guidance (Claude Code
  2.1.283): "Long-running agent recommendations" (de-prescribe step-by-step
  scaffolding, explicit self-verification) and "Give the reason, not just the
  request"; preserved-thinking rules on edited history.
