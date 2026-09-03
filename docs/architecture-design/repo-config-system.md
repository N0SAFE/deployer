# Config-File-in-Repo System (GitOps-style, DB-truth)

> **Date:** 2026-08-06
> **Status:** Proposed — full design spec (SC2), no implementation
> **Scope:** `deployer.yaml` manifest + overlays, Zod schema, 5 validation gates, materialization, drift, sync, pinning, secrets, preview, axioms
> **Branch:** n/a (docs only)

## 1. Positioning

The manifest is **`deployer.yaml`** — deliberately **not** compose-reuse as a format, but the loader **reuses `compose-parser`'s include/extends/interpolation machinery** as `loadYamlTree`. Base file + folder-per-env overlays. The file is a **proposal**; the DB is the SSOT (System C).

## 2. Manifest schema (`deployer.yaml`)

Zod manifest schema (version `1.0.0`; `superRefine` enforces acyclic `dependsOn`):

```text
ManifestSchema {
  version:      semver string (min 1)
  source:       string (github|upload|custom)
  defaults:     { replicas, strategy, region, healthGate … }   // optional
  services:     Record<name, ServiceSchema>
  preview:      PreviewSchema | optional
}
ServiceSchema {
  name, source, build, imagePin:
      { tag } | { digest } | { git }                     // pinning policy §7
  port, replicas, strategy,
  healthGate:   "strict" | "warn" | "ignore",
  startupMode:  "before" | "parallel" | "after",
  healthCheck:  { path, interval },
  dependsOn:    Array<{ service, condition:
                     "service_started" | "service_healthy"
                     | "service_completed_successfully",
                   required?: bool, shared?: bool /* A58 */ }>,
  environment:  Record<string,string>,
  resources, ingress, secretsRefs: Array<string>
}
PreviewSchema {
  enabled, branchPattern, ttlDays, autoDelete, maxConcurrent,
  subdomainTemplate /* A103 */, sharedDependencies /* A58 */
}
```

## 3. YAML examples

**Base** (`deployer.yaml`):

```yaml
version: "1.0.0"
project: deployer
source: github
defaults:
  replicas: 1
  strategy: rolling
  healthGate: strict
services:
  web:
    source: github
    build: Dockerfile.web
    imagePin: { tag: "v1.4.2" }
    port: 3000
    replicas: 2
    startupMode: after
    healthCheck: { path: /health, interval: 30 }
    dependsOn:
      - { service: api, condition: service_healthy, required: true }
  api:
    source: github
    build: Dockerfile.api
    imagePin: { tag: "v1.4.2" }
    port: 3001
    dependsOn:
      - { service: postgres, condition: service_healthy, required: true, shared: true }
      - { service: redis, condition: service_started, required: false }
preview:
  enabled: true
  branchPattern: "feature/*"
  ttlDays: 7
  autoDelete: true
  maxConcurrent: 3
  subdomainTemplate: "{branch}-{service}"
  sharedDependencies: [postgres, redis]
```

**Overlay** (`environments/production/deployer.yaml` — merged over base):

```yaml
version: "1.0.0"
source: include        # loadYamlTree include/extends/interpolation
overlay: merge
services:
  web:
    imagePin: { digest: "sha256:9f86d081884c7d65…" }   # promote → digest in DB
    replicas: 4
    healthGate: strict
    environment:
      LOG_LEVEL: info
  api:
    imagePin: { digest: "sha256:…" }
    healthGate: strict
```

## 4. Five validation gates

| Gate | Where | Mechanism |
|---|---|---|
| 1 — PR CI | repo CI | lint + schema check on PR |
| 2 — Webhook | API boundary | HMAC + idempotency (existing webhook world) |
| 3 — Zod safeParse | git boundary | **authoritative** — `manifestSchema.safeParse` on the loaded tree |
| 4 — Semantic | materialization | cross-field (acyclic deps, port conflicts, `dependsOn` targets exist) |
| 5 — Approval (A76) | promotion path | approval step for env-to-env promotion / production |

## 5. Materialization & truth-direction

**RECOMMENDED: repo-as-proposal → DB materialization** (preserves T274). On validated manifest:

- **Upserts** `services`, `environments`, `environment_services`, `environment_variables`, `service_dependencies`.
- **Generates** `github_deployment_rules` (fixing the zero-consumer dead table).
- **Writes** new `deployer_manifest_refs` and `deployer_sync_runs` (audit trail).
- **Conflict rule:** manifest is authoritative for *declared* fields; DB wins for runtime-only state.
- **Deployments** stay append-only and immutable.
- Open: digest write-back direction (§9).

## 6. Drift & sync

- **Drift — 3 levels:** config (file vs DB declared fields) · runtime (DB vs actual Swarm/Traefik state) · version (pinned vs running image).
- **Default: report-only**, no self-heal (drift = diff report). `selfHeal` opt-in.
- **Sync loop:** webhook push → ~60s reconciler → manual trigger. `DriftReconciliationService` (currently **unwired**) is the execution home.

## 7. Version pinning policy

> **"Tags are promotion hazards, digests are promotion artifacts."**

- Author in **tag/git**; on promote, resolve to **digest in DB**; promotion = **pointer move**; rollback = **re-point**. A/C/E deliver this first-class; this is the P1 artifact-promotion pattern (F4).

## 8. Secrets

**Refs only** — never values: `{org}/{project}/{env}/{name}`. Secrets leave DB only as references (this also answers the B/D concern). Mapping to the missing secrets management (GAP, A-new-13).

## 9. Preview integration

Per-PR materialization: manifest `preview` block → DB preview row from **rendered overlay** → naming via `PreviewNamingService` (pr/branch/branch_hash, A103) → `subdomainTemplate` → TTL + `maxConcurrent` → A58 `sharedDependencies` → full teardown (F5) → artifact promotion on merge (F4). Fixes F1 (serviceId), F2 (rules generation), F3 (config from DB).

## 10. Axiom impact (manifest-scoped proposals M1–M6)

The manifest system introduces six manifest-scoped proposals (**M1–M6**), labelled to avoid colliding with the 15 axiom proposals in `deployment-axiom-mapping.md` (A-new-1..15):

- **M1** — authored-in-repo / owned-by-DB truth split (maps to contradiction C9, T274 vs A67)
- **M2** — authoritative Zod validation at the git boundary (counterpart: A-new-7)
- **M3** — drift report-only default (counterpart: A-new-8)
- **M4** — tag→digest pinning (counterpart: A-new-9)
- **M5** — secrets refs-only (counterpart: A-new-13)
- **M6** — preview DB-row materialization (counterpart: A-new-15)

## 11. Open questions (see `gaps-and-open-questions.md`)

1. **Truth-direction (#1, BLOCKING)** — repo-as-proposal vs repo-as-truth.
2. UI mutation channel (how the UI edits reach the file).
3. Manifest scope (repo-wide vs per-app vs per-project).
4. Digest write-back (who resolves tag→digest and writes to repo vs DB).
5. Non-prod auto-promote policy.
