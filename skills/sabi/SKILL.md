---
name: sabi
description: Route a coding agent's inference per round instead of pinning one model to a whole task. Use when a session should escalate or de-escalate model, reasoning effort or provider from trajectory evidence — tool results, failures, context pressure, verification — rather than from the first prompt; when a harness should keep its own credential and let Sabi sit between it and the provider; or when work should be continued, delegated or spawned between Claude Code, Codex, OpenCode and Orca sessions. Covers install, the borrowed-authentication proxy, controller hooks, and the boundaries Sabi does not claim.
license: MIT
metadata:
  author: vizuh
  repository: https://github.com/vizuh/sabi
---

# Sabi agent skill

Sabi routes coding-agent trajectories, not single prompts. The host harness keeps its loop; Sabi chooses the model, reasoning effort, or provider for the next inference round, or a bounded controller handoff between sessions.

## When to use Sabi

- Per-round model and reasoning-effort routing inside Command Code.
- Model and provider routing for OpenAI-compatible clients through the local proxy.
- Borrowed authentication: a harness keeps its own credential and Sabi forwards it, so Claude Code or
  Codex can be routed per round without handing Sabi a key.
- Bounded continue, delegate, or spawn coordination across sessions and worktrees.

## When not to claim Sabi

- A hook install does not switch the model inside an existing native session. The borrowed route does,
  and only when the harness points its provider at Sabi.
- A model catalog listing does not prove plan entitlement, pricing, quota, or quality.
- A mock or fixture pass does not prove savings or task success.
- `sabi replay` aggregates recorded telemetry; it does not re-run tasks or compile policy lessons.

## Entry points

- Install once: `npm install --global @vizuh/sabi-controller@0.1.3`, then `sabi setup` and `sabi doctor`.
- Run the proxy from the installed package: `sabi serve` (`--host`, `--port`, `--cwd`).
- Install this skill with the skills CLI: `npx skills add vizuh/sabi --skill sabi`.
- Host-AI install flow: https://github.com/vizuh/sabi/blob/main/docs/install.ai.md
- Integrations: https://github.com/vizuh/sabi/blob/main/docs/adapters/README.md
- Borrowed authentication: https://github.com/vizuh/sabi/blob/main/docs/specs/borrowed-harness-auth.md
- Evidence layers: https://github.com/vizuh/sabi/blob/main/docs/harnesses.md
- Machine index: https://github.com/vizuh/sabi/blob/main/llms.txt
- Repository: https://github.com/vizuh/sabi

Paths above are repository paths, not files that sit beside this skill: an installed skill is this
one file, so link to the repository rather than to a relative path that will not exist.

## Accessibility contract for docs

- Every diagram ships alt text and a text fallback; color is never the only signal.
- Headings stay sequential; tables keep header rows; link text names its destination.
- English is canonical; PT-BR, ZH, JA and KO mirrors follow. English stays canonical for rates, quotas, and support claims.
