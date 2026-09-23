# Launch submissions

Where Sabi has been submitted, what each venue asked for, and the copy used. Kept so the next
submission does not duplicate one already made — the r/ChatGPTCoding weekly thread explicitly asks
builders not to repost the same project week over week.

## Status

| Venue | Type | Status | Evidence |
| --- | --- | --- | --- |
| [r/ChatGPTCoding weekly self-promotion thread](https://www.reddit.com/r/ChatGPTCoding/comments/1wm6cbp/weekly_self_promotion_thread/) | Reddit thread | **posted** 2026-09-23T02:17Z by u/Environmental-Ad5071 | [comment pbhmko4](https://www.reddit.com/r/ChatGPTCoding/comments/1wm6cbp/comment/pbhmko4/) |
| [r/ClaudeCode weekly showcase](https://www.reddit.com/r/ClaudeCode/comments/1wma6ma/weekly_showcase_thread_what_are_you_building_with/) | Reddit thread | **not posted** — draft below | thread live, 25 comments, no Sabi entry as of 2026-09-23 |
| [Not-Diamond/awesome-ai-model-routing](https://github.com/Not-Diamond/awesome-ai-model-routing) | GitHub PR | **open** — [#25](https://github.com/Not-Diamond/awesome-ai-model-routing/pull/25) | `Intelligent AI model routing`, alphabetical, open-source `*` marker |
| [ai-for-developers/awesome-ai-coding-tools](https://github.com/ai-for-developers/awesome-ai-coding-tools) | GitHub PR | **open** — [#748](https://github.com/ai-for-developers/awesome-ai-coding-tools/pull/748) | `Coding Agents`, appended to the end of the section |
| [itgoyo/awesome-claude-code](https://github.com/itgoyo/awesome-claude-code) | GitHub PR | **open** — [#13](https://github.com/itgoyo/awesome-claude-code/pull/13) | `Agent Orchestration`, both `README.md` and `README_CN.md` |

## Draft: r/ClaudeCode weekly showcase

The thread asks for what you built, how you used Claude Code, a link, and anything you learned.
It also allows quick project drops and simple self-promotion. Lead with the question, not the
product.

> Should a coding agent stay on one model for a whole session?
>
> I kept noticing the shape of my sessions didn't match a single model. Greps, reads and
> bookkeeping don't need the same capacity as a failing test or a second attempt at an edit I
> already got wrong once. Pinning the session means paying for the worst round in it, or babysitting
> the model picker by hand.
>
> So I built **Sabi**: a routing layer that sits between the harness and the models and decides per
> round from what the round actually produced — tool results, failures, context pressure,
> verification — instead of from the first prompt. The harness keeps its own loop, tools, approvals
> and history.
>
> How it attaches to Claude Code today: a `UserPromptSubmit` hook that reports bounded
> prompt/session metadata to a local controller, which can continue, delegate or spawn a target only
> when it has a typed execution receipt. **It does not change the model inside a running Claude Code
> turn** — that boundary is deliberate, and the per-round model/effort routing lives on the BYOK
> proxy path and the Command Code mod. I'd rather state that plainly than have someone install it
> expecting a model swap that never happens.
>
> MIT, no paid tier: https://github.com/vizuh/sabi
>
> What I learned building it: the hard part isn't picking a model, it's deciding when the evidence
> justifies escalating, without thrashing between tiers inside one task. The escalation signals are
> the part I'd most like torn apart — what would you require before letting a cheap round escalate
> to a strong one?
>
> Disclosure: I maintain Sabi.

## Angle per venue

- Reddit: "I tried adaptive model routing inside coding-agent trajectories — here's what happens."
- Routing awesome-lists: "Adaptive trajectory-aware model router."
- Claude communities: controller/orchestration, stated with the model-switching boundary.
- Agent-tool lists: "Cross-harness controller/router for Claude Code, Codex, OpenCode and Orca."

## Targets checked and not used

- `michielhdoteth/awesome-ai-agent-tools` — no such public repository (`raw.githubusercontent` 404
  on both `main` and `master`). Re-check before treating it as a target.
- `yenanjing/awesome-model-routing` — thematically exact, but the list requires 1,000+ GitHub stars;
  Sabi has 15.
- `r/selfhosted` New Project Megathread — for projects younger than three months and requires
  deployment/docs/AI-involvement detail; only a fit if the self-hosted proxy is made the main story.
- `r/LocalLLaMA` — moderators want meaningful participation before open-source drops; treat as a
  community-building target, not a first post.
- `r/ClaudeAI` — standalone Showcase posts need ≥50 total Reddit karma; the megathread is open to
  anyone. Not attempted yet.
- `erkcet/awesome-claude-code` — verified to exist; not yet submitted.

## Posting from an agent

Reddit blocks plain HTTP fetches and headless browsers. Reading the threads needs a headed browser
(retry once past the JS challenge). Posting needs the user's logged-in session, which means the
OMP browser relay: `omp browser-relay install`, load `~/.omp/browser-relay/extension` as an
unpacked extension in Chrome, then `omp browser-relay serve`. Until that is set up, agents can
verify threads but cannot submit to them.
