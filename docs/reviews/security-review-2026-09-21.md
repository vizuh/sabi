# Full-repo security review — 2026-09-21

Read-only static review of the whole Sabi repo, followed by fixes for every finding narrow and
safe enough to land without a design decision. Four independent passes, cross-checked against
each other and against the actual code before anything here was accepted as real:

1. Live review via OpenCode + `opencode/muse-spark-1.3-contributor-free` (free tier).
2. Live review via OpenCode Go + `opencode-go/deepseek-v4-flash` (paid; user-authorized spend,
   cost $0.0056 total).
3. Claude subagent, independent verification pass — re-derived each of pass 1/2's claims from the
   code itself rather than trusting them, and swept `packages/core/` + `packages/evals/`.
4. Claude subagent, coverage pass — swept the adapters and `scripts/setup.ts` that passes 1–3
   didn't touch.

Council ledger receipts for passes 1–2: `2f4920bb-ade9-430f-80ee-1eae9d2779f7`,
`d5368cb3-d4d3-49ed-8909-3c298e37e8c7` (`sabi council history`).

No live provider request beyond the two review calls above. No secrets were read or written
during the review. All fixes below were re-tested with the full suite after every change.

**Pass 5** — `/code-review high` against the resulting diff caught three real bugs in the pass
1–4 fixes themselves before commit, since fixed (see each item below):
the file-mode fix only applied at creation time and never touched a pre-existing file on an
upgraded install; the control-character regex missed the C1 range (NEL, CSI); the new file-mode
tests had no Windows guard. A fourth claim — quoting `SABI_HOOK_COMMAND` as one token could break
a multi-word usage — was rejected at the time (no evidenced usage), but turned out to identify a
real gap in this PR's fix anyway: see item 6, where a stricter fix landed independently on `main`
while this branch was open and properly supports the multi-word case, which plain quoting cannot.

**Pass 6** — merging `main` (10 commits landed while this branch was open, including its own
security-relevant PRs: #59/#60/#67/#68 privacy/egress hardening, plus an independent fix for the
unsalted tool-name hash and for `SABI_HOOK_COMMAND`) produced a real, substantive merge conflict
in `packages/core/src/log.ts` and its test, not just the usual append-only doc conflicts. Resolved
by combining both sides' logic rather than picking one — see item 6's "superseded" note below, and
the corrected "unsalted tool-name hash" and "inference proxy has no
authentication" write-ups, both revised for what's actually true after the merge.

## Fixed in this pass

| # | Finding | Severity | Where |
|---|---|---|---|
| 1 | `sabi.dispatch` (Orca adapter) sent request text straight to a terminal with embedded newlines intact — one dispatch could execute as multiple shell commands | HIGH | `packages/adapters/orca/main.mjs` |
| 2 | `sabi daemon --json` / `sabi daemon --status --json` printed the controller's 256-bit bearer token to stdout | MEDIUM | `packages/controller/src/cli.ts` |
| 3 | `scripts/setup.ts` printed "Jev is off by default" without writing `judge.enabled: false` for the OpenCode / Command-Code-Class-B path — the shipped config's `judge.enabled: true` was left untouched | MEDIUM | `scripts/setup.ts` |
| 4 | Decision log, council ledger, and surplus-review receipts were appended with no explicit file mode — inherited the process umask instead of matching the controller's own `0600`/`0700` convention | LOW | `packages/core/src/log.ts`, `council.ts`, `surplus.ts` |
| 5 | Controller daemon's bearer-token check used `!==` (non-constant-time string compare) | LOW | `packages/controller/src/daemon.ts` |
| 6 | `SABI_HOOK_COMMAND` was interpolated unquoted into a persisted hook command string a shell later executes on every prompt submission — fixed here first, then superseded by a stricter validation-based fix that landed independently on `main` | LOW | `packages/controller/src/hooks.ts` |

### 1. Orca dispatch — control-character injection (HIGH)

