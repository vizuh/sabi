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
non-secret local placeholder key. Upstream keys stay in Sabi's environment. Use --set-default
only when you explicitly want OpenCode's default model changed.

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
