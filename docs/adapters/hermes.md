# Hermes adapter

Sabi integrates with Hermes through its supported llm_request middleware seam and an explicit
Chat Completions custom provider.

The supported V1 path is:

~~~text
Hermes → custom:sabi / sabi-code → Sabi proxy → configured upstream
~~~

Hermes keeps the native loop. The middleware adds attribution headers and preserves the complete
request—tools, IDs, order, arguments, and SDK objects—without creating a second retry loop or
policy implementation.

## Current status

- Pinned/tested against Hermes 0.21.3 at commit 01382698fc32ec7740b6a204d9b7a6abeac74d33.
- Native mock and Sabi-proxy probes cover a bounded tool loop and resume.
- Extra model-discovery requests, auxiliary paths, subagents, and paid-provider smoke tests remain
  separate gates.
- A fail-open middleware is not a budget or permission enforcement boundary.

## Start

Use the isolated template and follow the package-level recipe:

~~~bash
cp packages/adapters/hermes/config.yaml.example /tmp/sabi-hermes-config.yaml
# edit an isolated HERMES_HOME; keep the real upstream key in Sabi's environment
~~~

Read the detailed [Hermes adapter README](../../packages/adapters/hermes/README.md) before
running a profile. Do not install this template into an existing .hermes directory.

## Maintainer note

The adapter must return the complete request and replace only Sabi attribution headers. Do not add
provider rebinding, tool execution, retry, or a second loop in middleware.
