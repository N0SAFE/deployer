# oRPC × NestJS — all integrations in one app

A self-contained NestJS app combining every oRPC integration the docs describe:
contract-first API, NestJS controllers, Effect handlers/services, Better Auth,
MSW, OpenTelemetry, SSE streaming (RxJS pipeline), OpenAPI link and plugins.

No database, no Docker, no other workspace package. `bun install` here is all
it needs.

```bash
bun install
bun run demo     # boots the app, signs a user up, exercises every feature
bun run test     # MSW mocks + Effect service tests — no server needed
bun run dev      # real server on :3000
bun run type-check
```

## Layout (NestJS modules, repositories/services)

```
src/
  contracts/                    API surface only (no framework imports)
    planet.contract.ts  auth.contract.ts  stream.contract.ts  demo.contract.ts
    observable.ts               Observable<T> output schema (client + handler)
    errors.ts                   shared contract error map
    index.ts                    composed `contract` used by client/mocks/docs
  modules/
    planet/
      planet.module.ts          providers: { provide: Tag, useClass: Impl } ×2
      planet.controller.ts      transport: @Implement + .effect + error mapping
      repositories/planet.repository.ts
                                interface + Effect key + in-memory implementation
      services/planet.service.ts
                                interface + Effect key + implementation
      errors/planet-name-conflict.ts   Data.TaggedError
    auth/    auth.controller.ts + .module.ts
    stream/  stream.controller.ts + .module.ts
      services/log-stream.service.ts   interface + Effect key + RxJS pipeline
    demo/    demo.controller.ts + .module.ts
    docs/    docs.controller.ts + observable-json-schema.converter.ts
  effect/
    effect-layer.ts             auto-discovers providers whose token is a Context key
    runtime.ts                  ManagedRuntime bridge + AppServices union
    runtime.module.ts           imported only by the oRPC module
  orpc/
    context.ts                  AppContext + DefaultInitialContext augmentation
    require-session.ts          Better Auth middleware
    rxjs-handler.plugin.ts      Observable → AsyncIteratorObject (SSE)
    rxjs-client.ts              streamed procedures exposed as Observable<T>
    observable-to-async-iterator.ts   transport bridge used by the plugin
    async-iterator-to-observable.ts   client bridge used by the wrapper
  auth/
    auth.ts                     Better Auth instance (memory adapter)
    auth.module.ts              mounts the handler + session middleware
    session.middleware.ts       resolves the session once per request
    auth-context.ts             discriminated AuthContext + Express augmentation
    auth.token.ts               AUTH injection token
  app.module.ts   server.ts   main.ts
  client.ts   mock.ts   telemetry.ts   demo.ts
test/
  fakes/planet.repository.fake.ts   test doubles (never under src/)
  msw.test.ts                   list, typed error, SSE through MSW
  planet.service.test.ts        Effect DI without Nest/HTTP
  planet.controller.test.ts     `call()` with a hand-built Effect context
  log-stream.test.ts            RxJS pipeline + transport bridges
```

## File conventions

Following `apps/api`:

- One file per type: `repositories/planet.repository.ts` holds the interface,
  the `Context.Service` key **and** the implementation. Same for
  `services/planet.service.ts`.
- Only when a type has **multiple implementations** do they get their own
  folder: `repositories/planet/in-memory.repository.ts`,
  `repositories/planet/drizzle.repository.ts`.
- No `ports/` and no `adapters/` folders. An adapter that translates an
  external payload lives in `utils/` (pure mapping) or in a service when it
  needs dependencies.
- Implementations used only by tests live in `test/fakes/` — production
  `src/` never imports them.

## NestJS DI × Effect DI

They are not competing containers here. Each one owns a different job, with a
single bridge point.

| Concern | Owner |
|---|---|
| Construction, module boundaries, lifecycle (`onApplicationShutdown`) | **NestJS DI** |
| Replacing infrastructure (`overrideProvider(PlanetRepository)`) | **NestJS DI** |
| Business logic composition, requirements tracking, concurrency, retries | **Effect DI** |
| Supplying Effect services to handlers | **Effect** (`effect/context`) |

### The convention

Every type — repository **and** service — is declared identically: an interface
plus a `Context.Service` class that doubles as the NestJS token, plus the
implementation in the same file.

```ts
export class PlanetRepository extends Context.Service<PlanetRepository, PlanetRepositoryShape>()(
  "planet/PlanetRepository",
) {}

export class PlanetService extends Context.Service<PlanetService, PlanetServiceShape>()(
  "planet/PlanetService",
) {}
```

Both are registered the same way, in the module that consumes them:

