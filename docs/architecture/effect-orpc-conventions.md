# Writing the Effect + oRPC way (no Nest roles)

> **Status of this document.** It is the guide for the migration "stop using Nest for guards, interceptors, pipes,
> middleware, passport strategies, gateways and `@Injectable` services". It was written **before** the code changed, then
> corrected against what shipped (see §14 for what changed and why). Every section says whether the pattern is
>
> - ✅ **today** — it exists, with a file to read, and you write new code this way now; or
> - 🧭 **proposed** — it is the intended shape, it is NOT built, and it needs a decision before anyone depends on it.
>
> Nothing in a 🧭 section should be copied into code yet. The decisions that were open are recorded in §11 and in
> `docs/qa/nest-roles-migration/`.

---

## 0. The idea in one page

Nest solved "how do I attach behaviour to a class" with **decorators**: `@Injectable`, `@UseGuards`, `@UseInterceptors`,
`@UsePipes`, `@Catch`, `OnModuleInit`, `@WebSocketGateway`. The behaviour lives in metadata that the container reads at
runtime. You cannot see in a function's type what it needs, what it can fail with, or who may call it.

We replace that with **code that carries its own types**:

| Question | Nest answer (decorator) | Our answer (code) |
|---|---|---|
| What does this need? | constructor parameters, resolved by the container | `yield* Tag` — the need is in the Effect's `R` type |
| How can it fail? | `throw` anything | a tagged `domainError`, in the Effect's `E` type |
| Who may call it? | `@UseGuards(...)` on a controller | a typed `accessRequired(...)` requirement in the **controller** (target; interim: `access({ permission })` on the contract + `authzGate`) |
| What input is valid? | a pipe on the route | the zod schema on the **contract** |
| What runs around it? | an interceptor | an oRPC **middleware** (`.use`), or an Effect combinator |
| When does it start/stop? | `OnModuleInit` / `OnModuleDestroy` | `onStart` / `run` / `onStop` **in the service's shape** |
| What is "the current request"? | `REQUEST` scope, or `AsyncLocalStorage` | `CurrentActor` / `Correlation` in the Effect context |

Four building blocks cover everything. Learn these and the rest is a mapping.

```
Contract  ──────────►  Procedure  ──────────►  Effect service  ──────────►  Module
(oRPC: input/output,   procedure(contract)     Context.Service tag +        createModuleContext:
 errors, access meta)  .use(middleware)        a `live` implementation      what is provided, what is
                       .effect(function*(){})  (+ ports it depends on)      visible, what is exported
```

**What Nest still is today ✅.** A container that holds provider tokens (`{ provide: Tag, useValue: Tag.live }`), a mount
point (`@Controller` + `@Implement(contract.x)` returning a `procedure(...)`), and the host that `main.ts` creates. That is all.
There is no Nest guard, interceptor, pipe, filter, middleware, strategy or gateway left in the source (§12 enforces it). It owns **no** behaviour — no guard,
no pipe, no lifecycle logic of its own. Everything below is about keeping it that way and removing even those two uses over
time.

---

## 1. The mapping table

"Rule" is the ESLint rule that enforces it (see §12); all of them exist.

| Nest concept | Replace with | Section | Rule |
|---|---|---|---|
| `@Injectable()` service | `Context.Service` tag + `live` (+ ports) | §2 | `noInjectableService` ✅ |
| Constructor injection | `yield* Tag`, ports, `serviceOver` | §2 | — |
| `OnModuleInit`, `OnModuleDestroy`, `OnApplicationBootstrap`, `OnApplicationShutdown` | `onStart` / `run` / `onStop` in the shape + `serviceLifecycle(Tag)` | §8 | `noNestLifecycleHook` ✅ |
| Guard (`@UseGuards`, `CanActivate`, `APP_GUARD`, `AuthGuard`) | `accessRequired(...)` in the controller (interim: `access()` meta on the contract + `authzGate`); `requireAuth()` | §4 | `noNestGuard` ✅ |
| Passport strategy (`PassportStrategy`) | a credential → `Actor` resolver feeding `context.auth` | §4.3 | `noPassport` ✅ |
| Pipe (`@UsePipes`, `PipeTransform`, `ParseIntPipe`, `ValidationPipe`) | zod schema on the contract | §5 | `noNestPipe` ✅ |
| Interceptor (`@UseInterceptors`, `NestInterceptor`, `APP_INTERCEPTOR`) | oRPC middleware / Effect combinator | §6 | `noNestInterceptor` ✅ |
| Exception filter (`@Catch`, `@UseFilters`, `APP_FILTER`) and thrown `HttpException`s | tagged `domainError` + the transport's mapping | §3 | `noNestExceptionFilter` ✅ |
| Request middleware (`NestMiddleware`, `configure(consumer)`) | procedure middleware / `Ambient` context; before oRPC, a plain function on the HTTP edge (§7.3) | §7 | `noNestMiddleware` ✅ |
| `REQUEST` / `Scope.REQUEST` providers | `CurrentActor`, `Correlation`, `HttpRequest` in the Effect context | §7 | `noNestRequestScope` ✅ |
| Gateway (`@WebSocketGateway`, `@SubscribeMessage`) | an oRPC streaming procedure (Observable / event iterator) | §9 | `noNestGateway` ✅ |

