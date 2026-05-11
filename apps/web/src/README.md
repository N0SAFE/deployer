# `src/` Architecture & Feature Organization Guide (apps/web)

This document is the **canonical organization guide** for `apps/web/src`.

Use it to decide where new code belongs and how to structure features from route files to domains and reusable components.

---

## 0) Architecture discipline (mandatory)

Every **new file** and every **moved file** must be placed intentionally after careful architectural review.

Before creating/moving files, verify:

- the scope is correct (route-local vs reusable vs cross-domain)
- the folder communicates long-term ownership
- the location supports future feature growth without extra indirection

### No deferred cleanup policy

If, during any task, you encounter a file location or structure that is not ideal for future implementations, fix it **immediately in the same change set**.

Do not postpone structural fixes with “temporary” legacy patterns.

### No legacy bridge / no compatibility re-export policy

- Do not keep legacy folders alive after migration.
- Do not add compatibility re-export files just to preserve old import paths.
- Move imports to the canonical path directly and remove dead paths.

Rule: prefer one clean canonical structure now, rather than layered aliases that create long-term maintenance debt.

---

## 1) High-level map

Current top-level structure:

- `app/` — Next.js App Router routes (pages, layouts, route groups, dynamic segments)
- `components/` — reusable UI, including atomic design system
- `domains/` — feature/domain data layer (endpoints, hooks, invalidations)
- `lib/` — cross-domain infrastructure utilities (auth, logging, errors, ORPC integration helpers, etc.)
- `routes/` — declarative routing generated/build-time integration (`route.info.ts`, route builders)
- `actions/`, `middlewares/`, `utils/`, `mocks/`, `__tests__/` — supporting layers

---

## 2) App Router conventions (`app/`)

### Route files

For each route segment, use standard Next conventions:

- `page.tsx` — page entrypoint
- `layout.tsx` — segment layout wrapper
- `loading.tsx`, `error.tsx`, `not-found.tsx` — route state boundaries when needed
- `route.info.ts` — declarative routing metadata (generated/synced)

### Route groups and internal segments

- Group folders like `(app)` and `(internal)` are for URL-neutral organization.
- Keep internal/system routes separated from user-facing routes.

### Dynamic routing

- Use `[param]` segments (e.g. `projects/[projectId]/services/[serviceId]`).
- Keep param names stable and descriptive (`[organizationId]`, not `[id]` when context is known).

### Important rule for `route.info.ts`

`route.info.ts` files are generated/synced by declarative routing tooling.

- Do not hand-edit generated flags.
- After route changes, run route generation (`dr:build`) to sync types and route builders.
- You can change the schema in it and you should do it

---

## 3) `_feature` semantics inside route folders

Inside a route subtree, underscore-prefixed folders define **route-local/internal** implementation details.

Use this pattern:

- `_components/` — UI used only by this route feature
- `_hooks/` — feature-local hooks (UI orchestration, derived view state)
- `_lib/` — feature-local pure helpers/formatters/parsers
- `_models/` — feature-local types/interfaces/schemas

### Rule of thumb

If used by only one feature/route area, keep it in that feature under `_...`.
If reused across multiple features, promote it to `components/atomics`, `domains`, or `lib` depending on responsibility.

---

## 4) Reusable UI: Atomic design (`components/atomics`)

Required structure:

- `components/atomics/atoms/`
- `components/atomics/molecules/`
- `components/atomics/organisms/`

### Layer responsibilities

- **Atoms**: smallest generic UI units
- **Molecules**: small compositions of atoms around a focused interaction
- **Organisms**: reusable sections with richer interaction behavior

### Critical boundary

Atomics must remain domain-agnostic.
Domain formatting/mapping must happen in route adapters or domain code before passing props to atomics.

### Legacy path policy

Do not use `components/organisms/*` (legacy location removed).
Always import from `components/atomics/*`.

---

## 5) Domain layer (`domains/<feature>`)

Recommended files per domain:

- `endpoints.ts` — ORPC endpoint references
- `hooks.ts` — React Query hooks and domain interaction hooks
- `invalidations.ts` — cache invalidation helpers/policies
- optional: `mock-hooks.ts`, domain-specific helpers

### Domain rules

- Domain hooks should encapsulate query/mutation details.
- Pages/features consume domain hooks, not raw transport clients directly.
- Keep domain contracts and endpoint mapping centralized.

---

## 6) `lib/` vs `utils/`

Use `lib/` for cross-cutting infrastructure with clear ownership and long-term stability:

- auth/session glue
- ORPC integration primitives
- logging abstractions
- form infra
- error handling infra

Use `utils/` for lightweight helper utilities that do not represent a broader subsystem.

---

## 7) Recommended feature implementation flow

When adding or refactoring a feature:

1. **Route surface** in `app/...` (`page.tsx`, `layout.tsx`, `route.info.ts`)
2. **Route-local internals** in `_components/_hooks/_lib/_models`
3. **Domain access** via `domains/<feature>/{endpoints,hooks,invalidations}`
4. **Reusable UI extraction** into `components/atomics/*` only when truly reusable
5. **Cross-cut infra** into `lib/` if shared by multiple domains/features

---

## 8) Adapter pattern (required)

Use route-level adapters to bridge domain data into reusable atomics.

Example pattern:

- Domain returns raw entities/events
- Adapter maps to presentational shape (lines/cards/rows)
- Organism renders generic shape

This keeps atomics reusable and prevents domain leakage into shared UI.

---

## 9) Naming conventions

- File names: `kebab-case.ts(x)` for generic shared components
- Route feature files may follow local conventions where established
- Exported symbols: `PascalCase`
- Keep folder names descriptive and stable
- Keep dynamic param names explicit (`[projectId]`, `[serviceId]`)

---

## 10) Import boundaries

Preferred:

- `@/components/atomics/...`
- `@/domains/...`
- `@/lib/...`

Avoid:

- deep-cross imports from unrelated route feature internals (`app/.../_components` of another feature)
- reintroducing removed legacy component roots

---

## 11) Layout strategy

- Keep global shell concerns in high-level `layout.tsx`.
- Keep feature context providers close to the feature layout when scope is feature-specific.
- Do not overload page components with global concerns better suited for layout/provider wrappers.

---

## 12) Dynamic routes and typed navigation

- Define/maintain route metadata with `route.info.ts`.
- Use generated routing artifacts from `routes/` and route tooling.
- Regenerate route artifacts after route structure updates.
- Prefer typed route builders/links over ad-hoc string paths in complex flows.

---

## 13) Testing and migration checklist

Before merging structural work:

- [ ] No imports from removed/legacy folders
- [ ] New/moved files are in their final canonical location (not a temporary compromise)
- [ ] New reusable UI is under `components/atomics/*`
- [ ] Route-local internals stay inside feature `_...` folders
- [ ] Domain hooks remain in `domains/*`
- [ ] No compatibility re-export shims added to preserve old paths
- [ ] Type-check passes for touched paths
- [ ] Route artifacts regenerated if routes changed

---

## 14) Quick templates

### New route feature

```
app/dashboard/<feature>/
  page.tsx
  route.info.ts
  _components/
  _hooks/
  _lib/
  _models/
```

### New domain

```
domains/<feature>/
  endpoints.ts
  hooks.ts
  invalidations.ts
```

### New reusable organism

```
components/atomics/organisms/<feature>/<name>.tsx
components/atomics/organisms/<feature>/index.ts
```

### New reusable atom

```
components/atomics/atoms/<feature>/<name>.tsx
```

---

## 15) Related docs

- `src/components/atomics/README.md` — detailed atomic component-specific rules
- `src/routes/README.md` — declarative routing details and generation workflow

---

If there is any conflict between ad-hoc local habits and this guide, follow this guide and update affected code incrementally.
