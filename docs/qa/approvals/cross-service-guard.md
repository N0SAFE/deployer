# Q&A — Approvals: Cross-Service Guard (`SEC-069`, `SEC-072`)

> **Module**: approvals
> **Category**: integrations
> **Last updated**: 2026-11-03

---

## Why identity answers the question for other services

**Q**: A project delete happens in the `project` service and a production deploy in `runtime`. Where is the approval
check made?

**A**: The service that owns the action still authenticates the caller and checks its own rules (ownership, role in the
project, environment). It then asks identity the ONE question it cannot answer alone — "may this caller do this exact
action" — because identity owns the ledger and the role catalogue.

The transport is the approval contract (`approvalContract.require`), reached with `ServiceClient.clientFor("identity", …)`.
`ApprovalGuard` (`apps/api/shared/src/core/modules/approval/approval.guard.ts`) wraps it as an Effect tag so a service
injects `ApprovalGuard` instead of building a client.

---

## Why the peer names the actor

**Q**: A mesh call carries no browser session. How does identity know who is asking?

**A**: The calling service names the account it authenticated (`requesterId`); the mesh peer itself is what makes the
claim trustworthy (`requireMesh()`), and it calls `serveAnonymous` rather than pretending there is a session.

Everything after that is shared with the in-process path (`require` → `requireFor` → the same `guard`): capability check
against the role catalogue snapshot, policy lookup, solo-mode degradation, atomic one-shot consume, typed refusal.

---

## The digest

`actionHash(procedure, ...parts)` lives in `@deployer/auth/server`. The peer that files a request and the guard that
spends it must agree byte for byte, so there is one implementation, not two canonicalisations.

Entries are keyed by action identity, never a free-form blob: `project.delete` + project id, `deployment.create` +
service id, `container.exec` + container id.

---

## Wired actions

| Action | Where | Permission | Hash input |
|---|---|---|---|
| Project delete | `project.service.ts` `deleteProject` | `project:delete` | `project.delete` + id |
| Production deploy | `deployment.service.ts` `triggerDeployment` | `deployment:create` | `deployment.create` + service id |
| Container shell | `docker.controller.ts` terminal open | `container:exec` | `container.exec` + container id |

Fail-closed: identity unreachable and identity refusing both surface as `ForbiddenError`. An approval system that
silently allows when its ledger is down is not a control.

## Not wired

- `node.revoke` has no procedure in fleet to protect; there is no surface, so no policy entry.
- `secret:reveal` on production: still on the roadmap.

## Tests

- `approval.guard.spec.ts` — digest agreement, refusal message preserved, fail-closed on transport failure.
- `approval.service.spec.ts` — `requireFor` answers for the peer-named actor, spends that actor's approval, and refuses
  without one.
