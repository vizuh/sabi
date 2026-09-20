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
- The packet is at most 64 changed paths and 24,000 diff characters from `git diff HEAD`; it has no
  environment, credentials, tools, terminal handles or absolute paths.
- `.env`, secret/credential/token/password paths, key/certificate files and secret-like markers are
  refused before the network call.
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