---

## 2. A service: tag, shape, ports, `live`  ✅

Read `apps/api/services/fleet/src/modules/cluster/` end to end first; it is the model. Four files, four jobs.

### 2.1 Ports — what the service depends on

A **port** is a tag for a collaborator that lives elsewhere (another package, a Promise-based provider, the environment).
The service never imports the collaborator; it yields the port. That is what makes it testable and what the module graph
can check.

```ts
// cluster.ports.ts
export class SwarmClusterPort extends Context.Service<SwarmClusterPort, SwarmClusterShape>()("fleet/SwarmClusterPort") {}
export class ClusterEnvPort   extends Context.Service<ClusterEnvPort, EnvService>()("fleet/ClusterEnvPort") {}
```

The module binds a port to its real provider (`useExisting`) — see 2.4. The string key (`"fleet/…"`) is the identity: keep
it `<service>/<Name>` and unique.

### 2.2 The service — a shape, and a tag over it

The **shape** is a plain type: a record of methods, each returning an `Effect`. It is the contract of the service and the
thing a spec fakes. The **tag** is `Context.Service<Self, Shape>()("key")`.

```ts
// cluster.service.ts
export type ClusterServiceShape = {
  /** Local engine's current Swarm snapshot. */
  readonly getSnapshot: () => Effect.Effect<ClusterSnapshot, unknown, ClusterServicePorts>;
  readonly listNodes:   (includeDown: boolean) => Effect.Effect<NodeInventoryRow[], unknown, ClusterServicePorts>;
};

export class ClusterService extends Context.Service<ClusterService, Over<ClusterServiceShape, ClusterServicePorts>>()("fleet/ClusterService") {
  static readonly live = serviceOver(
    Effect.all({ swarmClusterService: SwarmClusterPort, env: ClusterEnvPort /* … */ }),
    makeClusterService,
  );
}

function makeClusterService(ports: Ports): ClusterServiceShape {
  return { getSnapshot: () => /* an Effect that uses ports.swarmClusterService */ , /* … */ };
}
```

- `makeClusterService(ports)` is an ordinary function that closes over its ports and returns the methods. No class, no
  `this`, no decorator.
- `serviceOver(deps, make)` (`@deployer/effect-core`) resolves the ports from the Effect context **each time a method runs**
  and forwards to `make`'s method. The result is a plain constant, which is why a module can provide it with `useValue`
  and why `R` of every method includes the ports (`Over<Shape, Ports>`).
- Use `serviceOver` for **stateless** services. `make` runs again on each call, so it must not hold state.

**When the service has state or a resource** (a pool, a map of subscribers, a timer), do not use `serviceOver`. Build the
shape once in a factory (`{ provide: Tag, useFactory: makeX, inject: [...] }`), keep the state in the closure, and declare
its lifetime in the shape (§8).

### 2.3 What a method may fail with

A method's error type is a union of **tagged domain errors** (§3), not `unknown` and not a thrown `Error`. (The cluster
service still says `unknown`, because it forwards failures from Promise-based collaborators; new services should be
precise.)

### 2.4 The module — where wiring is declared

