# Web App Architecture Guide

This document describes the organization, patterns, and conventions for the Next.js web application.

## Directory Structure

```
apps/web/src/
├── app/                    # Next.js App Router pages, layouts, route groups, dynamic routes
│   ├── layout.tsx          # Root layout for the subtree
│   ├── loading.tsx         # Root loading boundary
│   ├── not-found.tsx       # Root 404 boundary
│   ├── route.info.ts       # Route metadata (generated/synced)
│   ├── (group)/            # Route group: organizational only (not in URL)
│   │   └── <feature>/
│   │       ├── page.tsx
│   │       ├── route.info.ts
│   │       ├── layout.tsx
│   │       ├── _components/
│   │       ├── _hooks/
│   │       ├── _models/
│   │       ├── _data-table/
│   │       └── _utils/
│   ├── [param]/            # Required dynamic segment
│   ├── [[param]]/          # Optional single dynamic segment
│   ├── [...param]/         # Required catch-all segment
│   └── [[...param]]/       # Optional catch-all segment
│
├── components/            # React components
│   ├── atomics/           # Reusable UI system (atoms/molecules/organisms)
│   │   ├── atoms/
│   │   ├── molecules/
│   │   └── organisms/
│   ├── auth/              # Auth/authorization wrappers (canonical)
│   │   ├── RequireAuth.tsx
│   │   ├── RequireOrganizationRole.tsx
│   │   ├── RequirePlatformRole.tsx
│   │   ├── RequirePermission.tsx
│   │   ├── ShowIfOrganizationRole.tsx
│   │   ├── ShowIfPlatformRole.tsx
│   │   └── ShowWhenAuthenticated.tsx
│   ├── dashboard/         # Dashboard reusable components
│   ├── loading/           # Loading states
│   ├── navigation/        # Navigation components
│   └── ui/                # Generic shared UI helpers
│
├── domains/               # Domain data layer (PREFERRED)
│   ├── user/
│   │   ├── endpoints.ts
│   │   ├── hooks.ts
│   │   └── invalidations.ts
│   ├── service/
│   ├── deployment/
│   ├── docker/
│   └── ...
│
├── lib/                   # Core library code
│   ├── orpc/             # ORPC integration (links, client internals)
│   ├── auth/             # Better Auth integration
│   ├── logging/          # Logging infrastructure
│   ├── errors/           # Error utilities
│   ├── forms/            # Form infrastructure
│   └── permissions.ts    # Permission utilities/hooks
│
├── middlewares/           # Middleware wrappers/composition helpers
├── proxy.ts               # Root middleware entrypoint
│
├── routes/               # Declarative routing system
│   ├── index.ts          # Auto-generated route exports
│   ├── hooks.ts          # Typed routing hooks
│   ├── utils.ts          # Routing utilities
│   └── makeRoute.tsx     # Route factory functions
│
└── utils/                # Generic helpers and provider glue
    └── providers/        # React context providers
```

### `app/` folder semantics (general)

- `page.tsx`: page entrypoint for a route segment.
- `layout.tsx`: shared wrapper for all child segments under that folder.
- `loading.tsx`, `error.tsx`, `not-found.tsx`: route state boundaries.
- `route.info.ts`: declarative route metadata used by typed routing generation.

Segment naming conventions:

- `(folder)`: route group for organization only, does **not** affect URL path.
- `[folder]`: required dynamic segment (exactly one segment).
- `[[folder]]`: optional dynamic segment (zero or one segment).
- `[...folder]`: required catch-all segment (one or many segments).
- `[[...folder]]`: optional catch-all segment (zero, one, or many segments).

Feature-local private folders inside route subtrees:

- `_components/`: UI pieces used only by this feature route.
- `_hooks/`: route-local interaction/view orchestration hooks.
- `_models/`: feature-local schemas and inferred types (Zod-first).
- `_data-table/`: table-focused files (`columns.tsx`, `filter-config.ts`, table wiring).
- `_utils/`: pure local helpers (formatting, parsing, mappers, predicates).

Promotion rule:

- Keep code in `_...` while it is route-local.
- Promote to `components/atomics`, `domains`, or `lib` only when reused cross-feature.

## Key Patterns

### 1. Permission Checking

