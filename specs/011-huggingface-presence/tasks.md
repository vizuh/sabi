# Tasks: Hugging Face Presence

**Input**: `specs/011-huggingface-presence/spec.md`, `plan.md`

**Prerequisites**: Spec 004 chain views + metric catalog; spec 010 corpus;
verified Spaces runtime docs (cite date); HF org access in env, never repo.

## Phase 1: Public API (blocks everything)

- [ ] T001 Add public API schema types (additive) + compatibility rules.
- [ ] T002 Implement `packages/core/src/public-api.ts` serializer +
  fail-closed redactor; adversarial fixtures (secrets/paths/args).
- [ ] T003 Forward-compatibility fixtures (v1 output readable by v2).

## Phase 2: Space (US2)

- [ ] T010 Scripted demo trajectory fixture with per-round expected
  display values (figure-to-record traceability).
- [ ] T011 Build the Space app (offline recorded playback; honest cost
  panel per estimates discipline; GitHub/npm links).
- [ ] T012 Local container build + run green; pinned base + rebuild
  checklist.

## Phase 3: Datasets (US3)

- [ ] T020 Implement `scripts/dataset-build.ts`: snapshot → sanitize →
  version + content hash + quarantine report.
- [ ] T021 Adversarial + reproducibility fixtures; dataset cards
  (method/limits/non-claims).

## Phase 4: Presence (US4)

- [ ] T030 Write `docs/huggingface.md` presence checklist; verify all
  links + tool-not-model framing + canonicals (no credentials in repo).
- [ ] T031 Live upload/publish runbook (visitor-key caps, yank procedure).

## Phase 5: Convergence

- [ ] T040 Full suite, typecheck; checklist; decisions/handoff/log
  (presence labeled, no benchmark claims).

## Dependencies

- Phase 1 blocks all. Phases 2–3 parallel after Phase 1. Phase 4 needs
  2–3. Phase 5 last. Learned-model artifacts are a separate future spec,
  never this one.
