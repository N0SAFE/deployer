# Q&A — Impersonation: Security

> **Module**: impersonation (`AUTH-067`, closes `AUTH-031`)
> **Category**: security
> **Last updated**: 2026-11-03

---

## Where the impersonated session is minted

**Decision**: a Better Auth server plugin endpoint (`POST /impersonate`), not an oRPC procedure in the identity service.

**Why**: impersonation replaces the session cookie, so the session must be created and set on the same origin sign-in
uses. An oRPC procedure would have to return the session token in a body for the browser to store — the design
explicitly requires Better Auth's impersonate to be *wrapped, not exposed raw*. The plugin is that wrapper; the admin
plugin that used to own a raw endpoint is gone.

---

## Read-only by default (`DEC-AUTH-25`)

**Implementation**: `actorFromContext` maps any session carrying `impersonatedBy` to the platform `viewer` role.

**Why this shape**: enforcement sits at the one place every capability check reads, so no handler has to remember a
flag. A write is refused because `viewer` does not grant it. The approximation is deliberately SAFER than
`target ∩ admin`: it never grants more than read-only platform access, even when the target is an admin. Project-scoped
reads under impersonation are correspondingly narrower than the target's own view; the eventual "toggle writes" flow
(`DEC-AUTH-25`) is where the intersection will be computed exactly.

---

## Why the admin's token is parked in a cookie

`stop-impersonating` must restore the admin's own session. The token waits in an HttpOnly, signed cookie
(`deployer.admin_session`, path `/`, 1 h) written BEFORE the impersonated cookie replaces it, and is checked against
`session.impersonatedBy` before restoring. An expired or tampered parked session refuses the stop instead of guessing.

---

## Preconditions

- Capability `user:impersonate` (held by `superAdmin`; `admin` does NOT hold it).
- Strictly higher rank than the target — never an equal, never a stronger principal.
- A fresh **passkey** step-up (`hasStepUp` port reads `step_up_events`, AAL3 only) for the CALLER's session.
- The target must not be banned, and a session that is already impersonating cannot impersonate again.
- 1 h TTL (`IMPERSONATION_TTL_SECONDS`), shorter than the 30-day session it replaces.
