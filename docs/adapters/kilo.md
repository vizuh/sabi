# Kilo adapter

Kilo CLI and Kilo VS Code can use Sabi as an OpenAI-compatible custom provider. They are separate
clients and must be tested separately.

Use the base URL—not the full completion path:

~~~text
http://127.0.0.1:8787/v1
~~~

Configure an explicit openai-compatible provider and the sabi-code alias. Declare conservative
context, output, tools, and modality metadata for every eligible tier. Missing limits can disable
compaction or make a client reject the route.

The CLI path has a bounded real-client mock check. The VS Code extension path is source-reviewed
and configuration-documented but not runtime-certified here. Do not infer extension support from
CLI support or from OpenCode's plugin API.

See [harness compatibility](../harnesses.md) and the upstream-specific
[research note](../research/harness-support-evidence.md).