`normalizeDispatchArgs` only `.trim()`ed the incoming request; `terminal.sendText` then fired one
`Enter` keypress over the (unstripped) text. A request containing `\n`/`\r` submits as multiple
terminal commands, not one. The adapter's own README frames `sabi.dispatch` as an
orchestration-layer entry point meant to be driven programmatically — i.e. the `request` text can
originate from LLM output that itself read untrusted content (a file, a ticket, a web page). That
is a real indirect-prompt-injection path into a live shell, not a same-user-typed-it non-issue.

**Fix:** reject the request outright (don't silently strip) if it contains any C0 control
character, DEL, or a C1 control (U+0080–U+009F, e.g. NEL/U+0085, CSI/U+009B — a terminal reading
8-bit C1 controls treats several of those as a line break or escape introducer too, not just
ASCII `\n`/`\r`; the pass-5 code-review caught that the first cut of this regex only covered C0 +
DEL). A legitimate multi-line need should be multiple dispatches, not one this adapter guesses how
to collapse.

Sibling precedent already existed in the repo for this exact class of problem — Hermes's
`_OPAQUE_ID` regex (`packages/adapters/hermes/plugin/__init__.py`) and its own injection test
(`"line\r\nInjected: header"`). Orca's adapter simply hadn't had the same control applied yet.

Tests: `packages/adapters/orca/test/plugin.test.mjs` — `dispatch rejects a request carrying a
newline instead of forwarding it to the terminal`, and `dispatch also rejects a C1 control
character, not just ASCII \n/\r`.

**Not independently confirmed:** whether Orca's host restricts `sabi.dispatch` to human
command-palette invocation, or lets any installed plugin/automation call it by ID. Orca's host
runtime is outside this repo. Treat as HIGH until an Orca-host owner confirms otherwise — this fix
closes the gap either way, but the blast radius depends on that answer.

### 2. Daemon token printed to stdout (MEDIUM)

`sabi daemon --json` and `sabi daemon --status --json` are documented, ordinary flags — a
plausible CI/scripting pattern (`sabi daemon --json | jq .info.port`) printed the local IPC bearer
token in the clear, into shell history / CI logs / `script(1)` recordings. Blast radius is bounded
to the local controller daemon's own loopback surface (session register/route/plan), since this is
a locally-generated token, not an upstream provider key — but it had zero redaction anywhere in
the print path, contradicting this repo's own stated secrets discipline.

**Fix:** `withoutToken()` strips `token` from the `info` object before any `console.log(JSON...)`
in `runDaemon`. The 0600 `daemon.json` file on disk is untouched — this only changes what the CLI
prints.

Test: `packages/controller/test/cli.test.ts` — `daemon --json and daemon --status --json never
print the bearer token`.

### 3. Jev "off by default" message didn't match the config it left behind (MEDIUM)

Traced precisely across two review passes before landing on the real mechanism: when
`npm run setup -- --harness=opencode` (or `--harness=command-code --class=b`) runs with neither
`--jev` nor `--no-jev`, the wizard printed *"Jev is off by default"* but never called
`setJevEnabled(configPath, false)` — the shipped `sabi.config.json`'s `judge.enabled: true` was
left exactly as-is. A user reading that message reasonably believes Jev is off; it wasn't. Once
`judge.enabled` is `true`, every qualifying round (default trigger: `failure`/`unclassified`
routing rules) sends `last_instruction` (≤1200 chars) and `last_tool.result_excerpt` (≤2500 chars)
to `api.typesafe.ai` — real third-party egress of prompt/tool content.

This is separate from, and does not contradict, the fact that this behavior is disclosed in
`docs/install.md` (a user who reads the Security section before running `npm start` directly
against the shipped config already knows Jev defaults on there). The bug is specifically that the
*setup wizard's own printed claim* didn't match what the wizard did. The Hermes path
(`runHermes`) already got this right — it only ever enables Jev on explicit request, and its
generated profile ships `judge.enabled: false`.

**Fix:** the `else if (!wantJev)` branch in `scripts/setup.ts` now calls
`setJevEnabled(configPath, false)` (skipping Hermes, which has its own isolated-profile flow),
so the printed message is true.

Test: `scripts/test/setup.test.ts` — `--harness=opencode with neither --jev nor --no-jev actually
turns Jev off, matching the printed message`.

### 4. Decision/council/surplus logs had no explicit file mode (LOW)

`appendFileSync`/`mkdirSync` calls in `log.ts`, `council.ts`, and `surplus.ts` (core) passed no
`mode`, so `.sabi/decisions.jsonl` and friends inherited the process umask (commonly `0644`,
world-readable on a shared machine) — the controller's own state files
(`packages/controller/src/daemon.ts`, `hooks.ts`) already use `0600`/`0700` consistently; these
three call sites just hadn't matched that convention. Content exposure was already bounded (hashed
session/turn ids, allowlist-gated `reason`, no raw prompt by default), so this is a hardening gap
on a shared/multi-user host, not a prompt leak by itself.

