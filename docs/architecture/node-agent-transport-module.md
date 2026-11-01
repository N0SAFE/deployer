# Node agent transport: declarative module model

Status: **implemented** (2026-10-31). Replaces the hand-wired `startMeshTransport(app)` call with a Nest module, and turns
every mesh/node procedure into decorated metadata the module resolves.

## 1. Problem

Today the transport is assembled by hand in `main.ts` (`startMeshTransport(app)`) and in the boot harness, while the
routers are assembled by hand in `transport/mesh-transport.ts`:

- four controllers (`access`, `directory`, `relay`, `roster`) are resolved one by one and their methods called in a
  literal object;
- the node door is a provider class with `@NodeProcedure`, but its router is built by a second hand-written call;
- `startMeshTransport` owns the websocket, the unix socket, five loops and their shutdown, outside Nest's lifecycle;
- adding a procedure means editing the transport's object literal, the controller and sometimes the contract validator.

That is three places to remember for one procedure, and the Nest module graph says nothing about which class serves
which door.

## 2. Target model

One rule: **a class declares the door, a method declares the procedure; a module resolves both and starts the transport.**

```
@MeshTransport()                 // class marker: "the resolver owns this class"
@Injectable()
export class DirectoryController {
  @MeshProcedure({ door: "peer", group: "directory", contract: directory.register })
  register() { return procedure(directory.register).effect(...); }
  ...
}
```

- The class is a **Nest controller without routes**: `@Controller()` + `@MeshTransport()`, no `@Implement`. Being in
  `controllers` is what puts its methods' `R` under `assertRequirementsMet`, exactly like every other controller; the
  missing `@Implement` is what keeps Nest/oRPC from mounting an HTTP route for it. There is no request scope: a
  procedure class holds no request state.
- `@NodeProcedure(contract)` remains sugar for `@MeshProcedure({ door: "node", group: "node", contract })`.
- A procedure class can serve both doors (it would repeat the method with another decorator only if the behaviour
  differs; the same method cannot sit under two doors without a second router entry — not needed today).

## 3. Metadata

`packages/nest/mesh` (`@deployer/nest-mesh`), framework-adjacent and reusable by the runtime service:

```ts
export type MeshDoor = "peer" | "node";

export type MeshProcedureMeta = {
  readonly door: MeshDoor;
  /** The router group, e.g. `directory`, `roster`, `node`. */
  readonly group: string;
  /** The key inside the group. Defaults to the method name. */
  readonly key?: string;
  /** The contract procedure, for validation and documentation only. */
  readonly contract: unknown;
};

@MeshTransport()                       // class decorator, stores a marker
@MeshProcedure(meta)                   // method decorator, stores meta on the prototype
@NodeProcedure(contract)               // sugar for door "node", group "node"
```

The decorator stores metadata only; nothing runs at decoration time. Resolution is explicit and happens once, at
bootstrap.

## 4. Resolver

`MeshRouterResolver` (in `@deployer/nest-mesh`) is a singleton provider:

- injects `DiscoveryService`, `MetadataScanner`, `ModuleRef`, and the contract (module option);
- reads `DiscoveryService.getControllers()` wrappers whose metatype carries `@MeshTransport()`, using the instance Nest
  already created (a request-scoped class or a controller Nest did not instantiate fails the boot with its name);
- refuses a marked class that is registered as a **provider**, naming it: a provider would escape the requirement gate;
- reads the prototype metadata, calls each decorated method once, and places the returned procedure at
  `router[door][group][key]`;
- rejects duplicate `door/group/key` and a method whose returned procedure is not a procedure;
- validates every contract procedure against the union of the two routers: `peer` must contain every contract key except
  the node door, `node` must contain all of it. This replaces the current `assertRouted` with a complete check, and it
  is the runtime gate the requirement model cannot provide for providers.

