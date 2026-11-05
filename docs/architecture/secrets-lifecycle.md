# Secrets lifecycle — generated on first boot, shared by the nodes, managed from the web app

Status: **requirement accepted 2026-11-05, design proposed, not built.** Decisions are recorded in
[`docs/qa/secrets/lifecycle-2026-11-05.md`](../qa/secrets/lifecycle-2026-11-05.md); the work items are `SEC-100..SEC-105` in
[`roadmap/auth-security.md`](../audit-2026-10-25/roadmap/auth-security.md).

## 1. The rule this comes from

The application must be **self-deployable without configuration**. Environment variables are for development only and must
never tell the application how to behave: everything that decides behavior lives in configuration inside the application's
runtime (the node's local store, the cluster's shared config), edited from the app. This restates
`docs/db-first-configuration-shift.mdx` ("boot with minimal env, complete configuration in-app") and goes further: even the
secrets are not provided, they are made.

## 2. The secrets the platform has today

| Secret | Where it comes from now | What uses it | Target |
|---|---|---|---|
| **Mesh shared secret** | generated on the node's first boot and stored in `node_config.mesh_shared_secret` (with `mesh_shared_secret_updated_at`); handed to a joiner with the join grant | mesh peer tokens (`v1.`, `v2.`), the control token, `requireMesh()` | already the target; needs versioning and adoption status |
| **Platform secret** | `node_config` for system-actor claims (generated on first use); **environment variable** (`BETTER_AUTH_SECRET`, else `AUTH_SECRET`) still for the rest | Better Auth session signing, the column-encryption root key (`schema-codecs`), the ingress token derivation, system-actor claims | generated on first boot, stored in `node_config`, shared with joiners (`SEC-100`) |
| **Root secret** (`DEPLOYER_ROOT_SECRET`) | **environment variable**, falls back to the platform secret | derived keys for encrypted columns | derived from the platform secret generated above; no separate variable |

`MeshSecret` and `PlatformSecret` are Effect services (`apps/api/shared/src/core/modules/auth/orpc/secrets.ts`), so the source is
one swap point. `MeshSecret` is provided from the node's own `NodeConfigRepository`. `PlatformSecret` still reads the
environment behind a `shortcut:` comment, and that is the first thing to remove.

## 3. Target model

1. **Created on first boot.** The first node of a cluster generates the platform secret with the same code that generates the
   mesh secret (`local-initialization.service`) and persists it in its local `node_config`. Nothing is asked of the operator.
2. **Inferred to and from the other nodes.** A joining node receives the platform secret with the join grant, exactly like the mesh
   secret (the remote-join spec already pins "stores exactly what the fleet granted"); a node that learns of a newer version
   from a peer adopts it. No node is the source of truth: the secret replicates peer to peer through the signed roster, in line
   with the mesh-first principle.
3. **Versioned.** A secret has an id, a purpose, a version and the time it was rotated. A rotation is a new version that overlaps
   the old one for a grace window (the mesh lifecycle already rotates its credential with a grace window; this generalises it),
   so no node is cut off while the new version spreads.
4. **Observable.** Every node reports, per secret, the version it holds and when it adopted it, and which of its services use it.
5. **Managed from the web app.** A superAdmin sees the inventory, rotates a secret, and reveals one (risk tier `reveal`, with
   step-up, as `platform.secret:reveal` already is in the catalog).

### 3.1 What the web app shows

| | node A | node B | node C |
|---|---|---|---|
| mesh secret, v7 | v7, adopted 10:02 | v7, adopted 10:02 | **v6, not yet updated** |
| platform secret, v3 | v3 | v3 | v3 |

Per secret: its purpose, the services that use it on each node, last rotation, who rotated it, and the nodes still on an older
version (with how long, and whether they are reachable). A rotation can be paused while any node is unreachable, or forced.

### 3.2 Where the code lives

| Piece | Location |
|---|---|
| secret metadata and per-node adoption (id, purpose, version, adoptedAt, consumers); values stay local and encrypted | `node_config` / a new local `node_secrets` table, owned by the node agent |
| first-boot generation | `local-initialization.service` (next to the mesh secret) |
| hand-over to a joiner and adoption from a peer | the join grant contract and the roster gossip in the node agent |
| per-node status aggregation | fleet service, by asking each node's agent over the mesh |
| the screen | BFF screen (`secrets`), `apps/web` Settings → Secrets, behind `platform.secret:read` and `:rotate` |
| the consumers | Better Auth, the column codecs, ingress token, system-actor claims read `PlatformSecret` / `MeshSecret`, never `process.env` |

## 4. Open decisions

1. **Encryption at rest of the secrets in the node's local store.** The key that protects them has to come from somewhere that is
   not an environment variable: a key file the agent creates with restrictive permissions on its data volume at first boot is the
   proposal.
2. **Rotation of the platform secret** invalidates sessions and re-encrypts columns if the column root is derived from it: it needs
   a versioned key with decrypt-with-any-version, which is a larger change than the mesh secret's.
3. **Behavior switches that are env variables today** (`AUTHZ_MODE`, and any other `process.env` read that changes behavior) move to
   runtime config with the same treatment (`SEC-104`).

## 5. What already follows the rule (2026-11-05)

- The mesh middleware (`requireMesh`) verifies against `MeshSecret`, backed by the node's own `node_config`, not an environment
  variable.
- The boot audit's mode is a bootstrap option each app sets in code (`accessAudit`), not an environment variable.
