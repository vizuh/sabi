# Maintainer guide

This is the short contract for maintainers of harnesses and for contributors adding a Sabi adapter.

## The boundary

Sabi should attach to a documented host seam. The host keeps its normal loop and remains the
authority for tools, approvals, compaction, retries, cancellation, and user-visible state.

An adapter may:

1. detect the host/version;
2. install or remove its integration without clobbering user config;
3. identify a session/turn using opaque IDs;
4. receive a prompt or inference request;
5. dispatch through the host's supported API;
6. observe an outcome or typed receipt;
7. report evidence and fail open when Sabi is unavailable.

It must not create a second agent loop, duplicate policy in another language, execute tools itself,
or treat a model catalog as entitlement.

## Adapter manifest

The controller's contract is versioned in packages/controller/src/adapter-contract.ts:

| Operation | Meaning |
| --- | --- |
| detect | Is the exact host executable/runtime available? |
| install | Can Sabi add its integration while preserving user config? |
| identify-session | Can the host expose an opaque session/turn identity? |
| receive-prompt | Can the adapter receive a prompt without scraping transcript text? |
| dispatch | Can it invoke a supported host transport with a bounded timeout? |
| observe-outcome | Can it return accepted/started/completed/failed/unverifiable? |
| uninstall | Can it restore backups and remove only Sabi-owned state? |

Operation modes are native, hook, cli, or missing; status is integrated, partial, inventory-only,
inference-only, or unsupported.

## Evidence ladder

Use exact versions, commits, dates, and the observed test boundary:

| Level | What it proves | What it does not prove |
| --- | --- | --- |
| Source review | The upstream seam appears to exist | Runtime behavior |
| Unit/contract test | Sabi preserves a fixture contract | Real host/plugin loading |
| Protocol test | A real client reaches Sabi/mock | Provider quality or paid entitlement |
| Live smoke | An approved real provider request works | Completed-task quality |
| Completed-task eval | Fixed tasks, outcome and cost are measured | Universal future performance |

Write the evidence level beside every support claim.

## Adding an adapter

Start with a one-page proposal containing:

- host name/version and upstream commit;
- exact seam and lifecycle events;
- request/response preservation rules;
- identity, cancellation, timeout, and retry ownership;
- tools, parallel calls, structured output, reasoning, files, and image/audio capabilities;
- config mutation and rollback;
- security boundary and secret ownership;
- fixture tests plus a bounded real-client smoke plan.

Then add the smallest adapter package under packages/adapters/<id> and a user-facing page under
docs/adapters/<id>.md. Reuse packages/core; do not fork decideTier.

## Upstream maintainer checklist

A host integration is easier to maintain when the host exposes:

- a stable per-request or per-turn hook;
- opaque session/turn/request IDs;
- explicit model/provider selection before inference;
- model capability metadata;
- cancellation and deadline propagation;
- structured tool results and typed execution receipts;
- a way to install a plugin without overwriting user settings;
- a clear fail-open/fail-closed policy.

If your host can provide these seams, open an issue with a small fixture and the exact host version.
Sabi can then keep the adapter narrow and versioned instead of scraping logs or patching internals.

## Testing commands

~~~bash
npm test
npm run typecheck
npm run eval
npm run report -- --json
~~~

Client smoke tests must be opt-in, isolated, bounded, and clearly labeled as paid or no-paid. Never
commit credentials, cookies, raw prompts, tool output, or provider error bodies.
