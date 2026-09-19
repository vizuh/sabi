#!/usr/bin/env node
// The old, disproven assumption (a bare JSON array) — must still be rejected as unrecognized-shape,
// not silently accepted, now that the real envelope shape is known.
console.log(JSON.stringify([{ path: '/tmp/example', branch: 'main' }]))
