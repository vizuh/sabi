# OpenRouter free quality lane

Status: implemented as an explicit setup opt-in; quality is not yet benchmark evidence.

## Goal

Give Sabi a refreshable, zero-priced OpenRouter lane for verification, assessment, review and
other low-risk quality checks while preserving the existing paid tiers for normal routing and
recovery.

## Contract

- `--free-quality` is opt-in. Plain `sabi setup` does not make a network request or change the
  routing config.
- Setup reads the live OpenRouter `/models` catalog and selects deterministically from models whose
  prompt and completion prices are both exactly zero, whose input/output include text, and whose
  catalog declares tools plus an output-token parameter.
- The `:free` name suffix is not the gate. Catalog pricing is the source of truth for this refresh;
  the selected id, observation time, endpoint and catalog SHA-256 are recorded in provenance.
- Setup writes a fixed `sabi-quality` alias and maps `verification` to the `quality` tier. It does
  not replace `cheap`, `mid`, `strong`, or `failure` routes.
- Command Code `--free` exposes the fixed zero-priced quality lane but refuses an adaptive alias if
  any reachable branch can still spend paid credits.
- A missing key, catalog failure, empty candidate set or invalid patch fails before the config is
  written. Existing config is backed up once as `<config>.sabi-backup`.

## Safety and evidence boundary

OpenRouter free availability can be rate-limited, temporary or subject to provider data policies.
The lane is therefore for explicitly accepted low-risk work; do not send secrets or proprietary
code unless the provider policy and user consent allow it. A successful catalog refresh proves
availability and metadata only. It does not prove model quality, entitlement, latency, quota or
completed-task success.

The first slice selects one current candidate. It does not run a multi-model debate, maintain a
learned quality profile, or automatically promote a free model based on its own answer. Those are
separate evaluation tasks.

## Commands

With a config containing an OpenRouter upstream and an environment reference such as
`$OPENROUTER_API_KEY`:

```bash
export OPENROUTER_API_KEY=...
sabi setup --free-quality
```

The same flag is available to the maintainer proxy wizard:

```bash
npm run setup -- --harness=opencode --no-jev --free-quality
```

Use `sabi-quality` for a fixed check, or `sabi-code` for the normal adaptive path. Refresh the
catalog by running the opt-in setup again; never hand-edit a current provider id into the shipped
config.