```ts
// cluster.module.ts
export class ClusterModule extends createModuleContext({
  imports:     [SwarmCoreModule, EnvModule],
  controllers: [ClusterController],
  providers: [
    { provide: SwarmClusterPort, useExisting: SwarmCluster },     // a port → its real provider
    { provide: ClusterEnvPort,   useExisting: EnvService },
    { provide: ClusterService,   useValue: ClusterService.live }, // the service itself
  ],
}) {}
```

`createModuleContext` is not Nest sugar: it records, **in types**, what the module provides, what its controllers need,
and what it exports. A controller that needs a service the module neither provides nor imports is a compile error at the
root (`Missing<…>`) and, with the architecture gate, an ESLint error at the module *and* at the code that uses the service
(`bun run lint:architecture`, see `tooling/eslint/AGENTS.md`).

### 2.5 The procedure — how a service is used

```ts
@Controller()                                        // the mount point; the ONLY Nest decorators left
export class ClusterController {
  @Implement(clusterContract.listNodes)
  listNodes() {
    return procedure(clusterContract.listNodes)      // typed by the contract
      .use(requireAuth())                            // middleware (§4, §6)
      .effect(function* ({ input, context }) {
        const cluster = yield* ClusterService;       // the need is in the type
        return yield* cluster.listNodes(input.includeDown);
      });
  }
}
```

`yield* ClusterService` is the whole of "dependency injection" here. The request boundary (actor, correlation, error mapping, defect hiding) is applied by `.effect()` itself, configured once in `createOrpcModule({ boundary })`; a handler wraps nothing. An effect that outlives the request (a `liveSnapshot` tick) re-enters it with `inBoundary(context, effect)`.

### 2.6 Checklist: turning an `@Injectable` into this

1. Write the **shape** (methods → `Effect`), from what callers actually use.
2. List what the class received in its constructor; each becomes a **port** (or an existing tag).
3. Move each method body into `make…(ports)`, replacing `this.dep.x()` with the port's value and `throw` with a failed
   tagged error (§3). `async` bodies become `Effect.tryPromise` / `attempt(...)` with a typed error.
4. Add the tag + `static live`.
5. In the module: `{ provide: Tag, useValue: Tag.live }` (stateless) or `useFactory` (stateful), and bind each port.
6. Replace every `constructor(private readonly x: X)` consumer with `yield* X`.
7. If it had `OnModuleInit`/`OnModuleDestroy`, move that to §8 in the same change — never leave a half-migrated class.
8. Delete the `@Injectable` class and its Nest import. Remove its name from the app's `allowInjectable` list.
9. Port the spec to §10: fake the ports, assert on the typed failure.

---

## 3. Errors: tagged, typed, mapped once  ✅

```ts
// packages/swarm/src/errors.ts — the pattern
export class SwarmConflict extends domainError("SwarmConflict", "conflict")<{ readonly service: string }>() {
  override publicMessage() { return "That service already exists."; }   // safe to show a client
}
```

- `domainError(tag, kind)<Fields>()` builds a class that is an Effect failure (`Data.TaggedError`) with a `kind`.
- **Six kinds**, each mapped to one transport error by `mapDomainError`:

  | kind | oRPC error |
  |---|---|
  | `not_found` | `NOT_FOUND` |
  | `validation` | `BAD_REQUEST` |
  | `conflict` | `CONFLICT` |
  | `unauthorized` | `UNAUTHORIZED` |
  | `forbidden` | `FORBIDDEN` |
  | `dependency_missing` | `FAILED_DEPENDENCY` |

  The table is a `Record<ErrorKind, …>`: adding a seventh kind is a compile error until it has a row.
- The client sees `publicMessage()` (the tag unless overridden). `cause` and `publicData()` stay server-side. **Never put
  `cause` in anything a client reads.**
- **Do not `throw new Error(...)` in a service.** Fail with a tagged error: `yield* new SwarmConflict({ service })`. (The
  `effectConventions` config already bans `throw new Error` in `services/`.) A repository may throw at its own boundary,
  inside the `Effect.tryPromise` that turns it into a typed failure.
- **Where the mapping happens:** once, at the request boundary — the `.effect()` boundary for Effects, and
  `domainErrorInterceptor()` for code that *throws* a domain error (Promise-based services, middleware).
