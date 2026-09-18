# Command Code-first roadmap

Proposal, 2026-09-18. Docs-only review; no changes enabled and no savings claimed.
See [folder review](folder-review.md) for defects and ready-to-post issue comments.
[Task-aware routing](task-aware-routing.md) covers security, design and infrastructure profiles.
[OpenCode and terminal plan](opencode-terminal-plan.md) reuses the existing proxy before adding adapters.

## Recommendation

Make Sabi a **local decision layer for the next inference round**: select an eligible
model/effort, useful evidence, and a relevant tool subset. Command Code still owns
execution, permissions, transcript, compaction, cancellation and the agent loop.
Do not build another harness or make Jev the mandatory controller.

“Local router” means local rules, state and cache. It does **not** mean offline model
inference: the current proxy can send bounded state to TypeSafe and prompts upstream.
An offline/private mode must make no judge network calls and report that explicitly.

## What the installed Command Code can support

Verified locally: npm `command-code` **1.56.0**. Sources under
`~/.nvm/versions/node/v24.15.0/lib/node_modules/command-code/dist/`.
Bundled references and shipped `cli.mjs` were read; no mod was executed in this review.
`cli.mjs` SHA-256: `773d28665cdc119689056edf11c5d7102a87b30527dabb5df3b945f66e45b992`.

| Need | Supported surface | Boundary |
|---|---|---|
| Model and effort | `prepareNextTurn` | Continuing rounds only; later mods can override |
| Context selection | `transformContext` | Per-request projection; do not rewrite durable history |
| Tool shortlist | `getActiveTools` / `setActiveTools` | Disabled tools disappear and refuse execution; host permissions still win |
| Outcome signals | `afterToolCall`, `model_request_end`, `onTurnEnd` | Keep planned/served/observed separate |
| Durable routing state | `modState`, session custom entries | Version state; test resume and branch changes |
| Explain/pause | `addCommand`, UI status, `shouldStopAfterTurn` | Status can be absent headlessly; stop after committed round |

Evidence: bundled `mod-builder/reference/hooks-and-events.md:22-60,87-140,166-205`;
`mod-builder/reference/api.md:20-60`. Runtime implementations include
`compileAgentMod`, `runTransformContext`, `runPrepareNextTurn` and `setActiveTools`.
Mods are marked experimental in `overview.md:5`; pin and test the installed contract.

## Order the work by benefit and risk

1. **Trust the state first.** Fix telemetry privacy and round attribution. Snapshot the
   current goal/constraints, changed file references, unresolved test failures, active
   background jobs, observed usage and eligible models. Preserve “unknown” values.
   First ship shadow decisions: explain recommendations without changing tools/context.
2. **Spend less without losing evidence.** Prefer deterministic retrieval and a small
   evidence set over full history. Use the model/effort combination that meets task risk,
   context fit and user budget. Repeated failures trigger investigation, not endless
   escalation. Keep routes stable unless the evidence justifies a switch.
3. **Add semantic help only where measured.** Optional Jev for ambiguous next-step intent,
   expected failures, or candidate relevance. Later add learned profiles and bounded
   independent review, only after fixed-policy task comparisons show a benefit.

## Context selection: evidence, not arbitrary truncation

Proposed record: source path + revision/content hash + span + size + relevance + last
use + trust label. Start with explicit paths, filename/symbol search and exact matching;
add semantic reranking only if the shortlist misses useful material in evals.
Always preserve current instructions, constraints, pending tool/result pairs, unresolved
failures and evidence required for the next action. Retrieved text is data, not authority.
Replace redundant old output in the **ephemeral request** with accurate summaries and
retrievable references; never hide a failed check or claim an omitted file was read.
Invalidate stale file evidence after edits. Respect host compaction before projecting;
keep stable ordering/prefixes so token reduction does not destroy cache reuse.

**Agent task / acceptance:** exercise a large read, file edit, stale cached snippet,
compaction and resume. The original transcript stays unchanged; tool pairs remain
valid; required evidence remains accessible; unknown context size cannot pick a
smaller model by guess. Measure tokens, cache hits, task success and total latency.

## Tool selection: recommend first, restrict only with evidence

Sabi should help the model choose its next tool, not execute guessed commands itself.
Begin with phase-based suggestions from the host's existing allowed tool set. Keep
recovery, user clarification and required task tools reachable. On uncertainty, retain
the host-permitted set rather than disabling the one tool needed to recover.
Test narrow allowlists in shadow mode before using `setActiveTools`.
Do **not** rewrite a tool's arguments to “optimize” it in `beforeToolCall`: that hook
runs after the host permission check. Use vetoes only; never widen approved effects.

