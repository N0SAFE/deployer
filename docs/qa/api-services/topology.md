# Q&A — api-services: Topology

> **Module**: api-services (cutover)
> **Category**: topology
> **Last updated**: 2026-10-27

---

## Final runtime topology

**Q**: Which runtime topology is final: (a) tier BFF + 5 `svc-*` only, delete the monolith and the stray BFF provisioner; (b) keep the stray BFF provisioner as the only path; (c) keep the monolith?

**A**: Confirmed: single `DEPLOYER_API_TARGET=svc-bff`, drop shape A (the monolith `deployer-api` service created by `ApiServiceProvisioner`) and shape C (the mount-less `deployer-bff` created by `provision_api` / `BffServiceProvisioner`). Proceed with cutover steps 9-11 (compose default, images, `apps/setup`).

---

## Consequences recorded with the decision

- The only supported shape is the tier: `svc-bff` plus `svc-identity`, `svc-project`, `svc-fleet`, `svc-runtime`, `svc-health`.
- `apps/api` (monolith) is legacy: never edited; deleted at the end of the cutover.
- No code path may create a service named `deployer-api` or `deployer-bff`.
- `DEPLOYER_API_TARGET` is the single switch for where the platform ingress sends API traffic.

---