- **This replaces the exception filter.** An `ExceptionFilter` existed to turn "whatever was thrown" into a status. Typed
  failures make that a table lookup instead. The old `InternalErrorExceptionFilter` was never registered (no `APP_FILTER`, no
  `useGlobalFilters`) and has been removed; unexpected errors on oRPC routes are already captured by the host's interceptors
  (`InternalErrorInsightService`, trace id + request id), and the mesh status table lives on in
  `MESH_DOMAIN_ERROR_HTTP_STATUS`. Do not throw Nest's `HttpException`s (`NotFoundException`, …) — fail with a `domainError`.

---

## 4. Who may call it: a requirement in the controller, not guards  🔄

> **Direction changed 2026-11-05.** The declaration moves from the contract to the controller. The canonical design is
> [`access-requirements.md`](./access-requirements.md); this section summarises it and says what exists today.

### 4.1 Declare it where the handler is written (target)

```ts
procedure(serviceContract.deploy)
  .use(requireAuth())                                   // required first: a type error without it
  .use(accessRequired(Service.can("deploy")))           // permission, scope kind and id key come from the resource
  .effect(function* ({ context }) {
    context.access.service.row;                         // the proof, typed with what was checked
  });
```

- A **contract carries no access information**. A reader of the controller sees exactly what is required, and the type
  system forces it: the terminal `.effect()` needs `context.access`, which only `accessRequired`, `accessSelf`,
  `accessPublic` and `accessDeferred` produce. A boot audit refuses a mounted procedure without one.
- **Code names permissions, never roles.** Roles are data (grants); `Service.can("deploy")` is the whole vocabulary.
- Resources (`Service`, `Project`, `User`, `Node`) are plugins over ordinary Effect services, defined by the service that owns
  the data. Several requirements, either-or, lists, self-or-permission and guardrails have their own forms; when the scope is
  known only after a load, `accessDeferred(reason)` plus `Service.require(...)` in the handler.

### 4.2 What exists today (interim)

`access({ permission })` from `@deployer/auth/authz/meta` is still attached to contracts (`.meta(access(...))`, about 160
procedures in identity, fleet and project), and `procedure()` appends `authzGate`, which reads it and refuses with
`FORBIDDEN`. `AUTHZ_MODE` (`off|shadow|enforce`, default `off`) decides whether it blocks. A procedure with no declaration
is a loud event in enforce mode, not a silent allow. These are replaced by 4.1 at `AUTHZ-011`/`AUTHZ-012`; permission
names carry over unchanged.

Handlers also have composable middleware for the common shapes:

```ts
procedure(contract)
  .use(requireAuth())                                    // a session is required; narrows context.auth
  .use(requirePlatformRole(["superAdmin", "admin"]))     // interim role gate; replaced by permissions (AUTHZ-024)
  .use(requireMesh())                                    // a verified mesh peer (independent of requireAuth)
  .effect(function* ({ context }) { /* … */ });
```

Inside a handler, a check that depends on data (not only on the caller) yields the `Authz` service
(`packages/nest/effect/src/authz.ts`), so it runs in the same fiber and trace as the work it guards.

**Never** write a `CanActivate` or `@UseGuards`. There is **no** Nest guard anywhere — not even a global one: `AuthModule`
installs none (its own header says "no guard, no decorator, no request hook"), so a plain controller route requires nothing and
a probe or a public page needs no opt-out. Some comments used to describe a global `APP_GUARD` and an `@AllowAnonymous()`
decorator; both were stale and have been corrected.

### 4.3 Credentials ("strategies")  ✅ (resolution) / 🧭 (shape)

A Passport strategy answers "given this request, who is it?". Here that is **credential → `Actor`**, resolved before the
gate runs. The credentials in use today are:

- the Better Auth **session cookie** (`getSession`),
- an **API key** in `x-api-key` or `Authorization: Bearer dk_…`,
- a **mesh internal key** in `x-mesh-internal-key`.

The `Actor` is `{ kind: "user", id, role, sessionId } | { kind: "system", id }` (`@deployer/effect-core`). Write a new
credential kind as a plain function `credential → Effect<Actor, Unauthorized>` plus the middleware that puts the result in
`context.auth` — not as a class with `validate()`. 🧭 Today `authMiddleware()` does this resolution inside the oRPC context;
extracting each kind into its own small function is part of the migration, not done yet.

