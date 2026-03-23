# Q&A — Platform Direction: Multi-tenancy & Org Model

> **Module**: platform-direction  
> **Category**: multi-tenancy  
> **Last updated**: 2026-03-04

---

## Org / cluster boundary

**Q**: Is an organization limited to one cluster, or can it span multiple clusters?

**A**: A cluster is managed by a **platform super admin** (platform-level user). Inside a cluster the super admin can:
- Create organizations
- Allow orgs access to a full instance, part of an instance, or multiple instances
- Orgs see the cluster and can configure: service splits, automatic preview deployments, and other deployment policies in a per-org config

Orgs can then manage their own users using a **complete role / permissions panel**:
- Allow users by project
- Allow users per specific service within a project

This means the access hierarchy is:
```
Platform super admin
  └── Cluster
        └── Organization  ← sees cluster, configures service policy
              └── Project
                    └── Service
                          └── User (role-scoped to project or specific service)
```

---

## DNS management

**Q**: How are preview subdomains provisioned?

**A**: Both manual and platform-managed DNS, with a long-term goal of full automation. Planned design:
- Multiple DNS provider integrations (Cloudflare being the primary target, others later)
- User connects a DNS provider and specifies a domain per app
- The platform handles wildcard record creation, preview subdomain assignment, and SSL automatically
- End-state UX: "use Cloudflare for this app, use this domain" → platform handles everything end-to-end

Manual DNS (user sets wildcard themselves) is the first working mode while provider integrations are built.
