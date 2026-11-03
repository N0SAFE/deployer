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

## Managing custom roles

`POST/PATCH/DELETE /roles` require `role:write` and are capped twice, independently:

- the rank must stay strictly BELOW the editor's (`platformRoleRank`), so a role can never reach the editor's own level;
- every permission must already be the editor's own (`capabilitiesOfRole`), so "manage roles" cannot become "grant myself
  the danger bundle"; a permission the catalog does not declare is refused too.

A built-in (`is_system`) role cannot be edited or deleted — re-seed the code. A custom role cannot be deleted while any
account holds it, because `user.role` would then name a role nothing can interpret, and every capability check for those
accounts would silently deny. Role writes are audited (`role-created/updated/deleted`).

## What is still missing

- `authz_epoch` (+ `LISTEN/NOTIFY`): a demotion is visible within the 60 s cookie-cache window today, not instantly.
- `Grants.assign/revoke` as a named service: the WRITE is now atomic (`applySecurityChange` commits the row and deletes
  the sessions/keys it invalidates in one transaction), but the role-table check is still a read in a separate statement
  and the seam is a repository method rather than a `Grants` service.
- The last-owner guard for project owners (`SEC-081`); the last-`superAdmin` guard exists for self-delete.