---

## 5. What input is valid: the contract's schema, not pipes  ✅

Validation is the contract's zod schema. oRPC parses input **before** the handler runs, so the handler receives a typed,
already-valid value and `ParseIntPipe` / `ValidationPipe` have nothing to do.

```ts
const projectOps = standard.zod(projectSchema, "project");           // builder from the entity schema
export const projectFindByIdContract = projectOps.findById().build();
```

- Use the `standard.zod` builder from `@deployer/orpc-utils` for every contract — never raw `oc.route()`.
- Coercion/transform (`"42"` → `42`, trimming, defaults) is part of the schema (`z.coerce`, `.transform`, `.default`), so it
  is documented and typed in one place.
- Data that arrives **outside** a procedure (a decoded token, a stored JSON blob, a child-process output) is parsed with
  **one** `zod/v4` schema and `safeParse`, never a chain of `typeof` checks (root `AGENTS.md` §8).

---

## 6. What runs around it: middleware, not interceptors  ✅

An interceptor wraps a call: before, after, and error. The equivalents:

**Before / context enrichment — oRPC middleware.**

```ts
os.middleware(({ context, next }) => {
  // …check or derive something…
  return next({ context: { ...context, extra } });    // narrows/extends the typed context for what follows
});
```

`requireAuth()` is the model (`apps/api/shared/src/core/modules/auth/orpc/middlewares.ts`): it throws the contract-defined
`UNAUTHORIZED` when there is no session and returns a context whose `auth` is narrowed to non-null. Compose with `.use(...)`
in the order that reads best; each middleware touches only its own context key.

**Around an Effect — Effect combinators**, not a wrapper class: `Effect.withSpan("name")`, `Effect.annotateLogs(...)`,
`Effect.timeout(...)`, `Effect.retry(...)`. They are visible in the code they affect and appear in the type.

**After / response shaping and error mapping** — the `.effect()` boundary (§3). **Logging a request** — a middleware that logs on
completion, using the Effect `Logger` (not `new Logger(Class.name)`); the current `LoggerMiddleware` is the thing being
replaced, and its safelist (`/health`, `/metrics`, `/favicon.ico`) becomes a constant of the new one.

---

## 7. "The current request": ambient context, not scopes or AsyncLocalStorage

### 7.1 `Ambient` ✅

`@deployer/effect-core` defines what a request carries: `CurrentActor`, `Correlation`, `HttpRequest`. They have **no
default**: a method that reads one carries it in `R`, and only a boundary can provide it — `.effect()` for a request,
`systemRequest` for a worker or a boot task. So "is there a request?" is never an `if`; it is a type.

This replaces `REQUEST`-scoped providers (`Scope.REQUEST`): a service stays a singleton and reads the request from the
context when a method runs.

### 7.2 Request-level middleware ✅

Four Express middlewares existed. Three were never registered (dead code, kept by `ARCH-089` pending a product decision); one was
live. All four are now **plain functions** (`apps/api/shared/src/core/middlewares/*.edge.ts`, `bff/src/clients/*.edge.ts`):

| Was | Now | Wired? |
|---|---|---|
| `LoggerMiddleware` | `accessLog()` / `accessLogEdge()` — logs when the response closes, uses `@deployer/logger` | no (as before) |
| `InternalErrorContextMiddleware` | `requestContext()` / `requestContextEdge()` — `x-request-id`, echoed on the response | no (as before) |
| `SsrAuthGuardMiddleware` | `ssrAuthRedirect(auth)` / `ssrAuthRedirectEdge(auth)` — `/manage/*` → login; the login page is exempt | no (`ARCH-089` decides if the SSR pages exist) |
| `ServiceAuthContextMiddleware` | `serviceAuthContextEdge()` — binds the CALLER's credentials for the BFF's fan-out | **yes**, `bff/src/main.ts` → `edge: [serviceAuthContextEdge()]` |

The last one keeps its `AsyncLocalStorage` for now: it has to cover the fan-out of any handler (including routes outside oRPC)
and must never reject an anonymous request, and the consumer is an oRPC *link plugin* that runs inside an outgoing `fetch`,
not an Effect. Replacing the ALS with a per-request `CallerCredentials` Effect service is the next step and needs the service
client link to read the Effect context — 🧭, not done, and not required by the rules.