**Location**: `components/auth/` (preferred wrappers) + `lib/permissions.ts` (programmatic checks)

Use these components for access control:

```tsx
import { RequireAuth, RequireOrganizationRole, RequirePlatformRole, RequirePermission } from '@/components/auth'

// Require authentication
<RequireAuth>
  <ProtectedContent />
</RequireAuth>

// Require specific organization role
<RequireOrganizationRole role="admin" organizationId={orgId}>
  <AdminPanel />
</RequireOrganizationRole>

// Require platform-level role
<RequirePlatformRole role="admin">
  <PlatformAdminPanel />
</RequirePlatformRole>

// Require specific permission
<RequirePermission
  permission="organization.members.manage"
  organizationId={orgId}
  fallback={<AccessDenied />}
>
  <MemberManagement />
</RequirePermission>
```

Programmatic permission checks come from `lib/permissions.ts`:

```tsx
import { usePlatformPermissions, useOrganizationPermissions } from '@/lib/permissions'

const { hasPlatformPermission } = usePlatformPermissions()
const { hasOrganizationPermission } = useOrganizationPermissions(orgId)

if (hasPlatformPermission('platform.users.manage')) {
  // User has platform permission
}

if (hasOrganizationPermission('organization.members.invite')) {
  // User has organization permission
}
```

### 2. Data Fetching with Domain Hooks

**Preferred Pattern**: Use the domain layer under `src/domains/<feature>/`.

```tsx
import { useUserList, useUser, useUserActions } from '@/domains/user/hooks'

const { data: users } = useUserList({ query: {} })
const { data: user } = useUser(userId)

const { create, update, delete: deleteUser } = useUserActions()
create.mutate({ body: { name: 'John', email: 'john@example.com' } })
```

**Benefits**:
- Co-locates endpoints, hooks, and invalidation strategy by feature
- Keeps components free from endpoint/query key details
- Type-safe through ORPC endpoint `queryOptions` / `mutationOptions`
- Works for ORPC-backed and custom endpoints with one consistent API

### 3. Declarative Routing

**Location**: `routes/` + route-local `route.info.ts` files

Define route metadata using `route.info.ts` files (generated/synced):

```tsx
// app/<feature>/route.info.ts
import { z } from 'zod'

export const Route = {
  name: 'FeatureRouteName',
  params: z.object({}),
}
```

Use generated routes in components:

```tsx
import { FeatureRouteName } from '@/routes'
import { useSearchParams } from '@/routes/hooks'

// Type-safe links
<FeatureRouteName.Link>Go to feature</FeatureRouteName.Link>

// Type-safe navigation
const search = useSearchParams(FeatureRouteName)
```

**Important**:

- Do not manually edit generated route flags.
- After route structure changes, regenerate routing artifacts with `dr:build`.
- Keep dynamic segment names explicit (`[projectId]`, `[serviceId]`, `[organizationId]`).

### 4. Middleware Composition

**Location**: `src/proxy.ts` (using wrappers from `src/middlewares/`)

Middleware stack is composed in order:

```tsx
export default WithEnv(              // 1. Validate environment
  WithHealthCheck(                   // 2. Health check endpoint
    WithAuth(                        // 3. Session management
      WithHeaders(                   // 4. CORS and security headers
        () => NextResponse.next()
      )
    )
  )
)
```

### 5. Better Auth Integration

**Location**: `lib/auth/*`

```tsx
import { auth } from '@/lib/auth'

// Server components
const session = await auth()
if (!session) redirect('/auth/login')

// Client components
import { useSession } from '@/lib/auth'
const { data: session, isLoading } = useSession()
```

**Plugins**: Admin and Organization plugins are enabled with custom hooks:
- `useOrganizationMembers()` - Get organization members
- `usePlatformPermissions()` - Check platform-level permissions
- `useOrganizationPermissions()` - Check organization-level permissions

### 6. Feature-local component expansion (models + data-table)

When a feature grows (especially list/detail dashboards), split responsibilities with dedicated folders and files.

Recommended structure:

```text
app/<segment>/<feature>/
  page.tsx
  route.info.ts
  _components/
    <feature>-header.tsx
    <feature>-toolbar.tsx
  _hooks/
    use-<feature>-query-state.ts
    use-<feature>-actions.ts
  _models/
    <feature>.schema.ts
    <feature>.types.ts
  _data-table/
    columns.tsx
    filter-config.ts
    table.tsx
  _utils/
    format.ts
    map-row.ts
```

