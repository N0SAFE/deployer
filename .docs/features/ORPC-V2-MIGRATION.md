# ORPC v2 Migration & Transport Plugins

This project runs **oRPC v2** (`2.0.0-beta.40`). v2 currently ships under the npm
`beta` dist-tag — a plain `latest` install still resolves to v1, so every
`@orpc/*` dependency is pinned explicitly in the root `catalogs.orpc` block.

## Package map changes

| v1 | v2 |
| --- | --- |
| `@orpc/openapi-client` | merged into `@orpc/openapi` (`@orpc/openapi/fetch`) |
| `@orpc/nest` (re-exported builder + errors) | `implement` / `ORPCError` / `onError` now come from `@orpc/server` |
| — | `@orpc/node` added (Node-only plugins, e.g. batch response compression) |

## Breaking changes encountered

### Routing moved to metadata

`~orpc.route` no longer exists. Routing lives in `meta['~openapi']`, produced by
`.meta(openapi({ method, path, ... }))`. `HTTPMethod`, `HTTPPath` and `Route` were
removed from `@orpc/contract` and are re-declared in
`packages/transport/orpc/src/types/types.ts` on top of `OpenAPIMeta`.

This repo's own builder API (`.method()`, `.path()`, `.tags()`, `.summary()`) is
unchanged — it is a fluent wrapper, and only its internals changed.

### Schemas became arrays

`~orpc.inputSchema` / `outputSchema` are now `inputSchemas` / `outputSchemas`
because `.input()` / `.output()` stack rather than replace. This repo applies one
of each, so index `0` is the schema. Read them through
`getProcedureInputSchema()` / `getProcedureOutputSchema()` rather than by hand.

### Contract shape readers

`getProcedureRoute()` reads `meta['~openapi']` and is typed as `OpenAPIMeta`. Use
it instead of indexing `meta` directly — `meta` is typed loosely, so direct
indexing widens the result to `unknown`.

### Plugin contract (`init` returns options)

`StandardLinkPlugin.init(options)` must **return** the transformed options; it no
longer mutates in place. Plugins also need a unique `name`, and ordering is
expressed with `before` / `after` name arrays instead of a numeric `order`.

### Renames that compile silently

These still type-check but change behaviour, so they were the highest-risk part
of the upgrade:

- `clientInterceptors` → `transportInterceptors` **on links** (the handler-side
  `clientInterceptors` still exists, unchanged).
- `sendResponseInterceptors` was removed from the handler config. It is not on
  `ORPCModuleConfig`, and excess-property checking does not fire on that literal,
  so nothing flagged it. The equivalent is `interceptors` (post-routing,
  pre-error-handler). Left unmigrated, every Nest `HttpException` and mesh
  domain error silently degraded to a generic 500.
- `rootInterceptors` → `routingInterceptors`.
- `status` was removed from `ORPCError` — map codes to HTTP statuses with
  `errorStatusMap` on the handler.

### `url` split into `origin` + `url`

`RPCLink` / `OpenAPILink` no longer take a full base URL as `url`. `origin` is the
base URL (prepended to every request), and `url` is a path-only prefix typed as
`/${string}`. Passing a full URL to `url` now fails the codec's path check.

### Wire format changed

A v1 client cannot talk to a v2 server in either direction. Server and clients
must be upgraded together — which is why `packages/transport/orpc`,
`packages/contracts/api`, `apps/api` and `apps/web` all moved in one change set.

## Transport plugins

### Compression (enabled)

Request and response compression are both on, with a symmetric `gzip` scheme and
the default 1 KB threshold so small payloads are never inflated:

- API: `RequestCompressionHandlerPlugin` + `ResponseCompressionHandlerPlugin`
  (`apps/api/src/app.module.ts`).
- Web: `RequestCompressionLinkPlugin` only
  (`apps/web/src/lib/orpc/index.ts`).

**No client-side response plugin.** The fetch adapter already negotiates
`Accept-Encoding` and decompresses transparently; adding
`ResponseCompressionLinkPlugin` on the client would double-decompress.

**Brotli is not available.** oRPC's compression plugins expose only `gzip`,
`deflate` and `deflate-raw`, even though `CompressionStream` supports `br`.

Verified against the real `OpenAPIHandler` with a byte-counting probe: a 27,010
byte JSON response became 75 bytes on the wire (`content-encoding: gzip`, gzip
magic bytes `1f 8b` present), while the same handler without the plugin returned
27,010 bytes.

### Batching (deliberately NOT enabled)

`BatchHandlerPlugin` / `BatchLinkPlugin` exist in v2 and were wired up, then
removed after testing revealed a correctness hazard in this architecture.

`@orpc/nest` builds **one `StandardHandler` per controller method**, whose
`resolveProcedure` is hardcoded to that single procedure. A batch sub-request
re-enters the plugin pipeline via `next({ request })` and is therefore re-resolved
through that same single-procedure resolver.

Measured directly with a two-procedure harness: a batch containing requests for
procedure `A` and procedure `B`, sent to the handler for `A`, produced
`DECODE_CALLS={"A":2,"B":0}` — procedure `B` never ran, and `A` executed twice.

So batching would silently execute the **wrong procedure** for every
cross-procedure batch, which is worse than not batching at all. It is disabled on
both sides. Any future work on batching must first give `@orpc/nest` a
router-scoped handler rather than a per-procedure one.

Note also that batching is largely redundant here: Traefik terminates HTTP/2/3,
which already multiplexes requests over one connection.

## Verification

```bash
bun --bun run --filter @repo/orpc-utils type-check   # 0 errors
bun --bun run --filter @repo/orpc-utils test         # 462 passed
bun --bun run api -- type-check                      # 0 errors
bun --bun run web -- type-check                      # see caveat below
```
