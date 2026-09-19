#!/usr/bin/env node
// A real orca-ide error envelope (ok: false) — exit 0, valid JSON, but not a success payload.
console.log(JSON.stringify({ id: 'fixture', ok: false, error: { message: 'not connected' } }))
