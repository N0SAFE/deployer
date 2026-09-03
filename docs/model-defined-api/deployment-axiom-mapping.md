# Deployment Axiom Mapping

> **Date:** 2026-08-06
> **Status:** Proposed — conformance audit, no implementation
> **Scope:** 36-row concept→axiom map (SC5), 15 axiom-change proposals, contradiction report, rulebook conformance notes
> **Branch:** n/a (docs only)

## 36-row concept → axiom map

| # | Concept | Axiom(s) | Conformance | Evidence / notes |
|---|---|---|---|---|
| 1 | Production env mandatory | A9 | Satisfied | `environments` exists; `deploymentConfig.strategy` field |
| 2 | Preview env reserved | A11 | Satisfied | `preview_environments` table |
| 3 | Dev env reserved | A11 | Satisfied | — |
| 4 | Custom environments | A12 | Partial | no custom-env TTL; env creation partial (`recordPreviewRow` links OLDEST deployment) |
| 5 | Env inheritance/ancestry | A11/12 family | **GAP** | no ancestry FK on `environments` |
| 6 | Env promotion | A68–77 | **GAP** | `environment_promotions` **dead** |
| 7 | Env templates | A12 ext. | **GAP** | `environment_templates` **dead** |
| 8 | Per-env policy | A46–52 | Partial | **contract-only, not persisted** (contradiction C5) |
| 9 | Default env variables | A53–55 | Partial | var precedence implemented (`configuration-resolver.service.ts` L726–740) |
| 10 | Preview orchestration | A56 | Partial | preview world disconnected; no orchestrator |
| 11 | Preview granular deps | A57 | Partial | `PreviewEnvOverlayService` exists, **zero callers** |
| 12 | Preview shared deps | A58 | **GAP** | **no code**; contradiction with A19 |
| 13 | Preview enable/disable | A59 | **Contradiction** | `isActive` unwired (C7) |
| 14 | Preview naming | A103 | Partial | `PreviewNamingService` pr/branch/branch_hash; hardcoded `pr` fallback |
| 15 | Preview TTL/GC/quota | A56 ext. | **GAP** | row-only, hardcoded 168h; quota field zero-consumers |
| 16 | Preview trigger rules | A56 | **GAP** | `github_deployment_rules` **zero consumers**; `github_repository_configs.previewDeploymentEnabled` zero consumers |
| 17 | Deployment sources | A61–67 | Partial | `deployments.sourceType` github\|upload\|custom; `services.type/providerId/builderId` |
| 18 | Artifact promotion w/o rebuild | A68–72 | **GAP** | P1-pattern; only A/C/E first-class (A-new-5) |
| 19 | Rollback | A73 | Partial | `fleet-rollback` exists, **unwired** |
| 20 | Health gates | A74 | **Contradiction** | `fleet-readiness-gate` **unwired** (C8) |
| 21 | Approvals | A76 | Partial | approval gate = manifest gate #4; policy not persisted |
| 22 | Deployment strategies | A77 | Partial | no compose home in D → dual-authoring; `deploymentConfig.strategy` field |
| 23 | Dep graph acyclic | A78 | **Satisfied (code)** | cycle handling in code; manifest `superRefine acyclic` |
| 24 | Dep ordering | A78 | Partial | fleet `service-dag` (Kahn) **unwired** |
| 25 | Dep readiness | A78 ext. | **GAP** | `fleet-readiness-gate` unwired; `service_dependencies` (service_id → depends_on_service_id, is_required) present |
| 26 | Version compatibility | — | **ABSENT** | no implementation anywhere (A-new-6) |
| 27 | Failure isolation | A74/75 | **GAP** | `fleet-failure-containment` **unwired** (A-new-10) |
| 28 | Config manifest | — | **GAP** | proposed `deployer.yaml` (A-new-7) |
| 29 | Drift detection | — | **GAP** | `DriftReconciliationService` **unwired** (A-new-8) |
| 30 | Digest pinning | A68–72 | **GAP** | tag→digest policy absent (A-new-9) |
| 31 | Repo-vs-DB truth | T274 / A67 | **Contradiction** | T274 (DB-first) vs A67 webhook-sync (C9) |
| 32 | Secrets management | — | **GAP** | refs-only design (A-new-13) |
| 33 | Mesh-env linkage | A183–185 | **GAP** | no linkage table (A-new-12) |
| 34 | Cross-project deps | A19 vs A58 | **Contradiction** | A19 scope vs A58 shared deps (C1); A-new-11 |
| 35 | Env policy persistence | A46–51 | **Contradiction** | contract-only, never persisted (C5) |
| 36 | Traefik/preview subdomains | A98–105 (A103) | Partial | `subdomainTemplate` in manifest; DB-only, **never syncs Traefik FS** (C6) |

