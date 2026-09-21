# What leaves your machine — SABI transparency report

This document describes what data leaves your machine when using SABI with Jev routing enabled. It is modeled after the approach taken in `kerpopule/hermes-jev-skills` — explicit, verifiable, and actionable.

**Version:** 2026-09-21  
**Scope:** SABI inference proxy (`packages/server`) with Jev routing (`packages/core/src/judge.ts`)  
**Primary off-machine surfaces:** Jev routing endpoint (typesafe.ai), Judge endpoint (typesafe.ai), upstream providers (OpenRouter, Ollama)

---

## 1. Overview: What SABI does and what data it handles

SABI is an inference routing proxy. It sits between your coding agent and LLM providers, deciding which model tier should serve each turn based on policy, and optionally consulting Jev (a remote routing service) for routing decisions.

**Data SABI handles locally (never leaves by default):**

- Your prompts and tool outputs (the full conversation)
- API keys for upstream providers (OpenRouter, etc.)
- Session identity, turn metadata
- Decision logic, policy configuration

**Data that may leave your machine (opt-in or by design):**

- Routing state sent to Jev for routing decisions (redacted by default)
- Judge state sent to typesafe.ai for failure analysis (redacted by default)
- Full request body sent to upstream providers (required for inference)
- Decision metadata logged locally (no raw content)

---

## 2. Per-feature breakdown

### 2.1 Jev Routing

**What is sent to Jev:**

The `buildRoutingState()` function in `packages/core/src/judge.ts` constructs the state object sent to Jev's `/systemone` endpoint. By default (shadow mode, no snippets), this includes:

| Field | Content | Default behavior |
|-------|---------|------------------|
| `round.index` | Assistant turn number | Always sent |
| `round.kind_heuristic` | Round type (first-turn, exploration, etc.) | Always sent |
| `round.messages` | Message count | Always sent |
| `round.context_tokens_estimate` | Estimated context size | Always sent |
| `round.context_generation` | Context generation number | Always sent |
| `last_instruction` | Combined opening + end of turn text | **Empty by default**; sent only if `jev.includeSnippets: true` or `telemetry.captureSnippets: true` |
| `last_instruction_sha256` | SHA-256 hash of combined text | Sent when snippets disabled (content-free) |
| `last_instruction_chars` | Character length of combined text | Sent when snippets disabled |
| `last_tool.names` | Last 6 tool names | Sent as-is when snippets enabled; hashed when disabled |
| `last_tool.result_excerpt` | Tool result excerpt | **Empty by default**; never sent separately (combined text captures full turn) |
| `failure_evidence_heuristic` | Last 3 failure evidence codes | Always sent (allowlisted codes only) |
| `available_tools` | Available tool names (up to 40) | Sent as-is when snippets enabled; hashed when disabled |
| `policy_tier` | The policy's proposed tier | Always sent |

**Redaction applied:**

