#!/usr/bin/env node
// Real envelope shape, observed live against orca-ide 1.4.201 on 2026-09-19.
console.log(JSON.stringify({
  id: 'fixture',
  ok: true,
  result: { worktrees: [{ path: '/tmp/example', branch: 'main' }], terminals: [{ worktreePath: '/tmp/example', branch: 'main' }] },
}))