```ts
// planet.module.ts — the entire wiring
providers: [
  { provide: PlanetRepository, useClass: InMemoryPlanetRepository },
  { provide: PlanetService, useClass: PlanetServiceImpl },
]
```

No exports: `PlanetController` is the only consumer and it lives in the same
module. `EffectRuntime` scans the Nest container at boot (`DiscoveryService`)
and, for every provider whose token is a `Context.Service` key, merges
`Layer.succeed(token, provider.instance)`. `Context.isKey()` is the check, so
there is no decorator, no layer token, no `forRoot`, no composition-root wiring.

Adding a new Effect service is therefore:

1. declare the port (`interface` + `Context.Service`),
2. provide it normally under that token, in the module that needs it,
3. add it to the `AppServices` union in `effect/runtime.ts` (one line, so
   `context['effect/context']` stays typed).

The runtime is still built **once**: `EffectRuntime.onApplicationBootstrap`
creates the `ManagedRuntime`, `runtime.context()` is cached and injected per
request as `'effect/context'`, and `runtime.dispose()` runs in
`onApplicationShutdown`. `EffectRuntimeModule` is imported by its only consumer
(the oRPC module), not made global.

Trade-off to be aware of: the Effect context is app-wide, so every registered
service is resolvable from every handler. NestJS module scoping still governs
*construction* and override testing; if you need per-module Effect isolation,
build one ManagedRuntime per module instead.

`PlanetService` is an `@Injectable()` whose methods return lazy `Effect`s with
requirements (`PlanetRepository`). Controllers have **no constructor and no
`@Inject`**: they yield services from `effect/context` with `.effect(...)`, and
the ManagedRuntime satisfies the requirements. Nothing is executed inside the
service, so calls still compose (`Effect.all`, `retry`, `timeout`) at the
boundary.

```ts
@Controller()
export class PlanetController {
  @Implement(planetContract.create)
  create() {
    return implement(planetContract.create)
      .use(requireSession)              // narrows context.auth
      .effect(function* ({ input, errors, context }) {
        const planets = yield* PlanetService;
        const planet = yield* planets.create(input).pipe(
          Effect.catchTag("PlanetNameConflict", (e) =>
            Effect.fail(errors.CONFLICT({ data: { name: e.name } })),
          ),
        );
        context.resHeaders?.set("x-created-by", context.auth.user.email);
        return planet;
      });
  }
}
```

`@orpc/effect/extensions/effect` is imported once in `app.module.ts`, which is
what adds `.effect()` to every builder. Because `.effect()` is called on the
builder after `.use(requireSession)`, the handler sees the middleware-narrowed
context — `context.auth.user` is non-null without checks or casts.

Domain errors stay domain-level: `PlanetNameConflict` is a `Data.TaggedError`,
mapped to `errors.CONFLICT(...)` in the controller with `Effect.catchTag`.

If a boundary must stay Promise-based, `runtime.runPromise(effect)` is the
escape hatch — do not scatter `Effect.runPromise` through controllers.

## Middleware-driven Better Auth

Modelled on `apps/api`:

1. `AuthModule.forRoot({ auth })` mounts `toNodeHandler(auth)` through
   `MiddlewareConsumer.forRoutes(basePath)` — no `app.use` in bootstrap.
2. `SessionMiddleware` runs on every request, calls `auth.api.getSession()`
   **once** (skipped entirely without cookie/authorization) and attaches
   `request.session` / `request.user`.
3. The oRPC context maps that result to a discriminated `AuthContext`
   (`isLoggedIn`, `session`, `user`). Public procedures can use optional auth
   (`auth.whoami`); protected ones call `.use(requireSession)`.
4. `requireSession` only checks `isLoggedIn` and throws a contract-defined
   `ORPCError("UNAUTHORIZED")`. TypeScript narrows through the union, so
   handlers read `context.auth.user.email` with no null checks.

Deliberately no global `APP_GUARD`: the existing apps need one because they
also serve non-oRPC routes; here oRPC is the only protected surface, and a
guard would answer with a Nest-shaped 401 before oRPC could emit the typed
error envelope. Session *resolution* is middleware; *enforcement* is the oRPC
middleware.

## Streaming: native RxJS transport

An Observable crosses the API boundary without any per-controller adapter:

| Layer | Role |
|---|---|
| **Contract** | `observable(logEventSchema)` types the output as `Observable<LogEvent>` on both sides |
| **NestJS** | owns `LogStreamServiceImpl`, registered as a normal provider |
| **Effect** | `.effect(...)` resolves `LogStream` from `effect/context` and returns the Observable |
| **Server plugin** | `RxJSHandlerPlugin` converts Observable → `AsyncIteratorObject` right before the codec encodes SSE |
| **Client** | `createRxJSClient` exposes streamed procedures as cold `Observable<T>` and converts the decoded SSE iterator on subscribe |