Return: `{ peer: Router, node: Router, admin: Router }`. `node` is the SERVICE door (the allowlisted procedures only, see
`serviceProcedures`); `admin` is the full local router.

## 5. Module and lifecycle

`MeshTransportModule.forRoot({ contract, serviceProcedures?, gossipIntervalMs?, doorsIntervalMs?, wireguardIntervalMs?, evictionIntervalMs? })`:

- providers: `MeshRouterResolver`, `MeshTransportService`;
- `serviceProcedures` is the service door's allowlist, as `group.key` ids. Omitted, the service door is the full local
  router (the pre-split behaviour); set, it is exactly that list and an id that nothing serves fails the boot.
- `MeshTransportService implements OnApplicationBootstrap, OnModuleDestroy`:
  - **bootstrap**: resolve the routers; attach the peer websocket to the HTTP server (`HttpAdapterHost.getHttpServer()` —
    Nest builds the server before the bootstrap hook and listens after it, so the `upgrade` listener is in place before
    the port opens), bind the two local unix sockets (service 0660 with the `node` router, admin 0600 with the `admin`
    router), start the gossip/doors/wireguard/eviction loops; expose `localSocketPath` and `adminSocketPath` for tests;
  - **destroy**: stop the loops, close the websocket gateways, remove both socket files, idempotently. `onModuleDestroy`
    and not `onApplicationShutdown` on purpose: Nest closes the HTTP adapter *between* the two hooks, and
    `server.close()` never completes while the peer websocket still holds a connection, so terminating the gateways
    first is what lets the app close.
- the module is imported by the root (`NodeAgentServiceModule`), so `main.ts` no longer calls `startMeshTransport`; the
  process shutdown path is Nest's.
- the intervals come from config (`MESH_GOSSIP_INTERVAL_MS`, `MESH_DOORS_INTERVAL_MS`, `MESH_WIREGUARD_INTERVAL_MS`,
  `MESH_EVICTION_INTERVAL_MS`; defaults 5 s / 5 s / 5 s / 30 s), so the boot harness sets the fast values instead of
  passing options to a function.

## 6. File layout

```
packages/nest/mesh/                    @deployer/nest-mesh
  src/mesh-procedure.decorator.ts      MeshTransport, MeshProcedure, NodeProcedure, metadata reader
  src/mesh-router.resolver.ts          MeshRouterResolver
  src/mesh-router.resolver.spec.ts
  src/mesh-transport.module.ts         forRoot(options) (resolver + service token)
  src/index.ts

apps/api/services/node-agent/src/
  modules/mesh/controllers/access.controller.ts       (was MeshAccessController)
  modules/mesh/controllers/directory.controller.ts
  modules/mesh/controllers/relay.controller.ts
  modules/mesh/controllers/roster.controller.ts
  modules/node/node-door.controller.ts                           (already a provider; gains @MeshTransport)
  transport/mesh-transport.service.ts                 (was mesh-transport.ts; lifecycle)
  transport/mesh-transport.module.ts                  (imports @deployer/nest-mesh)
  transport/service-door.ts                           (what a service may ask: the allowlist)
  app.module.ts                                       imports MeshTransportModule.forRoot
  main.ts                                             no transport call
```

## 7. What changes for each door

| Door | Served on | Router | Decorator |
|---|---|---|---|
| peer | HTTP `/mesh/ws` (credential) | `peer` | `@MeshProcedure({ door: "peer", group, contract })` |
| service | unix socket, mode 0660 (file permissions) | `node`, filtered to `serviceProcedures` | `@NodeProcedure(contract)` or a peer procedure named in the allowlist |
| admin | unix socket, mode 0600, own volume | `admin` (peer router + every `node` procedure) | every `@MeshProcedure` the agent serves locally |

