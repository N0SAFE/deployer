# Q&A — Permissions: Authz/Authn Design

> **Module**: permissions  
> **Category**: authz-authn-design  
> **Last updated**: 2026-10-26

Source of the questions: `docs/audit-2026-10-25/authz-authn-design.md` section 10 (D1..D18), itemised as DEC-AUTH-9..26 in `docs/audit-2026-10-25/roadmap/auth-security.md`. The operator answered "accept all" in chat on 2026-10-26 (every recommendation as written) plus the refinements recorded below. Complements `docs/qa/permissions/permission-system-design.md`, which is not modified.

---

## Authorization model (DEC-AUTH-9, D1)

**Q**: Flat RBAC, grants + guardrails, ReBAC (OpenFGA/Zanzibar), or ABAC policy-as-code (Cedar/OPA)?

**A**: Accepted: grants + guardrails. Closes `DEC-AUTH-8` ("wire the engine": yes, as a rewritten shell over the kept filter machinery). (Decided 2026-10-26, in chat.)

---

## superAdmin bypass (DEC-AUTH-10, D2)

**Q**: Keep the `superAdmin -> ALLOW` bypass, or remove it?

**A**: Accepted: remove (owner = all permissions, guardrails apply, host recovery CLI for lock-out), with a sequencing refinement: the bypass is removed only after the host recovery CLI (`SEC-081`) and break-glass (`SEC-073`) exist. Noted on `SEC-053`, `SEC-081`, `AUTH-025` and the enforcement-flip item `SEC-083`. (Decided 2026-10-26, in chat.)

---

## BFF to service identity (DEC-AUTH-11, D3)

**Q**: Cookie forward, signed claim, or mTLS?

**A**: Accepted: signed EdDSA claim (30 s) + service tokens, signer key anchored in the roster; mTLS only if the mesh later provides it for free. Resolves `DEC-SEC-3`, `EFF-016`, `DEC-EFF-3`. Reconciled with `DEC-EFF-28` (BFF serves `/.well-known/keys`, trust pinned in the mesh roster at setup). (Decided 2026-10-26, in chat.)

---

## Where policy lives (DEC-AUTH-12, D4)

**Q**: Postgres, roster, or both?

**A**: Accepted: Postgres for human/API authz now; roster capabilities for mesh-member authority; signed policy bundle in the roster later (`SEC-036`) for node-local enforcement. State in the architecture doc that the API tier is a coordinator for human actions. (Decided 2026-10-26, in chat.)

---

## Service accounts (DEC-AUTH-13, D5)

**Q**: User rows with `kind`, or a separate table?

**A**: Accepted: user rows with `kind` (native to Better Auth API keys). (Decided 2026-10-26, in chat.)

---

## Non-member reads (DEC-AUTH-14, D6)

**Q**: 403 or 404 for non-member reads?

**A**: Accepted: 404 (concealment) when the actor lacks `:read`; 403 only when read is held but the action is not. (Decided 2026-10-26, in chat.)

---

## Default role for new accounts (DEC-AUTH-15, D7)

**Q**: `viewer` or none?

**A**: Accepted: `member` with no capabilities; supersedes `DEC-AUTH-4` ("viewer"). (Decided 2026-10-26, in chat.)

---

## Approvals in a one-person install (DEC-AUTH-16, D8)

**Q**: Require a second person, or degrade?

**A**: Accepted: preset `solo` degrades to step-up + reason + cooldown; auto-suggest `team` at >= 2 humans. (Decided 2026-10-26, in chat.)

---

## Invites (DEC-AUTH-17, D9)

**Q**: Better Auth org invitations, own table, or drop and use `admin.createUser`?

**A**: Accepted: own `invitations` table (`DEC-AUTH-2`: grant templates and caps); interim before P4: admin-created users via our service, no email invites. (Decided 2026-10-26, in chat.)

---

## Agent Auth plugin (DEC-AUTH-18, D10)

**Q**: Register the plugin or delete it?

**A**: Accepted: delete (`DEC-AUTH-6`); agent tokens + device flow instead; revisit if the Agent Auth spec stabilises. (Decided 2026-10-26, in chat.)

---

## Quotas store (DEC-AUTH-19, D11)

**Q**: Redis or Postgres for quotas / rate limiting?

**A**: The operator accepted the DIFFERING recommendation: drop Redis for quotas/rate limiting and use an unlogged Postgres table (not Redis, which the design doc had recommended). Consequences: `SEC-071` and `SEC-024` updated; the Redis keep/drop decision (`DEC-ARCH-3`, `ARCH-070`) carries a note "leaning drop per DEC-AUTH-19; still confirm Redis removal". (Decided 2026-10-26, in chat.)

---

## Decision-log volume (DEC-AUTH-20, D12)

**Q**: Log everything or tiered?

**A**: Accepted: tiered (always denies/challenges/mutating and `risk>=high` allows, 1% sampled low-risk reads), hash-chained, 30 d decision summaries for simulate. (Decided 2026-10-26, in chat.)

---

## Condition language (DEC-AUTH-21, D13)

**Q**: CEL/Cedar or the existing `DFilter`?

**A**: Accepted: `DFilter` (non-Turing, tested, SQL-compilable), extended with `in`/`matches`/time/attribute paths only as needed. (Decided 2026-10-26, in chat.)

---

## Proof-carrying Authorized witness (DEC-AUTH-22, D14)

**Q**: Adopt or skip?

**A**: Accepted: adopt incrementally, `risk>=high` mutations first. (Decided 2026-10-26, in chat.)

---

## Org layer (DEC-AUTH-23, D15)

**Q**: Build an org layer or not?

**A**: Accepted: not now; leave the `org` ancestor extension point; closes `DEC-AUTH-1` as "platform + project". (Decided 2026-10-26, in chat.)

---

## operator scope (DEC-AUTH-24, D16)

**Q**: Platform-wide deploy, or observe + node ops only?

**A**: Accepted: observe + node ops only; deploys require a project role (documented behaviour change). (Decided 2026-10-26, in chat.)

---

## Impersonation default (DEC-AUTH-25, D17)

**Q**: Read-write or read-only by default?

**A**: Accepted: read-only by default, step-up to enable writes, intersection semantics. (Decided 2026-10-26, in chat.)

---

## oRPC gate/meta mechanics (DEC-AUTH-26, D18, UNVERIFIED)

**Q**: Middleware reading `procedure["~orpc"].meta` after validation, or `implement(contract).use(authzGate(accessMapFromContract))` keyed by procedure path?

**A**: Accepted as "resolve via spike `SEC-063`; fallback path-keyed access map". Resolved-pending-spike: `SEC-063` stays a todo spike and `SEC-061`, `SEC-062`, `SEC-064` and dependants remain gated on it. (Decided 2026-10-26, in chat.)

---
