# Gaps & Open Questions

> **Date:** 2026-08-06
> **Status:** Proposed — residual gaps (SC9), no implementation
> **Scope:** Open decisions blocking/limiting the recommendation
> **Branch:** n/a (docs only)

## Open questions

| # | Question | Impact | Owner decision needed |
|---|---|---|---|
| 1 | **Truth-direction (BLOCKING)** — repo-as-proposal→DB vs repo-as-truth (T274 vs A67) | Decides C vs B; reversal requires T274 amendment | Yes — before any implementation |
| 2 | UI mutation channel — how UI edits reach the manifest file | Determines whether UI is read-only over the file | Yes |
| 3 | Manifest scope — repo-wide vs per-app vs per-project | Affects schema + validation gates | Yes |
| 4 | Digest write-back — who resolves tag→digest and where it is written | Affects F4/F8 and the pinning policy | Yes |
| 5 | Non-prod auto-promote — should dev/staging auto-promote on merge | Affects F10 + A76 approvals | Yes |
| 6 | A59 enable/disable fold into F10 | `isActive` unwired; enable/disable should ride the promotion flow | No (design detail) |
| 7 | Quota defaults — `maxPreviewEnvironments` on `projects.settings` has zero consumers | F3/F5 need a default + first consumer | No |
| 8 | F13 default mode — cross-project gate default (block vs warn) | Affects A19/A58 resolution | No |
| 9 | D1 claims unverified — "satisfies axioms", "reuses machinery" are design assertions, not shipped chains | Scores in `decision-matrix.md` are design-anchored (max 4 unless shipped) | Verify during F1–F5 |

## Residual risks

- **Unwired ≠ free reuse** (anti-criterion): C's adoption score assumes wiring the fleet services; if wiring is deferred, realism drops toward A's score.
- **Rich-schema ≠ shipped:** the manifest schema is only as good as its consumer chain; every gate must land with its consumer in the same change set.
- **Preview-reuse is partial:** `PreviewEnvOverlayService` (zero callers) is a stub until F3/F9 consume it — stubs are debt.

## What to do next

1. **Decide Open Question #1 (truth-direction).** Recommendation: **repo-as-proposal → DB** (System C).
2. Implement **W1 in order: F1 → F3 → F2 → F5** — each closes a broken/partial link of the preview spine and creates the first consumers for previously-dead machinery.
3. In the same change set as each feature: update `apps/doc/content/docs/**` (register in `index.mdx`), this series, and the scoped `AGENTS.md`/axiom docs (docs-same-change-set HARD rule).
4. After W1, revisit Open Questions #2–#5 before starting W2 (F4 promotion depends on #4 digest write-back).
