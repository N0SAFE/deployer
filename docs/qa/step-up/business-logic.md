# Q&A — Step-up: Business logic

> **Module**: step-up (`AUTH-062`)
> **Category**: business-logic
> **Last updated**: 2026-11-03

---

## What counts as a step-up

**Decision (from `docs/audit-2026-10-25/authz-authn-design.md` §6.8 / `AUTH-062`)**: a step-up is a FRESH factor
verification bound to the CURRENT session. `session.freshAge` is explicitly NOT used: it describes how long the cookie
has lived (24 h here) and is used only by Better Auth's own sensitive endpoints.

- Window: 300 s (`STEP_UP_WINDOW_SECONDS`).
- Factors recorded: `passkey` (AAL3, phishing-resistant) and `totp` (AAL2, possession only).
- Only `passkey` satisfies a CRITICAL action (`isCriticalStepUp`). A TOTP row is recorded for visibility, never accepted
  as the stronger proof.
- Production: Better Auth's `after` hook on `/passkey/verify-authentication` and `/two-factor/verify-totp` writes the
  row. The hook reads the session from the verified context, never from the body, so a caller cannot claim a step-up for
  another session.

---

## What the read surface answers

**Q**: Does `GET /authz/step-up` gate anything?

**A**: No. It is a READ for the UI countdown and for callers that want to know before prompting. Every critical action
re-answers the question server-side (a future `requireStepUpForCritical` guard reads `step_up_events` directly).