Rules:

- `_models/*` is the source of truth for feature data shape. Define Zod schemas there and infer TypeScript types from schema.
- `_data-table/columns.tsx` defines typed table columns only (renderers/accessors).
- `_data-table/filter-config.ts` defines filter model/config for data tables (keys, operators, defaults, UI metadata).
- `_hooks/*` composes domain hooks + route state + filter state; avoid inlining filter schemas/column definitions in pages.
- `_components/*` consumes hooks and renders UI composition; keep business parsing/normalization out of JSX trees.
- `_utils/*` contains only pure helpers (no React hooks/components).

### Route-local `_feature` folders

Inside route subtrees, underscore-prefixed folders are private implementation details for that feature:

- `_components/` — route-local UI
- `_hooks/` — route-local interaction/view hooks
- `_data-table/` — route-local table columns/filter config/composition
- `_utils/` — route-local pure helpers
- `_models/` — route-local types and schemas

If something is reused across features, promote it out of `_...` into `components/atomics`, `domains`, `lib`, or top-level `utils` (for shared pure utilities).

### Adapter boundary between domain and reusable UI

Use route-level adapter components to map domain entities/events into generic reusable organism props. Reusable atomics should not embed domain-specific parsing/business formatting.

## File Organization Rules

1. **Architecture discipline is mandatory**
  - Every new or moved file must be intentionally placed after architectural review.
  - Verify scope (`_feature` local vs shared), ownership, and long-term fit before creating/moving files.

2. **Fix structure immediately (no deferred cleanup)**
  - If you discover a non-ideal structure while working, fix it in the same change set.
  - Do not postpone with temporary legacy layers.

3. **No legacy bridge / no compatibility re-export shims**
  - Do not keep old folders alive only for import compatibility.
  - Do not add re-export proxy files to preserve deprecated paths.
  - Move imports directly to canonical paths and remove dead paths.

4. **Group by Feature, Not Type**
   - Keep related components together (auth components in `components/auth/`)
   - Don't create generic folders like `components/common/`

5. **Prefer Domain Layer Hooks**
  - Use `src/domains/<feature>/{endpoints,hooks,invalidations}.ts`
  - Avoid ad-hoc query/mutation logic in components
  - See `src/domains/user/` as the reference pattern

6. **No Empty Directories**
   - Remove folders that don't contain files
   - Don't create placeholder directories

7. **No Duplicate Components**
   - Keep single source of truth for each component type
  - Reusable UI must live under `components/atomics/{atoms,molecules,organisms}`

8. **Co-locate Route Metadata**
  - Route metadata is `route.info.ts` (not `page.info.ts`)
   - Use unique Route names to avoid collisions

9. **Explicit Imports**
  - Prefer canonical paths: `@/components/atomics/...`, `@/domains/...`, `@/lib/...`
  - Avoid deep cross-feature imports into another feature's private `_...` folders

10. **Layouts and pages responsibilities**
   - Keep global/shell concerns in layouts
   - Keep page components focused on route composition and feature orchestration
   - Keep cross-cutting infrastructure in `lib/`, not inside route pages

## Migration Notes

### Deprecated Patterns

1. **Legacy reusable component root**
  - **Status**: REMOVED
  - **Deprecated**: `components/organisms/*`
  - **Migration**: Use `components/atomics/organisms/*`

2. **Legacy compatibility re-export strategy**
  - **Status**: FORBIDDEN
  - **Migration**: update all imports to canonical final paths directly
  - **Reason**: re-export bridges keep legacy structure alive and create maintenance debt

3. **String-based Routing**
   - **Status**: DEPRECATED
   - **Migration**: Use declarative routes from `@/routes`
  - **Example**: typed `<Route.Link>` instead of raw string `href` paths in complex flows

### Active Patterns

1. **Domain Hooks + Explicit Invalidations**
  - Define endpoint contracts in `endpoints.ts`
  - Keep invalidation config in `invalidations.ts`
  - Expose composable hooks from `hooks.ts`

