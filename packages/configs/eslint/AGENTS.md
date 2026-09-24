# AGENTS.md — @repo/config-eslint

Centralized ESLint configuration for the monorepo.

## Rules
- Keep configs minimal and sharable. Avoid project-specific rules here.
- When updating rules, run lint across repo and document notable changes.
 - Prefer using MCP `run-script` to run lint tasks across targets or consult `repo://commit/plan` for sequencing.

## @shadcn/lint

`@shadcn/lint` is registered as the `shadcn` plugin in `src/react.ts` (and therefore in
`@repo/config-eslint/nextjs`, which re-uses it). **No `shadcn/*` rules are enabled** — the plugin
is installed, discoverable, and inert until an app opts in.

Enable rules per app, in that app's own `eslint.config.ts` rules object, next to its files glob:

```ts
{ extends: [nextjsConfig.configs.base()], rules: { "shadcn/no-restyle": ["error", { allow: ["layout"] }] } }
```

Component discovery: `apps/web` and `packages/ui/base` use their local `components.json`; imports of
the shared package (`@repo/ui/components/…`) are matched via `settings.shadcn.componentImports` set
in `src/react.ts`. Theme CSS comes from each `components.json` `tailwind.css` path.

Rule list: https://github.com/shadcn-ui/lint#rules
