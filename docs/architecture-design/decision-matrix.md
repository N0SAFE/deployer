# Decision Matrix

> **Date:** 2026-08-06
> **Status:** Proposed — scored protocol, no implementation
> **Scope:** Env-hierarchy patterns (SC3) + 12-criterion decision matrix with HARD gate, sensitivity, and single recommendation (SC6)
> **Branch:** n/a (docs only)

## Part 1 — Environment hierarchy patterns (SC3)

Five hierarchy patterns were identified across the candidates:

| Pattern | Systems | Inheritance | Custom envs | Preview leaf | Promotion | Rollback | TTL/quota | A58 shared deps | Truth/observability | Complexity |
|---|---|---|---|---|---|---|---|---|---|---|
| **DB promotion DAG lattice** | A, C | via ancestry (FK missing today) | native | native (TTL/quota/PR-close) | pointer move | re-point | native | overlay/`shared:true` | DB (best) | medium |
| **Git folder-per-env overlays** | B | overlay merge | git branch | PR-driven | git op | revert commit | git expiry | none | Git (violates T274) | medium |
| **Compose profiles + env-files** | D | profile merge | profile | not expressible | rebuild | rebuild | none | none | dual-authoring | low |
| **Mesh logical overlays** | E | overlay | overlay | overlay | overlay switch | overlay | pool-level | **native** | mesh+DB | highest |
| **Flat env table (today's baseline)** | current v3 | **none** (no ancestry FK) | partial (`recordPreviewRow` links OLDEST deployment; quota zero-consumers) | hardcoded pr | `environment_promotions` dead | n/a | row-only hardcoded 168h | none | DB, but unwired | low |

**Decision-matrix for env hierarchy:** the DAG lattice (A/C) wins on inheritance potential, promotion semantics, rollback, and observability; mesh overlays (E) win only on A58; Git overlays (B) fail the truth gate; compose profiles (D) cannot carry per-env policy (A46–52/A77 have no compose home) — "compose-profiles ≠ per-env-policy".

## Part 2 — Scored recommendation protocol (SC6, applying D7)

### Step 1 — HARD constraint gate (violation = DISQUALIFY, not penalize)

| HARD rule (from D7) | A | B | C | D | E |
|---|---|---|---|---|---|
| DB-is-SSOT (T274) | ✅ pointer-move in DB | ❌ **Git truth** | ✅ DB stays SSOT | ❌ **file truth / dual-authoring** | ✅ DB-backed |
| Zero-assertions / Zod at boundaries | ✅ | ✅ | ✅ `safeParse` at git boundary | ⚠️ parser only, no schema | ✅ |
| ORPC-only, no-bridges, monorepo boundaries, change-order+validation, docs same change set, error handling, testing, `bun --bun`, drizzle schema location, domain invariants, dep contract executable, rollback+health+approvals+strategies, compose ops, Traefik+preview subdomains, security, preview lifecycle, multi-node, no-duplication-of-machinery | ✅ reuses machinery | ❌ duplicates ArgoCD machinery | ✅ reuses parser+webhook+fleet | ✅ (compose native) but gate already failed | ⚠️ greenfield new machinery (borderline on no-duplication) |
| **Verdict** | **PASS** | **DISQUALIFIED** | **PASS** | **DISQUALIFIED** | **PASS w/ caveat** |

> ⚠️ = borderline on that grouped rule; not decisive — the verdict is set by the DB-is-SSOT row and the no-duplication-of-machinery row (D's Zod row is non-decisive because the file-truth gate already fails; E's no-duplication row is non-decisive because net-new machinery is not duplication).

Anti-criteria checks: B borrows K8s/ArgoCD — "K8s-borrowing ≠ good (this is a Swarm stack, A178–182)"; D relies on compose profiles — "compose-profiles ≠ per-env-policy"; E is "novel ≠ good" and its machinery is unwired-by-design; none of the systems ships a verified consumer chain (this is a design study) so top scores are capped at "wired + consumed at design" except C1/C8 which score on architectural coherence.

### Step 2 — Scored table (1–5 evidence-anchored; 5 = shipped consumer chain, 4 = wired+consumed, 3 = unit-tested zero consumers, 2 = schema-only dead, 1 = violates HARD; N/A = 0, no renormalization)

Scores apply **only to systems that passed the gate** (A, C, E).

| # | Criterion (weight) | A | C | E | Citations (corpus) |
|---|---|---|---|---|---|
| C1 | Truth-coherence / DB-first (13%) | 5 | 5 | 3 | A: "DB-first pointer move"; C: "DB stays SSOT, preserves T274"; E: overlay topology needs new concepts, A47 amendment |
| C2 | Type-safety (8%) | 3 | 4 | 3 | A: typed fleet services but unwired; C: "webhook→parse→Zod-validate (reuse compose-parser)", manifest Zod schema; E: new mesh types |
| C3 | Realism-of-adoption (13%) | 4 | 4 | 2 | A: "reuses unwired fleet machinery"; C: reuses EnvGraph + compose-parser + webhook (most existing surface); E: "greenfield, highest complexity". C capped at 4 (wire exists, not shipped) |
| C4 | Feature-completeness (11%) | 4 | 4 | 3 | A: "satisfies axioms, A57-58 mild extension"; C: manifest data model covers all 15 features (D4); E: readiness strong, rulebook/policy absent |
| C5 | Preview-lifecycle (11%) | 4 | 4 | 4 | A: "preview = ephemeral leaf (TTL/quota/PR-close)"; C: "preview = DB row from rendered overlay" + manifest generates rules (F2) and config (F3); E: strongest readiness. C capped at 4 (design, not shipped) |
| C6 | Dependency-model (9%) | 3 | 4 | 4 | A: env-level lattice, service-level via fleet (unwired); C: `dependsOn` + `superRefine acyclic` + `service_dependencies` upserts; E: "deps = mesh edges, A58 shared deps native" (design, not shipped → 4) |
| C7 | Footprint (5%) | 3 | 4 | 2 | A: medium; C: medium-high but additive to existing; E: greenfield footprint |
| C8 | Rulebook (8%) | 4 | 5 | 3 | A: satisfies axioms; C: "new authored-in-repo/owned-by-DB axiom" + M1–M6 manifest axioms; E: "A47 amendment needed" |
| C9 | Promotability/rollback (7%) | 4 | 4 | 4 | A: "rollback = pointer move" (cleanest, capped at 4 — design, not shipped); C: "pointer-move promotion, rollback re-point" with open digest-write-back; E: strongest readiness but promotion undefined |
| C10 | Fleet (5%) | 4 | 4 | 3 | A/C: "reuse unwired fleet machinery" (must wire); E: mesh-native but new machinery |
| C11 | Migration-risk (5%) | 4 | 3 | 2 | A: "compatible"; C: medium-high complexity; E: greenfield |
| C12 | Complexity (5%) | 4 | 3 | 1 | A: medium; C: medium-high; E: "highest complexity" |

### Step 3 — Weighted totals (weight% × score; also normalized to /100)

| | C1 13% | C2 8% | C3 13% | C4 11% | C5 11% | C6 9% | C7 5% | C8 8% | C9 7% | C10 5% | C11 5% | C12 5% | **Total** | **Norm /5** |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **A EnvGraph** | 65 | 24 | 52 | 44 | 44 | 27 | 15 | 32 | 28 | 20 | 20 | 20 | **391** | 3.91 |
| **C RepoProposal** | 65 | 32 | 52 | 44 | 44 | 36 | 20 | 40 | 28 | 20 | 15 | 15 | **411** | **4.11** |
| **E MeshOverlay** | 39 | 24 | 26 | 33 | 44 | 36 | 10 | 24 | 28 | 15 | 10 | 5 | **294** | 2.94 |

### Step 4 — Sensitivity (±2 on C1/C3/C5)

C leads by **20 points** (411 vs 391); every swing delta (13%×2 = 26 for C1/C3; 11%×2 = 22 for C5) exceeds that margin, so **both independent and correlated single-criterion swings flip the ranking**:

- **Independent** (one side moves): C −2 alone on C1/C3 → C 385 vs A 391 (A ahead); C −2 alone on C5 → C 389 vs A 391; A +2 alone on C1/C3 → A 417 vs C 411; A +2 alone on C5 → A 413 vs C 411.
- **Correlated** (both sides ±2 on the same criterion): C1/C3 → C 385 vs A 417; C5 → C 389 vs A 413.
- **All-three correlated**: C 411 − (26+26+22) = **337** vs A 391 + (26+26+22) = **465**.

The recommendation does not rest on swing-immunity; it rests on three things sensitivity does not touch: (1) the **HARD gate** disqualifies B and D regardless of any score; (2) the **evidence anchors** explain the lead — C's pipeline is built from shipped components (compose-parser with a real caller, the webhook controller, fleet tables), A requires wiring from zero consumers, E is greenfield; (3) **A and C are compatible** — A is C's runtime engine, so the practical difference is a design refinement, not a fork. Sensitivity flags the thin margin for the decision-maker; it does not invert it.

### Step 5 — Tie-break (C1 + C3 + C5)

A: 5+4+4 = 13 · C: 5+4+4 = 13 · E: 3+2+4 = 9 → the sensitivity set **ties** between A and C; the tie is resolved by the weighted totals (C 411 > A 391).

### Step 6 — RECOMMENDATION

**Recommended: System C — RepoProposal (HYBRID).** Runner-up: **System A — EnvGraph** (compatible; adopt A as C's runtime engine). North-star: **System E — MeshOverlay** (target for A58 shared dependencies once the mesh topology matures). B and D are disqualified under current axioms (T274 DB-first).

**Conditional on truth-direction:** If the user reverses T274 and chooses **repo-as-truth**, the recommended architecture becomes the B-hybrid (RepoTruth with DB materialization on approve) — i.e., C *is* that hybrid under the proposal semantics; a hard file-as-SSOT choice (pure B) requires a formal T274 amendment and is not recommended. This is Open Question #1 (BLOCKING) in `gaps-and-open-questions.md`.
