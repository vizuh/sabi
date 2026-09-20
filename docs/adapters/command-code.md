# Command Code adapter

The Command Code adapter is Sabi's in-process inference path. It runs as a native mod, keeps
Command Code's loop, and chooses a model plus reasoning effort for continuing rounds.

## Install

Published package:

~~~bash
cmd mods add -g npm:@vizuh/sabi
cmd mods update
~~~

From a checkout:

~~~bash
cmd mods add ./packages/adapters/command-code
~~~

No Sabi provider key and no local proxy are needed. This path uses the Command Code subscription
already attached to the session.

## What happens

- Round 1 stays on the session model because the continuing-turn hook has not fired yet.
- From round 2, Sabi classifies the trajectory and selects cheap, mid, or strong.
- The decision includes model, effort, rule, and allowlisted usage metadata in the session.
- Tool errors are an explicit host signal. Transport/quota errors are not treated as task failures.
- Media is a hard capability constraint; a text-only tier is not asked to interpret an image.

Try a small read task:

~~~bash
cmd -p "Read package.json and reply with only the value of its name field." \
  --mod ./packages/adapters/command-code/mod/sabi.ts \
  -t --output-format json
~~~

Look for a first request on the session model and a continuing request planned as exploration → cheap.

## What this adapter does not do

It does not start Sabi's proxy, use OpenRouter credentials, coordinate Claude/Codex sessions, or
transfer a Command Code subscription to another harness. For those use cases, choose a proxy or
controller adapter.

Detailed package behavior and plan/entitlement caveats live in the
[package README](../../packages/adapters/command-code/README.md).
