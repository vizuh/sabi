# Security policy

## Supported versions

Only the latest published `@vizuh/sabi` (`npm view @vizuh/sabi version`) and `main`
receive security fixes. The `0.x` line is pre-stable: upgrade promptly.

## Reporting a vulnerability

Use **GitHub private vulnerability reporting** on `vizuh/sabi`
(Security tab → Report a vulnerability). Do not open public issues, discussions or
PRs for suspected vulnerabilities, and do not paste credentials, tokens or raw usage
logs anywhere in the report — describe the shape of the data instead.

We will confirm receipt, assess against a pinned runtime, and fix on `main` with a
patch release. Credit on request.

## Scope notes (read before reporting)

- Sabi binds loopback by default and fails open when unavailable. Fail-open is a
  usability posture, **not** a permission or budget boundary: hooks, middleware and
  the proxy must never be treated as authorization gates.
- Provider keys live in the process environment or a mode-0600 secrets file only.
  Sabi never copies them into harness configs, logs or telemetry; a report showing
  otherwise is in scope and severe.
- Telemetry and decision logs carry allowlisted evidence codes only. Raw prompts,
  tool output and secrets reaching a log is in scope.
- Model catalog presence is not plan entitlement, and a hook install is not proof
  of live routing — these are documented non-claims, not vulnerabilities.
