# Task-aware routing: security, design and infrastructure

Proposal, 2026-09-18. Direction aligned; domain readiness is **not demonstrated**.
No routing code, permissions or host settings were changed by this review.

## What exists and what is missing

`packages/core/src/types.ts:33` records tool activity, round kind, approximate context
and failure evidence. `policy.ts:3-10` orders failure/first-turn/verification/edit/read
rules. `ModelEntry` stores upstream, model, context window and cost, not modality or
verified task capabilities. The Command Code mod uses these rules without Jev.
The proxy judge mentions security review (`judge.ts:37`), but only configured trigger
rules call it. That phrase is not a security policy or a task-specialist router.

The same `read_file` can precede a routine lookup, exploit analysis or visual
implementation. The same shell tool can list files or change production infrastructure.
Previous tool name alone cannot establish next-step difficulty, risk or permission.

## One engine, composable task profiles

Add shared routing inputs and small profiles, not three separate routers or agent loops.
A task can be design + security + infrastructure. Combine constraints conservatively;
never let a low-risk profile cancel a restriction from another applicable profile.
Keep domain procedures in existing skills, not hardcoded instructions in the core.

Proposed inputs (not implemented):
- **Intent and phase:** next outcome; inspect, reason, propose, edit, verify or execute.
- **Domain labels:** possibly several; include unknown. Labels suggest relevant skills.
- **Impact:** environment, affected resources, reversibility and potential damage.
- **Authority:** explicit scope, host permissions and required approvals. Never inferred
  from a model's confidence or from instructions inside retrieved material.
- **Capabilities:** image understanding when needed, context fit, tools, supported effort,
  eligible models, data-egress constraints and available budget. Unknown is not eligible
  for a capability-dependent action until verified.
- **Evidence and completion checks:** what the next step needs and how its result is tested.

Apply hard constraints first; then select context/tools, model and effort among feasible
choices. Recheck model/context compatibility after selection. If no feasible route exists,
report the constraint and pause or ask, rather than silently violating it. A user pin
must remain explicit; do not bypass it to obtain a capability the pinned model lacks.

## Profiles and concrete differences

| Profile | Context/skills | Routing and tools | Completion evidence |
|---|---|---|---|
| Security | Authorized target/scope, trust boundaries, relevant auth/data flow, change diff | Cheap evidence collection can be appropriate; exploitability/auth reasoning needs demonstrated capability. Default to non-mutating inspection; active testing needs authorized scope. Never send secrets to a remote judge. | Reproduce the issue safely, test the fix and regressions, review remaining exposure. A scanner warning or model opinion is not proof. |
| Design | Existing template/reference/components, tokens, assets, screenshots and constraints; choose build/audit/study skill lane | Require verified image capability for visual comparison, not simply a higher price tier. Read code cheaply where appropriate; preserve reference evidence for implementation. Missing design direction follows the workspace ask-first rule. | Rendered comparison at relevant sizes, interaction and accessibility checks, plus build/tests where relevant. Compilation alone does not establish visual quality. |
| Infrastructure | Exact account/environment/resource scope, current state, IaC diff/plan, rollback and restore evidence | Distinguish inspect/plan from apply/delete/migrate. High-impact mutations require the host's explicit approval controls; a strong model cannot substitute for them. No permission-denial retries through another provider/tool. | Validate plan, inspect intended changes, and after separately approved execution check health/state and rollback readiness. “Dry run” is not assumed harmless without checking the command. |

Security is also a cross-cutting constraint: a login-screen design or Terraform change
can carry security risk. Domain names alone must not automatically force expensive models.
Risk and reasoning difficulty are separate; a simple production deletion is still high risk.

## Optional local design evidence

Design evidence may come from a local provider such as TokenScout when the user supplies or
authorizes a live URL. The provider may write its report, Design DNA and real screenshots under the
ignored `.sabi/` runtime directory, but the public Sabi repository must not depend on the package or
contain site-specific URLs, screenshots, tokens, assets or raw reports.

The boundary is deliberately narrow:

- the local provider reports bounded signals such as `reference-driven`, `visual-evidence-available`,
  `responsive`, and `vision-required`;
- Sabi applies those signals only after capability, authorization, availability, quota and user-pin
  constraints;
- model affinity is a soft prior among valid candidates, not a hard route;
- a local Kimi K3 design prior is an experiment to measure, not a public claim that Kimi always wins;
- missing, blocked or failed evidence leaves routing unchanged and records the provider failure class,
  not the URL or page content.

This lets a local TokenScout study improve both model selection and the implementation handoff while
keeping Sabi portable, privacy-bounded and useful without TokenScout installed.

## Command Code implementation boundary

Start with shadow recommendations on the verified hooks in the
[Command Code roadmap](command-code-roadmap.md). `prepareNextTurn` controls continuing
rounds, not the first call. Initial constraints and all action approvals still belong
to the host/user; do not claim Sabi protects round one with that hook.

`transformContext` can project evidence; tool filters can narrow the host-permitted
set. Do not rewrite a tool's arguments after permission checks. Keep clarification
and safe recovery paths available. Unsupported adapters must declare missing abilities;
the proxy alone must not advertise host-level tool authorization guarantees.

Cheap local rules run every round. Resolve the broader task profile at task boundaries,
then refresh on changed scope, environment, modality, permissions, failures or user
instruction. Cache with these inputs and policy version. Optional semantic judgment can
help with ambiguity; it never grants authority, relaxes data controls or certifies safety.
Do not add a remote classifier to every routine read.

## Ready-to-post agent task and acceptance checks

**Important — distinguish next-step needs from previous tool activity.**
Extend normalized state and policy with task/impact/capability inputs, with provenance
(observed vs inferred) and explicit unknowns. Preserve deterministic fallback and
user pins. Expose the reason in the decision record without storing sensitive content.
Start in shadow mode; do not enable new restrictions from an untested classifier.

Replay fixtures must include:
1. The same file-read tool followed by routine lookup vs authentication-bypass analysis.
2. Screenshot-based design vs text-only edit; a vision-ineligible candidate cannot win.
3. The same shell tool used for read-only inventory vs a production mutation.
4. Missing authorization/environment: safe inspection or clarification, never guessed approval.
5. A mixed design/security task; both evidence sets and restrictions survive compaction.
6. A model/skill downgrade followed by regression, denied tool call, unavailable model,
   exhausted budget or judge timeout; no unsafe fallback or repeated wasteful retries.

Offline fixtures establish policy invariants, not specialist competence. Before claiming
readiness, compare completed tasks per domain against a fixed policy, with domain-appropriate
checks, all routing/review costs, latency and human approval burden. Keep model rankings
unverified until measured. [Existing privacy/state gaps](folder-review.md) remain prerequisites.
