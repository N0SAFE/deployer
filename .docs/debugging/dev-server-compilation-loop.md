# Debugging: Dev Server Compilation Loop (Next.js 16.1.2)

> **Added**: 2026-06-12  
> **Type**: Pattern / Workaround  
> **Confidence**: Verified ✅  
> **Scope**: v3/apps/web

## Summary

The Next.js dev server can enter a perceived "infinite compilation loop" when three parallel file watchers within the Docker container detect file changes in overlapping scopes, creating a chain reaction of rebuilds.

## Context

The web container runs:
1. `@repo/ui:dev` — tsup `--watch` mode rebuilds UI components to `dist/`
2. `next dev` — webpack (via `transpilePackages`) watches all `@repo/*` packages including their `dist/` output
3. `dr:build:watch` — watches for route file changes and regenerates `routes/index.ts`

These three watchers run concurrently with no `ignored` patterns for `**/dist/**` on webpack.

## The Chain Reaction

```
User saves file on host
    ↓
Docker develop.watch syncs change to container
    ↓
@repo/ui:dev (tsup --watch) detects source change, rebuilds to dist/
    ↓
Webpack (via transpilePackages resolving @repo/ui → dist/cjs/index.js) 
    detects dist/ file changes → triggers recompilation
    ↓
dr:build:watch may detect route file changes → regenerates routes/index.ts
    ↓
Webpack detects route changes → triggers ANOTHER recompilation
    ↓
(cycle continues until a file quiescence timeout is reached)
```

## Key Facts Discovered

- **@repo/ui:dev builds ONCE** per startup (1 ESM + 1 CJS build) — 467 lines of output is just verbosity
- **next dev starts successfully** — "✓ Ready in 1612ms" confirmed in logs
- **No docker bind mounts** — only `develop.watch` sync with `**/dist/` ignored
- **No polling enabled** — `NEXT_WEBPACK_USEPOLLING=0` is falsy
- **Entrypoint restart mechanism NOT triggering** — 0 restarts in logs
- **API mesh control plane** has its own event loop (separate issue from web)

## Fix Applied

In `apps/web/next.config.ts`:

```typescript
webpack: (config, context) => {
    // Prevent webpack from watching dist/ directories inside @repo packages
    // to avoid recompile loops when package builds write to dist/
    config.watchOptions ??= {};
    if (Array.isArray(config.watchOptions.ignored)) {
      config.watchOptions.ignored.push("**/dist/**");
    } else if (typeof config.watchOptions.ignored === "string") {
      config.watchOptions.ignored = [config.watchOptions.ignored, "**/dist/**"];
    } else {
      config.watchOptions.ignored = ["**/dist/**"];
    }

    // Enable polling based on env variable being set
    if (process.env.NEXT_WEBPACK_USEPOLLING) {
      config.watchOptions = {
        ...config.watchOptions,
        poll: 500,
        aggregateTimeout: 300,
      };
    }
    return config;
},
```

## Additional Recommendations

### 1. Add `**/dist/**` to @repo/api-contracts chokidar exclusion
The `@repo/api-contracts:dev` watch mode rebuilds twice (initial + self-triggered). The chokidar watcher should exclude `dist/`:

In `packages/contracts/api/scripts/build.ts`:
```typescript
watcher = chokidar.watch(rootDir, {
  ignored: /(^|[/\\])\.|[/\\](node_modules|dist)[/\\]/,
  persistent: true,
});
```

### 2. Remove `import("@parcel/watcher")` dead code in @repo/ui build script

### 3. Separate issue: API mesh control plane event loop
`MeshControlPlaneService` publishes events that loop back to its own node ID (`759d5e0c...`). Rate limit warnings flood API logs. Needs investigation in `v3/apps/api/src/core/modules/mesh/`.

## Files Changed

- `apps/web/next.config.ts` — added `watchOptions.ignored: ["**/dist/**"]`

## Related Documentation

- `apps/doc/content/docs/dev/development-workflow.mdx`
