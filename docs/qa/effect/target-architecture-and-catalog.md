# Q&A — Effect: Target Architecture and Layer Catalog

> **Module**: effect  
> **Category**: target-architecture-and-catalog  
> **Last updated**: 2026-10-26

Source of the questions: `docs/audit-2026-10-25/roadmap/effect-migration.md` "Decisions raised by the full-Effect design docs" (DEC-EFF-18..38), from `effect-layers-catalog.md` (D-L1..D-L8) and `effect-target-architecture.md` (D-1..D-12, D-A..D-Q). The operator answered "accept all" in chat on 2026-10-26 to the walkthrough, i.e. every recommendation as written, plus the refinements recorded below. Complements `docs/qa/effect/architecture.md` (DEC-EFF-1..17), which is not modified.

---

## Separate effect-platform and effect-authz packages (DEC-EFF-18, D-L1)

**Q**: Create `@deployer/effect-platform` (adapters) and `@deployer/effect-authz` as separate packages beside the four planned, or fold both into `effect-infra`?

**A**: Accepted (a): both, as separate packages. Folding them into infra would break "mesh-agent depends on effect-core plus the Bun-only subset of infra" and drag Drizzle schema owners and Better Auth types into infra. (Decided 2026-10-26, in chat.)

---

## Column encryption API (DEC-EFF-19, D-L2)

**Q**: Column encryption: explicit `seal/open` in repository mappers (async, no global registry) vs a Drizzle custom type with a sync codec over a pre-resolved key?

**A**: Accepted: explicit `seal/open` in repository mappers; keep a thin sync adapter only for the transition of already-typed columns. (Decided 2026-10-26, in chat.)

---

## Where ReleaseManifestStore lives (DEC-EFF-20, D-L3)

**Q**: Runtime-owned table with project reading through `ServiceClients`, vs a shared table?

**A**: Accepted: runtime-owned; project reads via E1 (one owner per table). (Decided 2026-10-26, in chat.)

---

## BFF delegation controllers (DEC-EFF-21, D-L4)

**Q**: Regenerate the 18 BFF delegation controllers as `.effect(handle(...))` over `ServiceClients` (kills the Promise client stack) vs leave them?

**A**: Accepted: regenerate (script change only, `EFF-190`). (Decided 2026-10-26, in chat.)

---

## FakeDocker strategy (DEC-EFF-22, D-L5)

**Q**: `FakeDocker`: hand-rolled behavioural in-memory engine vs recorded-fixture replay?

**A**: Accepted: hand-rolled, with a contract test run against real Docker nightly in CI. (Decided 2026-10-26, in chat.)

---

## Notification channel config storage (DEC-EFF-23, D-L6)

**Q**: `SecretVault` per-channel sealed JSON vs one encrypted blob per project?

**A**: Accepted: per-channel. (Decided 2026-10-26, in chat.)

---

## Saga: custom vs effect/workflow (DEC-EFF-24, D-L7)

**Q**: `Saga` custom (G5) vs `effect/workflow` (S5 outcome)?

**A**: Accepted: custom, behind the same interface so a swap is local. (Decided 2026-10-26, in chat.)

---

## Control tier talks to nodes only via AgentApi (DEC-EFF-25, D-L8)

**Q**: Do control-tier services talk to nodes only via `AgentApi` (mesh), never SSH or direct Docker TCP (mesh-first invariant)?

**A**: Accepted: yes; any direct engine access is local-socket only. (Decided 2026-10-26, in chat.)

---

## HTTP edge: S1 outcome and shell (DEC-EFF-26, D-1)

**Q**: Does S1 pass (`OpenAPIHandler` on `Bun.serve` with SSE and uploads)? If not, stay on the thin Nest shell permanently for HTTP only and keep islands?

**A**: Accepted as the default: thin Nest shell for HTTP only until spike S1 passes. Refinement: the DEC is resolved-as-default, but the flip to `HttpEdge` in `EFF-179`/`EFF-198` stays gated on the S1 test outcome (`EFF-173`); the dependent flip items remain blocked on S1 itself, not on the DEC. (Decided 2026-10-26, in chat.)

---