```ts
// contract
stream: oc
  .input(z.object({ count: z.coerce.number().int().min(1).max(10).default(3) }))
  .output(observable(logEventSchema)),

// controller — Observable forwarded untouched
@Implement(logsContract.stream)
stream() {
  return implement(logsContract.stream).effect(function* ({ input }) {
    const logs = yield* LogStream;
    return yield* logs.stream(input); // Observable<LogEvent>
  });
}

// client — typed as Observable, not Promise<AsyncIterator>
const events = await firstValueFrom(client.logs.stream({ count: 3 }).pipe(toArray()));
```

`RxJSHandlerPlugin` uses oRPC's `clientInterceptors` on the handler, so the
conversion happens after output validation and before `encodeOutput` — the
existing SSE serializer (event metadata included) does the rest. The plugin is
registered once in `ORPCModule` and reused by the MSW `OpenAPIHandler`.

The client wrapper:
- collects streamed procedure paths from the contract once,
- returns a cold Observable (`defer`) that starts the HTTP call on subscribe,
- converts the decoded `AsyncIteratorObject` to an Observable (`unsubscribe`
  calls `iterator.return()`, aborting the HTTP stream),
- leaves non-streamed procedures untouched.

The RxJS pipeline itself: `interval → take → map → tap → timeout → finalize`.
`tap` emits OTel span events (`log.stream.event`, `log.stream.complete`,
`log.stream.closed`); `timeout` detects a stalled producer; `finalize` always
runs. `LogStreamService.stream()` accepts `{ scheduler, tickMs }` for
deterministic tests.

`ObservableJsonSchemaConverter` keeps `/openapi.json` working by documenting the
stream as an array of the item schema.

## Typed errors, end to end

Errors are declared on the contract, thrown by the middleware/handler with the
same constructor, and narrowed on the client:

```ts
// contracts/errors.ts — shared by protected procedures
export const commonErrors = {
  UNAUTHORIZED: {
    message: "Authentication required",
    data: z.object({ reason: z.string().optional() }),
  },
} as const;

// contracts/planet.contract.ts
create: oc
  .errors({ CONFLICT: { data: z.object({ name: z.string() }) } })
  .errors(commonErrors)
  ...

// orpc/require-session.ts — same map, typed constructor
osBase.errors(commonErrors).middleware(({ context, next, errors }) => {
  if (!context.auth.isLoggedIn) throw errors.UNAUTHORIZED({ data: { reason: "missing-session" } });
  return next({ context: { auth: context.auth } });
});
```

- `implement(contract).effect(...)` can only fail with `errors.X` that the
  contract declared; anything else is a TypeScript error.
- Domain errors stay Effect-level (`PlanetNameConflict`). The controller maps
  them with `Effect.catchTag` to `errors.CONFLICT`, so `Effect.Error<...>` is
  checked against the contract at the boundary.
- The client sees exactly the declared union: `isDefinedError` narrows and
  `error.data` is typed.

`test/contract-errors.test.ts` asserts this at compile time:

```ts
expectTypeOf<Effect.Error<ReturnType<PlanetServiceImpl["create"]>>>()
  .toEqualTypeOf<PlanetNameConflict>();

expectTypeOf<CodeOf<InferClientError<typeof client.planet.create>>>()
  .toEqualTypeOf<"CONFLICT" | "UNAUTHORIZED">();

// @ts-expect-error LIST declares no errors
errors.CONFLICT(...)
```

## Other integration points

- `@Implement` requires `openapi.path`; `@orpc/nest` serves the OpenAPI
  protocol, so the client is `OpenAPILink` (`origin` + optional path `url`),
  not `RPCLink`.
- `ORPCInstrumentation` installs a tracer into `@orpc/shared` (no module
  patching), so it works under Bun/ESM; the demo asserts one trace id spans the
  loopback call.
- MSW serves `new OpenAPIHandler(router)`, so mocks validate, serialize and
  stream exactly like production.
- SSE output is `eventIterator(...)`; the handler returns an async generator.

## Deliberate limits

- In-memory repository and Better Auth memory storage: restart = empty.
- MSW mocks serve procedures only; `requireSession` does not run in mocks.
- `src/main.ts` prints spans with `ConsoleSpanExporter`; swap it in
  `startTelemetry()` for OTLP in real deployments.
