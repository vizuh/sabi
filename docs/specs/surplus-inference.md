# Surplus inference and shadow QA

Status: first shadow slice implemented; findings are advisory and never verified by the model
itself.

## Contract

The primary harness remains responsible for the task. Sabi may use an explicitly configured
zero-cost fixed resource to ask a bounded, read-only review question about the tracked diff.

```text
primary execution -> diff/result
                         |
                         v
                 safe review packet
                         |
                         v
                 fixed zero-cost lane
                         |
                         v
              parsed advisory claims + receipt
```

- A resource must be a fixed alias with exact zero input/output cost, an enabled upstream and
  known text input capability. Adaptive aliases are excluded because they can reach paid tiers.
- The packet is at most 64 changed paths and 24,000 diff characters from `git diff HEAD`; both
  endpoints of a Git rename are checked, and it has no environment, credentials, tools, terminal
  handles or absolute paths.
- `.env`, conventional secret/credential/token/password files, key/certificate files and
  secret-like markers are refused before the network call.
- The reviewer returns a bounded JSON claim list. Parsed claims are `unverified`; the receipt always
  records `verifiedClaimCount: 0`.
- Receipts contain the intent, resource, packet hash, status, latency and counts only. Raw diff,
  prompt, provider response and claim text are not persisted.
- Proxy errors, rate limits, invalid responses and missing resources are receipts, not paid fallback
  or primary-task failures.

## Commands

```bash
sabi surplus inventory
sabi surplus review --intent=bug-hunt
sabi surplus review --intent=test-gap
sabi surplus review --intent=api-contract --alias=sabi-quality
sabi surplus history
```

The command is explicit and shadow-only in this slice. It uses the local Sabi proxy and the fixed
`sabi-quality` resource when available. It does not automatically run after every task yet.

## Promotion boundary

The next layer needs deterministic claim verifiers and a privacy-approved completed-task corpus.
Only after replay and held-out checks may Sabi use reviewer history for advisory ranking, and only
after independently verified findings may a review influence the primary agent automatically.

## Multi-alias intent-gated council (spec only, not implemented)

Status: spec. The implemented slice discovers every qualifying fixed zero-cost alias via
`surplusResources()` (local trust first) and serves three intents (`bug-hunt`, `test-gap`,
`api-contract`); no fan-out, debate, ranking, or automatic primary-task influence exists.

Evidence backdrop (verified 2026-09-21 vs unverified): the Hermes curated manifest
(`updated_at: 2026-09-20T18:57:41Z`) free-badges only `laguna-s-2.1:free` and
`laguna-xs-2.1:free` from the candidate set; the 324-model Nous Portal page and its wider free
set, all vendor benchmark tables, and all displayed prices are unverified by Sabi. Catalog
presence is evidence only, never entitlement, quota, or quality proof — and no alias ships
without a live-verified zero price (`sabi-free` deferred for exactly this reason, 2026-09-21).

Extension, when resources exist: one intent per invocation, never a voting council —
`visual-qa` (image-capable tier only), `requirements` (docs-heavy trajectories), `finance` /
`health` (firing only on detected domain work). Jev may select the intent; it does not fan out.
Promotion follows the gate order above: per-resource runtime catalog evidence → independent
receipts → deterministic verifiers → approved corpus with replay/held-out → advisory ranking →
automatic influence only after independently verified findings.
