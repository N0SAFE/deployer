# Web Build — Failure Modes & Fixes

Three independent failures can stop `bun --bun run build` in `apps/web`. They
surface in order, so fixing one reveals the next. All three are recorded here
because none of them produces a message that names its actual cause.

## 0. Running a bare build

`next.config.ts` throws `API_URL is not defined` unless the variable is present.
This is by design: `API_URL` is required to build the web app, and it is supplied
by the environment, never by `.env` (which only carries `NEXT_PUBLIC_API_URL`).

Supply it from one of:

| Context | Source of `API_URL` |
| --- | --- |
| CI | `env:` block in the workflow |
| Docker | `infra/docker/compose/common/web/docker-compose.config.*.yml` |
| Local | `bun run local:build` (wraps the build in `@repo/env mock`) |

So `cd apps/web && bun run build` is *expected* to fail — use `bun run local:build`
or set `API_URL` yourself. A missing `API_URL` is not a code defect.

## 0b. `turbo` never caches `api` / `web` (RESOLVED)

Two independent causes. Neither reports itself, and together they made `turbo run
build` look like it simply "does not cache".

### Cause A — the build ran under Node, so `next.config.ts` crashed

`apps/web/scripts/build.ts` spawned:

```ts
runCommand('node', ['--no-warnings', './node_modules/.bin/next', 'build', '--turbopack'], ...)
```

Every `@repo/*` package emits **Bun-flavoured CJS** — the files open with
`// @bun @bun-cjs` and an IIFE wrapper that only Bun completes. Under Node:
`require('@repo/env')` returns `{}`, so `next.config.ts` read
`envSchema.shape` off `undefined`:

```
⨯ Failed to load next.config.ts
TypeError: Cannot read properties of undefined (reading 'shape')
```

Measured directly, same file, two runtimes:

```
node require('@repo/env')  ->  0 keys
bun  require('@repo/env')  -> 36 keys
```

A task that exits non-zero is never cached, so `web#build` missed on every run
while all 17 dependency packages reported cache hits.

**Fix:** run the build under Bun — `['--bun', 'run', 'next', 'build', '--turbopack']`.
This is the same rule as the repo-wide `bun --bun run` mandate; the script had
opted out of it to chase `worker_threads` support.

### Cause B — the build wrote into its own declared inputs

`next-sitemap` regenerates `public/sitemap.xml`, `public/sitemap-0.xml` and
`public/robots.txt`, and the `build` task listed `public/**` as an input. Every
build therefore changed its own input hash, guaranteeing a permanent cache miss
even after Cause A was fixed.

**Fix:** exclude the generated files from `inputs` and declare them in `outputs`:

```json
"inputs":  ["src/**", "public/**", "!public/sitemap.xml", "!public/sitemap-0.xml", "!public/robots.txt", ...],
"outputs": ["dist/**", ".next/**", "!.next/cache/**", "public/sitemap.xml", "public/sitemap-0.xml", "public/robots.txt"]
```

The same exclusion is applied to `compile`, which shares the input shape.

### Verified

```
run 1: web:build cache miss  (executes)
run 2: web:build cache hit   >>> FULL TURBO   18/18 cached
```

### Debugging recipe

```bash
# Are hashes even stable? Identical hashes == caching CAN work.
bunx turbo run build --filter=web --dry=json | python3 -m json.tool | grep -A2 taskId

# Is a task failing? A failed task is never cached.
bunx turbo run build --filter=web --output-logs=full --log-order=stream
```

**Class check.** When a task never caches, check in this order: (1) does it exit
0; (2) does it write into its own `inputs`; (3) do hashes stay stable across runs.

## 1. `Export <name> doesn't exist in target module`

Example: `Export hasMasterTokenPlugin doesn't exist in target module`, pointing at
`packages/auth/dist/**/client/index.mjs`.

**Cause.** `pkg-build` marks a package's own name external (`@repo/auth`,
`@repo/auth/*`) so self-imports stay runtime re-exports. `bun build` then **silently
drops `export *` wildcard statements** in any module that also declares other
exports. Named re-exports survive; wildcards vanish with no warning.

