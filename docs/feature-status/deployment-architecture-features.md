# Deployment Architecture — Feature Status

> **Date:** 2026-08-06
> **Status:** Proposed — feature backlog + 6 full specs (SC7), no implementation
> **Scope:** 15 traceable features (7 NEW, 8 FIX-existing-partial), roadmap W1/W2/W3, full specs for F1,F2,F3,F4,F5,F9
> **Branch:** n/a (docs only)

## Index

| ID | Feature | Priority | Class | Roadmap |
|---|---|---|---|---|
| F1 | Preview serviceId resolution | P0 | FIX (broken cast `github-webhook.controller.ts:163`) | W1 |
| F2 | Webhook → preview build trigger rules | P0 | FIX (`github_deployment_rules` zero consumers) | W1 |
| F3 | Preview config from DB | P0 | FIX (hardcoded naming/TTL) | W1 |
| F4 | Artifact promotion without rebuild | P1 | **NEW** (P1-pattern) | W2 |
| F5 | Preview TTL + auto-delete full teardown | P1 | FIX (row-only hardcoded 168h) | W1 |
| F6 | Preview quotas + idle sleep | P2 | NEW (wires existing partial machinery — `maxPreviewEnvironments` quota field, zero consumers) | W3 |
| F7 | Drift detection & report | P1 | FIX (`DriftReconciliationService` unwired) | W2 |
| F8 | Digest pinning | P2 | **NEW** | W3 |
| F9 | Dependency readiness gates | P1 | FIX (wire fleet services) | W2 |
| F10 | Env-to-env promotion flow | P1 | FIX (`environment_promotions` dead) | W2 |
| F11 | Per-env policy enforcement | P2 | NEW (wires existing partial machinery — `envPolicySchema` contract-only, never persisted) | W3 |
| F12 | Version compatibility check | P2 | **NEW** (ABSENT today) | W3 |
| F13 | Cross-project dependency gate | P2 | NEW (wires existing partial machinery — `cross-project-gate` service unwired) | W3 |
| F14 | Environment templates | P2 | FIX (`environment_templates` dead) | W3 |
| F15 | Preview dependency sharing (A58) | P2 | **NEW** | W3 |

## Roadmap

- **W1:** F1 → F3 → F2 → F5 (fix the preview world's broken spine)
- **W2:** F4 → F9 → F10 → F7 (promotion + readiness + drift)
- **W3:** F8 → F6 → F11 → F13 → F12 → F14 → F15 (pinning, policy, compat, templates, A58)

Docs paths below are **proposed** (rendered docs live in `apps/doc/content/docs/**` per repo convention; register in `apps/doc/content/docs/index.mdx`).

---

## F1 — Preview serviceId resolution (P0)

**Problem:** The webhook resolves the preview's `serviceId` with a broken cast at `github-webhook.controller.ts:163`. Preview env rows end up linked to the wrong service (or the oldest deployment).
**Story:** As a developer opening a PR, my preview deployment must attach to *the service named by the branch config*, not whatever the cast happens to produce.
**Acceptance:**
- `serviceId` is resolved from `github_repository_configs`/manifest service mapping with Zod-validated output (zero assertions).
- A preview env row never references the OLDEST deployment by accident.
- Unit test: webhook payload → correct serviceId for named/nested branches.
**Target doc:** `apps/doc/content/docs/dev/deployment/preview-service-id.mdx`
**Priority:** P0 — blocks all preview flows (W1, first).

## F2 — Webhook → preview build trigger rules (P0)

**Problem:** `github_deployment_rules` (`action: deploy|preview|skip`) has **zero consumers**; rule matching is MISSING in the preview trace (step 4).
**Story:** As a platform engineer, I configure per-repo rules once; webhook events resolve to `preview`, `deploy`, or `skip` automatically.
**Acceptance:**
- Rule engine consumes `github_deployment_rules` (first consumer).
- Manifest materialization **generates** rules from the `preview` block (branchPattern).
- Rule match result drives build enqueue and is observable (log with requestId).
**Target doc:** `apps/doc/content/docs/dev/deployment/preview-trigger-rules.mdx`
**Priority:** P0 (W1).

## F3 — Preview config from DB (P0)

**Problem:** Preview naming and TTL are hardcoded (`pr` naming, 168h TTL); `PreviewNamingService` (A103) exists but the config path ignores it.
**Story:** As a developer, my preview gets the branch-based name and TTL my project config declares — not hardcoded defaults.
**Acceptance:**
- Naming reads `subdomainTemplate` from DB (A103), falling back to `PreviewNamingService` pr/branch/branch_hash.
- TTL/quota read from `preview_environments`/manifest (no hardcoded 168h).
- Quota field gains its first consumer.
**Target doc:** `apps/doc/content/docs/dev/deployment/preview-config.mdx`
**Priority:** P0 (W1).

## F4 — Artifact promotion without rebuild (P1)

**Problem:** The P1 artifact-promotion pattern is the biggest gap; promotion today is routing-only (`domain-routing.service.ts:396`) or a rebuild. **NEW feature.**
**Story:** As a release engineer, I promote a built artifact across environments by moving a pointer — no rebuild, instant rollback by re-pointing.
**Acceptance:**
- Author tag/git → promote → **digest in DB**; pointer-move promotion; rollback re-points.
- `deployments` stay append-only/immutable; promotion writes a new immutable row.
- Promotion conflict detection (append-only invariant).
- F10 consumes F4 for env-to-env flow.
**Target doc:** `apps/doc/content/docs/dev/deployment/artifact-promotion.mdx`
**Priority:** P1 (W2).

## F5 — Preview TTL + auto-delete full teardown (P1)

**Problem:** TTL is row-only (hardcoded 168h); merge/close handling is hardcoded; there is no full teardown.
**Story:** As a developer, my preview is deleted automatically on TTL expiry or PR merge/close — DNS, route, Traefik FS, and DB rows all cleaned.
**Acceptance:**
- TTL enforced from config (F3), checked at every state transition (TTL-race edge case).
- Merge/close → full teardown (DB + DNS + Traefik FS), not just row deletion.
- Teardown is idempotent (webhook re-delivery safe).
**Target doc:** `apps/doc/content/docs/dev/deployment/preview-teardown.mdx`
**Priority:** P1 (W1, last of the spine).

## F9 — Dependency readiness gates (P1)

**Problem:** `fleet-readiness-gate` and `service-dag` (Kahn) are **unwired**; A74 (health) and A78 (ordering) are not enforced at deploy time.
**Story:** As a platform operator, a service deploy starts only when its `dependsOn` (`service_healthy`/`service_started`/`service_completed_successfully`) predecessors are ready.
**Acceptance:**
- Fleet readiness gate wired into the deploy path (first consumer).
- Ordering uses fleet `service-dag` topological order.
- Failure of a required dep fails the deploy with a typed error (AppError hierarchy).
- Preview deploys (step 6 of the target lifecycle) honor the same gates.
**Target doc:** `apps/doc/content/docs/dev/deployment/dependency-readiness.mdx`
**Priority:** P1 (W2).

---

> **Class legend:** FIX = fixes existing-partial machinery; NEW = greenfield (some NEW items wire existing partial machinery — see annotations). 7 NEW, 8 FIX-existing-partial (per corpus D4).
