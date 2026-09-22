# Install Sabi

**English** · [Português (BR)](install.pt-BR.md)

Sabi is installed once per machine or user. It is not a Command Code plugin and does not require a particular harness. The core/controller is the user-facing installation; Command Code, OpenCode, Hermes, Claude Code, Codex, Orca, and other hosts are optional integrations.

If the user asks the current host AI to install Sabi, use the [host-AI installation flow](install.ai.md). It defines the questions, the one-key OpenRouter path, the localized explanation option, and the evidence the agent must report.

For Claude Code, Codex and controller-backed OpenCode workflows, install the published controller. For Hermes or OpenCode inference through the local Sabi proxy, keep using the checkout flow because the controller package does not contain the proxy server or Hermes profile.

## One-time user install

~~~bash
npm install --global @vizuh/sabi-controller@0.1.0
sabi setup
sabi doctor
~~~

The `setup` command is idempotent. It keeps the daemon and state user-scoped, detects supported hosts, installs only supported Sabi-owned hooks, and fails open when Sabi is unavailable. Use `sabi setup --no-hooks` if you want the daemon without changing host configuration. You do not need a Command Code account, a repository checkout, or a per-worktree installation.

The first public controller release is `controller-v0.1.0`. Do not use `npm link` for a user installation.

## What gets installed?

| Surface | Role | Requires Command Code? | Requires provider keys? |
|---|---|---:|---:|
| Sabi controller/daemon | User-level session and worktree coordination | No | No |
| Command Code mod | Per-round model + reasoning-effort routing inside Command Code | Yes | No |
| Local proxy | Model/provider routing for OpenAI-compatible clients | No | Yes, for BYOK upstreams |

These are independent surfaces, not stages. Installing the controller does not silently enable the proxy or the Command Code mod.

## Maintainer checkout (development only)

Use the repository checkout when you are developing Sabi, running the full test suite, or using an integration that has not yet been packaged:

~~~bash
git clone https://github.com/vizuh/sabi
cd sabi
npm install
npm run controller -- setup
npm run controller -- doctor
npm run controller -- integrations list
~~~

The `npm run setup` wizard is the checkout-based user path for Hermes/OpenCode proxy configuration; for
controller-backed hooks, use the global package above.

## Requirements by surface

| Surface | Requirements |
|---|---|
| Base controller | Node 22.6+ and the published `@vizuh/sabi-controller` package |
| Command Code mod | Command Code, a plan covering the configured `harness.tiers`, and the published `@vizuh/sabi` mod |
| Local proxy | Node 22.6+, an OpenAI-compatible client, and credentials for any paid upstream you enable |
| Hermes-first setup | Hermes, Node 22.6+, and a Sabi checkout; Nous login or OpenRouter key depends on the selected upstream |
| Maintainer checkout | Node 22.6+, git, and the repository |

## Optional integration: Command Code native mod

Use this only when you specifically want per-round model and reasoning-effort routing inside Command Code. It is not required to install Sabi.

### Published mod

~~~bash
cmd mods add -g npm:@vizuh/sabi
cmd mods list
~~~

### Local checkout (maintainer/development only)

~~~bash
git clone https://github.com/vizuh/sabi
cd sabi
npm install
cmd mods add ./packages/adapters/command-code
~~~

### Confirm it loaded

```bash
cmd mods list
```

Expected: one Sabi entry at user or project scope, with no warnings. The exact scope and source depend on how you installed the mod.

If it prints `Mods (0)`: the project has no session yet, so project-scope sources are not shown.
Start `cmd` once in the checkout, or trust the workspace, and list again.

### Confirm it routes

```bash
cmd -p "Read package.json and reply with only the value of its name field." \
  --mod ./packages/adapters/command-code/mod/sabi.ts -t --output-format json
```

In the event stream, turn 1 uses the session model and turn 2 uses the tier Sabi planned. A read
round is `exploration` → cheap, so turn 2 shows the cheap id from `harness.tiers`:

```
turn_start           1
model_request_start  <your session model>
tool_completed       read_file
turn_end             1
turn_start           2
model_request_start  deepseek/deepseek-v4-flash      ← planned by Sabi
turn_end             2
```