In `packages/auth/src/client/plugins/index.ts` this module had two
`export * from "@repo/auth/..."` lines alongside named exports. The emitted
`dist/**/plugins/index.mjs` contained only the named ones, so `hasMasterTokenPlugin`,
`getMasterTokenEnabled` and `setDevtoolsApiKeyProvider` were missing at runtime.

**Diagnosis.** Compare the source export list against the built file:

```bash
# source
grep -n "^export" packages/auth/src/client/plugins/index.ts
# built
grep -c "export \* from" packages/auth/dist/production/esm/client/plugins/index.mjs
# then check for the specific missing symbol
grep -c hasMasterTokenPlugin packages/auth/dist/production/esm/client/plugins/index.mjs
```

**Fix.** Replace `export *` with explicit named re-exports in any module that also
has other exports, and rebuild the package. Keep the list in sync with the module
it mirrors — the compiler will not tell you when it drifts.

```bash
cd packages/auth && bun --bun run build
```

**Related trap.** A stale `dist/` can hide a source fix. `@repo/auth` resolves to
`dist/` (not `src/`), so editing source without rebuilding leaves the app importing
old code. If an export is present in source but "doesn't exist", rebuild the package
before investigating anything else.

## 2. `usePathname() in a Client Component outside of <Suspense>`

Digest `CLIENT_HOOK_DYNAMIC`. **Advisory, not a failure.** Next.js logs it per
affected route and still emits `◐ (Partial Prerender)`; the build exits 0. Read the
exit code, not the presence of the message.

**Where the read actually is.** Identical stack frames for all 22 routes resolve to
nuqs's own compiled adapter:

```
.next/server/chunks/ssr/_1bnk31l._.js  →  function k() { let a = usePathname() ... }
                                          function l() { useRouter(); usePathname(); useSearchParams() }
```

`function l` is `useNuqsNextAppRouterAdapter()` — the call that builds the context
value consumers receive from `useQueryStates`. `NuqsAdapter` wraps only its
`NavigationSpy` (`function k`) in `<Suspense>`; the provider's own read is a
*sibling* of that boundary, so nothing in application code can cover it.

**What does NOT silence it** (all four were tested and still report 22):

| Attempt | Result |
| --- | --- |
| `export const instant = false` on the dynamic-segment layouts | no effect |
| `<Suspense>` wrapping `NuqsAdapter` | no effect |
| A `'use client'` boundary *inside* `NuqsAdapter`, around consumers | no effect |
| `experimental.instantInsights.validationLevel` (`warning` / `manual-warning`) | no effect on build output |

The `instantInsights` setting tunes the **dev overlay only** — Next accepts any
value (a bogus one produces no validation error) and the build output is unchanged.

### Resolution

Fixed in-tree by `apps/web/src/utils/providers/NuqsProvider.tsx` — this app's own
nuqs adapter, mounted from the root layout instead of `nuqs/adapters/next/app`.

**The mechanism.** Next.js gates the two client URL hooks differently:

| Hook | During a `prerender-client` render |
| --- | --- |
| `usePathname()` | suspends only when `fallbackRouteParams.size > 0` — **and is reported** |
| `useSearchParams()` | suspends unconditionally — **not reported** |

Decoded from the built chunk (`.next/server/chunks/ssr/0bv3_next_dist_*.js`):

```js
case "prerender-client": {
  let d = c.fallbackRouteParams;
  d && d.size > 0 && use(makeClientHookHangingPromise(...))   // ← reports CLIENT_HOOK_DYNAMIC
}
```

Dropping the `usePathname()` read removes the diagnostic; keeping
`useSearchParams()` keeps the behaviour identical, because the search-params read
still produces the same dynamic hole — routes stay `◐ (Partial Prerender)`.

**Why `<Suspense>` could never work.** `trackAllowedDynamicAccess` only honours a
boundary it can find in the **component stack**
(`hasSuspenseRegex = /\n\s+at Suspense \(<anonymous>\)/`). The logged stacks carry
only three plain JS frames (`at W (...)`, `at r (...)`, `at k (...)`) and no React
component frames, so the regex never matches. This also explains why every
`<Suspense>` placement measured 22 → 22.

