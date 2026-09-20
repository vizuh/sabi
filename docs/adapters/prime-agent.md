# Prime Agent adapter

Prime Agent uses the Sabi proxy as an explicit custom OpenAI-compatible provider. This is a
compatibility adapter and probe suite, not a claim that Prime's native setters are safe for every
continuing round.

## Current status

- Prime Agent 0.9.5 proxy path has strict local mock coverage preserving tool IDs, parallel tools,
  and usage.
- Custom provider metadata is required: context window, output reserve, tools, modalities, and
  reasoning support must match the models Sabi can actually serve.
- Native pi.setModel / pi.setThinkingLevel behavior is documented upstream but timing inside an
  active parent turn is not certified.
- The package's zero prices and limits belong to synthetic fixtures only.

## Conceptual profile

~~~json
{
  "providers": {
    "sabi": {
      "baseUrl": "http://127.0.0.1:8787/v1",
      "api": "openai-completions",
      "apiKey": "sabi-local-placeholder",
      "models": [{ "id": "sabi-code", "contextWindow": 32000, "input": ["text"] }]
    }
  }
}
~~~

Use the exact Prime Agent 0.9.5 model/profile format from its installed documentation; do not
copy synthetic fixture values into production blindly.

## Verify and rollback

Run the adapter's isolated probes/tests from the Sabi checkout. Keep the profile separate, select
the original provider to roll back, and preserve the profile files for inspection. Native support
should not be advertised until a same-parent-round model and effort test passes.
