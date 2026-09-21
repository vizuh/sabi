# OpenCode adapter

OpenCode has two independent Sabi paths. Pick one before configuring anything.

## A. Inference routing through the local proxy

This is the simplest OpenCode path and the one currently covered by a real-client proxy check.

~~~bash
npm start
npm run connect:opencode
opencode run --model sabi/sabi-code "Read package.json and explain the scripts"
~~~

The connector writes only the provider.sabi entry, preserves existing providers, and uses a
non-secret local placeholder key. Upstream keys stay in Sabi's environment. It never changes
your default model unless you pass --set-default.

## Recommended: native default, Sabi per run

Keep OpenCode's default on a native subscription model (for example
`opencode-go/kimi-k3`) and reach for Sabi explicitly per run:

~~~bash
npm start
npm run connect:opencode
opencode run --model sabi/sabi-code "Read package.json and explain the scripts"
~~~

This is the fail-open posture: when the OpenRouter balance behind the proxy is exhausted,
native sessions keep working and only `sabi/*` rounds fail. Verified 2026-09-21 against
OpenCode 1.18.31: with the default on `sabi/sabi-code` a trivial prompt failed with the
OpenRouter credit error (`requested up to 4096 tokens, but can only afford 3858`); after
switching the default back to `opencode-go/kimi-k3` the same session shape answered.
Use --set-default only while the proxy upstream is funded.

The adaptive alias is `sabi/sabi-code`. Fixed aliases such as `sabi/sabi-cheap`, `sabi/sabi-mid`,
and `sabi/sabi-strong` provide baselines. `sabi-code` can move to an image-capable tier when
the request carries an image; a fixed text-only alias refuses clearly instead of answering blind.

Verify locally:

~~~bash
npm run report -- --json
~~~

Decisions record the client, rule, selected tier, usage, and bounded failure evidence.

## B. Controller hook

The controller can install an OpenCode plugin that reports prompts/session context to the loopback
daemon. This is a task/session control boundary; it does not silently replace OpenCode's active
provider in the middle of a running session.

Observed 2026-09-21 on OpenCode 1.18.31: registering the state-home file path
(`~/.local/state/sabi/hooks/opencode.mjs`) in `plugin` made `opencode models` fail with
`Unexpected error: undefined is not an object (evaluating 'n.provider')`; removing the entry
restored it. The controller OpenCode bridge therefore stays opt-in until file-path plugin
loading is verified against the installed release. Provider-only config (path A) is unaffected.

~~~bash
npm run controller -- setup
npm run controller -- doctor
npm run controller -- integrations list
~~~

## Rollback

Remove the sabi provider from the OpenCode config or restore the .sabi-backup created by the
connector. For the controller path, run npm run controller -- uninstall; it restores hook backups
and archives controller state.

See the implementation [connector](../../packages/adapters/opencode/src/connect.ts),
[hook](../../packages/adapters/opencode/src/sabi-hook.mjs), and
[harness evidence](../harnesses.md).