Reuse native capabilities rather than importing Prime's runtime: Command Code already
has bounded multi-file `read_file`, `activate_skill`, background `shell_command` /
`monitor_command`, and background `agent` jobs with isolated context. Suggest these
when useful; do not turn every read into a worker or poll every unfinished command.
Evidence: bundled `command-code-knowledge/reference/tools.md:66-78,164-213,368-388`.

**Agent task / acceptance:** tasks requiring grep, edits, shell verification, an MCP tool,
a skill, background output and permission denial all retain the needed permitted path.
A restrictive mode cannot be widened by Sabi. Compare wasted calls and retries with
unfiltered tools, not just schema-token reduction.

## Use Jev selectively

Live TypeSafe docs read 2026-09-18: [state](https://docs.typesafe.ai/concepts/state.md),
[confidence](https://docs.typesafe.ai/confidence.md), and
[skill suggestion](https://docs.typesafe.ai/cookbooks/skill_suggestion.md), discovered
through [llms.txt](https://docs.typesafe.ai/llms.txt). Public docs only; no API inference.
They support narrow independent questions over shared state and a “none fits” route.
Choice/Score confidence describes distribution concentration, not task correctness.
The skill cookbook is a useful shortlist→verify pattern, **not** evidence of Sabi gains.
Do not copy its two remote calls per turn into a latency-sensitive router by default.

**Agent task / acceptance:** cache only fresh, policy/version-matched judgments; enforce
one total deadline including retry and cancellation; count actual calls, not cache hits.
Judge failure keeps the deterministic route; it never relaxes permissions or budgets.
Compare judge-disabled and judge-enabled task outcomes before adding more questions.

## Small implementation sequence

Recommendation, 2026-09-18: keep the existing three packages. Their manifests declare
no third-party runtime dependencies; `typescript` and `@types/node` are development
dependencies. Do not add a framework, database, queue, vector store or new service.

1. **Finish the current correctness work.** Concurrent working-tree changes already
   add telemetry codes, context fields and repeated-failure logic. Review and test
   those changes before layering task profiles on top. Check that a stuck rule is
   reachable, distinct failures are not treated as identical, unknown context stays
   unknown, and logged usage/evidence belongs to the current round. Treat this as
   in-progress work, not verified release behavior.
2. **Keep one pure planner.** Evolve the existing `decideTier` / `planRound` path rather
   than introducing a second router. Inputs are normalized observations, small policy
   data and eligible model candidates; output is a plan, a stable reason code, or an
   explicit cannot-route result. Model/context compatibility is a hard constraint,
   not another preference rule. The planner does no file, network or host calls.
   Adapters translate observations and apply plans. Keep config/log I/O in their
   existing modules initially; no package moves just to make the tree look cleaner.
   Avoid parallel policy helpers with separate precedence/fallback rules.
3. **Add task profiles as data, in shadow mode.** Add only the intent, impact and
   capability fields required by the fixtures in [task-aware routing](task-aware-routing.md).
   Security/design/infra profiles select constraints and existing skills, not separate
   engines. Start with explicit task settings and observed facts; uncertain labels
   remain unknown. Recommendations must not change the host's tools, context or model
   until explicitly enabled and evaluated. Keep Jev optional; add no new judge calls.

Each patch gets a focused `node:test` fixture and the existing typecheck; inspect test
recipes before running them to exclude live side effects. Use small synthetic inputs,
not copied private sessions. Keep fixed-policy baselines. Add a `/sabi` explanation
command later only if decision records are insufficient for daily use.

Dependency direction stays `Command Code adapter → core ← proxy server`. Within core,
pure policy/state modules must not depend on config loading, logging or network clients.
A new runtime dependency must solve a demonstrated gap that existing Node/host APIs
cannot reasonably cover. Defer learned profiles, automatic context deletion, aggressive
tool filtering, additional adapters and a dashboard until the baseline proves useful.

## What makes this a good daily tool

A proposed `/sabi` view should answer: what serves this round, why, which evidence was
kept, what remains unknown, budget remaining, and how to pause or pin routing. These
controls do not exist yet. Preserve an explicit user model pin instead of silently
replacing it. Show milestones and failed checks while work runs, not only at the end.
Evaluate completed-task quality, total billable/API usage or subscription allowance,
p50/p95 end-to-end time, router overhead, cache reuse, and avoidable tool rounds.
Keep subscription quota and API dollar estimates separate; unknown quota is not free.