**Fix:** `{ mode: 0o700 }` on directory creation, `{ mode: 0o600 }` on the append, in a shared
`appendPrivateLine()` helper (`packages/core/src/log.ts`) all three call sites now use — also
`chmodSync` both explicitly after the write, not just at creation. The pass-5 code-review caught
that the first cut only set `mode` on `mkdirSync`/`appendFileSync`, which is a create-time-only
flag: an install upgrading from before this fix, with an existing looser-permission log file,
would never actually get it narrowed. The explicit `chmodSync` calls fix that on every append,
old file or new. Skipped on `win32`, where POSIX permission bits don't apply.

Tests: `packages/core/test/log.test.ts`, `council.test.ts`, `surplus.test.ts` — each now asserts
the written file/dir mode directly (POSIX-only, guarded by `process.platform !== 'win32'` — the
pass-5 review also caught the initial version of these tests missing that guard).

### 5. Non-constant-time bearer-token compare (LOW)

`daemon.ts:152` used `!==` on the raw header string. The token itself is 256 bits of
`randomBytes`, stored `0600`, on a loopback-only server — a practical timing attack over HTTP
would need an infeasible sample count against normal network/scheduler jitter to recover 256 bits
of entropy. Not exploitable in this threat model, but `crypto.timingSafeEqual` is the standard,
free fix for a bearer-token check and there's no reason not to use it.

**Fix:** `isAuthorized()` does a length check (required — `timingSafeEqual` throws on
mismatched-length buffers) then `timingSafeEqual`.

Test: `packages/controller/test/daemon.test.ts` — added a wrong-length-token case alongside the
existing wrong-value-same-length case.

### 6. `SABI_HOOK_COMMAND` unquoted in a persisted, re-executed command string (LOW — superseded by a better fix on `main`)

The default branch of `commandFor()` already quoted `process.execPath` and the script path; the
`SABI_HOOK_COMMAND` override branch did not. The persisted string is written into
`~/.claude/settings.json` / `~/.codex/hooks.json` / the OpenCode config and re-executed by a shell
on every `UserPromptSubmit`/`SessionStart`/`SessionEnd` — so an unescaped metacharacter in that env
var becomes a standing injection primitive, not a one-time install-time risk.

**First fix in this PR:** `quote(configured)` — wrap the whole value as one shell token. The
pass-5 code-review flagged that this would break an operator relying on a multi-word invocation
(e.g. `node /opt/sabi/cli.js`); that was rejected at the time because no test, doc, or example
anywhere in the repo used a multi-word value.

**Superseded during the merge:** a separate PR on `main` (independent of this review) landed a
strictly better fix while this branch was open — `validateHookCommand()` tokenizes the value
(respecting quotes, so `"/opt/my dir/sabi" --flag value` works) and rejects the whole thing with a
clear error if any token contains a shell metacharacter, rather than quoting it. This properly
supports the `executable + arguments` shape the code-review was actually worried about, which
plain quoting cannot: `node /path/to/sabi.mjs` needs to reach the shell as two arguments, and
`quote()` would have collapsed it into one. The code-review's underlying concern was valid — this
review's specific rejection of it (no evidenced multi-word usage) was reasonable given the state
of the repo at the time, but `main`'s fix is the correct general solution the rejection didn't
anticipate. Dropped this PR's `quote(configured)` call in favor of `main`'s validation, which now
runs first and makes the quoting unreachable for a value that passes it.

