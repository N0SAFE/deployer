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

## Which actions require a proof

`StepUpService.assertCritical()` is called by `UserService.setRole`, `setBanned`, `revokeSessions`, `delete`, and by
`update` WHEN its patch moves `role` or `banned` — otherwise the profile form would be a second door around the guard. The failure is the domain's `UserForbidden`, so the boundary answers a refusal and the
web can tell the operator to verify with a passkey (`StepUpCard` on Settings → Account) and retry.

- The proof is recorded by the Better Auth `after` hook against the session `/passkey/verify-authentication` MINTED: that
  endpoint creates a fresh session and replaces the cookie, so reading the pre-existing session would bind the proof to a
  session the browser no longer holds.
- A TOTP row satisfies `steppedUp` but never `critical`; `assertCritical` refuses it.
- A refusal is the domain's `UserForbidden` carrying "step-up required: verify with a passkey and retry", so the toast
  tells the operator exactly what to do (`StepUpCard` on Settings → Account).

## What the read surface answers

**Q**: Does `GET /authz/step-up` gate anything?

**A**: No. It is a READ for the UI countdown and for callers that want to know before prompting. Every critical action
re-answers the question server-side (a future `requireStepUpForCritical` guard reads `step_up_events` directly).
