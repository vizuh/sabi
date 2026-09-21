# Security model

What actually protects what in Sabi today, stated plainly. This describes the checkout-based proxy
and the controller/hook installation, not aspirational design. Where a gap is known and open, it's
named as a gap, not smoothed over. See `docs/reviews/security-review-2026-09-21.md` for the full
audit this document was written from, including what was fixed and what's deferred.

## Authentication

Sabi has two separate HTTP surfaces with two different authentication postures. They are easy to
conflate; they are not the same.

**The inference proxy (`packages/server`, default `127.0.0.1:8787`) has no authentication.**
`/v1/chat/completions`, `/v1/models`, `/healthz`, and `/decisions` accept any request that reaches
the socket — no token, no header check, nothing. On the default loopback bind this means any other
local process or user on the same machine can spend your configured upstream's paid credits or read
recent routing telemetry. If `SABI_HOST` or `config.server.host` is ever set off-loopback (common
in containers, remote-dev boxes, or WSL), that surface becomes reachable to anyone who can route to
the host, with the same lack of a gate. This is a known, currently-open gap — see the review's
"Documented, not fixed" section for why it wasn't patched silently as part of a hardening pass.

**The controller daemon (`packages/controller/src/daemon.ts`, default `127.0.0.1:7433`) does
authenticate**, and is the model to follow if the proxy ever gets a token:

- Every request must carry `Authorization: Bearer <token>`, checked with a constant-time compare
  (`crypto.timingSafeEqual`, guarded by a length check first).
- The token is `randomBytes(32).toString('hex')` — 256 bits, generated fresh per daemon start —
  stored in `daemon.json` at `0600`, in a directory at `0700`.
- The daemon refuses to bind to a non-loopback host outright (`isLoopbackControllerHost`) — there
  is no config path or env var that can make the controller daemon listen off-loopback.
- `sabi daemon --json` / `sabi daemon --status --json` never print the token — that path was a
  real leak (fixed 2026-09-21; see the review) and is now redacted before any `console.log`.

**Hermes's isolated proxy path** (`packages/adapters/hermes`) generates its own independent Sabi
profile pointed at Hermes's Nous proxy; it does not share credentials with the main checkout config
and does not touch the main `sabi.config.json`.

## Authorization

There is no privilege separation inside a single Sabi installation — this is a same-user, single-
tenant developer tool, not a multi-tenant service, and the authorization model reflects that
honestly rather than pretending otherwise:

- Anyone who can read `~/.local/state/sabi/daemon.json` (same OS user) can call any controller
  daemon endpoint, including session registration and terminal dispatch through Orca.
- Anyone who can reach the inference proxy's socket (same host, or the network it's bound to) can
  route inference requests and spend configured credits — see Authentication above.
- Client-asserted headers (`x-sabi-client`, `x-sabi-session`, `x-sabi-turn`) are validated for
  *shape* (an opaque-id regex, no duplicates) but carry **no permission**. A client claiming
  `x-sabi-client: opencode` when it isn't OpenCode only pollutes telemetry labels; it grants no
  access it wouldn't otherwise have. Do not build an authorization decision on `record.client`.
- Config-scoped keys are coarse: one key per configured upstream, attached to every request routed
  to that upstream. There is no per-alias, per-client, or per-budget key scoping.

If you need to run Sabi somewhere this model doesn't fit (a shared machine, a multi-user host),
treat the proxy's lack of authentication as the binding constraint and don't bind it off-loopback
until that's addressed.

## Data encryption

- **In transit to upstream providers:** whatever the provider's `baseURL` scheme is. The shipped
  config points at `https://openrouter.ai/api/v1` and `https://api.typesafe.ai/v1` — real TLS.
  `upstream.baseURL` and `judge.baseURL` are only validated with `new URL()`, which accepts
  `http://` too; if an operator repoints an upstream at a plaintext endpoint, the provider API key
  (`Authorization: Bearer`) goes out in the clear. This is an operator-configuration risk, not a
  remote-exploitable one — no attacker input reaches `baseURL`.
- **In transit, local proxy to local client:** plain HTTP, always. `packages/server` has no TLS
  option. This is the same posture as the controller daemon and is fine *only* insofar as the
  connection stays on loopback — see Authentication above for what happens if it doesn't.
