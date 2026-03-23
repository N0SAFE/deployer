# Web App Architecture Guide

This document describes the organization, patterns, and conventions for the Next.js web application.

## Directory Structure

```
apps/web/src/
├── app/                    # Next.js App Router pages and layouts
│   ├── (auth)/            # Route group: authenticated pages
│   │   ├── dashboard/     # Main dashboard and admin pages
│   │   └── showcase/      # Feature showcase pages
│   ├── (internal)/        # Route group: internal/admin pages
│   ├── auth/              # Authentication pages (login, signup, etc.)
│   ├── middleware/        # Middleware error pages
│   ├── serwist/           # PWA service worker routes
│   └── api/               # API route handlers (Next.js API routes)
│
├── components/            # React components
│   ├── auth/              # Authentication & authorization components (CANONICAL)
│   │   ├── RequireAuth.tsx
│   │   ├── RequireOrganizationRole.tsx
│   │   ├── RequirePlatformRole.tsx
│   │   ├── RequirePermission.tsx
│   │   ├── ShowIfOrganizationRole.tsx
│   │   ├── ShowIfPlatformRole.tsx
│   │   └── ShowWhenAuthenticated.tsx
│   ├── pwa/               # PWA-specific components (install, update, offline)
│   ├── query/             # TanStack Query components (devtools, providers)
│   └── showcase/          # Feature showcase components
│
├── domains/               # Domain data layer (PREFERRED)
│   ├── user/
│   │   ├── endpoints.ts
│   │   ├── hooks.ts
│   │   └── invalidations.ts
│   ├── organization/
│   │   ├── endpoints.ts
│   │   ├── hooks.ts
│   │   └── invalidations.ts
│   └── ...
├── hooks/                 # Generic non-domain hooks
│   ├── usePermissions.ts          # Permission checking hooks
│   └── useInstallPrompt.ts        # PWA install prompt hook
│
├── lib/                   # Core library code
│   ├── orpc.ts           # ORPC client configuration
│   ├── auth.ts           # Better Auth client setup
│   ├── tanstack-query.ts # TanStack Query configuration
│   └── get-base-url.ts   # URL utilities
│
├── middlewares/           # Next.js middleware components
│   ├── proxy.ts          # Main middleware composition
│   ├── WithEnv.tsx       # Environment validation
│   ├── WithHealthCheck.tsx # Health check endpoint
│   ├── WithAuth.tsx      # Authentication middleware
│   └── WithHeaders.tsx   # CORS and security headers
│
├── routes/               # Declarative routing system
│   ├── index.ts          # Auto-generated route exports
│   ├── hooks.ts          # Typed routing hooks
│   ├── utils.ts          # Routing utilities
│   └── makeRoute.tsx     # Route factory functions
│
└── utils/                # Utility functions
    ├── providers/        # React context providers
    │   ├── AuthProviders.tsx
    │   └── ReactQueryProviders.tsx
    ├── transformCase.ts  # Case transformation utilities
    └── tanstack-query.tsx # TanStack Query helpers
```

## Key Patterns

### 1. Permission Checking

**Location**: `components/auth/` (SINGLE SOURCE OF TRUTH)

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

**Hooks**: Use `usePermissions.ts` for programmatic permission checks:

```tsx
import { usePlatformPermissions, useOrganizationPermissions } from '@/hooks/usePermissions'

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

**Location**: `routes/` directory with auto-generated `index.ts`

Define routes using `page.info.ts` files:

```tsx
// app/(auth)/dashboard/page.info.ts
import { z } from 'zod'
import { makeRoute } from '@/routes/makeRoute'

export const Route = makeRoute.create({
  name: 'Dashboard',
  params: z.object({}),
  searchParams: z.object({
    tab: z.enum(['overview', 'settings']).optional()
  })
})
```

Use routes in components:

```tsx
import { Dashboard, AdminUsers } from '@/routes'
import { useSearchParams } from '@/routes/hooks'

// Type-safe links
<Dashboard.Link search={{ tab: 'overview' }}>
  Go to Dashboard
</Dashboard.Link>

// Type-safe navigation
const { tab } = useSearchParams(Dashboard)
```

### 4. Middleware Composition

**Location**: `middlewares/proxy.ts`

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

**Location**: `lib/auth.ts`

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

## File Organization Rules

1. **Group by Feature, Not Type**
   - Keep related components together (auth components in `components/auth/`)
   - Don't create generic folders like `components/common/`

2. **Prefer Domain Layer Hooks**
  - Use `src/domains/<feature>/{endpoints,hooks,invalidations}.ts`
  - Avoid ad-hoc query/mutation logic in components
  - See `src/domains/user/` as the reference pattern

3. **No Empty Directories**
   - Remove folders that don't contain files
   - Don't create placeholder directories

4. **No Duplicate Components**
   - Keep single source of truth for each component type
   - Example: `components/auth/` is canonical for permission components

5. **Co-locate Route Metadata**
   - Every page should have a `page.info.ts` file
   - Use unique Route names to avoid collisions

6. **Explicit Imports**
   - Import from specific paths, not barrel exports
   - Example: `@repo/ui/components/shadcn/button` not `@repo/ui`

## Migration Notes

### Deprecated Patterns

1. **Legacy Flat Hooks in `src/hooks/`**
   - **Status**: DEPRECATED
  - **Migration**: Use domain hooks from `src/domains/<feature>/hooks.ts`
  - **Reason**: Domain co-location improves maintainability and cache consistency

2. **Components in Wrong Locations**
   - **Status**: CLEANED UP
   - **What Changed**: Removed duplicate `components/permissions/` folder
   - **Canonical Location**: `components/auth/` for all permission components

3. **String-based Routing**
   - **Status**: DEPRECATED
   - **Migration**: Use declarative routes from `@/routes`
   - **Example**: `<Dashboard.Link>` instead of `<Link href="/dashboard">`

### Active Patterns

1. **Domain Hooks + Explicit Invalidations**
  - Define endpoint contracts in `endpoints.ts`
  - Keep invalidation config in `invalidations.ts`
  - Expose composable hooks from `hooks.ts`

2. **Declarative Routing**
   - Define routes with `makeRoute.create()`
   - Use typed links: `<Route.Link>`
   - Use typed hooks: `useSearchParams(Route)`

3. **Better Auth**
   - Use `auth()` for server components
   - Use `useSession()` for client components
   - Leverage admin and organization plugins

4. **Middleware Composition**
   - Stack middleware functions in `proxy.ts`
   - Use matchers for route-specific middleware
   - Validate environment before other middleware

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
// page.info.ts
import { makeRoute } from '@/routes/makeRoute'
import { z } from 'zod'

export const Route = makeRoute.create({
  name: 'Products',
  params: z.object({}),
  searchParams: z.object({
    page: z.coerce.number().optional()
  })
})
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

- [Next.js App Router Documentation](https://nextjs.org/docs/app)
- [ORPC Documentation](https://orpc.io)
- [Better Auth Documentation](https://better-auth.com)
- [TanStack Query Documentation](https://tanstack.com/query)
- [Declarative Routing](./src/routes/README.md)

## Questions or Issues?

If you're unsure about the correct pattern to use:
1. Look for similar existing implementations
2. Check this ARCHITECTURE.md document
3. Prefer contract-generated patterns over manual implementations
4. Keep permissions in `components/auth/`
5. Use domain hooks from `src/domains/<feature>/hooks.ts`