## Claim signature scheme (DEC-EFF-27, D-2)

**Q**: EdDSA JWS (recommended) vs reusing Better Auth's JWT plugin keys?

**A**: Accepted: EdDSA JWS via `KeyRing`. (Decided 2026-10-26, in chat.)

---

## Where KeyRing public keys are published (DEC-EFF-28, D-3)

**Q**: BFF `/.well-known/keys` vs a shared table read by every service?

**A**: Accepted with refinement: the BFF serves `/.well-known/keys` while trust is pinned in the mesh roster at setup (reconciles with `DEC-AUTH-11`). (Decided 2026-10-26, in chat.)

---

## Per-service Postgres roles (DEC-EFF-29, D-4)

**Q**: Per-service Postgres roles generated from `TABLE_OWNERSHIP`: now or after cutover?

**A**: Accepted: after cutover, but add the ownership-guard test now. (Decided 2026-10-26, in chat.)

---

## S5 outcome: SQL worker vs effect/workflow (DEC-EFF-30, D-5)

**Q**: SQL worker vs `effect/workflow`?

**A**: Accepted: SQL worker (default). (Decided 2026-10-26, in chat.)

---

## Outbox and job store (DEC-EFF-31, D-6)

**Q**: Postgres everywhere vs `LocalDb` (sqlite) for the runtime-local queue and outbox?

**A**: Accepted: Postgres for outbox and job queue; sqlite only for build cache and process table. The architecture note must state that platform state in Postgres is a coordinator while the data plane stays peer-equal. (Decided 2026-10-26, in chat.)

---

## OTel enablement date (DEC-EFF-32, D-7)

**Q**: When are OTel traces enabled relative to correlation-id logging?

**A**: Accepted: after step 3 (identity). (Decided 2026-10-26, in chat.)

---

## Vitest 5 and the SWC toolchain (DEC-EFF-33, D-8)

**Q**: Keep SWC for the shell phase or force services off decorators faster?

**A**: Accepted: keep the SWC config for shell-phase services. (Decided 2026-10-26, in chat.)

---

## mesh-agent binary-size budget (DEC-EFF-34, D-9)

**Q**: What is the S3 binary-size budget?

**A**: Accepted: +8 MB over today's `bun build --compile`. (Decided 2026-10-26, in chat.)

---

## BFF HTTP edge timing (DEC-EFF-35, D-10)

**Q**: Keep Nest for Better Auth routes and setup SSE until step 8, or move earlier?

**A**: Accepted: step 8. (Decided 2026-10-26, in chat.)

---

## Idempotency-key contract (DEC-EFF-36, D-11)

**Q**: Header name, storage, TTL for write procedures called by workers?

**A**: Accepted: `Idempotency-Key` header, 24 h, table `idempotency_keys` per owner. (Decided 2026-10-26, in chat.)

---

## Package scope naming (DEC-EFF-37, D-12)

**Q**: Confirm the `@deployer/effect-*` package scope, given some code may still import `@repo/*`?

**A**: Accepted: `@deployer/effect-*`, but first verify that no code still imports `@repo/*`; a check item was added (`EFF-297`). (Decided 2026-10-26, in chat.)

---

## Decisions made by the target-architecture doc itself (DEC-EFF-38, D-A..D-Q)

**Q**: Confirm the decisions of the target-architecture doc (Effect owns the process; `HttpEdge` end state; errors by kind; `CurrentActor` without default and `Ambient` in `R`; per-request context merged by middleware; tag + `Live` in one file; transaction design with `CurrentTx` and savepoints; services never migrate at boot and verify the journal head; EdDSA claims with 30 s TTL; services drop Better Auth; five `effect-*` packages; Vitest 5 first; hand-rolled `runMain`; probes/readiness replace `HealthRegistry`; resilience classes and in-house `CircuitBreaker`; mandatory `meta.authz`; polled outbox consumers)?

**A**: Accepted as written (batch). Two items to skim later: the in-house `CircuitBreaker` should be a simple `Schedule`-based one (`EFF-239`), and `runMain` stays hand-rolled (`EFF-180`). (Decided 2026-10-26, in chat.)

---
