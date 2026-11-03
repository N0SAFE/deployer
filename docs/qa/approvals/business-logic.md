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

## Enforcement

`ApprovalService.require(permission, actionHash)` is the guard a protected action calls. It allows when the actor's ROLE
already grants the permission (an approval is only for what the caller cannot do alone); otherwise it consumes an
approved, unexpired request matching that hash. A refusal names the hash, so the caller can file the matching request
without a copy of the server's canonicalisation.

First wired action: `user.delete`. `actionHash("user.delete", id)` binds the approval to ONE account — approving the
deletion of account A cannot delete account B. The guard runs AFTER the passkey step-up and immediately before the write,
so a failed ceremony never spends an approval.

## The policy table

`approval.policy.ts` lists the actions that may be done by proxy (`{ permission, requiredApprovals, ttlSec }`). It is the
verdict `SEC-069` was missing, as data: adding a protected action is one entry, not an `if`.

- Asking is refused for an action with no policy (`ApprovalInvalid`): a row nobody can legally satisfy is worse than a
  clear "this is not approvable".
- The row's quorum and TTL come from the POLICY (`Math.max` for approvers, `Math.min` for TTL), never from the requester's
  payload — asking for one approver cannot shorten a two-person rule.
- `require` allows a caller who holds the capability, refuses an action with no policy with the ordinary
  "actor lacks X", and only then looks for an approval. `user:delete` is the current entry.

## Not done yet

- Solo-mode degradation (`DEC-AUTH-16`): the policy is installation-agnostic today.
- More entries: `secret:reveal` on production, prod deploys and `container:exec` live in other services and need the same
  guard wired there.
- The raw passkey `assertionHash` is not stored: Better Auth verifies WebAuthn assertions at ITS endpoint, so binding the
  raw assertion here would mean re-implementing the ceremony. What IS stored is `proof_hash` on the vote — a digest of the
  verified step-up record, the request and the approver — which makes the vote non-repudiable and non-reusable without
  pretending to be the assertion.
- Solo mode (`DEC-AUTH-16`) degrades approvals to step-up + reason + cooldown; not implemented.
- The passkey `assertionHash` (non-repudiation over the request id) is not stored yet.