Notes on headless runs: a `-p` run does **not** load project-scope mods (project mods are
trust-gated, and print mode never prompts), which is why the check above passes `--mod` explicitly.
Drop-in mods under `~/.commandcode/mods` and user-scope sources do load headlessly.

The mod also writes its decision per round into the session as a custom entry, readable from the
session transcript:

```json
{"turn":2,"planned":{"tier":"cheap","model":"deepseek/deepseek-v4-flash","rule":"exploration","roundKind":"exploration"},
 "servedBy":"deepseek/deepseek-v4-flash","usage":{"inputTokens":26613,"outputTokens":6}}
```

### Remove

```bash
cmd mods remove sabi          # or: cmd mods remove ./packages/adapters/command-code
```

## Optional integration: local OpenAI-compatible proxy

Use this only when a client accepts a `baseURL` and you want Sabi to route your own upstream credentials. This is separate from the user-level controller daemon: in the current release, the proxy is still a foreground checkout process, so this optional path requires a checkout and `npm start`.

```bash
npm install
npm start                          # http://127.0.0.1:8787/v1
```

### Credentials are independent of the harness

The proxy loads only the environment names referenced by the active `sabi.config.json`.
Existing environment variables win, followed by `SABI_SECRETS_FILE`, the nearest workspace
`secrets/.env`, and `~/.config/sabi/secrets.env` or `~/.config/sabi/.env`. Use ordinary dotenv
assignments such as `OPENROUTER_API_KEY=...` and `TYPESAFE_API_KEY=...`; the current HugoOS file's
`typesafe=...` alias is supported too. Sabi does not copy these values into generated OpenCode, Hermes, Kilo, Command Code, or Orca
configuration, or into its logs. If the source is a workspace secrets/.env, that file is already
inside the worktree: keep it out of version control, add it to .gitignore, and protect its file
permissions. The Command Code mod path remains keyless. Other harnesses only need the local proxy
URL; their own subscriptions and login credentials stay theirs.

If the secrets live elsewhere, start Sabi with `SABI_SECRETS_FILE=/absolute/path/to/.env npm start`.
Users without a central file can keep exporting provider variables normally, and users who do not
use Jev can set `judge.enabled` to `false`.

### Optional OpenRouter free quality lane

The proxy can use the current zero-priced OpenRouter catalog for verification and other explicitly
accepted quality checks. This is opt-in; plain `sabi setup` never refreshes a provider catalog.

```bash
export OPENROUTER_API_KEY=...
sabi setup --free-quality
```

The command selects a current catalog model with exact zero prompt/completion pricing, text input and
output, tools, and an output-token limit. It records the selected id, observation time and catalog
hash in config provenance, adds `sabi-quality`, and maps `verification` to that fixed lane. It does
not replace the paid `cheap`, `mid`, `strong` or `failure` tiers. Run it again to refresh the
selection when the free catalog changes. A config backup is kept at `sabi.config.json.sabi-backup`.

Free availability is not quality evidence: providers may rate-limit or retire these models, and
their data policies may differ from paid providers. Do not use this lane for secrets or proprietary
code without explicit provider-policy approval. The setup command fails before writing if the key,
catalog or candidate is unavailable.

### Confirm it is up

```bash
curl -s http://127.0.0.1:8787/healthz
# {"ok":true,"models":["sabi-code","sabi-cheap",...],"upstreams":["openrouter","ollama"],"log":".../decisions.jsonl"}

curl -s http://127.0.0.1:8787/v1/chat/completions -H 'content-type: application/json' \
  -d '{"model":"sabi-code","max_tokens":16,"messages":[{"role":"user","content":"say ok"}]}'
```

The response `model` field is rewritten back to the alias you asked for, never the real upstream id.

### Point Command Code at it

```bash
npm run connect:command-code     # writes/updates the "sabi" provider in ~/.commandcode/providers.json
cmd --list-models | grep sabi
```

This asks a consent question before registering anything paid: **route paid upstream models
(real API credits) through Command Code?** On a real terminal it prompts once; on bare Enter or a
non-interactive/CI/agent-driven run it defaults to **no** and registers nothing paid — pass `--paid`
to skip the prompt and register the paid tiers unattended, or `--free` to skip it and register none.
This is a behavior change from earlier versions, which registered every paid tier unconditionally.

