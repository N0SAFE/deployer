# Q&A — Approvals: Business logic

> **Module**: approvals (`SEC-072`)
> **Category**: business-logic
> **Last updated**: 2026-11-03

---

## Asking is not a capability

`POST /approvals` is open to any signed-in account: an account that cannot do something is exactly the account that
needs to ask. The permission it names is checked against the catalog (`isPermission`), because a ledger row for a
capability nothing enforces is consent for nothing.

## Deciding

`approval:approve` (platform admin today), plus:

- a fresh **passkey** step-up — the same AAL3 proof critical actions require;
- never the requester's own vote — two people means two people;
- only while `pending` and `expiresAt > now`.

A **deny** closes the request immediately. An **approve** closes it when the count of distinct approvers reaches
`requiredApprovals`; the vote table's `(request_id, approver_id)` primary key makes a double click a single vote and the
count a `COUNT(*)` over people rather than a counter that can drift.

## Spending

`POST /approvals/consume` is the requester's retry path: one `UPDATE … WHERE status='approved' AND action_hash=$h AND
expires_at>now RETURNING id`. The database decides which retry wins, so the same approval cannot authorise two actions.
The approval is bound to `actionHash` (sha256 over procedure, resource and input), which is what stops "approve the
staging deploy" being replayed as "deploy v9 to prod".

## Not done yet

- The guardrail engine's `Require Approval` verdict (`SEC-069`) does not create these rows yet, so no procedure is gated
  by an approval today. When it lands, the guard calls the same store method INSIDE the action it protects — the
  standalone `consume` procedure is the retry path, not the enforcement.
- Solo mode (`DEC-AUTH-16`) degrades approvals to step-up + reason + cooldown; not implemented.
- The passkey `assertionHash` (non-repudiation over the request id) is not stored yet.