**Why `instant = false` could never work here.** The reporter for these routes is
`logDisallowedDynamicError(workStore, workStore.invalidDynamicUsageError)`
(`app-render.js`), which is ungated by `allowEmptyStaticShell`. The
`isPageAllowedToBlock` gate that reads `instant` belongs to the *separate*
`validateInstantConfigsInBuild` pass — and `NEXT_PRIVATE_DEBUG_VALIDATION=1`
prints zero lines for these routes, proving that pass never runs. (Note: an earlier
instrumentation attempt looked at `dist/esm`, but the build loads
`dist/compiled/next-server/app-page-turbo.runtime.prod.js` — the gate symbol
`isPageAllowedToBlock` is absent from `dist/esm`'s bundled runtime and present in
the compiled one.)

**Verified result:** `CLIENT_HOOK_DYNAMIC: 22 → 0`, build green, no route
reclassified (57 `◐` / 9 `○` / 2 `ƒ`), and every previously-flagged route still
emits its static shell (`.html` + `.segments`). Guarded by
`src/utils/providers/NuqsProvider.test.ts`.

## 3. `Failed to build /api/server/health/route ... took more than 60 seconds`


This is the failure that actually aborts the build. The health handler probes the
API over the network and reports reachability *now*. With `cacheComponents: true`,
Next.js tries to **prerender** it at build time, where no API exists, so the fetch
hangs until the 60s worker timeout. It retries three times, then exits 1.

**Fix.** Opt the route out of prerendering with `connection()`:

```ts
import { connection } from 'next/server'

export async function GET() {
  await connection() // prerendering stops here; runs only for a real request
  // ...
}
```

`connection()` is the Cache Components replacement for
`export const dynamic = 'force-dynamic'` — that export is now rejected outright.
Any Route Handler that performs network I/O or reads request data needs it; a
handler returning a constant (like `api/server/ping`) does not.

**Class check.** When you hit this, audit every handler under `src/app/api/**`:
`grep -rn "orpc\.\|await fetch(" src/app/api` and confirm each hit calls
`connection()`.

## 4. `Another next build process is already running`

A `.next/lock` survives a build that was killed (for example by a timeout). Check
whether a build is genuinely running before deleting it:

```bash
pgrep -af "next build"
ls -la .next/lock
```

If nothing is running, `rm .next/lock`. If a build *is* running, wait for it —
deleting the lock under a live build causes two builds to share `.next` and corrupt
the output.

## Verification

```bash
cd apps/web && bun --bun run local:build
```

Success prints `✅ Build completed successfully!`. Confirm the route modes:

- `ƒ /api/server/health` — dynamic, runtime-only (expected after the `connection()` fix)
- `○ /api/server/ping` — static
- `◐ /dashboard/**` — partial prerender

## 5. `○ /auth/signin` emitted an empty static shell (RESOLVED)

`/auth/signin` was classified `○ (Static)` but its prerendered HTML contained only
fallback markup — no form, no heading:

```
form tags:    0
input tags:   0
button tags:  0
animate-pulse: 1     ← the whole body was one hole
```

`auth/signin.html` held a single pending hole (`<!--$?--><template id="B:0">`) wrapping
**the entire `<body>`** — 1 `<div>` where `/` had 53. The committed e2e guard caught it.

### Root cause

The page was exported through the declarative-routing wrapper:

```tsx
export default AuthSignin.Route(function SignInPage() { ... })
```

`Route` delegates to `createPage`
(`packages/routing/declarative/src/page-wrappers/server.tsx`), which awaits the
request-time props **before** rendering:

```ts
async function WrappedComponent(props) {
    const rawParams = await props.params
    const rawSearchParams = await props.searchParams   // ← defers the whole page
    ...
}
```

For a route with **no dynamic segments and no search-param use** that await is pure
overhead, but under Cache Components it is a request-time read: the entire page lands
inside one Suspense hole and the static shell ships empty. Hydration then had to
rebuild the form client-side.

Two supporting reads compounded it: `SignUpLink` and `SetupGate` each called
`useSearchParams()` during render. Worth noting that a `<Suspense>` wrapper could not
have saved them — see §2 for why Next.js only honours boundaries it can find in the
component stack.

### Fix

Three changes in `apps/web/src/app/auth/signin/page.tsx`:

1. **Plain default export** instead of `AuthSignin.Route(...)`, matching the pattern
   already used by `/device` and `/(app)` — both of which render their shells.
