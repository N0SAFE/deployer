# Mesh Orchestration Startup Model

## Summary

The app uses a **required setup gate** on first boot, then a **mesh orchestration layer** to bootstrap and reconnect the runtime mesh on every subsequent boot.

On installation, the container that will be installed should only bring up the **API container** and the **web app container**. The web app then drives the setup flow for the initial mesh/bootstrap decision.

The goal is:

- require setup before any other module becomes active
- allow the user to either **join an existing mesh** or **create a new mesh** with this server as the first node
- persist the discovered mesh node URLs in the **local database**
- on later startups, read those URLs from the local DB and pass them to the mesh so it can reconnect automatically
- keep mesh usage **observable-first**, so callers can consume the stream with RxJS operators

## First mesh authentication bootstrap

Before the setup wizard can finish the very first time, the node must authenticate itself to the mesh.

The bootstrap flow is:

1. the user starts the app and reaches the first-run mesh flow
2. the node connects to the mesh auth portal
3. the user signs in as a **superadmin** for the mesh
4. the auth portal returns the authenticated session to this node
5. the node creates a **lifetime auth usage** bound to that session
6. that lifetime auth usage is stored using a **public/private key pair**
7. future mesh control calls use that asymmetric identity to prove node trust

This means the mesh does not rely on a one-off login token after the first handshake.
It upgrades the first authenticated session into a long-lived node identity based on asymmetric encryption.

## First-run container and setup entrypoint

On first startup, the platform should not try to launch the full service graph immediately.

It should start only:

- the API container
- the web app container

This root container becomes the parent of every other runtime container that the platform creates from the mesh/bootstrap process.

The web app then presents the setup wizard. That wizard is the only allowed path forward until onboarding is complete.

### Uninstall and cleanup behavior

When uninstalling the server installation, only the **root container** should be removed manually.

All other containers that were created or started by that root container must shut down automatically by themselves.

That means:

- no orphan child containers should remain running after uninstall
- mesh-created runtime containers must be tied to the lifecycle of the root container
- the platform should treat the root container as the ownership boundary for cleanup

This keeps uninstall simple and makes the bootstrapped runtime self-managed.

## Step-by-step implementation checklist

### 1) Startup gate and container ownership

- [ ] Start only the API and web app containers on first install.
- [ ] Make the root container the ownership boundary for all runtime containers.
- [ ] Ensure every container created by the root container is tied to its lifecycle.
- [ ] On uninstall, remove only the root container.
- [ ] Verify that child containers shut down automatically when the root container is removed.
- [ ] Prevent orphan containers after uninstall or failed bootstrap.

### 2) First mesh authentication bootstrap

- [ ] Redirect first-run users to the mesh auth portal.
- [ ] Require superadmin authentication against the target mesh.
- [ ] Return the authenticated session to the node after login.
- [ ] Convert that first session into a lifetime node-auth identity.
- [ ] Store the node identity using a public/private key pair.
- [ ] Reuse the asymmetric identity for future mesh control calls and reconnects.

### 3) Setup flow: join an existing mesh

- [ ] Prompt for the target mesh node URL.
- [ ] Prompt for the display name of the local node.
- [ ] Redirect to the mesh auth portal for superadmin authentication.
- [ ] Attempt to connect using mesh-authenticated identity.
- [ ] Register the new node in the target mesh on success.
- [ ] Fetch the full mesh node URL list after registration.
- [ ] Persist the node URL snapshot in the local database.
- [ ] Use the stored URLs first on future boots.

### 4) Setup flow: create a new mesh

- [ ] Prompt the user to create a new local user.
- [ ] Assign the new user the node organizer / superadmin role.
- [ ] Prompt for a display name for the node.
- [ ] Register this server as the first member of the new mesh.
- [ ] Persist the initial node URL snapshot in the local database.
- [ ] Allow either local PostgreSQL bootstrap or connection to an existing PostgreSQL database.
- [ ] Store enough bootstrap state to reconstruct the mesh on restart.

### 5) Mesh orchestration responsibilities

