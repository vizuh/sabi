# Codex controller adapter

Codex is integrated through lifecycle and prompt hooks for task/session coordination. It is not
currently advertised as an in-session model/effort switcher.

## Hook events

sabi hooks install --codex writes Sabi-owned entries for:

- SessionStart (startup, resume, clear, compact)
- UserPromptSubmit
- SessionEnd

The installer preserves other Codex hooks, creates a .sabi-backup, and fails open when Sabi is unavailable.

~~~bash
npm run controller -- setup
npm run controller -- doctor
npm run controller -- hooks install --codex
~~~

A prompt can produce a controller plan with `CONTINUE`, `DELEGATE`, or `SPAWN` only when the
controller has a valid target and execution receipt. A receipt shows that a host accepted the
action; it does not prove that the downstream task completed successfully.

## Important boundary

The Codex hook does not switch the model in the current Codex session, bypass Codex approvals, or
transfer a Codex subscription to another provider. Use the Command Code mod or the local proxy
family when you need per-round inference routing.
