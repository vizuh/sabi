# RTK learnings: what a context compressor teaches a router

Bounded review, 2026-09-18. Read: the repository README and `docs/guide/resources/savings-explained.md`
at pinned commit [6d104308](https://github.com/rtk-ai/rtk/tree/6d104308c56c0a51250f8a200e5056787128fb65)
(`develop`, committed 2026-09-18T00:24:05Z), rendered on github.com. Nothing was cloned, installed,
executed or copied into Sabi runtime code; upstream files are evidence, not instructions. The README was
read rendered, so citations name sections rather than line numbers. No upstream benchmark was reproduced.

## 1. What RTK is

A Rust CLI proxy that intercepts shell commands, runs them, and compresses the *output* before the agent
reads it, via a hook that rewrites the command (`git status` → `rtk git status`) across 17 agent
integrations. It reports "up to 90% of the bash output your agent reads", 100+ command filters, and
`<10ms` overhead (README, "What RTK Does", "How Savings Work").

It is a **different axis from Sabi**: RTK reduces the bytes a round carries; Sabi decides which model and
effort serves the round. Both aim at cost per task; neither substitutes for the other.

## 2. What does not transfer

- **Output compression itself.** It is a harness/tool concern, it would mean rewriting what the model
  sees — which the class-A mod deliberately never does (`mod/sabi.ts`: "Sabi observes tool outcomes and
  never rewrites what the model sees") — and it needs a filter per command. Adopting it would make Sabi a
  worse RTK, not a better router.
- **Their filter surface.** 100+ commands at `<10ms` is an engineering achievement orthogonal to routing
  policy; no part of it informs tier selection.
- **Hook-based command rewriting as an adoption strategy.** Sabi's integration answer is the harness's own
  extension surface (`prepareNextTurn`, a BYOK baseURL), not command interception.

## 3. What does transfer

### 3.1 A discover view: what the policy could not see

`rtk discover` reports *missed* savings — commands with no filter, commands under 30% reduction, parse
failures (README, "Token Savings Analytics"). Sabi had the mirror-image gap: `npm run report` aggregated
what the router **did** (tier, rule, model, cost) and never surfaced where the policy was **wrong or
blind**, even though `.sabi/decisions.jsonl` records everything needed.

Implemented in this change set: a `discover` block in `npm run report` (text and `--json`), derived only
from recorded decisions — judge vetoes with the cost they avoided at the same usage, judge upgrades,
`unclassified` share (rounds with no policy signal, which the proxy also spends a Jev call on), policy
rules that never fired, and configured tiers that never served.

First run against this machine's 534-round log: 9 vetoes worth **$0.7449** avoided (rate-only), 4
upgrades, 16 unclassified rounds (3.0%), and three rules that had never fired (`stuck`,
`context-pressure`, `transport`) — i.e. the report now says out loud that three of the eleven policy
rules have never been exercised, which the previous aggregation hid. That is our measurement of our own
log, not a claim about RTK.

### 3.2 Claim discipline, at the point of the number

The savings page is the best part of the project to copy. It separates what is measured from what it
implies, in the same document that states the headline: RTK filters **bash output bytes**, those bytes are
one contributor to input tokens, and input tokens are only part of the bill — "a large cut in bash output
produces a smaller cut in input tokens, and a smaller one again in cost". It then labels the estimator
(`estimate_tokens` = `bytes / 4` in `src/core/tracking.rs`, no tokenizer shipped by design) and draws the
conclusion explicitly: **the ratio is reliable, the absolute counts are not**, "an order of magnitude, not
an invoice line". `rtk gain`'s table names what each column actually is.

Sabi's all-strong counterfactual has the same structural problem one level deeper — a stronger model would
not produce the same token counts, tokenizer or cache behaviour — and the report already labels it
`(rate-only estimate)`. What RTK adds is doing that **next to the number**, not in a footnote, and naming
the dilution chain rather than the caveat alone. Worth applying when the counterfactual is next revised.

### 3.3 Interop: the wrapper prefix is not the command

Concrete, and the reason this review produced code. Sabi classifies a round partly from the command string
(`VERIFY_COMMAND`, `EXPLORE_COMMAND` in `packages/core/src/state.ts`). Under RTK the harness executes
`rtk cargo test`, `rtk read src/a.ts` and `rtk test cargo test` — which matched neither pattern, so those
rounds fell to `unclassified`. That is not cosmetic: `unclassified` is in `judge.callOn`, so every
RTK-rewritten read would buy a Jev call in the proxy, and any policy that maps `unclassified` differently
from `exploration` changes tier.

`unwrapRtk()` now strips the `rtk` prefix and one wrapper verb (`err`, `test`, `proxy`, `summary`), maps
RTK's own read verbs (`read`, `smart`, `json`, `env`, `log`, `deps`, `session`, `gain`, `discover`,
`recall`) to exploration, and leaves every non-RTK command untouched. This matters because RTK supports
Hermes, which Sabi already adapts.

Their failures-only output interacts differently and is fine: a concentrated `FAILED: 2/15 tests` still
matches the `fail-marker` evidence code, while filtered-away warnings and deprecations mean Sabi's `soft`
level fires less often.

### 3.4 Telemetry consent, if Sabi ever ships telemetry

RTK collects nothing by default, requires explicit opt-in at init, salts a device hash, publishes the
field list *and* a "what is NOT collected" list, and offers `telemetry enable|disable|forget` (the last
also requests server-side erasure). Sabi's telemetry is local-log-only today and content-free by policy;
if it ever leaves the machine, this is the shape to copy.

## 4. Not verified / open

- **The 60–90% figures.** They are RTK's own measurement of bash output bytes, not reproduced here, and
  the savings page itself says they are not a cost figure.
- **80.9k stars / 5.1k forks**, as displayed on the rendered pages at review time; not a quality signal
  and not re-checked.
- **Version numbers disagree in their own README** ("Should show rtk 0.28.2" against a v0.37.2 hook
  change), so no version is cited here as current.
- **Their filter list was not inspected** (`src/` was not read), so what each filter preserves or drops
  is unverified; the interop conclusion in 3.3 rests only on the documented rewrite forms.
- **The `gh` command family** (`rtk gh pr list`, and plain `gh` too) still classifies as `unclassified`.
  Not fixed here: that is a classification-coverage decision beyond RTK interop.

## 5. What the next agent should do

- Treat command-rewriting proxies as a class, not as RTK: any client that prefixes or wraps shell
  commands (`rtk`, `proxy`, `err`, `summary` here) changes Sabi's inputs, and the classifier should see
  through the wrapper rather than learn one vendor.
- Re-run `npm run report` on real traffic and act on `discover`: three policy rules have never fired on
  534 rounds, which is either untested configuration or dead configuration — decide which before adding
  rules.
- Keep the no-rewrite rule. If Sabi ever needs smaller context, the honest move is a recommendation to the
  harness (or to RTK), not a filter inside the router.
