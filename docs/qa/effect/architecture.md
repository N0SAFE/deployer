# Q&A — Effect: Architecture

> **Module**: effect  
> **Category**: architecture  
> **Last updated**: 2026-10-26

Source of the questions: `docs/audit-2026-10-25/roadmap/effect-migration.md` "Decisions needed" (DEC-EFF-1..17), walked through with the operator in chat on 2026-10-26. All answers below were given by the operator in chat on 2026-10-26. For decisions "accepted as recommended" the answer is the recommendation text of the roadmap line. Design consequences are in `docs/audit-2026-10-25/effect-target-architecture.md`, `effect-layers-catalog.md` and `roadmap/effect-migration.md` (items EFF-159 onward).

Operator headline decision (2026-10-26): go for the FULL Effect layer architecture directly (services as Effect Layers, Effect owns the process), not the hybrid "Nest classes with `R = never`". All recommendations were accepted except the flips and adjustments listed under DEC-EFF-1, 6, 10, 13 and 17.

---

## Services as Layers or as Nest instances (DEC-EFF-1, D1)

**Q**: Services as Layers or as Nest instances (D1)? Options: (a) keep Nest-built classes but inject dependencies by constructor and expose methods with `R = never`; (b) `Layer.effect` owned by Effect (cleaner types, scoped resources, loses Nest DI/module override testing); (c) status quo with `R` leaking. Original recommendation: (a) now, revisit (b) when the infra layer exists.

**A**: FLIPPED to option (b): services are Effect Layers (`Layer.effect`), composed in an explicit `AppLive`; Effect owns construction and lifecycle. Option (a) is only the transition (thin Nest shell during the monolith cutover). Public service methods may carry only the Ambient requirements (`CurrentActor | Correlation`); a type test enforces it. (Decided 2026-10-26, in chat.)

---

## Error model and mapping (DEC-EFF-2, D2)

**Q**: Error model and mapping (D2): `effect/wrap` plus `_tag -> ORPCError` table, tagged-per-failure vs one wrapper; defect policy?

**A**: Accepted as recommended: tagged-per-failure with one shared table; 500 + correlation id for defects; refactor identity before porting more. (Decided 2026-10-26, in chat.)

---

## Actor / request context (DEC-EFF-3, D3)

**Q**: Actor/request context (D3): `CurrentActor` Effect service populated by `effect/wrap`, replacing `actorOf(context)`; BFF forwards cookie (today) or signed actor claim (what `ARCHITECTURE.md` says); remove ALS?

**A**: Accepted as recommended: Effect service plus signed actor claim aligned with `DEC-ARCH-4`; ALS removed after verification. (Decided 2026-10-26, in chat.)

---

## Transactions and cancellation (DEC-EFF-4, D4)

**Q**: Transactions and cancellation (D4): fiber-scoped `tx` service vs per-repository units of work; mandatory `AbortSignal` in `tryPromise`?

**A**: Accepted as recommended: fiber-scoped `Db` service for cross-repository units, per-repository for simple cases, signal mandatory. (Decided 2026-10-26, in chat.)

---

## Streaming (DEC-EFF-5, D5)

**Q**: Streaming (D5): RxJS stays (reconcile sample plugin with `packages/transport/orpc/src/observable`) or move to Effect `Stream`?

**A**: Accepted as recommended: RxJS remains the transport lingua franca (consistent with `packages/nest/events`), Effect wraps construction; migrate stream by stream only for new code. (Decided 2026-10-26, in chat.)

---

## zod vs Effect Schema (DEC-EFF-6, D6)

**Q**: zod vs Effect Schema (D6): confirm zod only at contracts and config; no Effect Schema in domains; which TaggedError flavour?

**A**: Accepted WITH ADJUSTMENT: zod at contract and config edges; Effect Schema is ALLOWED inside workflow, queue and config code (job payloads, outbox event bodies, claims, config) and this must be stated explicitly in the conventions doc and the lint rule. `Data.TaggedError` in-process, `Schema.TaggedError` only if serialised across processes. (Decided 2026-10-26, in chat.)

---

## Versions (DEC-EFF-7, D7)

