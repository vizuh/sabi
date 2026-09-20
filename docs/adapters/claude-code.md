# Claude Code controller adapter

Claude Code is integrated at the controller boundary, not as a native per-round model router.

## What the hook does

sabi setup or sabi hooks install --claude adds a fail-open UserPromptSubmit command hook to
Claude's settings. The hook sends bounded prompt/session/worktree metadata to the loopback
controller. If the controller accepts a delegation or spawn decision with a typed receipt, the
hook tells Claude to stop the current turn and explains where Sabi sent it.

~~~bash
npm run controller -- setup
npm run controller -- doctor
npm run controller -- hooks install --claude
~~~

The installer preserves existing settings and creates a .sabi-backup. Uninstall restores the
backup or removes only Sabi-owned entries.

## Important boundary

This adapter does **not** change the model selected inside an already-running Claude Code turn.
It does not move Claude's login/subscription credits into Sabi. It does not grant permissions to
a spawned target. The controller can dispatch only what its configured host or Orca transport can
prove with a receipt.

Read controller status as source and test evidence, hook installation, and live receipt evidence.
Do not treat an executable on PATH as proof that Claude is integrated.