2. **Declarative Routing**
  - Define route metadata in `route.info.ts`
   - Use typed links: `<Route.Link>`
   - Use typed hooks: `useSearchParams(Route)`
  - Regenerate route artifacts after route changes (`dr:build`)

3. **Better Auth**
   - Use `auth()` for server components
   - Use `useSession()` for client components
   - Leverage admin and organization plugins

4. **Middleware Composition**
   - Stack middleware functions in `proxy.ts`
   - Use matchers for route-specific middleware
   - Validate environment before other middleware

5. **Route-local private folders with promotion path**
  - Keep one-feature internals in `_components/_hooks/_models/_data-table/_utils`
  - Promote only true cross-feature reuse to `components/atomics`, `domains`, or `lib`

## Usage Examples

### Creating a New CRUD Feature

1. **Define API Contract** (in `packages/contracts/api/`)
```typescript
export const productContract = o.contract({
  list: o.route({ /* ... */ }),
  findById: o.route({ /* ... */ }),
  create: o.route({ /* ... */ }),
  // ...
})
```

2. **Create Domain Layer** (in `apps/web/src/domains/product/`)
```typescript
// endpoints.ts
import { orpc } from '@/lib/orpc'
export const productEndpoints = {
  list: orpc.product.list,
  findById: orpc.product.findById,
  create: orpc.product.create,
}

// hooks.ts
import { useQuery, useMutation } from '@tanstack/react-query'
import { productEndpoints } from './endpoints'

export function useProductList(input: { query: Record<string, unknown> }) {
  return useQuery(productEndpoints.list.queryOptions({ input }))
}

export function useCreateProduct() {
  return useMutation(productEndpoints.create.mutationOptions())
}
```

3. **Create Route** (in `apps/web/src/app/products/`)
```typescript
// route.info.ts
import { z } from 'zod'

export const Route = {
  name: 'Products',
  params: z.object({}),
}
```

4. **Use in Component**
```tsx
import { useProductList } from '@/domains/product/hooks'
import { Products } from '@/routes'
import { useSearchParams } from '@/routes/hooks'

export default function ProductsPage() {
  const { page = 1 } = useSearchParams(Products)
  const { data } = useProductList({ query: { page } })
  
  return <ProductList products={data?.products || []} />
}
```

5. **Optional route-local private structure**
```text
app/products/
  page.tsx
  route.info.ts
  _components/
  _hooks/
  _data-table/
  _utils/
  _models/
```

### Adding Permission-Gated Content

```tsx
import { RequireOrganizationRole } from '@/components/auth'

export function AdminPanel({ orgId }: { orgId: string }) {
  return (
    <RequireOrganizationRole 
      role="admin" 
      organizationId={orgId}
      fallback={<AccessDenied />}
    >
      <div>
        <h1>Admin Panel</h1>
        {/* Admin-only content */}
      </div>
    </RequireOrganizationRole>
  )
}
```

### Using Conditional Rendering

```tsx
import { ShowIfPlatformRole, ShowIfOrganizationRole } from '@/components/auth'

export function UserActions({ userId, orgId }: Props) {
  return (
    <div>
      {/* Show for platform admins */}
      <ShowIfPlatformRole role="admin">
        <DeleteUserButton userId={userId} />
      </ShowIfPlatformRole>
      
      {/* Show for organization owners */}
      <ShowIfOrganizationRole role="owner" organizationId={orgId}>
        <TransferOwnershipButton />
      </ShowIfOrganizationRole>
    </div>
  )
}
```

## Additional Resources

- `src/README.md` — canonical source-organization guide
- `src/components/atomics/README.md` — atomic component layering and rules
- `src/routes/README.md` — declarative routing behavior and generation details
- [Next.js App Router Documentation](https://nextjs.org/docs/app)
- [ORPC Documentation](https://orpc.io)
- [Better Auth Documentation](https://better-auth.com)
- [TanStack Query Documentation](https://tanstack.com/query)

## Questions or Issues?

If you're unsure about the correct pattern to use:
1. Look for similar existing implementations
2. Check this ARCHITECTURE.md document
3. Check `src/README.md` for canonical structure decisions
4. Prefer contract-generated patterns over manual implementations
5. Use domain hooks from `src/domains/<feature>/hooks.ts`
6. Do not leave temporary legacy folders or compatibility re-exports behind