When `allowSnippets` is true (snippets enabled), the combined text is run through `redactPii()` before transmission. See [Section 3](#3-redaction-details) for details.

**Private profiles:**

When the session ID matches an entry in `jev.privateProfiles`, the state uses `extractCoarseFeatures()` instead of raw text. This sends:

- `messageCount`, `totalChars`, `hasCode` (boolean), `riskWords` (detected labels)
- All text fields are replaced with SHA-256 hashes of the coarse features JSON

**What is NOT sent to Jev:**

- Raw tool output (unless snippets enabled AND it appears in the combined opening+end text)
- Full conversation history (only opening + end of turn, capped at 2500 chars)
- API keys, passwords, or credentials
- Provider API keys (these stay in your environment/config)
- The `x-sabi-*` headers (stripped before upstream calls)

---

### 2.2 Judge (typesafe.ai)

**What is sent to the Judge:**

The `buildJudgeState()` function in `packages/core/src/judge.ts` constructs the state sent to the Judge endpoint. This is consulted for `failure` and `unclassified` rounds (configurable via `judge.callOn`).

| Field | Content | Default behavior |
|-------|---------|------------------|
| `round.*` | Same round metadata as Jev routing | Always sent |
| `last_instruction` | Last user message (trimmed to 1200 chars) | **Empty by default**; sent only if `judge.includeSnippets: true` or `telemetry.captureSnippets: true` |
| `last_instruction_sha256` | SHA-256 hash of instruction | Sent when snippets disabled |
| `last_instruction_chars` | Character length | Sent when snippets disabled |
| `last_tool.names` | Last 6 tool names | Sent as-is or hashed (same as Jev) |
| `last_tool.result_excerpt` | Last tool result (trimmed to 2500 chars) | **Empty by default**; sent only if snippets enabled |
| `last_tool.result_excerpt_sha256` | SHA-256 hash of excerpt | Sent when snippets disabled |
| `last_tool.result_excerpt_chars` | Character length | Sent when snippets disabled |
| `failure_evidence_heuristic` | Last 3 failure evidence codes | Always sent |
| `available_tools` | Available tool names | Sent as-is or hashed (same as Jev) |

**Redaction applied:**

Same `redactPii()` function as Jev routing when snippets are enabled.

**What is NOT sent to the Judge:**

- Same exclusions as Jev routing
- The Judge does not receive the policy tier (that's a Jev routing concept)
- Raw tool output beyond the last tool result excerpt

---

### 2.3 Upstream Providers (OpenRouter, Ollama)

**What is sent to upstream providers:**

The `callUpstream()` function in `packages/server/src/upstream.ts` sends the full request body to the provider's `chat/completions` endpoint. This includes:

| Field | Content |
|-------|---------|
| `model` | The selected model name |
| `messages` | The full conversation messages array |
| `stream` | Whether streaming is requested |
| `stream_options` | Stream options (if configured) |
| Any other fields present in the original request | Passed through |

**Authentication:**

- The upstream's API key is sent as `Authorization: Bearer <key>`
- Keys are resolved from config or environment variables

**What is NOT sent to upstream providers:**

- SABI's internal configuration (`sabi.config.json`)
- Jev routing decisions (`jevRouting` metadata)
- Judge decisions (`judge` metadata)
- `x-sabi-*` headers (explicitly stripped in `callUpstream()`)
- Decision log data

**Important:** The upstream provider receives your full prompts and tool outputs. This is inherent to how LLM inference works — the provider must see the content to generate a response. SABI does not add additional redaction at this layer; that responsibility belongs to the provider's own privacy controls.

---

### 2.4 Decision Log

**What is logged locally:**

The decision log (`.sabi/decisions.jsonl` by default, configurable via `SABI_LOG`) records per-round metadata:

| Field | Content |
|-------|---------|
| `ts` | ISO timestamp |
| `requestId` | Random UUID for the request |
| `sessionId` | Hashed session identity (if `x-sabi-session` header present) |
| `alias` | The requested alias |
| `mode` | Request mode (auto, fixed, etc.) |
| `rule` | Routing rule that fired |
| `tier` | Selected tier |
| `reason` | Sanitized reason (allowlisted codes only by default) |
| `upstream` | Upstream name |
| `upstreamModel` | Model name |
| `stream` | Whether streaming was used |
| `state` | Round state (with tool names hashed) |
| `outcome` | Outcome (ok, transport, etc.) |
| `usage` | Token usage (if available) |
| `cost` | Cost breakdown (if available) |
| `latencyMs` | Request latency |
| `jevRouting` | Jev routing metadata (shadow/live, tiers, confidence) |
| `judge` | Judge record (status, model, realProblem, difficulty, etc.) |

**What is NOT logged:**

- Full turn text (the `last_instruction` and `last_tool.result_excerpt` fields are empty or hashed)
- API keys or passwords
- Raw tool output (tool names are hashed via `hashIdentity()`)
- Provider error bodies (only sanitized, truncated to 200 chars, with secret patterns redacted)

---

### 2.5 Telemetry

**What is captured:**

Telemetry is controlled by `telemetry.allowlistOnly` (default: `true`) and `telemetry.captureSnippets` (default: `false`).

| Config | Default | Effect |
|--------|---------|--------|
| `allowlistOnly` | `true` | Evidence codes in reasons must be from the allowlist; raw text is withheld |
| `captureSnippets` | `false` | When `false`, no raw instruction/tool text is sent to Jev/Judge; only hashes and metadata |

**What is NOT captured:**

- Raw prompt content (by default)
- Raw tool output (by default)
- Any data beyond what is explicitly listed in the per-feature sections above

---

## 3. Redaction details

### 3.1 What PII_PATTERNS redacts

The `PII_PATTERNS` array in `packages/core/src/judge.ts` defines regex patterns for redaction:

| Pattern | Regex | Replacement | Example matched |
|---------|-------|-------------|-----------------|
| Emails | `\b[\w.+-]+@[\w-]+\.[\w.-]+\b` | `[email]` | `user@example.com` |
| Phones | `\b(?:\+?[\d]{1,3}[\s-]?)?\(?\d{2,4}\)?[\s-]?\d{3,4}[\s-]?\d{3,4}\b` | `[phone]` | `+1-555-123-4567` |
| API keys | `\b(?:sk-|pk-|ai-|hk-)[a-zA-Z0-9]{20,}\b` | `[key]` | `sk-proj-abcdefghijklmnopqrstuvwxyz` |
| Hex strings (32+ chars) | `\b[0-9a-f]{32,}\b` | `[hash]` | `a1b2c3d4e5f6...` (32+ hex chars) |
| GitHub personal tokens | `\bghp_[0-9a-zA-Z]{36}\b` | `[ghp-token]` | `ghp_abcdefghijklmnopqrstuvwxyz123456` |
| GitLab tokens | `\bglpat-[0-9a-zA-Z\-]{20,}\b` | `[glpat-token]` | `glpat-abcdefghi1234567890` |

Additionally, there is a separate `sanitizeError()` function in `packages/server/src/upstream.ts` that redacts credentials in provider error messages:

| Pattern | Replacement |
|---------|-------------|
| `bearer|authorization|api-key|token` keyword followed by value | `$1=REDACTED` |
| `sk-[A-Za-z0-9_-]{8,}` | `sk-[REDACTED]` |
| `AKIA[0-9A-Z]{16}` (AWS keys) | `AKIA[REDACTED]` |
| `AIza[0-9A-Za-z_-]{30,}` (Google API keys) | `AIza[REDACTED]` |
| `ghp_[A-Za-z0-9]{8,}` | `ghp_[REDACTED]` |
| `ghu_[A-Za-z0-9]{8,}` | `ghu_[REDACTED]` |
| `ghs_[A-Za-z0-9]{8,}` | `ghs_[REDACTED]` |
| `github_pat_[A-Za-z0-9_]{8,}` | `github_pat_[REDACTED]` |
| Credential URLs (`user:pass@host`) | `$1REDACTED@` |

### 3.2 How redaction works

1. The `redactPii()` function iterates through `PII_PATTERNS` in order
2. For each pattern, it applies `String.replace()` with the global flag
3. Matches are replaced with the corresponding placeholder (`[email]`, `[phone]`, etc.)
4. The result is sent to the remote endpoint

Redaction happens **before** transmission when `allowSnippets` is true. When `allowSnippets` is false, no raw text is sent at all — only hashes and metadata.

### 3.3 What is NOT redacted

- Message roles (`user`, `assistant`, `tool`, etc.) — these are structural, not PII
- Message content that doesn't match any PII pattern
- The turn text structure (opening + end, with `--- MIDDLE OMITTED ---` separator)
- Tool names (when snippets are enabled, tool names are sent as-is; when disabled, they are hashed)
- Failure evidence codes (these are allowlisted, not redacted)
- The `policy_tier` field

**Known limitation:** Redaction is a best-effort regex pass, not a comprehensive PII scrubber. It catches the most common leakage shapes but may miss edge cases. If you have highly sensitive content, consider using private profiles or disabling snippets.

---

## 4. Configuration options

### 4.1 Disable Jev routing

```json
{
  "jev": {
    "enabled": false
  }
}
```

When `jev.enabled: false`, the `jevRoutingTriggers()` function returns `false` and Jev is never consulted. The proxy falls back to policy-only routing.

### 4.2 Enable live routing (instead of shadow)

```json
{
  "jev": {
    "shadow": false
  }
}
```

- **Shadow mode (default):** Jev's routing recommendation is logged but does not change the actual tier used. The `x-sabi-jev` response header shows what Jev would have done.
- **Live mode:** Jev's routing recommendation overrides the policy tier (subject to capability/availability checks). The `x-sabi-jev` header shows what Jev actually did.

### 4.3 Configure private profiles

```json
{
  "jev": {
    "privateProfiles": ["session-prefix-1", "session-prefix-2"]
  }
}
```

When a session's ID matches (exactly or by prefix) an entry in `privateProfiles`, the routing state uses coarse features instead of raw text. This preserves routing signal (message count, code presence, risk words) without exposing raw user/tool content.

### 4.4 Enable snippets (raw text to Jev/Judge)

There are two ways to enable raw text transmission:

**Option A — Jev-specific (preferred for Jev routing):**

```json
{
  "jev": {
    "includeSnippets": true
  }
}
```

**Option B — Shared telemetry flag (affects both Jev and Judge):**

```json
{
  "telemetry": {
    "captureSnippets": true
  }
}
```

When either flag is `true`, the `judgeAllowsSnippets()` function returns `true`, and raw (redacted) text is sent to the remote endpoint. When both are `false` (default), only hashes and metadata are sent.

**Note:** Enabling snippets means raw (PII-redacted) instruction and tool output text leaves your machine. Only enable this if you understand and accept that risk.

### 4.5 Disable the decision log

There is no `log: false` config option in `SabiConfig`. The decision log is controlled via:

- **Environment variable:** `SABI_LOG` — set to a path or empty to disable
- **Default:** `./.sabi/decisions.jsonl` (relative to CWD)

To disable logging:

```bash
# Disable by pointing to /dev/null or an unwritable location
export SABI_LOG="/dev/null"

# Or leave it at the default (logs to ./.sabi/decisions.jsonl)
# The log is always written when the proxy runs — there is no config toggle to disable it.
```

The log file is written with `0600` permissions in a `0700` directory (on Unix) to restrict access to the owning user.

---

## 5. Monitoring: How to see what leaves your machine

### 5.1 The `/decisions` endpoint

```
GET http://127.0.0.1:8787/decisions?limit=20
```

Returns the last N decisions with full metadata, including:

- `jevRouting` — Jev routing decision (shadow/live, tiers, confidence)
- `judge` — Judge record (status, realProblem, difficulty, etc.)
- `state` — Round state (with hashed tool names)

Example response:
```json
{
  "count": 1,
  "decisions": [{
    "ts": "2026-09-21T12:00:00.000Z",
    "alias": "claude",
    "tier": "mid",
    "rule": "auto",
    "jevRouting": {
      "shadow": true,
      "jevTier": "cheap",
      "jevConfidence": 0.72,
      "policyTier": "mid",
      "consulted": true
    },
    "judge": {
      "status": "ok",
      "realProblem": 0.85,
      "difficulty": "standard"
    }
  }]
}
```

### 5.2 Console log

When `verbose` is not `false`, the proxy logs each decision:

```
[sabi] claude -> mid (auto) -> claude-3.5-sonnet · 1234ms 1000in/500out · $0.005000 · ok
```

When Jev routing is consulted, an additional line is logged:

```
[sabi:jev] shadow: Jev would route to cheap (confidence 0.72), policy chose mid
[sabi:jev] live: Jev routed to cheap (confidence 0.72), overriding policy's mid
```

### 5.3 `x-sabi-jev` response header

Every response includes an `x-sabi-jev` header when Jev was consulted:

```
x-sabi-jev: {"jev-tier":"cheap","jev-confidence":0.72,"jev-shadow":"true","jev-policy-tier":"mid"}
```

This lets you inspect Jev's decision without reading the decision log.

### 5.4 Audit the decision log

The decision log is at `SABI_LOG` (default: `./.sabi/decisions.jsonl`). Each line is a JSON object. You can audit it with:

```bash
# View recent entries
tail -n 20 .sabi/decisions.jsonl | jq .

# Count entries
wc -l .sabi/decisions.jsonl

# Check for Jev routing decisions
grep '"jevRouting"' .sabi/decisions.jsonl | jq '.jevRouting'

# Check for judge decisions
grep '"judge"' .sabi/decisions.jsonl | jq '.judge'
```

The `sabi report` command provides aggregated statistics from the log.

### 5.5 Check what data is sent to Jev

The `buildRoutingState()` function in `packages/core/src/judge.ts` is the source of truth for what data is sent to Jev. Key points:

1. **If `allowSnippets` is false** (default): Only hashes, metadata, and allowlisted evidence codes are sent. No raw text.
2. **If `allowSnippets` is true**: Raw text is sent, but run through `redactPii()` first.
3. **If session matches a private profile**: Coarse features are sent instead of raw text, regardless of `allowSnippets`.

You can trace the exact data flow by reading `buildRoutingState()` and `buildJudgeState()` in `packages/core/src/judge.ts`.

---

## 6. Summary table

| Surface | Default sends raw text? | Redaction | Opt-out |
|---------|------------------------|-----------|---------|
| Jev routing | No (hashes only) | Yes, when snippets enabled | `jev.enabled: false` or `jev.includeSnippets: false` |
| Judge | No (hashes only) | Yes, when snippets enabled | `judge.enabled: false` or `judge.includeSnippets: false` |
| Upstream providers | Yes (full request) | No (inherent to inference) | N/A — required for inference |
| Decision log | No (metadata only) | N/A (local only) | `SABI_LOG=""` |
| Telemetry | No (allowlist only) | N/A | `telemetry.captureSnippets: true` |

---

## 7. Verifying this document against implementation

To verify the claims in this document:

1. **Read `packages/core/src/judge.ts`:**
   - `PII_PATTERNS` (lines 13-20) — confirms redaction patterns
   - `buildRoutingState()` (lines 279-393) — confirms Jev routing state
   - `buildJudgeState()` (lines 395-451) — confirms Judge state
   - `redactPii()` (lines 34-40) — confirms redaction logic

2. **Read `packages/server/src/server.ts`:**
   - `/decisions` endpoint (lines 634-638) — confirms monitoring endpoint
   - `x-sabi-jev` header (lines 818-826) — confirms response header
   - Console logging (lines 688-699) — confirms log output

3. **Read `packages/server/src/upstream.ts`:**
   - `callUpstream()` (lines 15-43) — confirms what's sent to providers
   - `sanitizeError()` (lines 95-100+) — confirms error redaction

4. **Read `packages/core/src/types.ts`:**
   - `JevRoutingConfig` (lines 166-179) — confirms config options
   - `JudgeConfig` (lines 181-199) — confirms judge config
   - `TelemetryConfig` (lines 210-216) — confirms telemetry config

---

*This document reflects the implementation as of 2026-09-21. If the implementation changes, this document should be updated to match.*