- [ ] Create `MeshOrchestrationService` as the startup coordination root.
- [ ] Make orchestration wait for setup completion before proceeding.
- [ ] Wire `MeshOrchestrationService` through a `forRootAsync()` path that resolves only after setup provides the initial bootstrap data.
- [ ] Read stored bootstrap URLs from the local database.
- [ ] Feed those URLs into the mesh runtime.
- [ ] Expose orchestration readiness as an observable.
- [ ] Refresh the persisted node URL snapshot when nodes join or leave.
- [ ] Retry stored URLs in order when reconnecting after reboot.

### 6) Global database startup gate

- [ ] Stop treating the DB URL as env-only runtime truth.
- [ ] Make the global database module wait for the mesh-provided runtime DB URL.
- [ ] Use `forRootAsync()` with the mesh orchestration result as the source of the URL.
- [ ] Keep the global database module blocked until mesh orchestration has completed its own async bootstrap.
- [ ] Block every DB-dependent module until the DB connection is initialized.
- [ ] Keep the DB initialization part of the startup dependency chain.

### 7) Local bootstrap memory model

- [ ] Store setup completion state in the local database.
- [ ] Store whether the node joined a mesh or created a new one.
- [ ] Store the discovered mesh node URLs.
- [ ] Store the last successful mesh snapshot.
- [ ] Update the stored URL list whenever the mesh changes live.
- [ ] Reuse the stored URLs as the first reconnect source after restart.

### 8) Docker and local PostgreSQL bootstrap

- [ ] Generate the runtime container service definition on the fly.
- [ ] Generate the runtime Dockerfile on the fly.
- [ ] Include a small script in the generated container that checks whether the API is running.
- [ ] Make the generated container self-stop if the API never becomes reachable after the timeout or when started if the api become unreachable for to long.
- [ ] Prevent ghost containers after failed bootstrap.
- [ ] Support attaching to an existing external PostgreSQL database instead of creating a local one.

### 9) Observable-first mesh API

- [ ] Keep mesh call APIs fluent and builder-based.
- [ ] Expose the underlying `Observable` stream directly.
- [ ] Allow RxJS operators such as `map`, `filter`, `mergeMap`, `take`, `scan`, and `timeout` and all the other as well the goal should be to use the full power of RxJS for mesh stream composition.
- [ ] Keep optional aggregation on top of the observable stream.
- [ ] Ensure `observe()` returns the raw stream and `execute()` returns the aggregated result.

### 10) Module startup order and blocking chain

- [ ] Start the API and web containers first.
- [ ] Show the setup UI in the web app.
- [ ] Process onboarding through the setup module.
- [ ] Resolve bootstrap snapshot and mesh URLs in mesh orchestration.
- [ ] Start mesh core connection attempts after orchestration data is ready.
- [ ] Start the global database only after mesh orchestration has resolved the runtime DB URL through its own `forRootAsync()` step.
- [ ] Start DB-dependent modules only after the DB connection exists.
- [ ] Keep all mesh consumers and feature modules blocked until their dependencies are ready.

### 11) Async module chain

- [ ] Make the mesh orchestration module `forRootAsync()`-driven so it starts only after setup has finished and provided the startup snapshot.
- [ ] Make the global database module `forRootAsync()`-driven so it starts only after mesh orchestration has produced the runtime DB URL.
- [ ] Preserve the chain order as: `setup -> mesh -> global database -> rest of the modules`.
- [ ] Verify that each layer only exposes the data required by the next layer in the chain.

## Implementation notes

This checklist is intentionally ordered:

1. **Container ownership** first, because it defines the lifecycle boundary.
2. **First auth bootstrap** next, because mesh trust must exist before setup completes.
3. **Setup flows** next, because the user must choose join vs create.
4. **Mesh orchestration** next, because it owns runtime bootstrap recovery.
5. **Database gating** next, because DB startup must wait on mesh.
6. **Persistent bootstrap memory** next, because restart recovery depends on it.
7. **Docker self-stop behavior** next, because bootstrap containers must not become ghosts.
8. **Async module chain** next, because setup, mesh, and database must be resolved in sequence.
9. **Observable-first API** and **startup ordering** last, because they tie the runtime together.