The service door is an **allowlist**, not the local router minus a few: a procedure is reachable from a service container
only by being named in `serviceProcedures` (`apps/api/services/node-agent/src/transport/service-door.ts`). What it names:
`directory.*`, `relay.call`, `access.verify`, `roster.check`, `roster.setting`, `roster.view`, `node.labels`,
`node.settings`, `node.state`, `node.status`. What it does not: `roster.credential`, `roster.rotate`, `roster.token`,
`roster.join`, `roster.block`/`unblock`, `roster.exchange` and `node.configure` — those live on the admin door only
(F-06). The node procedures keep the `nodeDoor` context guard as a second lock; the peer procedures keep their credential
interceptor at the websocket upgrade.

The admin socket's boundary is the mount, not only the mode: it lives on its own volume
(`deployer-node-agent-admin`, mounted at `/run/deployer-node-admin`) which only the operator-facing processes mount —
setup, the API, and the `fleet` tier app. A service container without that mount has no admin door at all, so a
compromised service cannot read the swarm secret, rotate it, issue itself a token, cut a member off or reconfigure the
node.

## 8. Tests

- `@deployer/nest-mesh`: decorator metadata; resolver builds `{peer,node,admin}` from two fake providers; duplicate key
  fails; missing contract procedure fails; request-scoped class fails with its name; the service door serves only the
  allowlist while the admin door serves everything; an allowlist id nothing serves fails the boot.
- node-agent: every existing boot spec must pass with the harness no longer calling `startMeshTransport`; a test asserts
  `app.get(MeshTransportService).localSocketPath` exists after `app.listen` and disappears after `app.close()`; a test
  asserts an unmarked provider is ignored and a node procedure is absent from `peer`.
- The split, proved on real sockets (`src/boot/mesh-local-only.spec.ts`): the sockets are mode 0660 and 0600; every
  operator procedure (`token`, `join`, `rotate`, `credential`, `revoke`, `block`, `unblock`, `exchange`, `configure`) is
  refused on the service door as "no procedure matched"; the admin door serves them.
- A negative test: an HTTP request to `/mesh/roster/token` is a 404 (no controller), while the websocket answers it.

## 9. Migration order

1. Add `@deployer/nest-mesh` (decorators + resolver + tests) and wire it into the workspace.
2. Convert the four controllers to `@MeshTransport()` providers, method decorators, no `@Implement`; add them to
   `MeshDomainModule.providers`; delete the controller entries.
3. Move `mesh-transport.ts` into `MeshTransportService` (+ module), delete `startMeshTransport`; update `main.ts`.
4. Update the boot harness to read the service from the app and rely on `app.close()`.
5. Switch the tests that used the HTTP mesh routes to the peer websocket; keep one 404 assertion as proof there is no
   HTTP surface.
6. Docs (`node-agent-service.md`, readiness report F-06/F-19 notes), `ROADMAP.md`.

## 10. Consequences, stated plainly

- **No HTTP surface for mesh procedures.** That was incidental and is the safer default; tests move to the websocket.
  The health controller remains.
- **The requirement gate audits them.** They are controllers, so `assertRequirementsMet` checks every method's `R` at
  the root; a missing service fails the build as `Missing<[DirectoryController, SomeService]>` (verified with a probe
  controller, then removed). The resolver's contract check adds the routing completeness the type system cannot see.
- **Provider shapes are audited too, for every module.** `createModuleContext` also checks the `R` of every service a
  provider's shape yields (Ambient — `CurrentActor`/`Correlation` — is subtracted: it is a request boundary, not a
  module). A service whose shape needs an invisible provider fails as `Missing<[ProviderName, MissingService]>`
  (verified with a probe provider, then removed). A plain Nest module must be annotated with `declareModule` claims so
  its exports are visible; the audit found and fixed `CoreDockerModule`'s missing claims.
- **Request-scoped classes are refused.** A procedure class must be a singleton; it holds no request state (it returns
  an Effect description, it does not run it).
- **The transport is now testable through the module**: intervals come from config, and the service exposes the socket
  path and a stop that Nest owns.
