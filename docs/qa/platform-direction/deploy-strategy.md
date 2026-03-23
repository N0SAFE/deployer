# Q&A — Platform Direction: Deploy Strategy & Pipeline Details

> **Module**: platform-direction  
> **Category**: deploy-strategy  
> **Last updated**: 2026-03-04

---

## SSL / TLS certificates

**Q**: How are SSL certificates managed?

**A**: Both — auto Let's Encrypt as default + custom cert upload option per domain/service.

---

## Zero-downtime deploy strategy

**Q**: What deployment strategy for zero-downtime deploys?

**A**: All three — configurable per service:
- Rolling update (new container starts, old stops after health passes)
- Blue-green (run both, swap Traefik route atomically)
- Canary (send % of traffic to new, promote if healthy)

---

## Service types / workload kinds

**Q**: Does the platform distinguish between service types?

**A**: Yes, four types:
- **Web service** — HTTP-based, gets a domain, routed via Traefik
- **Worker** — long-running process, no HTTP endpoint, no domain
- **Cron job** — scheduled task on a cron expression
- **One-shot task** — run once to completion (e.g. migrations)

---

## Scale to zero / sleep mode

**Q**: Can services scale to zero after inactivity?

**A**: Heavily configurable. Preview environments have scale-to-zero enabled by default (inactivity-based timing). Production services can opt in. Wake-on-first-request with a loading screen. Configurable inactivity threshold.

---

## Deploy concurrency

**Q**: Can multiple services deploy at the same time?

**A**: **Parallel deploys with dynamic limits, then queued.** Platform runs as many concurrent deploys as the node resources allow. When limits are hit, additional deploys queue. Prevents resource exhaustion.

---

## Health check configuration

**Q**: Are health check params configurable per service?

**A**: Defaults + per-service override. Sensible defaults (interval, timeout, retries, start period) with full override per service.

---

## Org isolation level

**Q**: Are org services physically or logically isolated?

**A**: Logically isolated **by project** (not by individual service). Projects within an org get their own Docker network. Services in the same project share a network. Different projects are isolated even within the same org.

---

## Platform self-update

**Q**: How does the platform itself get updated?

**A**: Both manual and auto. Updates are **cluster-wide** — all nodes update together to prevent version mismatches. Dashboard shows available updates. Admin can trigger immediately or schedule auto-update.

---

## Public API

**Q**: Is there a public API for Terraform, CI scripts, etc.?

**A**: ORPC API with API key auth. Same ORPC contracts used internally are exposed publicly with API key authentication for external tools (CI/CD scripts, Terraform, custom dashboards).

---

## Multi-service cascade deploys

**Q**: When a dependency service is redeployed, do dependents auto-redeploy?

**A**: Heavily configurable. **Default: auto-cascade ON.** When service B is redeployed and service A depends on B, A auto-redeploys. Users can override per dependency edge (turn off cascade for specific dependencies).

---

## Secrets scope

**Q**: At what scope can secrets/env vars be shared?

**A**: All three scopes:
- **Per-service** — only this service sees the var
- **Per-project** — shared across all services in the project
- **Per-org** — shared across all projects in the org

Higher-scope vars can be overridden at lower scopes.

---

## Container image retention

**Q**: How long are built Docker images retained?

**A**: Configurable — retain by count OR by time, whichever is longer. Example: keep last 10 images OR images from the last 30 days, whichever retains more.

---

## Monorepo path filter config

**Q**: How does a user define which paths trigger which service?

**A**: All three methods:
- Dashboard UI (manual path filter input per service)
- Auto-detected from Dockerfile path / package.json location
- Defined in `deployer.yaml` in the repo

---

## Deployment approval flow

**Q**: Who can approve, and is the rule per-tier?

**A**: Configurable per tier. Example: `prod` requires approval from a role with `deploy:approve:prod` permission, `staging` auto-deploys, `preview` auto-deploys.

---

## Branch → tier mapping

**Q**: How are Git branches mapped to deployment tiers?

**A**: Convention defaults + fully customizable per project. Matching criteria include:
- Branch name patterns (regex: `main` → prod, `develop` → staging, `PR/*` → preview)
- Docker image tags
- PR labels / Git tags

---

## Rate limiting

**Q**: Does the platform enforce rate limiting on deployed services?

**A**: Both — platform baseline rate limiting via Traefik middleware + service can add its own Traefik middleware overrides.

---

## Database migrations for user services

**Q**: Does the platform help run database migrations?

**A**: Yes — platform runs a migration command as a one-shot task before deploy. User configures the migration command (e.g. `npx prisma migrate deploy`) in the service config. Platform runs it in a one-shot container from the new image, waits for success, then proceeds to deploy.

---

## Deployer.yaml bidirectional sync

**Q**: When a user changes config in the UI, how does it sync back to deployer.yaml?

**A**: Platform opens a PR with the config diff for the user to merge. The user reviews the PR and merges it into their repo. No direct bot commits.

---

## Plugin security model

**Q**: What security model constrains plugins?

**A**: Marketplace with review/approval. Plugins must be reviewed and approved before they can be installed. Self-hosted instances can opt to allow unreviewed plugins (admin override).
