# Jev Routing in SABI

**What it is, how it works, why it fails open, and how to watch it.**

---

## 1. What Jev routing is

SABI's deterministic policy chooses a model tier for every round from rules alone — `failure` goes to `strong`, `exploration` goes to `cheap`, and so on. That policy is cheap, fast, and auditable, and it is right most of the time. It is blind in exactly one place: it has no semantics. It cannot tell whether a failure is a real problem the agent must fix (escalate) or a trivial hiccup that should stay cheap (vetoes). It cannot tell whether the current step is genuinely demanding (escalate) or routine (stay cheap).

**Jev routing** is SABI's semantic layer on top of that policy. On every auto round — when configured — SABI sends a bounded state snapshot to the Jev model (`jev-latest` on TypeSafe's API) and asks one question: *which tier should serve this round?* Jev returns a `routingTier` (a tier name like `"strong"`, `"mid"`, `"cheap"`, `"local"`) and a `routingConfidence` (a number in `[0, 1]`). In shadow mode, SABI records what Jev would have done without changing anything. In live mode, SABI overrides the policy's tier with Jev's — but only after every availability and capability gate clears.

Jev routing is separate from the **judge** (`config.judge`). The judge answers two different questions — "is this a real problem?" and "how demanding is this step?" — and applies thresholds to those answers. Jev routing answers one question — "which tier?" — and is a routing signal, not a judgment. Both consult Jev, but they are configured, triggered, and recorded independently.

---

## 2. How it works

### Trigger

Jev routing consults Jev on every auto round when `config.jev` is present and `jevRoutingTriggers(decision, config.jev)` returns true. By default that means every auto round (`callOn: ["auto"]`). You can narrow it by changing `callOn`.

### The request

For each round that triggers, SABI builds a bounded state snapshot (`buildRoutingState`) — at most `maxStateChars` characters (default 6000) — containing the last user instruction, the last tool excerpt, and round metadata. It never sends the full conversation. It then makes one batched TypeSafe request with `JUDGE_QUESTIONS` (a `noul` question and a `choice` question) and the Jev model.

### The response

Jev returns an outcome with at least:

- `routingTier` — a string tier name, e.g. `"strong"`, `"mid"`, `"cheap"`, `"local"`.
- `routingConfidence` — a number in `[0, 1]`.

### What SABI does with it

**Shadow mode** (`config.jev.shadow: true`, the default):

- SABI records Jev's tier and confidence in the decision metadata.
- The policy decision is **kept unchanged**.
- The console log and `/decisions` endpoint show what Jev would have done.

**Live mode** (`config.jev.shadow: false`):

- If Jev's `routingTier` is valid (string, present in `config.models`) and the suggested tier is actually available (upstream enabled, input modalities compatible), SABI overrides the policy tier with Jev's.
- If the suggested tier is unavailable for any reason, the policy decision is kept.

### The fail-open catch

If Jev is unreachable for any reason — timeout, network error, HTTP error, DNS failure — SABI catches the error, keeps the policy decision, and records the consultation as a failure. The request is served exactly as the deterministic policy alone would have chosen. **The proxy always serves requests.** See Section 3.

---

## 3. Fail-open behavior — and why it is intentional

**The contract: Jev is an opinion about routing, never a dependency of serving.**

Every failure path ends with the request served. There are four distinct fail-open paths:

| # | Trigger | What happens | Why |
| --- | --- | --- | --- |
| 1 | **Jev unavailable** — timeout, network error, HTTP error, DNS failure | The catch block records the consultation as failed; policy decision is kept. | A timeout must not hold the request. The proxy already chose a tier; that tier is served. |
| 2 | **Jev returns an invalid `routingTier`** — not a string, empty string, or a string not present in `config.models` | Validation fails before the shadow/live branch; a warning is logged; policy decision is kept. | A tier we cannot map to a model is a tier we cannot serve. Using it would crash or silently degrade. |
| 3 | **Jev returns a `routingTier` that is unavailable** — upstream disabled or capability mismatch (model cannot serve the input modalities the request needs) | The live branch's availability check fails; policy decision is kept. | Jev might suggest a tier we deliberately disabled or a model that cannot read the images/text the request carries. We do not serve what we cannot serve. |
| 4 | **Jev returns an invalid `routingConfidence`** — not a number, `NaN`, `Infinity`, or outside `[0, 1]` | Validation fails; confidence is clamped to `0` for metadata; a warning is logged; policy decision is kept. | A bad confidence is metadata noise. Clamping to 0 records the fact without letting it propagate into any decision. |

**Why this is the design, not a gap to be filled:**

- Before Jev routing existed, the proxy served every request with the deterministic policy. Adding Jev routing must not regress that guarantee. The moment a routing opinion can prevent a request from being served — by crashing, by hanging, by returning a tier that does not exist, by returning a tier whose upstream is down — the proxy is worse than the policy it supplements.
- A classifier is an opinion about the work, not a dependency of the work. This is the same principle kerpopule/hermes-jev-skills documents in its "Fail open, or do not ship it" section: *no key, no network, a timeout, a malformed answer, the toolkit not installed at all — every one of those ends with the work done exactly as it would have been, and the process exiting zero.*
- Fail-open is the default. Live override is the exception that must clear every gate: valid response, known tier, enabled upstream, compatible modalities.

**A corollary: bound the work by the clock, not just the count.** `timeoutMs` (default 2500) is the real limit. A count cap would not protect against a slow Jev that answers every call just inside the count but well outside the latency budget.

---

## 4. Safety rails

These are the explicit checks, in the order they run:

1. **Jev unavailable (catch block).** The `abortable(state.judge.ask(...))` call is wrapped in try/catch. On any error that is not a signal abort, the catch records the consultation as failed and keeps the policy decision. `signal.aborted` is re-thrown — that is the request's own deadline, not a Jev failure.

2. **Response validation (before shadow/live branching).** After receiving `outcome`, SABI validates:
   - `routingTier` is a non-empty string.
   - `routingTier` is a key in `config.models`.
   - `routingConfidence` is a finite number in `[0, 1]`.
   If any check fails, a `[sabi:jev]` warning is logged to the console, the policy decision is kept, and the consultation is still recorded (so it appears in `/decisions` and the dashboard). This catches caller bugs, upstream schema drift, and partial responses.

3. **Live availability check (live mode only).** If `config.jev.shadow` is false and the response passed validation, SABI checks:
   - `isEnabledUpstream(config.upstreams[jevModel.upstream])` — the upstream is not disabled.
   - `servesInputModalities(jevModel.capabilities?.inputModalities, decision.state.inputModalities)` — the model can serve the input modalities the request carries (text, image, audio, file).
   If either check fails, the policy decision is kept. Jev suggested a tier SABI cannot actually serve.

4. **Post-routing compatibility gate.** After Jev routing (live or shadow), `ensureRouteCompatible(body, config, decision)` runs on the final decision. This is the shared gate that every routing path — policy, Jev, transport fallback — must clear. Jev routing never bypasses it.

5. **Config defaults to off.** `config.jev.enabled` defaults to `false`. The setup wizard writes it only when the operator explicitly passes `--jev`. A missing or unset key never activates Jev routing silently.

---

## 5. Configuration

All fields live under `config.jev` in `sabi.config.json`:

| Field | Type | Default | Meaning |
| --- | --- | --- | --- |
| `enabled` | boolean | `false` | Whether Jev routing is active at all. When false, Jev is never consulted for routing. |
| `shadow` | boolean | `true` | Shadow mode records what Jev would do without overriding the policy. Live mode (`false`) overrides the policy tier when Jev's suggestion clears every gate. Start in shadow; switch to live only after reviewing the shadow log. |
| `baseURL` | string | `"https://api.typesafe.ai/v1"` | The TypeSafe API base URL. |
| `apiKey` | string | `"$TYPESAFE_API_KEY"` | The API key. The `$TYPESAFE_API_KEY` form reads the environment variable at runtime. The setup wizard never writes the literal key into the config file. |
| `model` | string | `"jev-latest"` | The Jev model to consult. |
| `timeoutMs` | number | `2500` | Per-request timeout in milliseconds. When this elapses, the request is aborted and the catch block fires fail-open. This is the real limit — bound by the clock, not the count. |
| `callOn` | string[] | `["auto"]` | Which decision modes trigger Jev routing. `["auto"]` means every auto round. Narrow it to reduce cost and latency if you only want Jev on specific rounds. |
| `maxStateChars` | number | `6000` | Maximum characters of state sent to Jev per round. The snapshot contains the last user instruction, last tool excerpt, and round metadata — never the full conversation. |
| `costPerMTokInput` | number | `0.042` | Jev's input cost in USD per million tokens, used for cost reporting in the decision log. |
| `privateProfiles` | string[] | `[]` | Profiles whose turns are not sent to Jev. When non-empty, rounds belonging to these profiles skip Jev routing entirely. Use this to keep specific profiles local-only. |

### Enabling Jev routing

The setup wizard handles the initial config. For manual setup:

1. Ensure `TYPESAFE_API_KEY` is set in the environment.
2. In `sabi.config.json`, set `jev.enabled` to `true`.
3. Start in shadow: `jev.shadow` defaults to `true`. Review the shadow log before switching to live.
4. To go live, set `jev.shadow` to `false`.

### Switching from shadow to live

Shadow mode pays the full Jev cost and latency on every triggered round but changes nothing. Live mode pays the same cost and latency but can override the policy tier. Before switching:

1. Run in shadow long enough to collect a meaningful sample.
2. Read the shadow log (console `[sabi:jev]` lines, `/decisions` endpoint, or the dashboard) and compare Jev's suggested tier to the policy's chosen tier.
3. Decide whether Jev's suggestions are improving routing or just adding cost and latency.
4. Set `jev.shadow` to `false` only when you have made that judgment.

There is no automatic threshold or automatic promotion from shadow to live. The review is manual because the cost of being wrong live — routing a cheap round to a strong model, or vice versa — is real money and real latency, and a shadow log is the only evidence we have before the switch.

---

## 6. Monitoring

### The `/decisions` endpoint

`GET /decisions?limit=N` returns the most recent N routing decisions. Each decision record has a `jevRouting` field when Jev was consulted:

```json
{
  "count": 20,
  "decisions": [
    {
      "ts": "2026-09-21T11:00:00.000Z",
      "alias": "sabi-code",
      "mode": "auto",
      "tier": "mid",
      "rule": "first-turn",
      "upstream": "openrouter",
      "upstreamModel": "openai/gpt-5-mini:batch",
      "jevRouting": {
        "shadow": true,
        "jevTier": "strong",
        "jevConfidence": 0.72,
        "policyTier": "mid",
        "consulted": true
      }
    }
  ]
}
```

When Jev was not consulted, `jevRouting` is absent. When the Jev call failed (timeout, error, invalid response), `jevRouting.consulted` is still `true`, `jevTier` is the policy tier, and `jevConfidence` is `0` — the fail-open record.

### Console log

When Jev is consulted and `state.options.verbose` is not false, SABI logs a `[sabi:jev]` line:

```
[sabi:jev] shadow: Jev would route to strong (confidence 0.72), policy chose mid
[sabi:jev] live: Jev routed to strong (confidence 0.72), overriding policy's mid
[sabi:jev] shadow: Jev would route to cheap (confidence 0.31), policy chose mid
```

When Jev fails open — timeout, error, invalid response — a warning is logged:

```
[sabi:jev] invalid Jev response: routingTier must be a non-empty string, got null. Keeping policy decision.
[sabi:jev] invalid Jev response: routingTier "nonexistent" is not in config.models. Keeping policy decision.
[sabi:jev] invalid Jev response: routingConfidence must be a number in [0,1], got 1.5. Replacing with 0, keeping policy decision.
```

These warnings are the signal that Jev routing is not contributing on that round. They are not errors — the request is served — but they are visible in the console and should be investigated if they appear frequently.

### The `x-sabi-jev` response header

When Jev was consulted on a request, the proxy adds an `x-sabi-jev` header to the response:

```
x-sabi-jev: {"jev-tier":"strong","jev-confidence":0.72,"jev-shadow":"true","jev-policy-tier":"mid"}
```

This header is present on every response where `decision.jevRouting.consulted` is true — including fail-open cases. You can inspect it with any HTTP client:

```bash
curl -s http://127.0.0.1:8787/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{"messages":[{"role":"user","content":"hello"}],"model":"sabi-code"}' \
  -D - | grep x-sabi-jev
```

The header fields:

| Field | Meaning |
| --- | --- |
| `jev-tier` | The tier Jev suggested (or the policy tier on fail-open). |
| `jev-confidence` | Jev's confidence, or `0` on fail-open. |
| `jev-shadow` | `"true"` if shadow mode, `"false"` if live. |
| `jev-policy-tier` | The policy's original tier choice. |

Comparing `jev-tier` to `jev-policy-tier` tells you in one header whether Jev agreed with the policy (same value), disagreed (different value), or was not able to contribute (fail-open: `jev-tier` equals `jev-policy-tier` and `jev-confidence` is `0`).

---

## 7. Relationship to the judge

SABI has two Jev-powered surfaces, and they are not the same:

| Surface | Config key | Trigger | Question | Output |
| --- | --- | --- | --- | --- |
| **Jev routing** | `config.jev` | `jevRoutingTriggers` (default: every auto round) | "Which tier should serve this round?" | `routingTier`, `routingConfidence` |
| **Judge** | `config.judge` | `judgeTriggers` (default: `failure`, `unclassified`) | "Is this a real problem?" + "How demanding is this step?" | `realProblem`, `difficulty`, applied via thresholds |

The routing surface is about *where to send the round*. The judge surface is about *whether to escalate, veto, or keep*. Both call Jev. Both fail open. Both record their consultations. But they are configured, triggered, and reviewed independently.

---

## 8. Operational notes

- **Shadow is the default for a reason.** Jev routing in live mode changes which model serves every auto round. That is a real behavior change with real cost. Shadow mode lets you observe Jev's suggestions before they affect anything. Start in shadow.
- **A quiet log is not evidence Jev routing is running.** If you enable Jev routing and see no `[sabi:jev]` lines, verify: `jev.enabled` is true, the request mode is `auto`, the callOn list includes the mode, and the API key is reachable. The `/decisions` endpoint and the `x-sabi-jev` header are the proof, not the absence of errors.
- **Fail-open warnings are not errors, but they should not be frequent.** A fail-open warning means Jev routing did not contribute on that round. One-off warnings (a blip in the API, a schema mismatch on one response) are normal. A stream of warnings means something is wrong — the API is down, the key is invalid, or the response schema has changed.
- **Private profiles skip Jev routing.** If `jev.privateProfiles` lists the current profile, Jev is not consulted for that profile's rounds at all. Use this for profiles that must not send any state to the TypeSafe API.
- **The state snapshot is bounded and redacted.** At most `maxStateChars` characters are sent, containing the last user instruction, last tool excerpt, and round metadata. The full conversation is never sent. The decision log stores no prompt content.

---

*Modeled after the transparency and fail-open approach in [kerpopule/hermes-jev-skills](https://github.com/kerpopule/hermes-jev-skills), specifically its "Turning a Jev feature on without breaking something" doc and its "Fail open, or do not ship it" principle.*