### 7.3 The raw HTTP edge ✅

Things that happen **before** oRPC and are not procedures live in one place, `apps/api/shared/src/server/http-edge.ts`:

```ts
// an edge piece: a name and a way to mount a plain function
edgeUse("access-log", accessLog())                    // every route
edgeAt("better-auth", "/api/auth", toNodeHandler(a))  // a path and everything under it

mountHttpEdge(app, entries);   // called by createApiServerApp between `NestFactory.create()` and `app.init()`,
                               // so it runs before the router — where Nest's own middleware ran
```

- **The container's own edge** (`containerHttpEdge`): an app that imported `AuthModule` gets `betterAuthEdge(options)` for free —
  CORS for the trusted origins, Better Auth's handler at its `basePath`, and body parsing for every other route (Better Auth
  needs the raw body). Apps that never imported `AuthModule` get nothing.
- **An app's own edge**: `bootstrapApiServer({ ..., edge: [serviceAuthContextEdge()] })`, mounted after the container's.
- `AuthModule` no longer implements `NestModule` and has no `configure(consumer)`; `BffModule` neither.
- **Gotcha — never use `app.get(token)` to ask "is this provider here?".** Nest runs it in an exception zone that logs and calls
  `process.exit(1)` for an unknown token, so there is nothing to catch. `containerHttpEdge` reads `ModulesContainer` (a plain
  map) instead; an app without `AuthModule` boots normally.
- Better Auth's global guard **does not exist** (see §4.2): there is nothing to replace.

---

## 8. Lifecycle: declared in the shape  ✅

Nest's `OnModuleInit` / `OnModuleDestroy` do **not** appear on a service. The service states its lifetime where it states
everything else:

```ts
export type OutboxDispatcherShape = ServiceLifecycleShape & {
  readonly dispatchPending: Effect.Effect<void, OutboxFailure>;
};

export class OutboxDispatcher extends Context.Service<OutboxDispatcher, OutboxDispatcherShape>()("events/Outbox") {
  static readonly live = /* … built by a factory … */ {
    onStart: () => Effect.void,                                              // once, before serving; must complete
    run:     () => Effect.repeat(dispatchPending, Schedule.spaced("3 seconds")),   // forked; runs until interrupted
    onStop:  () => Effect.void,                                              // once, after `run` is interrupted
  };
}

// in the owning module:  providers: [..., serviceLifecycle(OutboxDispatcher)]
```

| Member | When | Failure |
|---|---|---|
| `onStart()` | once, before the app serves | **fails the boot** — it is initialisation, not a background task |
| `run()` | forked after `onStart`, runs until interrupted | owned by the runner; ends when interrupted |
| `onStop()` | once, after `run` is interrupted | **never fails shutdown** — a failure is logged |

Order is the point: on stop, `run` is interrupted and awaited **before** `onStop`, so nothing is torn down while the work
that uses it may still be running.

- `serviceLifecycle(Tag)` (`@deployer/nest-effect`) adds **one generic runner** that binds these members to Nest's hooks. There
  is no per-service adapter class, and it refuses at compile time a tag whose shape declares none of the three.
- `EffectHost` is the one place non-request Effect work starts (`run`, `fork`, `context`). A service never touches the
  runtime directly, and a spec substitutes the host with a fake that records programs instead of running them.
- Process-lifetime state (a handle to close, a background fiber for the whole process) uses the `AppLifecycle` tag
  (`@deployer/lifecycle`), provided globally by `AppLifecycleModule`.
- **Do not**: fork in a constructor, `setInterval`/`setTimeout` for background work, or start a loop from a request handler.
  Those are untracked and survive shutdown.

**Honest limits today.** The runner is still driven by Nest's init/destroy, so **cross-service start order follows Nest's
module order, not an Effect `Layer` graph**. If service B's `onStart` needs A to have started, depend on A explicitly (yield
it) and make A's `onStart` complete first; do not rely on module order. A `Layer`-scoped lifecycle (`acquireRelease`) is the
natural next step and is not used yet. About 30 files still use Nest hooks directly (`apps/setup`, `apps/api/shared`, the
fleet/identity installers): they are the migration ledger for this section.

---

## 9. Streaming: procedures, not gateways  ✅

