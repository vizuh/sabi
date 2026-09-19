# @vizuh/sabi-controller

Install Sabi once for the user, then use supported harnesses and Orca worktrees normally:

```bash
npm install --global @vizuh/sabi-controller
sabi setup
sabi doctor
```

The package bundles the controller and its private workspace dependencies. It does not require a
Sabi checkout, per-worktree `node_modules`, or `npm link`.

`setup` is explicit and idempotent; `--hooks` is the opt-in configuration mutation. It keeps
the daemon user-scoped. On Linux it attempts a `systemd --user` service and reports a lazy detached
fallback if the user bus is unavailable. Use `sabi status`, `sabi agents`, `sabi integrations list`
and `sabi replay --last=1000` to inspect the local state.

The first public release supports only the harness adapters listed by `sabi doctor`. An executable
being present on `PATH` is not, by itself, proof that a harness is controller-integrated.
