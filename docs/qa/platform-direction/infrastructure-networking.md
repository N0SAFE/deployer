# Q&A — Platform Direction: Infrastructure & Networking

> **Module**: platform-direction  
> **Category**: infrastructure-networking  
> **Last updated**: 2026-03-04

---

## Service networking model

**Q**: How do services within the same project communicate?

**A**: Two scopes:
1. **Intra-project**: services in the same project share a private Docker network — can call each other by container name (e.g. `http://backend:3000`)
2. **Intra-org**: services in the same org can call each other via a mesh service URL (platform-assigned internal URL, resolved via the API's service discovery)

---

## Persistent storage

**Q**: What persistent storage options must the platform offer?

**A**: All of the following:
- **Named Docker volumes** — bound to one node, non-migratable, simplest option
- **Shared NFS / S3-backed volumes** — survive node migration (required for multi-node replicated services)
- **Platform-managed PostgreSQL** — provision a DB instance from the dashboard
- **Platform-managed Redis** — provision a Redis instance from the dashboard

---

## Network ingress / egress policies

**Q**: Should services have configurable network policies?

**A**: Yes — platform-level firewall rules per service (allow/deny by port or origin). Not just open intra-project networking.

---

## Traefik config ownership

**Q**: Is Traefik fully managed by the platform, or can the user inject custom rules?

**A**: Both — platform baseline + user override snippets. Platform generates the core Traefik config (SSL, routing, preview subdomains). User can inject custom Traefik middleware or route rules per service (e.g. rate limiting, custom headers, IP allowlist). Override snippets are merged on top of the platform baseline.

---

## Custom domains

**Q**: How are custom domain names assigned?

**A**: Multiple custom domains per service (aliases). A single service can have multiple domain names pointing to it.

---

## Instance migration (service moves between nodes)

**Q**: Can a running service be migrated from one node to another?

**A**: Both — automatic with manual override:
- **Automatic**: LB migrates service to a less-loaded node when a threshold is breached
- **Manual override**: admin can trigger a migration from the dashboard
- Graceful migration: platform checks cluster capacity before migrating. If insufficient capacity, it warns and offers options (change settings or kill lower-priority services)

---

## Multi-region / geo-distribution

**Q**: Does v3 need to support geo-distributed clusters?

**A**: Yes — v3 should support multiple clusters in different regions, with org traffic routed to the nearest cluster. Each cluster is an independent fleet but shares org/user data via the shared PostgreSQL (or a cross-cluster sync mechanism TBD).

---

## Node join flow

**Q**: How does a new VPS node join an existing cluster?

**A**: New node onboarding experience with two paths:

**Path A — Join existing cluster**:
1. On new VPS: onboarding prompt "connect to existing cluster"
2. Enter the cluster join path/URL (generated from the cluster dashboard)
3. Log in as a super admin of that cluster
4. Enter a one-time token (generated in the cluster dashboard)
5. Node joins the cluster

**Path B — Create new cluster**:
1. Provide a database connection string
2. If DB already belongs to a cluster: warned, must authenticate as super admin + one-time token to attach
3. If DB is new/unclaimed: prompted to create the first super admin → new cluster bootstrapped

---

## Node removal / draining

**Q**: When removing a node from the cluster, is it graceful or immediate?

**A**: Both — graceful default with force option:
- **Graceful**: LB checks cluster capacity across remaining nodes. If all services can be migrated, it drains the node (migrate services one by one). If capacity is insufficient, warns admin with options (adjust limits, kill lower-priority services first)
- **Force**: immediate shutdown, containers stopped, node marked offline (data loss risk for non-migratable volumes — warning shown)

---

## Preview environment lifetime

**Q**: When are preview environments cleaned up?

**A**: Both PR close AND inactivity timeout — configurable per project. Additional features:
- **Max open PR previews cap**: configurable per project. When the cap is reached and a new PR arrives, use a "least recently accessed" eviction policy
- **Wake-on-access**: if a user tries to access an evicted preview, the platform shows a beautiful loading screen while it spins the preview back up (close another preview if needed to make room)
- Configurable inactivity TTL (e.g. 7 days no traffic → auto-close)