- **At rest:** nothing is encrypted at rest. Provider API keys live in the environment or in a
  `0600` secrets file (`scripts/setup.ts`'s `saveOpenRouterKey`) — file permissions are the only
  control, not encryption. The decision log, council ledger, and surplus-review receipts are plain
  JSONL, now written `0600`/`0700` (fixed 2026-09-21) but not encrypted.
- **Hashing, not encryption, for identifiers:** session/turn/tool identity in logs is
  `SHA256(domain-tag, ...)` (`hashIdentity`) or `randomUUID()` — this is pseudonymization for log
  hygiene, not a security boundary. It is domain-separated (a session hash and a tool hash of the
  same input differ), but it is *not* salted or keyed, so a small, guessable value (like a tool
  name drawn from a short known list) can be dictionary-matched back from its hash by anyone who
  can read the log file. Don't rely on this for anything that needs to resist a motivated reader
  with local file access — see the review's "Unsalted SHA-256" item.

## Audit logging

Three append-only JSONL logs, all local, all metadata-oriented by design:

| Log | Written by | Location | Contents |
|---|---|---|---|
| Decision log | `packages/core/src/log.ts` (`appendDecision`) | `SABI_LOG` or `./.sabi/decisions.jsonl` | Per-round routing decision: alias, tier, rule, upstream, cost/usage estimate, latency, hashed session/turn ids, sanitized reason. **Exception:** a failed upstream call records up to 200 chars of the provider's own error text (secret patterns redacted) — a provider that echoes request content in its error line puts that line in the log. |
| Council ledger | `packages/core/src/council.ts` (`appendCouncilLedgerReceipt`) | user config path (`sabi council history`) | Harness/provider/model/seat/stage/mode/evidence/status plus counts and hashes — explicitly allowlisted fields only (`RECEIPT_KEYS`); anything else on the receipt object (a stray `rawPrompt`, `credentials`) is dropped before it's ever serialized. |
| Surplus review receipts | `packages/core/src/surplus.ts` (`appendSurplusReviewReceipt`) | `SABI_SURPLUS_LOG` or user config path | Review outcome, claim counts, `verifiedClaimCount` (forced to `0` unless independently verified) — no raw diff or provider output persisted. |

None of these logs capture raw prompt content, tool output, or credentials by design (the
allowlist/sanitize pattern is deliberate and, per this review, verified to actually hold — see
"Explicitly checked and clean" in the audit). All three now write `0600` files in `0700`
directories (fixed 2026-09-21; previously inherited the process umask).

**What audit logging does not cover:** there is no tamper-evidence (no signing, no hash chain — an
operator with file access can edit or delete any of these logs), and there is no centralized/remote
log shipping. This is a local developer tool's local record, not a compliance-grade audit trail.

## Incident response

Sabi has no automated incident detection — this section is "what to do," not "what Sabi does for
you."

**If you suspect a provider API key leaked** (committed to git, printed to a shared terminal,
etc.):
1. Rotate the key at the provider (OpenRouter, TypeSafe, etc.) immediately — Sabi has no revocation
   mechanism of its own; the key lives entirely in your environment or provider dashboard.
2. Check `git log -p -- sabi.config.json` and any `.sabi-backup` files for a literal key value —
   the config schema only accepts `$ENV_VAR` references (`config.ts` rejects inline `apiKey`
   values), so a leaked literal key almost always means it was pasted somewhere by hand, not
   written by Sabi itself.
3. Check the decision log for the leaked key's prefix — `sanitizeError` redacts
   `bearer|authorization|api-key|token`-shaped substrings, but a provider whose error message
   embeds the key in an unrecognized shape could have slipped through; grep before assuming it
   didn't.

**If you suspect the controller daemon's token leaked** (e.g. via the `--json` bug fixed
2026-09-21, or a shell-history capture):
1. `sabi daemon --stop` then `sabi daemon` — this generates a fresh `randomBytes(32)` token and
   overwrites `daemon.json`; the old token stops working the moment the new daemon starts (the
   comparison is against the current `info.token`, not a persisted allowlist of past ones).
2. There is no separate revocation step needed beyond restarting the daemon.

**If you suspect the inference proxy was reachable by an untrusted party** (e.g. it was
accidentally bound off-loopback):
1. Stop the proxy (`Ctrl-C` on `npm start`, or however you're running it) immediately — there is no
   per-request kill switch, only stopping the process.
2. Rotate every upstream API key configured in `sabi.config.json` at the provider — an unauthenticated
   proxy exposes the ability to spend on every configured key, not just one.
3. Review `/decisions`-shaped entries in the decision log for the affected window for
   routing/cost anomalies (unexpected upstreams, unexpected volume).
4. Re-bind to loopback (`127.0.0.1`, the default) and don't change `server.host`/`SABI_HOST` again
   without adding the auth this document's Authentication section flags as missing.

**If a hook command was compromised** (e.g. `SABI_HOOK_COMMAND` pointed somewhere unexpected):
`sabi hooks install` overwrites the persisted hook entries in `~/.claude/settings.json` /
`~/.codex/hooks.json` / the OpenCode config from the current environment — re-running it with a
clean `SABI_HOOK_COMMAND` (or unset) restores the default, quoted, `process.execPath`-based
command.

## Reporting a new issue

This is a local developer tool without a dedicated security contact today. If you find something
here, open an issue against the repo — do not silently work around it in a fork, since the same
gap likely affects every install using the shipped defaults.
