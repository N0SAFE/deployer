# AGENTS.md — @repo/config-typescript

Shared TypeScript configurations.

## Rules
- Keep strict mode and modern targets unless project requirements change.
- Validate `tsgo -b` and package type-checks after changes.

## Canonical excludes — single source of truth

- The canonical list of directories to never type-check lives in
  `config/base.json` (this package), anchored at the repo root via the
  `../../../../` prefix (4 levels up from this file = repo root):
  `../../../../**/node_modules`, `../../../../**/.next`, `../../../../**/.turbo`,
  `../../../../**/dist`, `../../../../**/out`, `../../../../**/build`,
  `../../../../**/coverage`, `../../../../**/.swc`, `../../../../**/.source`,
  `../../../../**/.tmp`, `../../../../**/test-results`,
  `../../../../**/graphify-out`, `../../../../**/.eslintcache`,
  `../../../../**/*.tsbuildinfo`.
- Every consumer of `@repo/config-typescript/*` inherits the excludes
  **effectively**: TS resolves include/exclude relative to the file that
  declares them, and the `../../../../**/` prefix normalizes to repo-root-
  anchored globs that match every nested occurrence below the root, for any
  consumer at any depth. Verified with `--listFiles` probe files.
- Do NOT redeclare an `exclude` in a leaf tsconfig that extends the chain: a
  child `exclude` fully overrides the inherited one and silently drops the
  canonical list. Only standalone configs (`apps/doc`, `packages/contracts/api`)
  keep their own excludes.
- Do NOT move the list to a root `tsconfig.base.json`: Docker images are built
  via `turbo prune --docker`, which only ships workspace trees + root manifests
  (`package.json`, `bun.lock`, `turbo.json`) — a root-level tsconfig is never
  copied into the image and the extends chain breaks inside containers
  (`TSCONFIG_ERROR: Tsconfig not found`). Keeping the list inside this package
  (a workspace in the pruned dependency graph) makes it ship everywhere.
- Gotcha: `include/exclude` from an extended config resolve relative to the
  config file that declares them (not the consumer). Anchoring with the
  `../../../../` prefix at the repo root is what makes it work for every
  consumer.
