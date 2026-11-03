# Q&A — Roles: Business logic

> **Module**: roles (`SEC-054`, `AUTH-052`)
> **Category**: business-logic
> **Last updated**: 2026-11-03

---

## Who decides which roles exist

The code declares them (`authz/definition.ts` → `SYSTEM_ROLES_TABLE`); the `roles` table is seeded from that declaration
on boot (idempotent upsert on `(scope, name)`), and every reader asks the table:

- `GET /roles` (`role:read`) serves the catalogue to the web, so the picker's labels come from data rather than a second
  list in the browser.
- `user.setRole` and `user.create` refuse a role the platform-scope table does not know (`UserInvalid`). A role renamed
  in code but not yet re-seeded therefore cannot be written into `user.role`.

A role row is editable only by re-seeding while `is_system` is true; custom roles are rows like any other.

## What is still missing

- `authz_epoch` (+ `LISTEN/NOTIFY`): a demotion is visible within the 60 s cookie-cache window today, not instantly.
- `Grants.assign/revoke` writing `roles` + `user.role` in ONE transaction: today `user.setRole` writes the projection and
  the role check reads the table, in two statements.
- The last-owner guard for project owners (`SEC-081`); the last-`superAdmin` guard exists for self-delete.
