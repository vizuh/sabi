# Contributing to Sabi

Small, verified pull requests beat large speculative ones.

## Ground rules

- **Verified vs unverified is explicit.** Cite exact repos, commits, dates and observed numbers for upstream claims. Never invent benchmarks, model capabilities, pricing or quota behavior — verify against live sources or label the claim unverified.
- **Secrets never enter Git.** Provider keys live in the environment only. No credentials, cookies or raw usage logs in the repo or in PR text.
- **One focused change per PR**, branched off `main`. Never force-push or rewrite shared history.
- **Docs stay short and true.** `TODO — ask` beats invented detail. User-facing prose ships in English first; the PT-BR, ZH, JA and KO mirrors follow. English stays canonical for rates, quotas, and support claims.

## Gates (run before pushing)

```bash
npm ci
npm test          # full suite must pass
npm run typecheck # must be clean
git diff --check  # no whitespace errors
```

Live provider or harness claims additionally need a pinned runtime, the exact receipt,
and an explicitly approved free/paid boundary. A mock pass is not a benchmark; a catalog
listing is not plan entitlement.

## Releases

Maintainers only: bump `packages/adapters/command-code/package.json`, merge, then
`git tag vX.Y.Z && git push origin vX.Y.Z`. The tag publishes `@vizuh/sabi` with
provenance and opens the GitHub Release. Do not cut a tag for changes that leave the
published tarball untouched without saying so in the release notes.

## Security

Do not open public issues for vulnerabilities. See [SECURITY.md](SECURITY.md).
