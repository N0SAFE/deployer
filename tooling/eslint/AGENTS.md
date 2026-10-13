# AGENTS.md — @deployer/config-eslint

Centralized ESLint configuration for the monorepo.

## Build

Built through `@deployer/pkg-build` like every other package. Two pieces of the
package are unusual and both are covered here:

**The TypeScript 6 island.** `typescript-eslint@8` peer-requires
`typescript <6.1.0`, but every app in this repo compiles against TypeScript 7.
`src/plugins/bundle-ts6-island.ts` therefore redirects every `typescript` /
`typescript/*` import to THIS package's TS6 copy and bundles that plus the
`typescript-eslint` / `@darraghor/eslint-plugin-nestjs-typed` closure into
`dist`. A consumer's TS7 can never reach the lint toolchain. It is the only
`plugins` entry in the repo — see `tooling/bin-pkg-build/AGENTS.md`.

**The progress plugin.** `plugins/progress/` is a separate package
(`@deployer/config-eslint-plugins-progress`) holding the per-file progress
display. It is a normal `pkg-build` package: `src/` is TypeScript, and `dist/`
plus `dist/types/` are generated from that one source. It used to be a raw
`.js` file with a hand-written `.d.ts` beside it, which is why the types could
drift from the implementation — they no longer can.

Because the island is bundled, `dist/index.mjs` is large (≈12 MB) and `lint`
must run AFTER `@deployer/config-eslint#build:types`, which `turbo.json`
encodes.

## Rules
- Keep configs minimal and sharable. Avoid project-specific rules here.
- When updating rules, run lint across repo and document notable changes.
 - Prefer using MCP `run-script` to run lint tasks across targets or consult `repo://commit/plan` for sequencing.

## @shadcn/lint

`@shadcn/lint` is registered as the `shadcn` plugin in `src/react.ts` (and therefore in
`@deployer/config-eslint/nextjs`, which re-uses it). **No `shadcn/*` rules are enabled** — the plugin
is installed, discoverable, and inert until an app opts in.

Enable rules per app, in that app's own `eslint.config.ts` rules object, next to its files glob:

```ts
{ extends: [nextjsConfig.configs.base()], rules: { "shadcn/no-restyle": ["error", { allow: ["layout"] }] } }
```

Component discovery: `apps/web` and `packages/ui/base` use their local `components.json`; imports of
the shared package (`@deployer/ui/components/…`) are matched via `settings.shadcn.componentImports` set
in `src/react.ts`. Theme CSS comes from each `components.json` `tailwind.css` path.

Rule list: https://github.com/shadcn-ui/lint#rules