In the shipped config, `sabi-code`, `sabi-cheap`, `sabi-mid` and `sabi-strong` all resolve only to
the paid `openrouter` upstream — none of them register unless you answered yes or passed `--paid`.
Then pick `sabi/sabi-code` in `/model`, or pass `--model sabi/sabi-code`. The fixed aliases
(`sabi-cheap`, `sabi-mid`, `sabi-strong`) bypass the policy and exist as baselines for comparison.
`--include-local` also exposes `sabi-local` (Ollama); it is skipped by default because a 32k window
is too small for harness prompts.

When `--free-quality` has added `sabi-quality`, `npm run connect:command-code -- --free` exposes that
fixed zero-priced lane. It does not expose `sabi-code` in free-only mode while that adaptive alias
can still reach paid branches.

To hard-disable a specific upstream regardless of `--paid`, set `"enabled": false` on it in
`sabi.config.json` — see Configuration below. The kill switch is enforced again at request time, so
even a stale registration or another harness's config pointed at the running proxy is refused.

Read the outcome with:

```bash
npm run report          # decisions, tiers, tokens, cost, savings vs an all-strong counterfactual, judge stats
npm run report -- --json
```

### Stop

Sabi is a foreground process. `Ctrl-C`, or `kill <pid>`. It is not a service and nothing restarts it:
if it is down, every `sabi/*` request fails inside the harness with
`ECONNREFUSED 127.0.0.1:8787`.

## Configuration

`sabi.config.json` is looked up in order — first hit wins:

1. `$SABI_CONFIG` (when set, it is the only path read)
2. `<cwd>/sabi.config.json`
3. `~/.config/sabi/sabi.config.json` (honours `$XDG_CONFIG_HOME`)
4. the nearest `sabi.config.json` above the installed package

Each entry in `upstreams` accepts `"enabled": false` as a persistent kill switch — omitted or
`true` means usable. A disabled upstream stays schema-valid but `connect:command-code` will not
register any alias that needs it, and the proxy refuses to dispatch to it even if something else
still points there.

An entry also accepts `"paidModelsAllowed": false` — a billing rule, not a kill switch. Only
zero-priced models may then route or dispatch to that upstream: an id carrying the OpenRouter
`:free` variant, or an explicit `"cost": { "input": 0, "output": 0 }`. Anything else is refused
before the request leaves the process, so a priced id added to that upstream by mistake fails
loudly instead of spending:

```
{"error":{"message":"incompatible route 'mid': upstream 'openrouter' is free-models-only and 'openai/gpt-5-mini' is not zero-priced", ...}}
```

An undeclared price is treated as unknown, and unknown is not free. Use it to keep a shared
OpenRouter key free-only while Jev (TypeSafe) and any keyless local upstream stay unaffected.

Case 4 is what makes a fresh clone work: run from the checkout and the shipped config is found.
For a personal setup that survives moving the clone, copy the file to `~/.config/sabi/`. To work on
one project only, drop a config in that project.

Decisions go to `<cwd>/.sabi/decisions.jsonl`; override with `$SABI_LOG`.
Sabi writes metadata only — tier, rule, model id, token counts, cost, judge outcome. Prompt content
is never written, to the log or to the session, with one exception: a failed upstream call records the
first 200 characters of the provider's error response (credential patterns redacted), so a provider
that echoes request content in its error line puts that line in the log.

## Plan coverage

`cmd --list-models` lists the **entire catalog, not your plan**. A model outside your plan is still
listed and then fails at request time:

```
Error: 403 MODEL_NOT_IN_PLAN: Claude Sonnet 5 available in Pro and above plans or extra on demand usage
```

Because the mod switches models mid-session, an out-of-plan tier kills the round it routes to. Set
`harness.tiers` to ids your plan covers. Shipped defaults, verified live on 2026-09-18:

| Tier | Go and above (default) | Pro and above | Max |
|---|---|---|---|
| cheap | `deepseek/deepseek-v4-flash` | same | same |
| mid | `gpt-5.6-luna` | `claude-sonnet-5` | `claude-sonnet-5` |
| strong | `zai-org/glm-5.3` | `claude-sonnet-5` | `claude-opus-5` |

Other Go-and-above choices for `strong`: `moonshotai/kimi-k3`, `qwen/qwen3.8-max`,
`deepseek/deepseek-v4-pro`. `minPlan` in the config is a note for humans, not a runtime check —
Sabi cannot read your plan.