There is no websocket gateway left in the source and none should return. Realtime is an oRPC **streaming procedure**: the
contract declares an observable output, the handler returns an `Observable`, and the transport frames it as an event
iterator (`packages/transport/orpc/src/observable`).

```ts
@Implement(clusterContract.streamSnapshot)
streamSnapshot() {
  return procedure(clusterContract.streamSnapshot)
    .use(requireAuth())
    .effect(function* ({ context }) {
      const events = yield* ClusterEventsPort;                                  // the stream hub, as a port
      return yield* attemptSync(() => events.observeSnapshot());
    });
}
```

RxJS stays as the **streaming surface**; Effect owns logic and state. A stream hub (subscriptions to Docker events, say) is
the one thing that has a lifetime *and* produces an Observable: give it `onStart`/`run`/`onStop` (§8) and expose the
Observable through its shape, instead of an `@Injectable` class with `OnModuleInit`. Auth for a stream is the same
`requireAuth()` / `access()` as any procedure, applied when the stream is opened.

---

## 10. Testing recipes  ✅

A service is a shape; a spec fakes the shape.

```ts
// a use case, over fakes
const fakeRepo: UserRepositoryShape = { find: () => Effect.succeed(null) };
const result = await Effect.runPromise(
  provideTo(UserService.live, (e) => e.pipe(Effect.provideService(UserRepository, fakeRepo))).find("u1").pipe(Effect.flip),
);
expect(result).toBeInstanceOf(UserNotFound);          // assert on the TYPED failure, not on a thrown exception
```

```ts
// a procedure, through the controller
const context = effectContext(Context.empty().pipe(Context.add(HealthService, fake)));
await callProcedure(controller.check(), {}, context);   // effectContext: @deployer/nest-effect/testing
```

- Substitute a port with `Effect.provideService`; substitute a whole service with `Context.add(Tag, fake)`.
- For lifecycle, substitute `EffectHost` with a recording fake and assert `onStart` ran, `run` was forked, `onStop` ran after
  interruption — without a runtime.
- Assert on **`_tag`/class of the failure**, never on a message string.

---

## 11. Decisions

Answered 2026-11-04 ("Approve, start"); recorded in `docs/qa/nest-roles-migration/api-design.md`.

1. **The raw HTTP edge — plain functions, one mount** (§7.3). Not replacing the HTTP host, not oRPC-plugins-only.
2. **Scope — roles + rules now, services by app.** The Nest roles are migrated and the rules are on; every remaining `@Injectable`
   (and lifecycle hook, and thrown Nest exception) sits on a per-app ledger (§12) and is migrated app by app, each in its own
   session.
3. **Still open — lifecycle on `Layer`s.** Keep the runner driven by Nest's hooks (today), or move to `Layer`-scoped
   `acquireRelease` so start order is the dependency graph. Worth deciding before the ~30 hook sites move (§8).

---

## 12. Enforcement: one ESLint rule per concept ✅

A convention that is not enforced is a suggestion. Each concept has **one rule** (plugin `deployer-effect`, in
`tooling/eslint/src/rules/`), all syntactic so they run natively under `bun lint`. A role is recognised by what it **imports**
from Nest (the decorator, the interface and the token all come from a Nest package), so it is caught however it is spelt. Each
message says what to write instead and points here.

| Rule | Flags | Message points to |
|---|---|---|
| `noInjectableService` | `@Injectable` on any class — **no exemptions** | §2 |
| `noNestLifecycleHook` | `OnModuleInit`, `OnModuleDestroy`, `OnApplicationBootstrap`, `OnApplicationShutdown`, `BeforeApplicationShutdown` | §8 |
| `noNestGuard` | `UseGuards`, `CanActivate` (`@nestjs/common`), `APP_GUARD` | §4 |
| `noPassport` | any import of `@nestjs/passport`, `passport`, `passport-*` | §4.3 |
| `noNestPipe` | `UsePipes`, `PipeTransform`, `ValidationPipe`, the `Parse*Pipe`s, `DefaultValuePipe`, `APP_PIPE` | §5 |
| `noNestInterceptor` | `UseInterceptors`, `NestInterceptor`, `CallHandler`, `APP_INTERCEPTOR` | §6 |
| `noNestExceptionFilter` | `Catch`, `ExceptionFilter`, `UseFilters`, `ArgumentsHost`, every built-in `*Exception`, `APP_FILTER`, `BaseExceptionFilter` | §3 |
| `noNestMiddleware` | `NestMiddleware`, `MiddlewareConsumer`, `NestModule` | §7 |
| `noNestRequestScope` | `Scope`, `REQUEST`, `INQUIRER`, `ContextIdFactory` | §7.1 |
| `noNestGateway` | any import of `@nestjs/websockets`, `@nestjs/platform-socket.io`, `@nestjs/platform-ws` | §9 |

