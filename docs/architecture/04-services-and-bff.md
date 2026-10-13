# 04 — Services & BFF

> **Status:** canonical
> **Answers:** how `apps/api` is divided, what the BFF owns (and must not), and how
> the parts communicate with full type safety.

## 4.1 The layout

```text
apps/api/
  shared/                     @deployer/shared
    src/
      core/                   platform machinery (db, supervisors, swarm, mesh,
                              traefik, edge, lifecycle, events, git, auth)
      config/                 env, drizzle migrations, schema codecs
      auth.ts                 the Better Auth factory
      server/                 the shared Nest+oRPC bootstrap every app imports
  bff/                        @deployer/bff          ← the ONLY public edge
  services/
    svc-identity/             @deployer/svc-identity     ← users, permissions, push
    svc-project/              @deployer/svc-project      ← projects, services, domains
    svc-runtime/              @deployer/svc-runtime      ← deployments, docker, runners
    svc-fleet/                @deployer/svc-fleet        ← nodes, cluster, providers
  contracts-compose/          appContract composition, shared by bff + services
```

> **There is no `configurator` service.** The configurator UI + relay are
> **remote infrastructure** (or served by the CLI on localhost — see
> [03](./03-configurator-protocol.md) §3.1 and [12](./12-architecture-review.md)
> §12.2). Making it a platform service would be impossible on a fresh node: the
> node has no swarm and no platform yet, so nothing could host it.

Everything shared **inside** the API lives under `apps/api/`. Nothing here is
promoted to `packages/*`.

## 4.2 Why the BFF is not a proxy

A pass-through BFF is worse than no BFF: it adds a network hop and a deployment
unit while owning nothing. The BFF exists to own **the mismatch between what
services model and what the front needs**:

| The BFF owns | The services must not |
|---|---|
| **Screen-shaped reads.** A dashboard asks for "the state of the platform"; the BFF fans out to `svc-fleet` (nodes), `svc-runtime` (running deployments) and `svc-identity` (who may see it) and returns one object. | Model a "dashboard". |
| **Authorisation against the front's model.** Roles/permissions resolved once, at the edge, with the session in hand. | Parse cookies or know about sessions. |
| **Session + identity.** The only process that touches the session store. | Know what a session is. |
| **Contract composition.** The public router is assembled here from the service contracts. | Expose a public router. |
| **Shaping.** Renaming, flattening, joining, defaulting, redacting for the front. | Know about a screen's shape. |
| **Cross-service reads.** When one screen needs two services, the join happens here. | Call each other for a screen. |

### Worked example — a screen that must not be a proxy

The dashboard's "platform overview" needs: node count and health
(`svc-fleet`), how many deployments are running (`svc-runtime`), and the caller's
own permission to see each panel (`svc-identity`).

```ts
// apps/api/bff/src/modules/overview/overview.service.ts
@Injectable()
export class OverviewService {
  constructor(
    private readonly fleet: FleetClient,
    private readonly runtime: RuntimeClient,
    private readonly identity: IdentityClient,
  ) {}

  /** ONE front-facing read composed from THREE services. */
  async getOverview(actor: Actor): Promise<PlatformOverview> {
    // Fan out; each service authorises the actor for its OWN slice.
    const [nodes, deployments, permissions] = await Promise.all([
      this.fleet.listNodes({ actor }),
      this.runtime.countByState({ actor, states: ['running', 'deploying'] }),
      this.identity.permissionsFor({ actor }),
    ]);

    // The BFF owns the SHAPE the front needs. No service knows this exists.
    return {
      cluster: { nodes: nodes.total, healthy: nodes.healthy, degraded: nodes.degraded },
      deployments: { running: deployments.running, inProgress: deployments.deploying },
      panels: {
        nodes: permissions.includes('fleet.read'),
        deployments: permissions.includes('deployment.read'),
      },
    };
  }
}
```

Three calls, one screen-shaped answer, authorisation in one place. That is what
the BFF is for. Forwarding `/fleet/nodes` verbatim would give the front a
service-shaped payload and put the join in the browser — the failure mode this
design exists to prevent.

## 4.3 Service boundaries

Each service owns **entities and their tables**, not "a slice of URLs".

