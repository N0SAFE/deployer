# Q&A — Secrets: lifecycle and management

> **Module**: secrets
> **Category**: security (with integrations)
> **Last updated**: 2026-11-05
> **Design**: [`docs/architecture/secrets-lifecycle.md`](../../architecture/secrets-lifecycle.md)

---

## Environment variables

**Q**: (raised while the auth middlewares were being migrated to Effect services: `MeshSecret` and `PlatformSecret` read environment variables, and a boot-audit switch had been added as one.)

**A**: "Remember: stop using all these env variables. The application should be self-deployable without configuration. Env variables are only there for dev purposes; they should not tell behavior in the app. Everything is in config inside the app runtime." **Accepted as a rule.** Applied immediately to what was just written (mesh secret from `node_config`, audit mode as a bootstrap option); the rest is tracked as `SEC-100..SEC-105`.

---

## The Better Auth / platform secret

**Q**: Where does it come from?

**A**: "Better Auth secret should be created on first [boot], then inferred to and from the other nodes to share the same." **Accepted:** generated on the first node's first boot, stored in the node's local config, handed to joiners, adopted from peers.

---

## Managing secrets

**Q**: What must the operator be able to do?

**A**: "Secrets should be manageable from the web app, and we should see their usage in all the nodes and see where it's not yet updated." **Accepted:** an inventory with rotation and reveal (step-up), and a per-node adoption matrix with the services that use each secret.

---

## Still open

| Topic | Options | Recommendation |
|---|---|---|
| Protecting secrets at rest in the node's local store | a key file the agent creates at first boot; the platform's own key | key file with restrictive permissions on the agent's volume |
| Rotating the platform secret | version the encryption key and decrypt with any version | required before rotation is offered for this secret |
| Other behavior switches read from env (`AUTHZ_MODE`, …) | runtime config in the global platform config | `SEC-104`: inventory every `process.env` read, move behavior ones, then a lint rule |