Tests: `packages/controller/test/hooks.test.ts` — `SABI_HOOK_COMMAND keeps executable-plus-
arguments but rejects shell metacharacters` and the `installHooks` malicious-value test, both from
`main`'s PR. This review's own now-redundant quoting test was removed.

## Documented, not fixed — needs a product decision or is out of Sabi's control

### The inference proxy has no authentication (HIGH, by exploitability — not fixed)

`packages/server/src/server.ts` (`/v1/chat/completions`, `/v1/models`, `/healthz`, `/decisions`)
has zero *credential* authentication anywhere in `handleRequest`. `packages/server/src/index.ts:7`
binds to `SABI_HOST ?? config.server?.host ?? '127.0.0.1'` verbatim — nothing refuses a
non-loopback value the way `packages/controller/src/daemon.ts:211` (`isLoopbackControllerHost`)
explicitly does for the controller daemon.

**Update from a merge conflict with `main` (#59 #60 #67 #68), which landed while this branch was
open:** `server.ts` now has `originViolation()` — a `Host`/`Origin`/`Referer` loopback check that
runs before every request. This closes a real, different vulnerability (a malicious webpage's
`fetch()` can't forge `Host`, so DNS-rebinding/browser-CSRF against the proxy is now blocked). It
does **not** add authentication: any non-browser client — another local process, a `curl`, a
Python script, a remote attacker if `SABI_HOST=0.0.0.0` — can set a loopback-looking `Host` header
itself and pass the check trivially. On the default bind, any other local process/user on the same
machine can still spend the configured upstream's paid API credits via `/v1/chat/completions` or
read `/decisions` (recent routing telemetry) with zero friction, and a non-loopback bind is still
reachable by exactly the kind of client `originViolation()` doesn't stop. The finding is narrower
than when this review started, not closed.

**Why not fixed here:** adding auth changes the API contract for every existing adapter
(`opencode`, `command-code`, `hermes`, `deepseek-harness`, `prime-agent` connect scripts) that
currently talks to this endpoint with no credential. That's a real feature with real compatibility
tradeoffs (opt-in token? mTLS? mirror the daemon's bearer-token pattern and update every adapter?)
— a design decision, not a hardening patch. Recommend: at minimum, mirror
`isLoopbackControllerHost`'s refuse-non-loopback behavior on `server/src/index.ts` as a cheap first
step that changes no existing local workflow; treat an opt-in bearer token as a separate follow-up.

### `SABI_DSH_BASE_URL` has no loopback validation (LOW, not fixed — architecturally can't be, here)

`packages/adapters/deepseek-harness/cordis.patch.yml` sets
`baseURL: !!js process.env.SABI_DSH_BASE_URL ?? 'http://127.0.0.1:8787/v1'`. Hermes's equivalent
(`packages/adapters/hermes/plugin/__init__.py: _local_base_url`) strictly validates loopback host,
no credentials-in-URL, fixed path — a real asymmetry. But Hermes's validation is Python code Sabi
authored that runs *inside Hermes's own process*; the DSH bundle is a static YAML patch consumed
and evaluated by DSH's own config loader (the `!!js` tag is DSH's mechanism, not Sabi's). There is
no Sabi-authored runtime code in the DSH bundle to attach validation to — doing this properly would
require a DSH plugin analogous to Hermes's, which doesn't exist yet. Flagging as a real gap for
whenever such a plugin is built, not fixing a phantom hook here.

### Unsalted SHA-256 "hash" of tool names gives a false sense of irreversibility (LOW — fixed independently on `main`)

Originally found as: `hashIdentity('tool', name)` (`packages/core/src/log.ts`) was bare
`SHA256(JSON[kind, ...parts])` — no secret, no per-install salt. Tool names are drawn from a
small, guessable universe (`read_file`, `grep`, `bash`, ...), so anyone with a `decisions.jsonl`
could trivially dictionary-match the real tool name back out. Deferred here originally (a
keyed-HMAC change touches the log format and deserves its own review), but a separate PR merged
to `main` while this branch was open and fixed exactly this: `hashIdentity` is now
`createHmac('sha256', getIdentitySalt())`, with the salt generated once per install at
`~/.config/sabi/.identity-salt` (mode `0600`). Resolved by that merge, not by this PR — noted here
so the record is accurate about which change fixed it.

### `saveOpenRouterKey`'s chmod-after-write has a narrow TOCTOU window (LOW, not fixed)

`scripts/setup.ts` writes the secrets file with `{ mode: 0o600 }` then `chmodSync`s it again — the
`mode` on `writeFileSync` only applies at file *creation*; if the file already exists with looser
permissions, there's a brief window before the explicit `chmodSync` narrows it. Same-user, LOW,
narrow, and the correct fix (write-to-temp-then-rename, or chmod-before-write-when-preexisting)
is a slightly bigger change than the other items here. Flagging for a follow-up.

## Explicitly checked and clean

Verified by direct code reading (not inherited from a single reviewer's claim) across the whole
repo (`packages/server`, `packages/core`, `packages/controller`, `packages/evals`, all adapters,
`scripts/setup.ts`):

- **No command/shell injection.** Every subprocess call in the repo uses array-form argv with no
  `shell: true` — grepped for `shell:\s*true` and `exec(`/`execSync(` repo-wide, zero matches
  outside the one now-fixed Orca terminal-text path.
- **No path traversal.** No filesystem path in the request-handling path is ever derived from
  `req.url`, headers, or body; env-provided config paths are operator-controlled by design.
- **No hardcoded secrets.** Only hits for secret-shaped patterns are synthetic test fixtures that
  assert redaction, or documented non-secret loopback placeholders
  (`sabi-local-placeholder`, `Bearer sabi-local-placeholder`).
- **Credential handling in `setup.ts` is sound** — `0700`/`0600` on creation, never echoed, sent
  only to the fixed OpenRouter endpoint with `redirect: 'error'`.
- **Log redaction works as documented** — `sanitizeError`/`sanitizeReason`
  (`packages/core/src/telemetry.ts`) redact `bearer|authorization|api-key|token` patterns and
  cap length; canary patterns block `sk-*`/`AKIA`/`AIza`-shaped strings.
- **Header/config injection is handled correctly** — `packages/server/src/upstream.ts` strips any
  inbound `x-sabi-*` header before forwarding upstream; `server.ts`'s `OPAQUE_ID` regex rejects
  malformed session/turn identifiers.
- **`redirect: 'error'`** on both the upstream and judge fetches prevents credential replay via a
  redirect.
- **Dependencies are clean** — the repo's runtime path (`server.ts`, `upstream.ts`, `typesafe.ts`)
  uses only Node stdlib; root `package.json` has zero runtime `dependencies`.
- **No cryptographic misuse found** beyond the two items already listed (the bare-hash tool-name
  cosmetic issue, and the daemon compare, now fixed) — `randomUUID`/`randomBytes` used correctly
  everywhere else for identifiers and the daemon token.

## Follow-up

- Get an answer from whoever owns the Orca host runtime on whether `sabi.dispatch` is reachable by
  non-human callers — determines whether the fixed injection issue was HIGH-in-practice or a
  hardening-only fix.
- Decide the proxy-authentication design (loopback-refuse as a floor, bearer token as a stretch
  goal) and update every adapter's `connect.ts` accordingly if a token is added.
- HMAC-key the tool-name hash, or drop the pretense and log tool names in the clear.
- Fix the `saveOpenRouterKey` TOCTOU window (write-temp-then-rename).
- Build a DSH plugin (mirroring Hermes's) if `SABI_DSH_BASE_URL` validation is ever wanted.
