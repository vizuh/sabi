# Install Sabi

For putting Sabi on a machine that is not this one. The repo (`https://github.com/vizuh/sabi`) is
public; you need a Command Code account for the class-A path.

**Quick setup**: `npm run setup` walks you through picking a harness and, optionally, Jev — see
[Quick setup](#quick-setup) below. The sections after it are the detailed manual steps it runs
for you; read them if you want to script around a single piece instead.

Two ways in, and they are alternatives rather than stages:

- **A — the mod** (recommended if you use Command Code): Sabi runs inside the harness, routes the
  subscription catalog, and needs no proxy and no API keys.
- **B — the proxy**: Sabi runs as a local OpenAI-compatible endpoint. Use it for harnesses that only
  accept a `baseURL`, or to route your own OpenRouter/Ollama models.

You can install both; they do not interfere (different mechanisms, different model namespaces).

## Quick setup

```bash
git clone https://github.com/vizuh/sabi && cd sabi && npm install
npm run setup
```

Asks which harness (Command Code / OpenCode / Hermes) and, separately, whether to enable Jev.
For Command Code and OpenCode it runs the same certified writer each harness's detailed section
below documents. For Hermes it automates the mechanical parts of the manual recipe below (create
`HERMES_HOME`, copy the plugin, write `config.yaml`) — that path is still **uncertified**, exactly
as the Hermes section says; it prints the context-window candidate for you to verify, it does not
assert it. Flags skip any prompt: `npm run setup -- --harness=command-code --class=a`,
`--harness=opencode --no-jev`, `--harness=hermes --hermes-home=<path>`. No harness flag and no TTY
to prompt on writes nothing and prints usage — there's no safe default harness, every choice
writes a different file. `--jev` only ever flips `judge.enabled`/`judge.baseURL` in
`sabi.config.json`; it never reads, prints, or writes your `TYPESAFE_API_KEY` — export that
yourself, same as always. Kilo and Prime Agent aren't automated — `--harness=kilo`/`prime-agent`
just points at [the manual recipes](harnesses.md).

## Requirements

| | |
|---|---|
| Node | 22.6 or newer (type stripping; developed on 24) |
| Harness | Command Code for path A; anything OpenAI-compatible for path B |
| Access | none — the repo is public |
| Keys | path A: none; path B: an upstream key (e.g. OpenRouter) and optionally a TypeSafe key for Jev |
| Plan | path A only: every id in `harness.tiers` must be covered — see [Plan coverage](#plan-coverage) |

## A — Command Code mod

```bash
git clone https://github.com/vizuh/sabi && cd sabi
npm install
cmd mods add ./packages/adapters/command-code
```

`cmd mods add` records the package as a mod source for the **project** (it writes
`.commandcode/settings.json` next to your checkout, which is gitignored). It does not copy anything:
the package is referenced in place, which is why the clone must stay where it is.

What was added:

```json
{ "mods": { "sources": ["/path/to/sabi/packages/adapters/command-code"] } }
```

The package declares what it ships in its own `package.json`:

```json
{ "commandcode": { "mods": ["./mod/sabi.ts"] } }
```

If you would rather not keep a checkout, the same mod is published to npm as one bundled file with no runtime dependencies, shipping its own default `sabi.config.json`:

```bash
cmd mods add -g npm:@vizuh/sabi     # user scope — loads in every project
```

A `sabi.config.json` in the project (or `~/.config/sabi/sabi.config.json`) takes precedence over the shipped default. Updates come from `cmd mods update`. Path B below still needs the clone.

### Confirm it loaded

```bash
cmd mods list
```

Expected — one line, no warnings:

```
Mods (1)
  sabi · project · from local:/path/to/sabi/packages/adapters/command-code
```

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

## B — local proxy

```bash
npm install
npm start                          # http://127.0.0.1:8787/v1
```

### Credentials are independent of the harness

The proxy loads only the environment names referenced by the active `sabi.config.json`.
Existing environment variables win, followed by `SABI_SECRETS_FILE`, the nearest workspace
`secrets/.env`, and `~/.config/sabi/secrets.env` or `~/.config/sabi/.env`. Use ordinary dotenv
assignments such as `OPENROUTER_API_KEY=...` and `TYPESAFE_API_KEY=...`; the current HugoOS file's
`typesafe=...` alias is supported too. Sabi never copies these values into OpenCode, Hermes, Kilo,
Command Code, Orca, a worktree, a log or Git. The Command Code mod path remains keyless. Other
harnesses only need the local proxy URL; their own subscriptions and login credentials stay theirs.

If the secrets live elsewhere, start Sabi with `SABI_SECRETS_FILE=/absolute/path/to/.env npm start`.
Users without a central file can keep exporting provider variables normally, and users who do not
use Jev can set `judge.enabled` to `false`.

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
  "model": "openai/gpt-5.6-luna",
  "capabilities": { "inputModalities": ["text", "image", "file"] }
}
```

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

The separate Agent Controller can install a thin OpenCode `chat.message` plugin alongside the
Claude and Codex hooks:

```bash
npm install --global @vizuh/sabi-controller
sabi setup --hooks
# or: sabi hooks install --opencode
```

This is the intended user installation path. The public `@vizuh/sabi` release contains the Command
Code adapter only; it does not install the controller or Orca bridge. Before the first
`@vizuh/sabi-controller` tag is published, the package command is intentionally unavailable; do not
replace it with `npm link` for a user installation. Maintainers can run `npm run build:controller`
and the clean-prefix package test from the repository.

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

Hermes is served through the same proxy, plus an optional plugin that adds stable attribution. This
follows `packages/adapters/hermes/README.md`: the plugin and a Hermes → Sabi → mock probe are verified
in isolation, but **no real Hermes profile has been run against Sabi yet** — treat this as a template,
not a certified path.

1. Create a new `HERMES_HOME`. Do not point it at an existing personal profile.
2. Copy `packages/adapters/hermes/plugin/` to `$HERMES_HOME/plugins/sabi-metadata/`.
3. Adapt `packages/adapters/hermes/config.yaml.example`: replace the context placeholder with a
   verified limit, and keep `supports_tools`, `supports_vision` and `supports_reasoning` conservative
   until you have verified every tier Sabi can route to. The template ships them `false`, which means
   no tools.
4. `HERMES_HOME=… hermes chat`, then select `sabi-code`.

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
