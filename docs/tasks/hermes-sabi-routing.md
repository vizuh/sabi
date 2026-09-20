# Hermes × Sabi routing V1 tasks

All V1 tasks are complete on this branch. The checklist is intentionally small:

- [x] Pin the Hermes runtime/source contract and exact loopback boundary.
- [x] Register one public `llm_request` middleware; do not patch Hermes core.
- [x] Preserve complete request payloads, unknown SDK values, tools and arguments.
- [x] Replace stale/case-variant Sabi headers with validated opaque session and turn IDs.
- [x] Keep Sabi request IDs distinct from Hermes turn IDs.
- [x] Route through the existing Sabi proxy and shared core; do not add a Python policy copy.
- [x] Fail open for protocol mismatch, unsafe endpoint, malformed headers and missing IDs.
- [x] Prove native tool-loop and resume behavior with the pinned Hermes CLI and a local mock.
- [x] Prove the same trajectory through Sabi with `mid → cheap → mid`, receipts and redaction.
- [x] Document the measured metadata-discovery limitation instead of claiming suppression.
- [x] Document handoff/compaction as host-owned and keep Jev out of transcript deletion.
- [x] Record the acceptance contract in `docs/specs/hermes-sabi-routing.md`.

## Deferred research, not V1 gaps

- [ ] Real-provider smoke with an approved spend cap.
- [ ] Auxiliary, subagent, MoA, gateway and desktop call coverage.
- [ ] Hermes-native ContextEngine replacement, only after a held-out compaction evaluation.
- [ ] A direct-provider model rewrite, only if Hermes exposes a safe provider-preserving seam;
      Sabi's proxy path already solves cross-provider scheduling without that coupling.

Each deferred item needs its own pinned runtime evidence and rollback path. It must not weaken the
completed proxy contract or make a synthetic result look like plan entitlement, quality or savings.
