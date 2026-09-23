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

## Where a host's file comes from

`setup` installs host integrations from Sabi's own packages, never from a path you copy. Every
host resolves through one order, and `sabi setup` reports which step answered (`setup --json` puts
it in `hooks[].source`):

1. an explicit override — `SABI_OPENCODE_HOOK_SOURCE`, then `SABI_PACKAGE_DIR`;
2. the controller's own bundled `resources/` — it leads the package steps because the hook is
   loaded by the controller that shipped it, so the bundled copy is the one whose protocol matches
   the daemon it will talk to;
3. the installed `@vizuh/sabi` — the product, carrying every host;
4. the installed `@vizuh/sabi-commandcode` — the stand-alone mod slice;
5. this checkout, so a clone keeps working.

Each artifact is read from the declaring package's own manifest (`opencode.plugin`, `omi.extension`,
`commandcode.mods[0]`, `orca.plugin`), so a package that does not ship a host resolves to nothing
for it rather than installing something older. `sabi hooks install --oh-my-pi --command-code`
installs the two file-based hosts on their own; `--opencode` installs OpenCode's hook through the
same order above.

The first public release supports only the harness adapters listed by `sabi doctor`. An executable
being present on `PATH` is not, by itself, proof that a harness is controller-integrated. Use
`sabi serve` runs the local proxy in the foreground (the same server a checkout runs with
`npm start`), so routing inference through Sabi needs no clone. `sabi sessions --json` to inspect
bounded adapter registrations; registered sessions are not route
targets until their adapter proves a dispatch transport.

The daemon binds to loopback only, and the OpenCode bridge refuses non-loopback controller URLs.
Persisted controller traces omit raw requests, handoffs, diffs and terminal handles by default;
those values are used only for the live dispatch that needs them.