## 15 axiom-change proposals (A-new-1..15)

| # | Proposal | Rationale (corpus) |
|---|---|---|
| 1 | Env promotion | `environment_promotions` dead; promotion is a first-class pointer move |
| 2 | Env templates | `environment_templates` dead; templates needed for F14 |
| 3 | Custom-env TTL | custom envs lack TTL |
| 4 | Preview TTL/GC/quota | hardcoded 168h, row-only; quota zero-consumers |
| 5 | Artifact promotion | P1-pattern; promote-without-rebuild = pointer move |
| 6 | Version compatibility | **ABSENT** today; F12 |
| 7 | Manifest validation | `deployer.yaml` + 5 gates, Zod at git boundary |
| 8 | Drift | 3 levels, report-only default, selfHeal opt-in |
| 9 | Digest pinning | tags are hazards, digests are artifacts |
| 10 | Failure isolation | `fleet-failure-containment` unwired |
| 11 | Cross-project resolution | A19 vs A58 contradiction |
| 12 | Mesh-env linkage | no mesh↔env mapping |
| 13 | Secrets | refs-only `{org}/{project}/{env}/{name}` |
| 14 | Per-env policy persistence | A46–51 contract-only; manifest gives it a home |
| 15 | Preview DB-row materialization | preview = DB row from rendered overlay (manifest M6 counterpart); no other counterpart in the 14 |

> **Numbering note:** `repo-config-system.md` labels its six manifest-scoped proposals **M1–M6** to avoid colliding with these 15 (A-new-1..15). Counterparts: M2 (validation)→A-new-7, M3 (drift)→A-new-8, M4 (pinning)→A-new-9, M5 (secrets)→A-new-13; M1 (truth-split) maps to contradiction C9 (T274 vs A67), *not* to A-new-1 (= Env promotion); M6 (preview DB-row materialization) has no counterpart in the 14 and is added here as **A-new-15**.

## Contradiction report

| # | Axioms | Conflict | Evidence |
|---|---|---|---|
| C1 | A19 vs A58 | cross-project scope vs preview shared deps | A58 "no code"; needs A-new-11 |
| C2 | A59 vs `isActive` | enable/disable axiom vs unwired flag | `github_repository_configs.previewDeploymentEnabled` zero consumers |
| C3 | A46–51 vs contract-only | per-env policy vs never persisted | config contracts only |
| C4 | A103 vs `addPreviewRoute` | naming axiom vs DB-only route | routes never sync Traefik FS |
| C5 | A74 vs unwired fleet readiness | health axiom vs zero consumers | `fleet-readiness-gate` unwired |
| C6 | A11/12 vs no enforcement | env-type reservation vs no enforcement | no ancestry, no TTL |
| C7 | T274 vs A67 | DB-first vs webhook-sync | truth-direction (BLOCKING) |

## Rulebook conformance notes

- **Satisfied:** cycle handling (A78, in code).
- **Partial:** A17–18 (not detailed), A46–51 (contract-only), A79–86 (dep-graph policy not persisted), A103 (hardcoded `pr`).
- **GAP (unwired runtime):** env inheritance, promotion, templates, preview TTL/GC/quota, trigger rules, artifact promotion, A58, version compatibility, failure isolation, config manifest, drift, digest pinning, repo-vs-DB truth, secrets, mesh-env linkage.
- Any candidate that passes the HARD gate must close the GAP rows via the axiom proposals above **in the same change set** as the implementing feature (docs-same-change-set rule).