## Core startup rule

**The global database module must wait for the mesh orchestration layer to provide the database URL at runtime.**

The database URL should **not** be treated as a fixed environment-only value for runtime startup anymore.

Instead:

1. setup completes
2. mesh orchestration resolves the startup data and mesh URL list
3. mesh returns the database URL to the global database module
4. the global database module only starts once that URL is available
5. every module that depends on the database is blocked until this completes

This makes the mesh the bootstrap source for the database connection during runtime startup.

## Required setup flow

On the first startup, setup is mandatory.

The user must choose one of two paths from the web app setup UI:

### 1) Join an existing mesh

- the user enters:
	- a node URL from the existing mesh
	- a display name for this node
- the node is redirected to the mesh auth portal
- the user authenticates as a **superadmin** of the target mesh
- the system attempts to connect to the existing mesh using that mesh-authenticated identity
- if authentication succeeds, the new node is registered into the mesh
- once the node is accepted, the mesh returns the full list of mesh node URLs
- the setup flow stores that URL snapshot in the local database
- on future boots, the orchestration layer reads the stored URLs and retries those peers first

### 2) Create a new mesh

- the user creates a new local user
	- this user gains the **superadmin** role
- the user enters a display name for the node
- the node becomes the first authenticated member of the new mesh
- the system creates a new mesh with this server as the first member
- the new node is registered as the initial mesh node
- once successful, the mesh returns the initial node list and the setup flow stores the URL snapshot locally
- if the user wants, they can also connect to an existing global PostgreSQL database instead of creating a new local one

While this is happening, the global PostgreSQL database is provisioned or attached:

- default path: create the global PostgreSQL database locally
- optional path: connect to an existing PostgreSQL database

This means the mesh bootstrapping flow and the database provisioning flow are coordinated together.

After the first successful mesh authentication, the node should reuse the lifetime asymmetric auth identity on later reconnects instead of repeating the superadmin login step.

## Bootstrap memory model

The local database acts as the bootstrap memory for the mesh.

It stores:

- whether setup has completed
- whether the node joined an existing mesh or created a new one
- the discovered mesh node URLs
- the last successful mesh snapshot
- any data needed to reconnect on restart

When the mesh is running, node join/leave changes must also update this local URL snapshot so the reboot path always starts from the latest known mesh state.

On a later restart:

1. setup checks the local DB
2. if setup already completed, it returns the stored bootstrap data
3. mesh orchestration reads that data
4. mesh attempts to reconnect to the known nodes

If the first reconnect target is down or unreachable, the orchestration layer should continue through the stored URL list until it finds a reachable node or exhausts the list.

## Module hierarchy

The intended ownership is:

### 1) Setup module

Owns the onboarding decision and persists bootstrap state.

Responsibilities:

- enforce first-start setup
- collect the user’s choice: join existing mesh or create a new one
- persist bootstrap metadata in the local DB
- expose the setup completion signal

### 2) Mesh orchestration module

Owns startup coordination and mesh bootstrap recovery.

Responsibilities:

- wait for setup completion
- read bootstrap URLs from local DB
- feed those URLs into the mesh runtime
- expose orchestration readiness as an observable
- provide the runtime source of truth for startup bootstrap

### 3) Mesh core module

Owns mesh runtime services and transport primitives.

Responsibilities:

- node topology and peer state
- topic transport and stream routing
- resource discovery
- internal request handling
- queue transition replication
- observable mesh call APIs

### 4) Global database module

Owns DB connection setup, but it must wait on mesh orchestration for the runtime URL.

Responsibilities:

- block until the mesh provides the DB URL
- initialize the runtime DB connection from that URL
- export the database connection to downstream modules

The global database module should no longer treat a plain environment variable as the final runtime source of truth for the DB URL.

Instead:

- the DB URL is discovered or confirmed by the mesh orchestration flow
- `forRootAsync()` must wait for that mesh-provided URL before initializing the global DB connection
- every module that depends on the database stays blocked until that completes

## Startup order

The intended order is:

1. **API container** and **web app container** start first
2. **Setup UI** is shown in the web app
3. **Setup module** processes the onboarding choice
4. **Mesh orchestration service** resolves the startup snapshot and node URL list
5. **Mesh core module** begins runtime connection attempts
6. **Global database module** starts only once mesh provides the runtime DB URL
7. **All DB-dependent modules** start after the DB connection exists
8. **All mesh consumers / feature modules** start after their mesh/runtime dependencies are ready

In practice, the startup gate is:

- setup must complete first
- mesh orchestration must resolve the startup snapshot
- database startup must wait for mesh to provide the DB URL
- any module depending on database or mesh remains blocked until those steps finish
- on reboot, the persisted mesh URL list is the first source used for reconnection

## Dependents and blocking chain

### Setup is the first blocker

Modules blocked by setup:

- mesh orchestration
- mesh core startup
- global database module
- all modules that depend on the database module

### Mesh orchestration is the second blocker

Modules blocked by mesh orchestration:

- global database module
- mesh core runtime startup
- any consumer that needs mesh bootstrap URLs

Mesh orchestration also owns the local mesh URL snapshot refresh behavior:

- when a node joins the mesh, the snapshot updates
- when a node leaves the mesh, the snapshot updates
- when a reconnect happens after reboot, the stored URLs are tried in order

### Global database module is the third blocker

Modules blocked by database initialization:

- project module
- service module
- deployment module
- github module
- fleet module
- domain module
- analytics module
- docker module
- permission module
- any other module that relies on DB access

## Observable-first mesh usage

The mesh API should stay fluent and observable-first.

The call flow should support:

- builder-style configuration
- stream access through `Observable`
- RxJS operators such as `map`, `filter`, `mergeMap`, `take`, `scan`, and `timeout`
- optional aggregation on top of the observable stream

The builder should not hide the stream; it should expose it.

Recommended shape:

- `call(...)` returns a builder
- `builder.observe()` returns the raw observable stream
- `builder.execute()` returns the aggregated result when needed

This keeps mesh calls composable while still supporting the current request/response semantics.

## Runtime behavior after first mesh connection

After the mesh connects for the first time:

1. mesh orchestration captures the URL snapshot of all known nodes
2. the snapshot is persisted in the local DB
3. on the next boot, mesh orchestration reads the snapshot first
4. mesh retries those URLs automatically
5. if some nodes are unavailable, the mesh keeps reconnecting through its normal retry logic

This snapshot must be kept up to date whenever nodes join or leave while the mesh is live.

## Docker and local PostgreSQL bootstrap

When the mesh is itself the first node of the system, the global PostgreSQL database should start locally as part of the bootstrap sequence.

That local DB start should use a generated Docker service flow:

- the app generates the container service definition on the fly
- the service is started like a normal container
- the app also generates a Dockerfile on the fly for that container
- that generated Dockerfile includes a small script that checks whether the API is running
- if the API has not become available after a configured timeout, the container self-stops

This avoids ghost containers that keep running even though the API bootstrap failed.

If the user chooses an existing external PostgreSQL database instead of a local one, the mesh/bootstrap flow should use that connection instead of creating a new local DB.

## Notes on the global database module

The global database module should **not** rely on a plain environment variable as the final runtime source of truth.

It should instead consume the database URL from the mesh orchestration flow.

This implies:

- `forRootAsync()` should wait for a mesh-provided runtime value, not a static env-only assumption
- the DB connection is part of the startup dependency chain
- any module importing the DB module inherits the same startup block

The blocking relationship is intentional: the database is now **mesh-provisioned at startup**, so the DB module must not race ahead of mesh orchestration.

## Related files in the current implementation

- `v3/apps/api/src/core/modules/mesh/setup/services/mesh-orchestration.service.ts` — orchestration entry point
- `v3/apps/api/src/core/modules/mesh/mesh-core.module.ts` — core mesh wiring
- `v3/apps/api/src/core/modules/mesh/services/base-mesh.service.ts` — fluent observable mesh caller
- `v3/apps/api/src/modules/setup/services/setup.service.ts` — setup state and bootstrap persistence
- `v3/docs/qa/platform-direction/mesh-data-layer.md` — earlier mesh transport and DB direction notes