**Q**: Versions (D7): Nest 12 vs 11 and TS 7 vs 5.9 target, when the catalog moves, exact `@orpc/*` beta pin and who owns bumps?

**A**: Accepted as recommended: keep Nest 11/TS 7 through the cutover, pin oRPC and effect exactly, sample moves to the catalog; revisit Nest 12 after cutover. (Decided 2026-10-26, in chat.)

---

## One class per file (DEC-EFF-8, D8)

**Q**: One class per file (D8): amend `apps/api/AGENTS.md` to allow key+impl together or split `*.tag.ts`/`*.impl.ts`?

**A**: Accepted as recommended: amend the rule for tag+impl pairs only (health/sample already do this). Under the full-Effect design there is no `Impl` class: tag and `Live` live in one file, test layers in `*.test-layer.ts`. (Decided 2026-10-26, in chat.)

---

## Bundling (DEC-EFF-9, D9)

**Q**: Bundling (D9): is `bun build --packages=external` accepted, superseding "never `bun build` an app"; verify Nest metadata?

**A**: Accepted as recommended: accept after a boot test of the built output. (Decided 2026-10-26, in chat.)

---

## Sample's fate (DEC-EFF-10, D10)

**Q**: Sample's fate (D10): keep as non-CI showcase, fold into `docs/` and delete, or promote into the workspace and CI?

**A**: Accepted WITH ADJUSTMENT (instead of "fold into docs and delete after Template v1"): delete the sample's duplicated runtime; make `samples/api-sample` a thin consumer of `@deployer/nest-effect` (later the `effect-*` packages) inside the workspace, with its tests running in CI. (Decided 2026-10-26, in chat.)

---

## Mixed-mode services (DEC-EFF-11, D11)

**Q**: Mixed-mode services (D11): are partially migrated services (identity) acceptable on `main`, and what is the facade for non-Effect consumers?

**A**: Accepted as recommended: acceptable if labelled and tracked (`EFF-118`), facade for consumers. (Decided 2026-10-26, in chat.)

---

## Observability (DEC-EFF-12, D12)

**Q**: Observability (D12): adopt OTel (none in the repo today) with an Effect tracer, or defer and standardise on correlation-id logging first?

**A**: Accepted as recommended: correlation-id logging first, OTel traces-only next. (Decided 2026-10-26, in chat.)

---

## mesh-agent (DEC-EFF-13, D13)

**Q**: mesh-agent (D13): own Effect-native template or leave non-Effect?

**A**: Accepted WITH ADJUSTMENT: Effect-native template, but DEFER the mesh-agent Effect migration until after Phase 2 (ROADMAP.md); low priority. The binary-size check stays a precondition. (Decided 2026-10-26, in chat.)

---

## Health supervisors field (DEC-EFF-14)

**Q**: Health supervisors field: BFF roll-up, service-token call to the BFF, or drop?

**A**: Accepted as recommended: drop from `svc-health` and keep supervisors in the BFF platform view. (Decided 2026-10-26, in chat.)

---

## Role assignment at user.create (DEC-EFF-15)

**Q**: Role assignment at `user.create`: add `role` to the contract or remove the dead service path?

**A**: Accepted as recommended: add it with the hierarchy rule enforced. (Decided 2026-10-26, in chat.)

---

## Identity writes to auth tables (DEC-EFF-16)

**Q**: Identity writes to auth tables: via Better Auth admin API or direct writes plus audit event?

**A**: Accepted as recommended: via Better Auth for bans/roles so hooks and session revocation apply. (Decided 2026-10-26, in chat.)

---

## Effect everywhere vs hybrid (DEC-EFF-17)

**Q**: Effect everywhere vs hybrid, and oRPC 2 beta pin: remain hybrid (Nest + oRPC + Effect for logic) vs adopt `effect/http-api`/`effect/workflow` if oRPC 2 stalls or the workflow spike passes? Original recommendation: hybrid; revisit only on those triggers.

**A**: FLIPPED to full Effect (Effect owns the process; Nest is a transitional shell, then an application-context-only island that shrinks to zero; oRPC stays the contract and transport; `effect/http`, `effect/http-api`, `effect/rpc` remain rejected). The original "revisit" triggers (oRPC 2 stalls, workflow spike passes) are kept only as risk notes (risk register R1, R2, spike S5). (Decided 2026-10-26, in chat.)

