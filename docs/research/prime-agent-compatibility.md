# Prime Agent compatibility

Checked **2026-09-18**, installed **0.9.5**. **Proxy: local protocol-tested. Native
per-round scheduling: deferred.** No paid inference or live provider smoke test ran.
`packages/adapters/prime-agent` contains only opt-in probe tooling, not a native adapter.

## Installed contract and isolation

The executable resolves to the standalone release directory
`~/.local/share/prime-agent/releases/0.9.5-linux-x64-bc4b0ed791d1e8b3b5d6a95249a60306d9579fc0d6038e5d7d82f068d81f008d/`.
Binary SHA-256: `37d593e7d7065e2953d15e92dc6b705483037b93ae5020b5e12a6337a7f84f87`.
The archive identifier is not a newly verified tarball hash. The source commit was
not established from this standalone build; its manifest names
[PrimeIntellect-ai/prime-agent](https://github.com/PrimeIntellect-ai/prime-agent).

Read before testing, relative to that installed release:

- `docs/development.md:29-37`: `PRIME_AGENT_CODING_AGENT_DIR` isolates configuration
  **and daemon testing**; `PRIME_AGENT_SESSION_DIR` isolates session storage.
- `docs/usage.md:222-262,358-376`: ephemeral sessions, explicit tool allowlists,
  resource/context discovery controls, offline startup and environment overrides.
  Actual `--help` confirmed the flags; actual `--version` returned `0.9.5`.
- `docs/settings.md:73-132,175-215`: offline startup, telemetry opt-out, bounded
  provider timeout and retry disable. Offline does **not** disable inference.
- `docs/models.md:19-60,121-140,188-246,331-368`: custom Chat Completions providers,
  model metadata, thinking levels and compatibility controls.
- `docs/extensions.md:549-560,635-700,1558-1579` and
  `examples/extensions/{hello,preset}.ts`: per-turn hooks, synthetic tools and setters.
- `docs/daemon.md:30-53`: client-owned headless workers and isolated daemon shutdown.
  `docs/rlm-runtime.md:73-85`: lazy Python kernel provisioning; the probe disabled
  built-in tools, so it did not provision or use a Python kernel.

All test state lives under `.sabi/compat/prime-agent/`. Each client received a clean,
explicit environment: isolated `HOME`, all four XDG directories, `TMPDIR`, agent and
session directories, plus `PI_OFFLINE=1`, `PI_SKIP_VERSION_CHECK=1`,
`PRIME_AGENT_TELEMETRY=0` and `DO_NOT_TRACK=1`. No account environment, credentials,
normal settings, session history or global defaults were read or changed. Discovery
of extensions, skills, prompts, themes and context files was disabled. The sole
explicit extension supplied `sabi_probe`, a deterministic tool with no file, shell
or network access. No child agent was spawned.

Client deadlines: 25 seconds, then SIGTERM; SIGKILL at 28 seconds. Each run invoked
`shutdown --force` **with the same isolated environment**, with a 10-second bound.
All clients and shutdowns returned 0 without reaching their deadlines. No session
files or daemon sockets remained. Saved evidence contains allowlisted fields only,
not prompts, response text, credentials, request bodies or raw stdout/stderr. The
runner discards Prime's automatic diagnostic logs and command journals from its
own isolated profile after shutdown; Sabi's allowlisted decision records remain.

## Observed results

| Probe | Observation |
|---|---|
| Direct custom provider | Three streamed `POST /v1/chat/completions` requests. Model `sabi-code`, effort `medium`. |
| Tool continuation | Two parallel calls with fragmented JSON arguments, then one further tool call. Three unique executions. IDs, arguments, result order and history survived. |
| Usage | Mock totals 25, 35 and 45 tokens arrived unchanged at the client. These are fixture values, not measured model performance. |
| Prime → Sabi → mock | Strict fixture catalog, Jev off. Sabi selected `mock-mid` → `mock-cheap` → `mock-cheap`. All client responses retained `sabi-code`. |
| Attribution | `X-Sabi-Client: prime-agent` appeared in Sabi decisions and was stripped upstream. Three distinct Sabi request IDs. `sessionKnown=false`; no prompt-based grouping or invented host session identity. |
| Native `turn_start` | Both setters changed visible host state; neither changed requests inside the active tool loop. See below. |

The proxy test used the existing `createSabiServer` and shared core policy, not a
second policy or agent loop. Its inline mock catalog declared capabilities and
context accounting in strict mode. Production metadata was not inferred from these
fixtures. Wire parameters observed: `model`, `messages`, `stream`, `max_tokens`,
`stream_options`, `tools`, `store`, and `reasoning_effort`.

### Native timing blocker

One parent session, one prompt, three inference rounds:

| Round | Requested by `turn_start` | Setter result / visible state | Actual request |
|---|---|---|---|
| 0 | `probe-first` / `low` | accepted / requested values | `sabi-code` / `medium` |
| 1 | `probe-second` / `high` | accepted / requested values | `sabi-code` / `medium` |
| 2 | `probe-first` / `minimal` | accepted / requested values | `sabi-code` / `medium` |

`before_provider_request` and the mock server independently observed the original
model and effort. A second probe kept the same RPC parent session open for another
user prompt. Its next request used the previously stored `probe-first` / `minimal`,
not the new `turn_start` request for `low`. Thus these setters affect subsequent
prompts in this tested path, not rounds already running in the current prompt.

This is a runtime result for 0.9.5, not a claim about every extension hook or future
version. Native shipping stays blocked. Payload-only rewriting would not prove
host model/provider rebinding or correct attribution. Child-model selection with
`spawn` is not parent-round scheduling and was not used as a substitute.

## Opt-in proxy recipe

Use a **separate** `PRIME_AGENT_CODING_AGENT_DIR`, never the normal user profile.
Its `models.json` needs this shape. The numbers and zero prices below describe only
the tested, free local mock. Before live use, replace limits and capability flags
with verified values common to the eligible upstreams; do not treat Prime's default
zero cost display as a real upstream price.

```json
{
  "providers": {
    "sabi": {
      "baseUrl": "http://127.0.0.1:8787/v1",
      "api": "openai-completions",
      "apiKey": "sabi-local-placeholder",
      "headers": { "X-Sabi-Client": "prime-agent" },
      "compat": {
        "supportsDeveloperRole": false,
        "supportsReasoningEffort": true,
        "supportsUsageInStreaming": true,
        "maxTokensField": "max_tokens"
      },
      "models": [{
        "id": "sabi-code",
        "reasoning": true,
        "input": ["text"],
        "contextWindow": 32000,
        "maxTokens": 2048,
        "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0 }
      }]
    }
  }
}
```

Select `--provider sabi --model sabi-code`. The `api` value is
`openai-completions`, **not** `openai-responses`. Prime's local placeholder is not
an upstream credential; any separately approved upstream key stays in Sabi.
For targets without verified common effort support, set `reasoning: false`,
`supportsReasoningEffort: false`, and select `--thinking off`. Do not advertise
images, structured output, or other capabilities without separate verification.

The probe's isolated `settings.json` disables telemetry, automatic compaction,
automatic retries and wait-for-usage. It sets the provider timeout to 4000 ms.
Compaction is off **only for this bounded fixture**; normal host compaction remains
a separate integration gate. Choose one retry owner before live use. No backup
provider was configured. Restrict the first connection to loopback in the same
network namespace. No native routing extension should run alongside proxy routing.

A static `X-Sabi-Client` header identifies the client, not its parent session or
permissions. Native session/round headers were not implemented; keep grouping
unknown instead of reusing a fixed identifier across unrelated sessions.
Rollback: stop the isolated client/daemon and launch the original provider without
these environment overrides. No user settings need to be restored or deleted.

## Local reproduction and artifacts

Reusable sources live in `packages/adapters/prime-agent/`. This private test package
has no runtime dependencies and imports the existing workspace core/server as dev
dependencies. The ignored `.sabi/compat/prime-agent/` directory holds only isolated
runtime state and host-local evidence. From the repository root:

```sh
# Use the already installed binary. Do not run variants concurrently: they share
# one isolated test profile. Each probe also bounds its client and shutdown.
binary="$(readlink -f "$(command -v prime-agent)")"
node packages/adapters/prime-agent/src/inspect-cli.mjs "$binary"
timeout --kill-after=3s 45s node packages/adapters/prime-agent/src/probe.mjs "$binary" transport
timeout --kill-after=3s 45s node packages/adapters/prime-agent/src/probe.mjs "$binary" native
timeout --kill-after=3s 45s node packages/adapters/prime-agent/src/probe.mjs "$binary" native-followup
timeout --kill-after=3s 45s node packages/adapters/prime-agent/src/probe.mjs "$binary" proxy
node packages/adapters/prime-agent/src/verify-evidence.mjs
node --test packages/adapters/prime-agent/test/profile.test.ts
```

- `source-evidence.json`: installed version, binary hash and hashes of inspected files.
- `cli-evidence.json`: actual version/help flags and bounded process outcomes.
- `{transport,proxy,native,native-followup}-evidence.json`: allowlisted wire fields,
  lifecycle/tool counts, checks and process outcomes.
- `{transport,proxy,native,native-followup}-extension.jsonl`: hook observations.
- `proxy-decisions.jsonl`: existing Sabi allowlist-only telemetry, snippets disabled.
The durable `src/probe.mjs` runner uses `src/profile.ts` and stages the synthetic
`src/probe-extension.mjs` as an explicit runtime extension. The verifier asserts both
transport successes and the observed native timing rejection, including the
same-session follow-up distinction. Probe execution rejects an installed version
other than 0.9.5. Default `npm test` only runs offline profile checks, not the client.

Validation performed: installed CLI/help checks; four actual-client local mock
variants; the durable proxy runner also passed; saved-evidence verification passed;
four offline profile tests passed; `npm run typecheck` passed. The parent task owns
aggregate release checks.

## Remaining gates

This is **not full production certification**. Not tested here: nonstream responses,
HTTP 4xx/5xx/429 behavior, cancellation/disconnects, host tool denial, title/child/
compaction/refinement calls, resume, user pinning, real providers, images, reasoning
history across vendors, or provider quota behavior. The synthetic tool has no
permission-bearing side effects, so it does not prove host approval behavior.
Native support requires an installed supported seam that passes actual same-parent
model **and** effort round changes, then the remaining native gates in the
[multi-harness plan](multi-harness-plan.md). Paid smoke tests need separate approval.