### The ledger

`nestjsConfig.configs.nestRoles({ ledger: `${import.meta.dirname}/nest-roles.ledger.json` })` (also included by `effectConventions`) turns **all** the
rules on for an app. The ledger is a JSON file next to its `eslint.config.ts`: `{ "<rule>": ["src/…/file.ts", …] }` — the files
that have **not** migrated yet; each rule is switched off for exactly those files. It is the migration's to-do list:

- it is parsed with one schema (an unknown rule name is an error), and an entry whose file no longer exists **fails the config
  load** — a migrated or deleted file must leave the list, or the list stops being true;
- an empty ledger (`{}`) means the app is done: there is no escape hatch left;
- **to migrate a file: fix it, delete its entry.** Never add one for new code.

State when the rules landed (files listed, by workspace): `apps/api/shared` 112 entries, `apps/api/services/runtime` 57,
`apps/setup` 31, `apps/api/bff` 24, `fleet` 4, `identity` 4, `packages/nest/effect` 3 (the bridge itself, by design),
`node-agent` 2, `project` 1, `health` 0. Guards, pipes, interceptors, middleware, gateways and Passport were already at **zero**
everywhere. What remains is `@Injectable` services, lifecycle hooks, thrown Nest HTTP exceptions and request scope.

---

## 13. Quick reference: what to reach for

| I need to… | Write |
|---|---|
| a new use case | a shape + `make…(ports)` + tag with `static live`; provide with `useValue` |
| depend on another package's service | a **port** tag, bound with `useExisting` |
| fail | `yield* new MyDomainError({...})` (`domainError(tag, kind)`) |
| protect an endpoint | `.use(accessRequired(Service.can("deploy")))` in the controller (interim: `.meta(access({ permission }))` on the contract) |
| require a session / role / mesh peer | `.use(requireAuth())` / `.use(requirePlatformRole([...]))` / `.use(requireMesh())` |
| validate input | the contract's zod schema |
| run something around a call | oRPC middleware, or `Effect.withSpan` / `annotateLogs` / `timeout` |
| know who is calling | `yield* CurrentActor` (and `Correlation`) |
| start/stop something | `onStart` / `run` / `onStop` in the shape + `serviceLifecycle(Tag)` |
| stream to a client | a streaming procedure returning an `Observable` |
| test it | fake the ports; assert on the typed failure |

---

## 14. What changed between this guide's first draft and the code

The first draft was written from the repo's own comments and audit documents. Reading the code showed three of them were wrong,
and the migration followed the code:

1. **There was no global guard.** The draft listed "Better Auth's global `APP_GUARD`" as a Nest role to replace. `AuthModule`
   installs none; comments in `service-health.ts`, `setup.controller.ts`, `platform-health.controller.ts`, `setup-done.controller.ts`
   and `openapi-docs.controller.ts` described one (and an `@AllowAnonymous()` decorator that no longer exists). Corrected.
2. **Three of the four middlewares and the exception filter were never registered.** Nothing called `.apply(...)` or
   `useGlobalFilters`. The middlewares were converted to plain functions and kept unwired (their fate is `ARCH-089`'s, not this
   migration's); the filter, with no Nest-free hook and a duplicate in the oRPC host interceptors, was removed.
3. **The live Nest HTTP code was two `configure(consumer)` hooks**: `AuthModule` (Better Auth handler, trusted-origins CORS,
   body-parse skip) and `BffModule` (the credentials context). Both now go through `mountHttpEdge`.

One bug was found by running the tests, not by reading: `app.get(token, { strict: false })` does not throw for a missing provider —
it exits the process (§7.3). It is recorded there so nobody reintroduces it.