---

## Open questions raised by the design docs (recorded 2026-10-26, NOT yet answered)

These are roadmap lines `DEC-EFF-18..38` (from `effect-layers-catalog.md` 8.1 and `effect-target-architecture.md` 12.2). Their recommendation is the "default if unanswered" of the source doc. Update this section with the exact answer when the operator replies.

| Roadmap id | Source | Question (short) | Recommendation / default | Answer |
|---|---|---|---|---|
| DEC-EFF-18 | D-L1 | Create `@deployer/effect-platform` and `@deployer/effect-authz` as separate packages? | yes, both | pending |
| DEC-EFF-19 | D-L2 | Column encryption: explicit `seal/open` in repository mappers vs Drizzle custom type with sync codec | explicit seal/open; thin sync adapter only during transition | pending |
| DEC-EFF-20 | D-L3 | Where does `ReleaseManifestStore` live | runtime-owned table; project reads via `ServiceClients` | pending |
| DEC-EFF-21 | D-L4 | Regenerate the 18 BFF delegation controllers as `.effect(handle(...))` over `ServiceClients` vs leave | regenerate (script change only) | pending |
| DEC-EFF-22 | D-L5 | `FakeDocker`: hand-rolled behavioural engine vs recorded-fixture replay | hand-rolled plus nightly contract test against real Docker | pending |
| DEC-EFF-23 | D-L6 | Notification channel config storage | `SecretVault` per-channel sealed JSON | pending |
| DEC-EFF-24 | D-L7 | `Saga` custom vs `effect/workflow` | custom behind the same interface | pending |
| DEC-EFF-25 | D-L8 | Control-tier talks to nodes only via `AgentApi` (mesh), never SSH/direct Docker TCP | yes; direct engine access is local-socket only | pending |
| DEC-EFF-26 | D-1 | Does S1 pass (`OpenAPIHandler` on `Bun.serve` with SSE and uploads)? | if not, stay on thin Nest shell (a) for HTTP only and keep islands | pending |
| DEC-EFF-27 | D-2 | Claim signature scheme: EdDSA JWS vs Better Auth JWT plugin keys | EdDSA JWS via `KeyRing` | pending |
| DEC-EFF-28 | D-3 | Where `KeyRing` public keys are published to services | BFF `/.well-known/keys` | pending |
| DEC-EFF-29 | D-4 | Per-service Postgres roles from `TABLE_OWNERSHIP`: now or after cutover | after cutover | pending |
| DEC-EFF-30 | D-5 | S5 outcome: SQL worker vs `effect/workflow` | SQL worker | pending |
| DEC-EFF-31 | D-6 | Outbox/job store: Postgres vs `LocalDb` sqlite | Postgres for outbox and job queue; sqlite only for build cache and process table | pending |
| DEC-EFF-32 | D-7 | OTel (traces) enablement date | after step 3 (identity) | pending |
| DEC-EFF-33 | D-8 | Vitest 5 compatibility of the SWC toolchain; keep SWC during shell phase? | keep SWC config for shell-phase services | pending |
| DEC-EFF-34 | D-9 | mesh-agent binary-size budget | +8 MB | pending |
| DEC-EFF-35 | D-10 | BFF HTTP edge: keep Nest for Better Auth routes and setup SSE until step 8? | step 8 | pending |
| DEC-EFF-36 | D-11 | Idempotency-key contract for write procedures called by workers | `Idempotency-Key` header, 24 h, table `idempotency_keys` per owner | pending |
| DEC-EFF-37 | D-12 | Package scope naming | `@deployer/effect-*` | pending |
| DEC-EFF-38 | D-A..D-Q | Confirm the decisions made by the target-architecture doc itself (Effect owns the process, `HttpEdge` end state, errors by kind, `CurrentActor` without default, per-request context by middleware, tag+Live in one file, tx design, services never migrate at boot, EdDSA claims 30 s, services drop Better Auth, five `effect-*` packages, Vitest 5 first, hand-rolled `runMain`, probes/readiness, resilience classes, mandatory `meta.authz`, polled outbox consumers) | accept as written | pending |

---
