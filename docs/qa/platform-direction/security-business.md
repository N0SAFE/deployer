# Q&A — Platform Direction: Security, Compliance & Business Model

> **Module**: platform-direction  
> **Category**: security-business  
> **Last updated**: 2026-03-04

---

## Secrets management

**Q**: Are environment variables the only secret primitive, or is a separate vault needed?

**A**: Both — env vars for simple cases, vault integration for enterprise:
- Env vars stored encrypted in DB (primary, simple case)
- HashiCorp Vault / Infisical integration for enterprise use cases

---

## Role / permission system

**Q**: What is the role system design?

**A**: Both — predefined roles + ability to create fully custom roles:
- Predefined roles per level: Owner / Admin / Developer / Viewer
- Custom roles with a permission checkbox matrix (define exactly which actions a role can perform)

Applicable at every access level:
- Platform level (super admin, platform viewer)
- Org level (org admin, org developer, etc.)
- Project level (can be scoped to a specific project)
- Service level (can be scoped to a specific service within a project)

---

## Resource quotas

**Q**: Should the platform enforce resource quotas per org?

**A**: Hard quotas — platform refuses to deploy if the org is over limit. Configurables:
- CPU / memory / disk / concurrent deploys per org
- Soft warning threshold configurable separately

---

## Audit log

**Q**: What level of audit log is required?

**A**: Full audit log — all write operations including: actor (user ID), action, resource, IP address, user agent. Exportable to CSV / JSON.

---

## Deployment history retention

**Q**: How long should deployment history be retained?

**A**: Configurable per org — e.g. retain N deploys or N days. No fixed platform-wide limit.

---

## Backup & disaster recovery

**Q**: Should the platform provide backup/restore, and at what granularity?

**A**: Full cluster backup — platform manages backups of:
- Cluster configuration
- Volumes
- Secrets (encrypted)
- Deployable assets

Backup destination: S3-compatible bucket (user-configured).

---

## Plugin / extension model

**Q**: Is there a plugin/extension API?

**A**: Yes — plugin API allowing third parties to add:
- Deployment providers (new source types)
- Notification channels
- DNS providers
- Storage providers
- Build runtimes

---

## Open source / license model

**Q**: What is the licensing model?

**A**: **Open core** — core platform is open source; enterprise features are commercial. Tiers:
- **Self-hosted free**: core features, community support
- **Self-hosted pro**: additional enterprise features (SSO, advanced audit log, SLA) via commercial license
- **Hosted / SaaS option**: platform owner can offer the platform as a SaaS with usage-based billing

Goal: self-hosted first, with an optional commercial layer for teams that want managed features.
