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
| **Platform secret** | `node_config` for system-actor claims , Better Auth sessions, column encryption and the ingress token (generated on first use); **environment variable** (`AUTH_SECRET`, optional) only for the legacy column reader and a one-time import | Better Auth session signing, the column-encryption root key (`schema-codecs`), the ingress token derivation, system-actor claims | generated on first boot, stored in `node_config`, shared with joiners (`SEC-100`) |
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

## 6. Rotation of the platform secret (SEC-101), decided 2026-11-06

The platform secret becomes a **ring of generations**: one current value and the previous ones that are still accepted.

- **Generation = version.** The first secret is generation 1. A rotation generates a new value, makes it generation N+1 and moves
  the old one into `previous`. The generation number is what the key ring already calls a generation (`column:1`, `column:2`) and
  what Better Auth calls a secret `version`, so each consumer maps onto a mechanism it already has.
- **Sign with the current, verify with every accepted one.** System-actor claims, the ingress token, sealed columns and Better Auth
  sessions all open under any accepted generation and are written under the current one. Nothing is cut off while the new value
  spreads.
- **A previous generation is retired by an explicit act, not by a clock.** Sealed columns stay readable under it until the reseal
  has rewritten every row; the operator retires it from the Secrets screen once the inventory shows every node on the new
  generation and the reseal reports zero rows under the old one. (A time-based grace would silently make old rows unreadable.)
- **Nodes adopt from peers, nobody is the source of truth.** An agent that sees a peer with a higher generation pulls that peer's
  ring over the authenticated mesh and adopts it; a joiner receives the ring with the join. Adoption is visible per node (the
  inventory compares generations, not only fingerprints).
- **A consumer that cannot hot-swap says so.** Better Auth is built once at boot, so it picks a new generation up at the next
  restart; the inventory shows the node's stored generation, and the Better Auth restart is the one step an operator still does.
- **Who rotates:** `platform.secret:rotate` (new action, `platform-danger`, superAdmin). Retiring is `platform.secret:retire` under
  the same bundle. Both also need a passkey step-up: identity holds the proofs, so the fleet asks it as the system with a signed
  claim that names the caller's session, and fails closed if identity does not answer.

Delivery is in four steps, each shippable: the model, the consumers, the distribution between nodes, the operations and their screen.