2. **`SignUpLink`** reads the query string through `useSyncExternalStore` (empty
   server snapshot, live `location.search` on the client) instead of
   `useSearchParams()`. This is the React-sanctioned way to read a browser-only value:
   no hydration mismatch, no `setState`-inside-effect, no suspended shell.
3. **`SetupGate`** reads the same values inside its effect via a shared
   `readUrlSearchParam()` helper, so nothing suspends during render.

The now-dead `SignUpLinkFallback` and its `<Suspense>` wrapper were removed, and
`getPostSignInTarget()` was de-duplicated onto the shared helper.

### Verified

```
signin.html        31 698 → 38 440 bytes
<div> in body      1 → 21
pending holes      1 → 0
markers            Welcome Back / <form> / type="email" / Create one here  all present
```

`bun --bun run test:e2e` → **6/6 pass** (was `2 failed | 4 passed`). Route
classification unchanged, and the diagnostic count stays at 0.

## 6. `api-dev` restart loop — turbo refuses to run 27+ persistent tasks

Symptom, repeated every few seconds until the whole stack reports
`dependency failed to start: container is unhealthy`:

```
x Invalid task configuration
`-> You have 27 persistent tasks but `turbo` is configured for
    | concurrency of 10. Set `--concurrency` to at least 28 or configure
    | `"concurrency"` in `turbo.json`
```

**Cause.** `dev` is `persistent: true` for every package that defines it — 30 of
33. `bun run dev:local` is `turbo dev`, which resolves **38** of them (the api
container alone sees 27). Turbo's default concurrency is 10, and it *hard-fails*
rather than queuing when persistent tasks outnumber that limit.

**Fix:** declare concurrency in `turbo.json`.

```json
"concurrency": "40"
```

**Verified:** `turbo run dev --dry=json` → `exit=0`, `tasks=38 persistent=38`,
zero config errors.

**Related warning, harmless:** `Unable to calculate transitive closures: Workspace
'packages/infrastructure/logger' not found in lockfile.` The lockfile *does* reference it
(2 occurrences — identical to `packages/config/env`, `errors` and `type-guards`,
which do not warn). It appears only in the `doc` container, whose scope excludes
that package, so turbo cannot compute a closure through a workspace it did not
load. No action needed; it is noise, not a missing dependency.

## 7. `api` build hung forever on the `compile.ts` boot check (RESOLVED)

The build printed its success line and then never returned:

```
✅ compile: api feature graph assembled and closed cleanly
   ...and then nothing, forever.
```

**Cause.** `apps/api/src/compile.ts` booted the real Nest graph, called
`app.close()`, logged success — and had **no explicit exit**:

```ts
await app.close();
console.log("✅ compile: api feature graph assembled and closed cleanly");
}   // ← falls off the end; any surviving handle keeps the loop alive
```

`close()` releases Nest's own resources, but booting the full graph leaves other
handles open (mesh dispatchers, the supervisor, provider timers) that the shutdown
hooks do not cover. Node then waits on an event loop that never drains.

That is not cosmetic: `scripts/build.ts` awaits the child's **`'exit'`** event, so
the promise never settled and `build` never returned — CI blocked until the job
itself timed out, with nothing pointing at the real cause.

**Measured**, same command, before and after:

```
before:  NODE_ENV=test bun --bun dist/compile.js   exit=124 (timeout) after 45s
after :  NODE_ENV=test bun --bun dist/compile.js   exit=0            in 3s
```

**Fix:** end the check with `process.exit(0)` — reaching that line *is* the pass
condition, so zero is correct. Separately, `runCompileCheck` now carries a 120s
timeout that `SIGKILL`s the child and rejects with a message naming this failure
mode, so a future regression reports itself instead of hanging.

**Class check.** Any script that boots an application and relies on natural exit
needs an explicit `process.exit(code)`. "Shut down cleanly" is not the same as
"the process ended", and only the second one resolves a parent's `'exit'` listener.

**Class check.** Any page exported via `.Route()` on a route with no dynamic segments
pays this cost. Prefer a plain default export there; reach for `.Route()` only when the
page genuinely needs parsed `params` / `searchParams` on the server.