| Service | Owns (entities) | Owns (tables) |
|---|---|---|
| `svc-identity` | Permission, PlatformRole, Push subscription, User preferences | `permissions`, `push_*`, `user_preferences` |
| `svc-project` | Project, Service, Domain, Environment | `projects`, `services`, `domains`, `environments` |
| `svc-runtime` | Deployment, Container, Image, Volume, Network, Runner | `deployments`, `docker_*`, `runners` |
| `svc-fleet` | Node, Cluster, Provider, ProviderSchema, Reachability | `cluster_nodes`, `providers`, `reachability_*` |
| **(the BFF)** | Better Auth's `user` / `session` / `account` / `verification` | `auth_*` |

**Rule:** a table has exactly one owning service. Another service that needs it
calls the owner. No shared table writes across services — ever.

### The two deliberate single-writer exceptions

Most tables are owned by a domain service. Two are not, and burying that would be
worse than stating it:

| Table group | Sole writer | Why not a service |
|---|---|---|
| `auth_*` (Better Auth) | **the BFF** | session validation happens on **every** request. A network hop to `svc-identity` per request would make identity a hard dependency of all traffic and add latency to every call. The BFF validates locally with the shared auth factory; `svc-identity` owns everything *after* identity (permissions, roles, preferences) and reads the actor from the forwarded claim. |
| `node_config` (local SQLite) | **the CLI** | it is a local file, and the component that must answer when nothing is running is the CLI ([01](./01-lifecycle-and-ownership.md) §1.3). Every other process reads it. |

### Same database, service-owned tables (and the exit path)

All services share **one** Postgres today. That is deliberate, not an oversight:

- foreign keys are allowed **within** an owner's tables;
- a cross-service reference is an **ID plus a validation call**, never a FK — so
  an owner can later move its tables to its own database without a migration
  that spans owners;
- no cross-service `JOIN`. If a screen needs two owners' data, the **BFF** joins
  in code ([04.2](#42-why-the-bff-is-not-a-proxy)).

The exit path is therefore real: extract an owner's tables, delete its ID
validation call, and it runs on its own store. Nothing else changes.

## 4.4 Contracts are the seam

Contracts stay in `packages/contracts/api/modules/<domain>/` (unchanged). They are
the only thing every app and the web client share.

```text
packages/contracts/api/modules/
  user/        →  svc-identity implements
  project/     →  svc-project implements
  deployment/  →  svc-runtime implements
  docker/      →  svc-runtime implements
  cluster/     →  svc-fleet implements
  nodes/       →  svc-fleet implements
  ...
```

A service implements **its own** contract with `@Implement`, exactly as a module
controller does today. The BFF owns the public router assembled from those same
contracts, so **public URLs do not change** and `apps/web` keeps working.

## 4.5 How the BFF calls a service

Typed oRPC client per service, over the internal network. Never a blind byte
proxy: the client is generated from the service's contract, so a schema change is
a compile error at the caller.

```ts
// apps/api/bff/src/clients/client.module.ts
export const FLEET_CLIENT = Symbol('FLEET_CLIENT');

@Module({
  providers: [
    {
      provide: FLEET_CLIENT,
      useFactory: (env: EnvService) =>
        createORPCClient<ContractRouterClient<typeof fleetContract>>(
          new RPCLink({ url: `${env.serviceUrl('svc-fleet')}/rpc` }),
        ),
      inject: [EnvService],
    },
  ],
  exports: [FLEET_CLIENT],
})
export class ClientModule {}
```

`env.serviceUrl('svc-fleet')` resolves through **internal service-name DNS**
(see [06](./06-networking-and-dns.md)) — no loopback hostname, no hardcoded URL.

## 4.6 Authentication across the boundary

- The **BFF** parses the cookie, resolves the session, and derives an `Actor`.
- It forwards the actor as an explicit, signed claim; services **never** parse
  cookies.
- A service authorises the actor against **its own** rules (it owns the data).
- Service-to-service calls made *by the BFF* carry the same actor; calls made by
  a service carry a service token plus the actor it was given.

No service holds a session store, and no service trusts the network for identity.

## 4.7 What happens to the monolith

`apps/api/src/**` is emptied by the split. Every file is either:

- **moved** into `shared/` (platform machinery — done: 868 imports rewired,
  type-check green), or
- **recreated** as an entity-first service/bff module (the user's explicit
  requirement: *recreate*, do not relocate), or
- **deleted** (`apps/setup`, the orchestrator, the `*.deployer.localhost` naming).

There is no transitional dual-mount. A module is either served by the BFF from a
service, or it does not exist.
