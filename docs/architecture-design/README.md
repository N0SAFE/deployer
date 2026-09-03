# Deployment Architecture Series — Index & Executive Summary

> **Date:** 2026-08-06
> **Status:** Proposed — documentation-only study, zero implementation
> **Scope:** Deployment environment hierarchy, project service interdependencies, config-file-in-repo (K8s/GitOps-style) system, single recommendation
> **Branch:** n/a (docs only)

## Executive summary

This study evaluated five architectures for (1) environment hierarchy + inter-environment dependencies, (2) per-project service dependency modeling, and (3) a config-file-in-repo system. **The recommendation is System C — "RepoProposal" (HYBRID): a repo file is a *proposal*, a webhook parses and Zod-validates it (reusing `compose-parser`), and materialization makes the **DB the single source of truth (SSOT)**.** System A "EnvGraph" (DB-first promotion DAG lattice) is the runner-up and fully compatible with C; System E "MeshOverlay" is the north-star for A58 shared-dependency support but is greenfield and highest-complexity.

**Key finding:** v3 has rich, well-specified contracts — axioms A9–12, A46–52, A56–59, A61–86, A98–105, A178–185, ORPC contracts, Zod schemas — but most runtime machinery is **unwired**: fleet services (`service-dag`, `fleet-rollout-planner`, `fleet-readiness-gate`, `fleet-rollback`, `fleet-failure-containment`, `cross-project-gate`, `drift-reconciliation`) have zero consumers; `github_deployment_rules` and `github_repository_configs` have zero consumers; `environment_promotions` and `environment_templates` are dead tables. The **preview world is disconnected**: the webhook's `serviceId` resolution is broken (`github-webhook.controller.ts:163`), naming/TTL are hardcoded, routes are DB-only and never sync to Traefik's filesystem, build trigger and health-gated deployment are missing. Preview coverage today ≈ 35–40% of the target lifecycle.

**Decision context:** DB-first (T274, in progress: local SQLite + global Postgres, DB = SSOT) is the load-bearing constraint. Any system that makes the repo file the source of truth (B "RepoTruth", D "StackNative") is **disqualified at the HARD gate**.

## How to read the series

Start with `candidate-systems.md` (the five options), then `decision-matrix.md` (the scored recommendation), then `repo-config-system.md` (the chosen config-file design). Use `deployment-axiom-mapping.md` to audit rulebook conformance, `preview-lifecycle.md` for the end-to-end trace, `deployment-architecture-features.md` for the build roadmap, and `gaps-and-open-questions.md` for what is unresolved.

| Doc | Contents | Covers | Priority |
|---|---|---|---|
| `candidate-systems.md` | 5 systems A–E, each with env hierarchy, service deps, pinning, preview, drift, pros/cons, v3 fit, truth-direction + comparison table + service-dep DAG | SC1, SC4 | Read first |
| `decision-matrix.md` | Env-hierarchy patterns, 12-criterion decision matrix, HARD gate, sensitivity, recommendation | SC3, SC6 | Read after candidates |
| `repo-config-system.md` | `deployer.yaml` schema + examples, Zod type tree, 5 validation gates, materialization, drift, sync, pinning, secrets, preview, axioms | SC2 | Core design |
| [`../model-defined-api/deployment-axiom-mapping.md`](../model-defined-api/deployment-axiom-mapping.md) | 36-row concept→axiom map, 15 axiom-change proposals, contradiction report | SC5 | Reference |
| [`../mesh/preview-lifecycle.md`](../mesh/preview-lifecycle.md) | 16-step current trace, 12-step target, sequence + state diagrams, edge cases | SC8 | Trace |
| [`../feature-status/deployment-architecture-features.md`](../feature-status/deployment-architecture-features.md) | Feature index + roadmap (W1/W2/W3) + 6 full feature specs | SC7 | Build order |
| `gaps-and-open-questions.md` | Truth-direction, UI mutation channel, digest write-back, next step | SC9 | Before deciding |
