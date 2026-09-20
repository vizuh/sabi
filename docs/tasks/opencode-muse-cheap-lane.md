# OpenCode Muse cheap lane tasks

- [x] Verify the installed OpenCode catalog and record the Muse model ID, limits and free label
      without persisting credentials or raw catalog output.
- [x] Distinguish the current Sabi context limit from the 4,096-token client output fallback.
- [x] Declare verified OpenRouter `maxOutputTokens` values for the current proxy tiers.
- [x] Record that native OpenCode Muse is not selectable by the current Chat Completions proxy.
- [x] Run a read-only Sabi/Orca architecture review (`ctx_193cf942ae7d`); it confirmed the
      proxy/provider boundary and produced no worktree changes.
- [x] Add an explicit `--small-model=<provider/model>` OpenCode connector option, preserving the
      adaptive main model; the option performs no catalog or credential lookup.
- [ ] Define and implement a Responses upstream contract if Muse must serve coding/tool rounds.
- [ ] Prove auth, streaming, tool calls, usage, context fit and safe model switching with a bounded
      free-only smoke before enabling Muse as a Sabi action tier.
- [ ] Add held-out comparison against `sabi-cheap`/`sabi-code`; catalog presence and zero price do
      not establish task quality or savings.

## Deferred by design

Do not hard-code the temporary free model as Sabi's default cheap tier. Do not route an OpenCode
subscription through the proxy by reading OpenCode's auth store. Do not treat `small_model` as a
per-round Sabi decision hook.
