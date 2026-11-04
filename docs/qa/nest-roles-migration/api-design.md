# Q&A — Nest roles migration: API design

> **Module**: nest-roles-migration
> **Category**: api-design
> **Last updated**: 2026-11-04

---

## The raw HTTP edge

**Q**: How should the HTTP-edge Nest roles move: the 3 Express middlewares (logger, SSR auth redirect, service-auth ALS context), the global exception filter, and Better Auth's global APP_GUARD?

**A**: Approved the recommended option — *plain functions, one mount*: each becomes a plain function or Effect service with no decorators, mounted from one non-decorator `mountHttpEdge(app, [...])` in main.ts. Nest stays only as DI container and oRPC mount. The guard role is replaced by `authzGate` (oRPC) plus an explicit Better Auth route handler; the filter by tagged domain-error mapping plus one final error-handler function. ("Approve, start", after reading `docs/architecture/effect-orpc-conventions.md` §7.3 and §11.)

---

## Service scope

**Q**: How much of the ~180 remaining `@Injectable` services should be migrated in this pass?

**A**: Approved the recommended option — *roles + rules now, services by app*: migrate the Nest roles, drop the exemptions, add one ESLint rule per concept, and put every remaining `@Injectable` on a per-app allow-list (the visible migration ledger). Services are migrated app by app afterwards, each in its own session.

---

## Rule shape

**Q**: One rule per concept, or one rule with kinds?

**A**: One rule per concept ("create eslint rules for each things"), each syntactic, each with an `allow` list.

---

## What the code showed (not a question, a correction)

**Q**: (implicit) Is Better Auth's global `APP_GUARD` a live Nest role to replace?

**A**: No. `AuthModule` installs no guard; the comments claiming one were stale. Three of the four Express middlewares and the
exception filter were never registered. The live Nest HTTP code was two `configure(consumer)` hooks (`AuthModule`, `BffModule`),
both now mounted through `mountHttpEdge`. See `docs/architecture/effect-orpc-conventions.md` §14.