## Images and other media

Sabi refuses to send media to a model that cannot read it. Declare what each tier accepts, and the
router does the rest:

```json
"mid": {
  "upstream": "openrouter",
  "model": "dots-studio/dots-3-note-preview:free",
  "capabilities": { "inputModalities": ["text", "image"] }
}
```

That is the shipped `mid` tier. On a free-only upstream the id and the price both have to agree
with the rule — see `paidModelsAllowed` above.

- An adaptive round (`sabi-code`) that carries an image is served by the first tier in
  configuration order that declares `image` — tier order is the preference order, so list cheap
  before strong. The decision records `rule: capability` with a reason naming both tiers.
- A fixed alias (`sabi-cheap`) is refused with
  `400 incompatible route 'cheap': input modality 'image' is not supported`, because a baseline
  alias is an explicit choice. Use `sabi-code` when a session may contain screenshots.
- Nothing declared at all means unknown, and Sabi forwards as before — declaring modalities is what
  turns the constraint on. Verify them per model id against the upstream: on OpenRouter
  `deepseek/deepseek-v4-flash-0731` is text-only while `deepseek/deepseek-v4-flash-vision-exp`
  accepts images.
- The mod path reads the same idea from `harness.tiers[].inputModalities` and scans the transcript
  for media. It cannot fix a model the host already chose: if no tier can read the image, the round
  stays on the session model rather than being routed to a text-only one that would have the image
  silently stripped.
- Media is charged to the context estimate — 1500 tokens per image, the host's own bound — so a
  screenshot does not look like a small round to the context-pressure rule.

## Clients other than Command Code

