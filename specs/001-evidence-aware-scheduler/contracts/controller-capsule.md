# Contract: Controller Recovery Capsule

## Handoff shape

`HandoffSnapshot` may carry an optional bounded `recoveryCapsule`:

```json
{
  "failureSignature": "typescript-error",
  "verifiedFacts": [],
  "attemptedApproaches": ["retry-same"],
  "verifiedNonSolutions": [],
  "lastKnownCleanPoint": "before-auth-migration",
  "recommendedNextAction": "retry-with-feedback",
  "sourceGeneration": 1
}
```

The example is illustrative; production serialization must use typed
allowlisted values and configured bounds.

## Invariants

- `SPAWN`, `DELEGATE`, and `ORCHESTRATE` preserve the capsule when the target is
  compatible and the handoff is accepted.
- A target with incompatible capability or stale inventory cannot receive an
  unqualified route; it must be gated or become `ASK`/`unknown`.
- A capsule contains distilled facts and labels, not a full transcript, raw
  prompt, provider credential, or unbounded diff.
- The execution receipt, idempotency key, target identity, and outcome remain
  separate from the capsule.
- Restart, duplicate delivery, malformed receipt, and timeout are safe to
  retry only under the existing bounded controller retry rules.
