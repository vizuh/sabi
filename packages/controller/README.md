# @vizuh/sabi-controller

English is canonical. Entry points: [Português (BR)](../../README.pt-BR.md) · [中文](../../README.zh-CN.md) · [日本語](../../README.ja.md) · [한국어](../../README.ko.md). Agent entry: [SKILL.md](../../skills/sabi/SKILL.md) · [machine index](../../llms.txt).

Install Sabi once for the user, then use supported harnesses and Orca worktrees normally:

```bash
npm install --global @vizuh/sabi-controller
sabi setup
sabi doctor
sabi serve
```

The package bundles the controller and its private workspace dependencies. It does not require a
Sabi checkout, per-worktree `node_modules`, or `npm link`.

`setup` is the one-time consent point and is idempotent: it installs hooks only for detected
supported harnesses, while `--no-hooks` leaves their configuration untouched. It keeps the daemon
user-scoped. It installs a Linux `systemd --user`, macOS LaunchAgent, or Windows Task Scheduler
service when that platform's user service command is available; Linux reports a lazy detached
fallback if the user bus is unavailable. Use `sabi status`, `sabi agents`, `sabi integrations list` and
`sabi replay --last=1000` to inspect the local state. `sabi upgrade --version=<semver>` installs an
exact controller version, and `sabi uninstall` restores hook backups while archiving user state.

The first public release supports only the harness adapters listed by `sabi doctor`. An executable
being present on `PATH` is not, by itself, proof that a harness is controller-integrated. Use
`sabi serve` runs the local proxy in the foreground (the same server a checkout runs with
`npm start`), so routing inference through Sabi needs no clone. `sabi sessions --json` to inspect
bounded adapter registrations; registered sessions are not route
targets until their adapter proves a dispatch transport.

The daemon binds to loopback only, and the OpenCode bridge refuses non-loopback controller URLs.
Persisted controller traces omit raw requests, handoffs, diffs and terminal handles by default;
those values are used only for the live dispatch that needs them.