The proxy is an OpenAI-compatible endpoint, so any client that accepts a `baseURL` can use it. These
clients get **class B only**: Sabi still picks the model per round, but not the reasoning effort, and it
infers a failed round from output text rather than the harness's own error signal. The judge still runs
(see [Jev for these clients](#jev-for-these-clients)).

### OpenCode

Verified end to end on 2026-09-18 against OpenCode 1.18.30: a real
`opencode run --model sabi/sabi-code` session reached a local Sabi, completed a tool round, and was
recorded with `client: opencode`.

```bash
npm start                       # Sabi proxy on 127.0.0.1:8787
npm run connect:opencode        # merges provider "sabi" into ~/.config/opencode/opencode.json
opencode run --model sabi/sabi-code "summarise this repository"
```

What the writer does — and deliberately does not do:

- Merges `provider.sabi` only. Existing providers, credentials and your default model are untouched;
  `--set-default` opts the session into the adaptive alias.
- Writes one backup (`<config>.sabi-backup`) and never overwrites it on a re-run.
- Refuses to touch a config that is not valid JSON, and leaves it unmodified.
- Declares each alias with the smallest window among the tiers it can serve. OpenCode rejects a model
  entry that sets `limit.context` without `limit.output`, so an undeclared tier gets a conservative
  4,096-token client cap — declare `maxOutputTokens` on a tier to make it exact.
- Declares input modalities per alias from the tiers that alias can serve: `sabi-code` and the
  image-capable fixed aliases advertise `text` + `image` (mid/strong declare `image` in the
  shipped config), while `sabi-cheap` stays text-only. An adaptive image round falls forward to
  the first image-capable tier (`rule: capability`); the same image on `sabi-cheap` is refused
  with 400, by design.
- Skips the `local` (Ollama) tier unless you pass `--include-local`.

Verify with `npm run report` (or `.sabi/decisions.jsonl`): the rounds appear with `client: opencode`.
Rollback: remove the `sabi` provider from the config, or restore the backup.

#### Controller hook

The user-level controller installed above can install a thin OpenCode `chat.message` plugin alongside the
Claude and Codex hooks:

```bash
npm install --global @vizuh/sabi-controller
sabi setup --hooks
# or: sabi hooks install --opencode
```

The controller package is the canonical user-level installation surface. Its release is separate from the `@vizuh/sabi` Command Code mod; the two packages are optional and do not replace each other. Maintainers can run `npm run build:controller` and the clean-prefix package test from the repository.

The plugin asks the loopback controller for a plan, dispatches only `DELEGATE`, `SPAWN` and
`ORCHESTRATE`, and replaces the current message only after the daemon reports accepted execution.
`CONTINUE` stays in OpenCode. Transport and daemon failures fail open. This is controller routing,
not a subscription/model switch, and the installed OpenCode plugin surface still needs a live host
activation check in the user's Orca instance.

When the controller probes OpenCode, it records the runtime catalog from `opencode models` with the
installed version and an output hash. IDs ending in an explicit `free` marker are classified as
`explicit-free`; other IDs remain `unknown` rather than being called paid or plan-eligible. A
controller-spawned OpenCode terminal may receive an exact native model such as a free Muse Spark
entry through `--model`; an existing session keeps its selected model. This does not make a native
OpenCode resource available through the Sabi proxy.

Controller traces use schema v1 and retain bounded candidates, valid actions, execution status and
duration. Inspect the read-only aggregate with:

```bash
sabi replay --last=1000
```

This summarizes recorded traffic; it does not invoke a harness or replay a paid task.

### Hermes

Hermes is served through its native `llm_request` middleware and local proxy. The setup below
creates one isolated profile, keeps Hermes' own auth store, and starts the path:

~~~text
Hermes → sabi-code → Sabi → Hermes Nous proxy → Nous Portal
~~~

It does not silently transfer OpenCode Go or ChatGPT Plus entitlements into Sabi. Those remain
native Hermes providers and can be selected with `hermes model`; the Sabi route uses the logged-in
Nous profile. The adapter has a pinned synthetic probe plus a bounded live Nous smoke; neither is
a quality, quota, savings or production-readiness claim.

#### Install, login and start

If Hermes is not installed yet, install it from the official installer and reload the shell:

~~~bash
curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash
source ~/.bashrc
hermes --version
~~~

From a fresh checkout:

~~~bash
git clone https://github.com/vizuh/sabi
cd sabi
npm install
npm run setup -- --harness=hermes --hermes-home="$HOME/.config/sabi/hermes" --no-jev
export HERMES_HOME="$HOME/.config/sabi/hermes"
~~~

Use a new or empty `HERMES_HOME`; do not overwrite an existing personal Hermes profile. If the
directory already exists, choose another isolated path and keep the existing auth store intact.

Login to Nous in the isolated Hermes profile. The browser/device flow keeps the credential in
Hermes' profile; Sabi never receives or writes that token:

~~~bash
hermes auth add nous --type oauth
hermes auth status nous
~~~

Use three terminals, from the Sabi checkout in the second one:

~~~bash
# Terminal 1
HERMES_HOME="$HERMES_HOME" hermes proxy start --provider nous --host 127.0.0.1 --port 8645

# Terminal 2
SABI_CONFIG="$HERMES_HOME/sabi.config.json" npm start

# Terminal 3
export SABI_HERMES_BASE_URL="http://127.0.0.1:8787/v1"
HERMES_HOME="$HERMES_HOME" SABI_HERMES_BASE_URL="$SABI_HERMES_BASE_URL" hermes chat
~~~

The generated Hermes profile already selects `sabi-code`. Verify the two local boundaries before
the first paid request:

~~~bash
curl -fsS http://127.0.0.1:8787/healthz
HERMES_HOME="$HERMES_HOME" hermes proxy status
~~~

To use the other accounts natively in Hermes, authenticate them through the installed Hermes
provider flow and select them with `hermes model`; switching back to `sabi-code` returns to Sabi
routing. Provider ids and auth modes are version/account dependent, so do not copy commands from
another Hermes release:

~~~bash
HERMES_HOME="$HERMES_HOME" hermes model
~~~

The exact ChatGPT Plus entitlement and the Nous balance are account-side facts; Hermes should
report quota or entitlement errors directly. If the `$20` is a standalone Nous API key rather than
Nous Portal credit, use the API-key upstream recipe instead of starting `hermes proxy`—do not paste
that key into `config.yaml` or commit it.

On the validation host, `qwen2.5-coder:7b` has a 32768-token context while Hermes 0.21.3 requires
at least 64000 for a custom model. Use Nous or a local model with a verified context of at least
64000 for Hermes; Qwen remains usable through a direct Sabi/Ollama configuration.

### Jev for these clients

The judge needs a TypeSafe key: export `TYPESAFE_API_KEY`, or set `judge.enabled: false`. Without a key
the proxy warns at startup and every judged round **fails open** — the round still completes on the
deterministic policy, the decision records `judge.status: error` with `note: typesafe unavailable`, and
the veto and difficulty signals are lost. Verified on 2026-09-18: HTTP 200, about 0.6 s added per judged
round. The mod never calls the judge; this applies to proxy clients only.

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `ECONNREFUSED 127.0.0.1:8787` in the harness | Path B is selected (`sabi/*` model) but the proxy is not running. `npm start`, or switch the session model back. |
| `403 MODEL_NOT_IN_PLAN` | A tier in `harness.tiers` is above your plan. See [Plan coverage](#plan-coverage). |
| `No endpoints found that support image input` (upstream 404) | An upstream model that takes no images, and no `capabilities.inputModalities` declared. See [Images and other media](#images-and-other-media). |
| `400 input modality 'image' is not supported` | Working as intended: the round carries media the selected tier cannot accept. Use the adaptive alias, or declare a tier that accepts it. |
| `Sabi disabled: Sabi config not found at …` | No config in any of the four locations. The message lists every path searched; set `SABI_CONFIG` or create one. |
| `cmd mods list` shows `Mods (0)` | Project-scope sources appear only after the project has had a session. Start `cmd` in the checkout once. |
| Mod loads interactively but not in `-p` | Expected: `-p` does not load project-scope mods. Pass `--mod ./packages/adapters/command-code/mod/sabi.ts`. |
| `WARN: missing upstream credentials` at startup | The config references an env var that is unset. Export it, or set that upstream's `apiKey` to `false`. |
| Round 1 ignores Sabi | By design: `prepareNextTurn` fires only from the second round, so the first round runs on the session model. |
| An image round looks bigger than its text | Expected: media is charged 1500 tokens per image in `state.estimatedTokens`, and `state.mediaCounts` records the count. |
| A provider error arrives mid-stream (`402`, context length) | Providers can report it inside an HTTP 200 stream. The decision records the provider's own message, and the client's stream is reset rather than completed with partial output — nothing is fabricated. |

## Security

This section covers the Command Code mod specifically. For the full picture across every
harness — authentication, authorization, encryption, audit logging, and incident response — see
[`docs/security.md`](security.md).

- **The mod is arbitrary code** — it runs in-process with no sandbox, like any Command Code mod.
  Install packages you trust; this one is short and readable (`mod/sabi.ts`, plus `packages/core`).
- **No secrets in git.** Keys are read from the environment; the config only stores `$ENV_VAR`
  references. Do not commit a config with literal keys.
- **Nothing leaves the machine except the model calls themselves.** The class-A path adds no network
  hop of its own. The class-B path forwards to the upstreams you configured — once you supply a key
  it will spend real credit on every routed round — and the Jev judge sends excerpts of the last
  instruction and tool result plus round metadata — a 6k-character target, not a strict
  serialized-size guarantee for every field.
- **Paid upstreams are opt-in at wiring time.** `npm run connect:command-code` defaults to
  registering nothing paid unless you pass `--paid` or answer yes at its prompt; `enabled: false`
  on an upstream disables it everywhere, including at request time, regardless of that consent.
  The consent question only governs whether Command Code gets wired in with paid tiers — the
  moment real spend actually becomes possible is exporting that upstream's key and running
  `npm start`, same as always. `enabled: false` is the durable switch for "never route here,
  period"; anything hitting the proxy directly still needs a key you supplied yourself.
- **The decision log is metadata only, with one exception.** Nothing from the conversation is written
  — no prompt content, no file contents, no tool output — but a failed upstream call records the first
  200 characters of the provider's error response (credential patterns redacted). A provider that
  echoes request content in its error line puts that line in the log.
- Working on a shared machine: `~/.config/sabi/sabi.config.json` is per-user; keep keys in the
  environment rather than in a world-readable config.

## Updating

```bash
cd /path/to/sabi && git pull && npm install
```

Nothing else to do for path A (the mod is referenced in place). For the npm install (`cmd mods add -g npm:@vizuh/sabi`), update with `cmd mods update`, which reinstalls the newest published version. For path B, restart the proxy.
If a model id or price has drifted, re-check upstream before trusting the cost report — see the
provenance notes in `sabi.config.json`.
