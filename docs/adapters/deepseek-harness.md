# DeepSeek Harness adapter

Sabi connects to DeepSeek Harness (DSH) through a public DSH bundle package:
[`@vizuh/sabi-deepseek-harness`](../../packages/adapters/deepseek-harness/README.md).
The package uses DSH's native `@deepseek-ai/dsh-llm-pi-ai` OpenAI-compatible
provider seam and points it at Sabi's local `/v1` proxy.

```text
DSH native loop
  → provider=sabi, model=sabi-code
  → Sabi OpenAI-compatible proxy
  → Sabi trajectory policy
  → configured upstream
```

## What this adapter does

- adds one explicit adaptive `sabi-code` route;
- preserves DSH's loop, tools, approvals, streaming and session state;
- attributes requests as `deepseek-harness` without sending the raw session id
  upstream;
- keeps Sabi provider credentials outside DSH configuration.

## What it does not do

- start or supervise the Sabi daemon;
- switch an already-running DSH request after it has begun;
- provide DSH session identity, prompt hooks, task dispatch or outcome receipts;
- prove upstream model availability, plan entitlement, token cost or task quality.

DSH is a developer preview. The adapter is pinned to `0.1.6-alpha.2` at
[`ddefc45fbc7f8e46dd73185e68295696d1297887`](https://github.com/deepseek-ai/deepseek-harness/tree/ddefc45fbc7f8e46dd73185e68295696d1297887).
The repository test is static because `dsh` was not installed in the publication
worktree. A live gate must use a pinned DSH runtime, the local Sabi proxy, and a
bounded mock upstream before the status can move beyond inference-only.
