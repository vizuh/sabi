# OpenCode and plain-terminal integration plan

Proposal, 2026-09-18. No config applied, package installed, service started or live
inference request made. Reuse the existing core/proxy before adding another adapter.

## Minimal shape

```text
Command Code mod ───────────────────────> core planner → host catalog
OpenCode custom provider ─┐
                         ├─> existing Sabi proxy → core planner → OpenRouter
terminal HTTP client ────┘
```

OpenRouter is already an upstream, not a new routing engine. Keep one Sabi policy
owner; use concrete upstream model IDs rather than stacking another automatic router
under it unless that extra routing is deliberately evaluated. No new Sabi runtime
dependency or package is needed for this first path.

## Verified interfaces

- Installed `~/.opencode/bin/opencode`: `opencode --version` returns **1.18.30**.
  `opencode run --help` exposes `--model provider/model`, `--pure` and `--format json`.
  Help/version only were run; no session, provider setup or credentials were inspected.
- Local `~/.opencode/node_modules/@opencode-ai/plugin` reports **1.18.4**, different
  from the CLI. `dist/index.d.ts:203-215` exposes parameter changes, not an explicit
  next-round model replacement output. Do not infer a Command Code-style hook from it.
  SHA-256: `f3ec1a150d1354be3c9d93928fa130edc118c63fb468533ebb01eb3d6ed77f92`.
- Current [OpenCode provider docs](https://opencode.ai/docs/providers/) describe
  `@ai-sdk/openai-compatible` for `/chat/completions`, with `provider`, `options.baseURL`
  and `models`. Its local-provider example omits a key. These are live docs, not a
  successful test of this Sabi integration.
- [OpenCode tools](https://opencode.ai/docs/tools/) use names including `read`, `bash`,
  `edit`, `write`, `apply_patch` and `skill`. Do not assume Command Code names.
- [OpenRouter quickstart](https://openrouter.ai/docs/quickstart) documents
  `https://openrouter.ai/api/v1/chat/completions` with bearer authorization and streaming.
  Sabi already implements this path in `packages/server/src/upstream.ts` using `fetch`.
- Public docs above and [OpenCode CLI docs](https://opencode.ai/docs/cli/) read on
  2026-09-18. No current model capability, rate, quota or price is asserted here.

## Three small delivery steps

1. **Offline proxy compatibility first.** Extend existing `node:test` fixtures, not
   a new eval framework. Normalize OpenCode tool names into semantic activities for
   routing only; preserve original names, arguments and call/result IDs on the wire.
   Cover read, edit, shell verification, mixed calls and unknown MCP tools. Unknown
   activity must not silently count as proven low-risk work. Do not identify a trusted
   host merely from its tool names or treat textual denial as model failure.
2. **Config-only OpenCode pilot.** Add a project-scoped custom-provider example after
   checking this installed release. Use the local Sabi endpoint and synthetic aliases.
   Keep the host's loop, transcript, tool execution and approvals native. No plugin yet.
   Test in an isolated synthetic fixture with explicit deny-by-default tool permissions
   and narrowly permitted reads. Merely omitting `--auto` is not a restrictive policy.
3. **Plain-terminal client, then optional convenience wrapper.** Document the existing
   HTTP interface first. Only if needed, add a small prompt/stdin→response CLI using
   Node built-ins and the same planner/upstream path. No shell execution, recursive
   agent loop, database, SDK or CLI framework. A command such as `sabi ask` is a future
   UX proposal, not an installed command. Agentic terminal work should use OpenCode.

## Proposed OpenCode configuration

Skeleton only; not applied or fully validated against the installed binary:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "sabi": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "Sabi (local)",
      "options": { "baseURL": "http://127.0.0.1:8787/v1" },
      "models": { "sabi-code": { "name": "Sabi Code" } }
    }
  }
}
```

Before a pilot, add verified `limit.context` / `limit.output` and capability declarations
for the **eligible routed model set**, not one optimistic upstream. Reconcile Sabi's
model advertisement with its provider writer. Add fixed aliases for comparison.
The AI SDK package is selected by OpenCode; do not add it as a Sabi dependency.
Verify keyless-local behavior offline. If a client insists on a key, use only a clearly
non-secret local placeholder; never place the OpenRouter key in this provider entry.
Keep `OPENROUTER_API_KEY` in the Sabi process environment. Keep Jev disabled for the
first transport pilot, so it adds neither another credential nor an extra data recipient.

After config, permission and budget checks, a planned read-only smoke command is
`opencode run --pure --model sabi/sabi-code "Read the fixture README; do not modify files."`.
The prompt is not a security boundary: host permission rules must enforce the scope.
Do not use `--auto` or `--share`. Neither this command nor a provider-config change was run.

## Existing plain-terminal interface

Once Sabi is deliberately started with approved upstream credentials, this uses its
existing endpoint. Example only; it was not executed and would incur upstream usage:

```bash
curl --fail-with-body http://127.0.0.1:8787/v1/chat/completions \
  -H 'Content-Type: application/json' \
  --data-raw '{"model":"sabi-code","stream":false,"messages":[{"role":"user","content":"Explain what an inference router does."}]}'
```

This returns JSON, not a coding agent. No tools are supplied or executed. For multi-turn
HTTP use, the caller must retain/resend the relevant `messages`; Sabi does not provide
chat-session storage. One-shot prompts cannot establish per-round trajectory savings.
Calling OpenRouter directly bypasses Sabi. A later standalone CLI can reuse the same
core/upstream functions without requiring a new server or duplicating routing logic.

## Acceptance before claiming support

Mock: nonstream JSON, SSE chunks, tool IDs/results, usage, alias rewriting, context
limits, unsupported parameters/modalities, upstream errors and client cancellation.
Check privacy and total cost accounting; adapter heuristics are not permission controls.
Then, with separate approval, cap one live read-only tool round and compare against a
fixed alias on the same task. Verify no duplicate execution or real-key leakage.
Keep Sabi bound to loopback: its current local keyless endpoint is not a secure remote
service. Rich OpenCode context/tool control remains deferred until version-aligned
installed hooks and behavior are verified. See the [small-core plan](command-code-roadmap.md#small-implementation-sequence).
