# Q&A — Deployment triggers: business logic

> **Module**: deployment-triggers (runtime + fleet)
> **Category**: business-logic / security / integrations
> **Last updated**: 2026-10-27

---

## Where the registry lives

**Q**: Where should the trigger registry and webhook-initiated deploys live?

**A**: In `svc-runtime`, which owns deployments. Fleet receives the GitHub webhook and calls runtime over `ServiceClient`. Runtime hosts the registry, the sources (`api`, `github-push`) and a new internal procedure `deployment.triggerFromEvent`.

---

## System actor

**Q**: How should a webhook-initiated deploy be authorized?

**A**: A signed actor claim. The caller signs a short-lived claim `{kind:"system", source, deliveryId, aud, exp}` (HMAC-SHA256 over a key derived from the platform auth secret); runtime verifies it and treats the call as a system actor: it skips the project-membership check, stores `triggeredBy = null` (the column is nullable "for webhook triggers") and logs the claim. This is the first piece of the "service identity / signed actor claim" idea (cutover report §6, idea 5).

---

## Scope

**Q**: Which trigger sources are in scope?

**A**: `api` and `github-push`, plus replacing the placeholder `serviceId = repository.full_name` in fleet's pull_request handler with a real repository→service lookup. A PR source that deploys the PR commit is out of scope (behaviour change; the monolith only provisioned DNS/routes).
