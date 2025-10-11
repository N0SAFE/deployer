# Frontend Development Patterns

> **Purpose**: Standardized patterns for Next.js frontend development with ORPC, Better Auth, and Declarative Routing  
> **Date**: 2025-01-05  
> **Status**: 📝 Specification

---

## TL;DR - The Three Core Patterns

### 1. 🔌 ORPC Integration: Type-Safe API Calls
```typescript
// ✅ DO: Use orpc with queryOptions pattern
import { orpc } from '@/lib/orpc'
import { useQuery } from '@tanstack/react-query'

const { data } = useQuery(orpc.project.list.queryOptions({ input: {} }))

// ❌ DON'T: Manual fetch or raw API calls
const data = await fetch('/api/projects')
```

### 2. 🔐 Better Auth: Session & Authentication
```typescript
// ✅ DO: Use Better Auth hooks and utilities
import { useSession, signIn, signOut } from '@/lib/auth'

const { data: session } = useSession()

// ❌ DON'T: Manual session management
const session = await fetch('/api/auth/session')
```

### 3. 🧭 Declarative Routing: Type-Safe Navigation
```typescript
// ✅ DO: Use typed routes from @/routes
import { ProjectDetail } from '@/routes'

<ProjectDetail.Link projectId="123">View Project</ProjectDetail.Link>

// ❌ DON'T: Raw href strings
<Link href={`/projects/${projectId}`}>View Project</Link>
```

**Key Principle**: Use type-safe patterns for all API calls, authentication, and navigation to ensure compile-time safety and automatic refactoring support.

---

## Table of Contents

1. [ORPC Client Integration](#orpc-client-integration)
2. [Better Auth Integration](#better-auth-integration)
3. [Declarative Routing](#declarative-routing)
4. [Custom Hooks Pattern](#custom-hooks-pattern)
5. [Component Patterns](#component-patterns)
6. [State Management](#state-management)
7. [Error Handling](#error-handling)
8. [Best Practices](#best-practices)

---

## ORPC Client Integration

### Overview

ORPC provides end-to-end type-safe API communication between the Next.js frontend and NestJS backend. All API contracts are defined in `packages/api-contracts/` and shared between both applications.

### Setup

The ORPC client is configured in `apps/web/src/lib/orpc/index.ts` with:
- Automatic cookie handling (server & client)
- 401 redirect to login
- Master token support (development only)
- Request caching and revalidation

### The queryOptions Pattern

**CRITICAL**: Always use the `queryOptions` pattern with `useQuery` and `useMutation`:

```typescript
import { orpc } from '@/lib/orpc'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

// ✅ CORRECT: Query with queryOptions
export function useProjects() {
  return useQuery(orpc.project.list.queryOptions({
    input: {},
    staleTime: 1000 * 60, // 1 minute
  }))
}

// ✅ CORRECT: Query with parameters
export function useProject(projectId: string) {
  return useQuery(orpc.project.getById.queryOptions({
    input: { id: projectId },
    enabled: !!projectId, // Only fetch when projectId exists
    staleTime: 1000 * 30, // 30 seconds
  }))
}

// ✅ CORRECT: Mutation with mutationOptions
export function useCreateProject() {
  const queryClient = useQueryClient()
  
  return useMutation(orpc.project.create.mutationOptions({
    onSuccess: () => {
      // Invalidate projects list after creation
      queryClient.invalidateQueries({ 
        queryKey: orpc.project.list.getQueryKey({}) 
      })
      toast.success('Project created successfully')
    },
    onError: (error: Error) => {
      toast.error(`Failed to create project: ${error.message}`)
    },
  }))
}
```

### Why queryOptions?

The `queryOptions` pattern provides:
- ✅ **Type Safety**: Input and output types automatically inferred from contracts
- ✅ **Query Key Management**: Automatic query key generation
- ✅ **Consistent Configuration**: Standardized options across all queries
- ✅ **Refactoring Support**: Contract changes automatically update all usages

### Query Configuration Options

```typescript
useQuery(orpc.contract.method.queryOptions({
  input: { /* typed parameters */ },
  
  // React Query options
  enabled: boolean,           // Conditional fetching
  staleTime: number,         // Cache freshness time (ms)
  gcTime: number,            // Garbage collection time (ms)
  refetchInterval: number,   // Auto-refetch interval (ms)
  refetchOnWindowFocus: boolean,
  refetchOnMount: boolean,
  retry: number | boolean,
  
  // Callbacks
  select: (data) => transformed, // Transform response
  placeholderData: fallbackData, // Placeholder while loading
}))
```

### Mutation Configuration Options

```typescript
useMutation(orpc.contract.method.mutationOptions({
  // Callbacks
  onSuccess: (data, variables, context) => {
    // Handle success (invalidate queries, show toast, navigate)
  },
  onError: (error, variables, context) => {
    // Handle error (show error toast, log error)
  },
  onMutate: async (variables) => {
    // Optimistic updates (return context for rollback)
    return { previousData }
  },
  onSettled: (data, error, variables, context) => {
    // Always runs after success or error
  },
  
  // Retry configuration
  retry: 3,
  retryDelay: attemptIndex => Math.min(1000 * 2 ** attemptIndex, 30000),
}))
```

### Server-Side Data Fetching

For Server Components (RSC), use ORPC directly without React Query:

```typescript
// app/dashboard/projects/page.tsx (Server Component)
import { orpc } from '@/lib/orpc'

export default async function ProjectsPage() {
  // ✅ Direct ORPC call in Server Component
  const projects = await orpc.project.list({
    input: {},
  }, {
    cache: 'no-store', // or 'force-cache' for caching
    next: { revalidate: 60 } // Revalidate every 60 seconds
  })
  
  return <ProjectsList projects={projects} />
}
```

### Client-Side Data Fetching

For Client Components, always use React Query hooks:

```typescript
// components/ProjectsList.tsx (Client Component)
'use client'

import { useQuery } from '@tanstack/react-query'
import { orpc } from '@/lib/orpc'

export function ProjectsList() {
  const { data: projects, isLoading, error } = useQuery(
    orpc.project.list.queryOptions({ input: {} })
  )
  
  if (isLoading) return <Skeleton />
  if (error) return <ErrorMessage error={error} />
  
  return <div>{/* Render projects */}</div>
}
```

### Query Invalidation Pattern

After mutations, invalidate related queries to refresh data:

```typescript
export function useUpdateProject() {
  const queryClient = useQueryClient()
  
  return useMutation(orpc.project.update.mutationOptions({
    onSuccess: (data, { id }) => {
      // Invalidate specific project
      queryClient.invalidateQueries({ 
        queryKey: orpc.project.getById.getQueryKey({ id }) 
      })
      
      // Invalidate project list
      queryClient.invalidateQueries({ 
        queryKey: orpc.project.list.getQueryKey({}) 
      })
      
      // Invalidate all project-related queries (use with caution)
      queryClient.invalidateQueries({ 
        predicate: (query) => query.queryKey[0] === 'project'
      })
    },
  }))
}
```

### Optimistic Updates Pattern

For instant UI feedback before server confirmation:

```typescript
export function useToggleProjectStatus() {
  const queryClient = useQueryClient()
  
  return useMutation(orpc.project.toggleStatus.mutationOptions({
    onMutate: async ({ id }) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ 
        queryKey: orpc.project.getById.getQueryKey({ id }) 
      })
      
      // Snapshot current value
      const previousProject = queryClient.getQueryData(
        orpc.project.getById.getQueryKey({ id })
      )
      
      // Optimistically update
      queryClient.setQueryData(
        orpc.project.getById.getQueryKey({ id }),
        (old: any) => ({ ...old, status: !old.status })
      )
      
      // Return context for rollback
      return { previousProject }
    },
    onError: (err, { id }, context) => {
      // Rollback on error
      queryClient.setQueryData(
        orpc.project.getById.getQueryKey({ id }),
        context?.previousProject
      )
    },
    onSettled: (data, error, { id }) => {
      // Always refetch after mutation
      queryClient.invalidateQueries({ 
        queryKey: orpc.project.getById.getQueryKey({ id }) 
      })
    },
  }))
}
```

---

## Better Auth Integration

### Overview

Better Auth provides session management, authentication, and authorization. The auth client is configured in `apps/web/src/lib/auth/index.ts`.

### Core Auth Utilities

```typescript
import { 
  useSession,    // Hook to get current session
  signIn,        // Sign in function
  signOut,       // Sign out function  
  getSession,    // Get session (non-reactive)
  $store,        // Auth store for advanced usage
} from '@/lib/auth'
```

### Session Management Pattern

```typescript
'use client'

import { useSession } from '@/lib/auth'

export function UserProfile() {
  const { data: session, isPending, error } = useSession()
  
  if (isPending) return <Skeleton />
  if (error) return <div>Error loading session</div>
  if (!session) return <div>Not authenticated</div>
  
  return (
    <div>
      <p>Welcome, {session.user.name}!</p>
      <p>Email: {session.user.email}</p>
    </div>
  )
}
```

### Authentication Actions

#### Sign In

```typescript
import { signIn } from '@/lib/auth'
import { useRouter } from 'next/navigation'

export function LoginButton() {
  const router = useRouter()
  
  const handleLogin = async () => {
    try {
      await signIn.email({
        email: 'user@example.com',
        password: 'password',
        callbackURL: '/dashboard',
      })
      
      // Redirect handled automatically by callbackURL
    } catch (error) {
      toast.error('Login failed')
    }
  }
  
  return <Button onClick={handleLogin}>Sign In</Button>
}
```

#### Sign Out

```typescript
import { signOut } from '@/lib/auth'

export function LogoutButton() {
  const handleLogout = async () => {
    await signOut()
    // Automatically redirects to login page
  }
  
  return <Button onClick={handleLogout}>Sign Out</Button>
}
```

### Protected Routes Pattern

For Client Components:

```typescript
'use client'

import { useSession } from '@/lib/auth'
import { redirect } from 'next/navigation'

export function ProtectedContent() {
  const { data: session, isPending } = useSession()
  
  if (isPending) return <Skeleton />
  
  if (!session) {
    redirect('/auth/login')
  }
  
  return <div>Protected content</div>
}
```

For Server Components:

```typescript
import { serverAuthClient } from '@/lib/auth/server'
import { redirect } from 'next/navigation'

export default async function ProtectedPage() {
  const session = await serverAuthClient.getSession()
  
  if (!session) {
    redirect('/auth/login')
  }
  
  return <div>Protected page</div>
}
```

### Role-Based Access Control

```typescript
'use client'

import { useSession } from '@/lib/auth'

export function AdminPanel() {
  const { data: session } = useSession()
  
  // Check user role
  if (session?.user?.role !== 'admin') {
    return <div>Access denied: Admin only</div>
  }
  
  return <div>Admin panel content</div>
}
```

---

## Declarative Routing

### Overview

Declarative Routing provides type-safe navigation with automatic route generation. Routes are defined in `page.info.ts` files co-located with pages.

### Link Components Pattern

```typescript
import { ProjectDetail, ProjectSettings } from '@/routes'

export function ProjectCard({ projectId }: { projectId: string }) {
  return (
    <Card>
      {/* ✅ Type-safe link with parameters */}
      <ProjectDetail.Link projectId={projectId}>
        View Project
      </ProjectDetail.Link>
      
      {/* ✅ Link with additional props */}
      <ProjectSettings.Link 
        projectId={projectId}
        className="text-blue-500"
        prefetch={true}
      >
        Settings
      </ProjectSettings.Link>
    </Card>
  )
}
```

### Programmatic Navigation

```typescript
import { ProjectDetail } from '@/routes'
import { usePush } from '@/routes/hooks'

export function CreateProjectForm() {
  const push = usePush()
  
  const handleSubmit = async (data: ProjectData) => {
    const project = await createProject(data)
    
    // ✅ Type-safe programmatic navigation
    push(ProjectDetail({ projectId: project.id }))
  }
  
  return <form onSubmit={handleSubmit}>...</form>
}
```

### Route Parameters

```typescript
import { useParams } from '@/routes/hooks'
import { ProjectDetail } from '@/routes'

export function ProjectPage() {
  // ✅ Typed route parameters
  const params = useParams(ProjectDetail)
  // params.projectId is typed as string
  
  return <div>Project ID: {params.projectId}</div>
}
```

### Search Parameters

```typescript
import { useSearchParams } from '@/routes/hooks'
import { ProjectList } from '@/routes'

export function ProjectFilters() {
  const searchParams = useSearchParams(ProjectList)
  // searchParams typed based on page.info.ts definition
  
  return (
    <div>
      <p>Search: {searchParams.search}</p>
      <p>Status: {searchParams.status}</p>
    </div>
  )
}
```

### Generating Routes

After modifying route structure:

```bash
# Generate route types and utilities
bun run web -- dr:build

# Watch mode for development
bun run web -- dr:build:watch
```

**When to regenerate:**
- Route file/folder renamed or moved
- Route parameters added/removed/renamed
- New routes added
- Route metadata changed in `page.info.ts`

---

## Custom Hooks Pattern

### Standard Hook Structure

Create custom hooks in `apps/web/src/hooks/` following this pattern:

```typescript
// hooks/useProjects.ts
'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { orpc } from '@/lib/orpc'
import { toast } from 'sonner'

// =============================================================================
// PROJECT MANAGEMENT HOOKS
// =============================================================================

/**
 * Fetch all projects
 */
export function useProjects() {
  return useQuery(orpc.project.list.queryOptions({
    input: {},
    staleTime: 1000 * 60, // 1 minute
  }))
}

/**
 * Fetch single project by ID
 */
export function useProject(projectId: string) {
  return useQuery(orpc.project.getById.queryOptions({
    input: { id: projectId },
    enabled: !!projectId,
    staleTime: 1000 * 30, // 30 seconds
  }))
}

/**
 * Create new project
 */
export function useCreateProject() {
  const queryClient = useQueryClient()
  
  return useMutation(orpc.project.create.mutationOptions({
    onSuccess: () => {
      queryClient.invalidateQueries({ 
        queryKey: orpc.project.list.getQueryKey({}) 
      })
      toast.success('Project created successfully')
    },
    onError: (error: Error) => {
      toast.error(`Failed to create project: ${error.message}`)
    },
  }))
}

/**
 * Update existing project
 */
export function useUpdateProject() {
  const queryClient = useQueryClient()
  
  return useMutation(orpc.project.update.mutationOptions({
    onSuccess: (data, { id }) => {
      queryClient.invalidateQueries({ 
        queryKey: orpc.project.getById.getQueryKey({ id }) 
      })
      queryClient.invalidateQueries({ 
        queryKey: orpc.project.list.getQueryKey({}) 
      })
      toast.success('Project updated successfully')
    },
    onError: (error: Error) => {
      toast.error(`Failed to update project: ${error.message}`)
    },
  }))
}

/**
 * Delete project
 */
export function useDeleteProject() {
  const queryClient = useQueryClient()
  
  return useMutation(orpc.project.delete.mutationOptions({
    onSuccess: () => {
      queryClient.invalidateQueries({ 
        queryKey: orpc.project.list.getQueryKey({}) 
      })
      toast.success('Project deleted successfully')
    },
    onError: (error: Error) => {
      toast.error(`Failed to delete project: ${error.message}`)
    },
  }))
}

/**
 * Utility hook combining all project actions
 */
export function useProjectActions() {
  const createProject = useCreateProject()
  const updateProject = useUpdateProject()
  const deleteProject = useDeleteProject()
  
  return {
    createProject: createProject.mutate,
    updateProject: updateProject.mutate,
    deleteProject: deleteProject.mutate,
    isLoading: {
      create: createProject.isPending,
      update: updateProject.isPending,
      delete: deleteProject.isPending,
    },
  }
}
```

### Hook Naming Conventions

- `use[Entity]` - Fetch single entity
- `use[Entity]s` or `use[Entity]List` - Fetch multiple entities
- `useCreate[Entity]` - Create mutation
- `useUpdate[Entity]` - Update mutation
- `useDelete[Entity]` - Delete mutation
- `use[Entity]Actions` - Combined actions utility hook

### Hook Organization

```
apps/web/src/hooks/
├── useProjects.ts          # Project-related hooks
├── useServices.ts          # Service-related hooks
├── useDeployments.ts       # Deployment-related hooks
├── useTraefik.ts           # Traefik-related hooks
├── useAuth.ts              # Auth-related hooks (if needed beyond lib/auth)
└── useAnalytics.ts         # Analytics hooks
```

---

## Component Patterns

### Client vs Server Components

#### Server Components (Default)

```typescript
// app/dashboard/projects/page.tsx
import { orpc } from '@/lib/orpc'

export default async function ProjectsPage() {
  // ✅ Direct data fetching in Server Component
  const projects = await orpc.project.list({
    input: {},
  }, {
    next: { revalidate: 60 }
  })
  
  return <ProjectsList projects={projects} />
}
```

**Use Server Components for:**
- Static content
- SEO-critical pages
- Data fetching without interactivity
- Reducing client-side JavaScript

#### Client Components

```typescript
// components/ProjectsList.tsx
'use client'

import { useProjects } from '@/hooks/useProjects'

export function ProjectsList() {
  const { data: projects, isLoading } = useProjects()
  
  if (isLoading) return <Skeleton />
  
  return <div>{/* Interactive list */}</div>
}
```

**Use Client Components for:**
- Interactive features (forms, buttons with onClick)
- React hooks (useState, useEffect, etc.)
- Browser APIs (localStorage, window, etc.)
- Third-party libraries requiring client-side

### Component File Structure

```typescript
// components/project/ProjectCard.tsx
'use client'

import { Card, CardHeader, CardContent } from '@repo/ui'
import { ProjectDetail } from '@/routes'
import { useProject } from '@/hooks/useProjects'
import { Badge } from '@repo/ui'

interface ProjectCardProps {
  projectId: string
}

export function ProjectCard({ projectId }: ProjectCardProps) {
  const { data: project, isLoading, error } = useProject(projectId)
  
  if (isLoading) return <ProjectCardSkeleton />
  if (error) return <ProjectCardError error={error} />
  if (!project) return null
  
  return (
    <Card>
      <CardHeader>
        <h3>{project.name}</h3>
        <Badge variant={project.status}>{project.status}</Badge>
      </CardHeader>
      <CardContent>
        <p>{project.description}</p>
        <ProjectDetail.Link projectId={project.id}>
          View Details
        </ProjectDetail.Link>
      </CardContent>
    </Card>
  )
}

// Loading skeleton
function ProjectCardSkeleton() {
  return <Card><Skeleton className="h-32" /></Card>
}

// Error state
function ProjectCardError({ error }: { error: Error }) {
  return (
    <Card>
      <CardContent>
        <p className="text-red-500">Error: {error.message}</p>
      </CardContent>
    </Card>
  )
}
```

### Form Components Pattern

```typescript
'use client'

import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useCreateProject } from '@/hooks/useProjects'
import { Form, FormField, FormItem, FormLabel, FormControl } from '@repo/ui'
import { Input, Button } from '@repo/ui'

const projectSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  description: z.string().optional(),
})

type ProjectFormData = z.infer<typeof projectSchema>

export function CreateProjectForm() {
  const form = useForm<ProjectFormData>({
    resolver: zodResolver(projectSchema),
  })
  
  const createProject = useCreateProject()
  
  const onSubmit = (data: ProjectFormData) => {
    createProject.mutate(data)
  }
  
  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)}>
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Project Name</FormLabel>
              <FormControl>
                <Input {...field} />
              </FormControl>
            </FormItem>
          )}
        />
        
        <Button type="submit" disabled={createProject.isPending}>
          {createProject.isPending ? 'Creating...' : 'Create Project'}
        </Button>
      </form>
    </Form>
  )
}
```

---

## State Management

### When to Use Zustand vs React Query

#### React Query (Preferred for Server State)

```typescript
// ✅ Use React Query for:
// - Data from API
// - Cached server state
// - Automatic refetching

import { useProjects } from '@/hooks/useProjects'

const { data: projects } = useProjects()
```

#### Zustand (For UI State)

```typescript
// ✅ Use Zustand for:
// - UI state (modals, sidebar, theme)
// - Client-only state
// - Global app state

import { create } from 'zustand'

interface UIStore {
  sidebarOpen: boolean
  toggleSidebar: () => void
}

export const useUIStore = create<UIStore>((set) => ({
  sidebarOpen: true,
  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
}))
```

### Zustand Store Pattern

```typescript
// stores/useProjectStore.ts
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface ProjectStore {
  // State
  selectedProjectId: string | null
  viewMode: 'grid' | 'list'
  
  // Actions
  setSelectedProject: (id: string | null) => void
  setViewMode: (mode: 'grid' | 'list') => void
}

export const useProjectStore = create<ProjectStore>()(
  persist(
    (set) => ({
      selectedProjectId: null,
      viewMode: 'grid',
      
      setSelectedProject: (id) => set({ selectedProjectId: id }),
      setViewMode: (mode) => set({ viewMode: mode }),
    }),
    {
      name: 'project-store', // localStorage key
    }
  )
)
```

---

## Error Handling

### Query Error Handling

```typescript
import { useProjects } from '@/hooks/useProjects'

export function ProjectsList() {
  const { data, isLoading, error, refetch } = useProjects()
  
  if (isLoading) return <Skeleton />
  
  if (error) {
    return (
      <div className="error-container">
        <p className="text-red-500">Failed to load projects</p>
        <p className="text-sm text-gray-500">{error.message}</p>
        <Button onClick={() => refetch()}>Retry</Button>
      </div>
    )
  }
  
  if (!data || data.length === 0) {
    return <EmptyState />
  }
  
  return <div>{/* Render projects */}</div>
}
```

### Mutation Error Handling

```typescript
export function useCreateProject() {
  const queryClient = useQueryClient()
  
  return useMutation(orpc.project.create.mutationOptions({
    onSuccess: () => {
      queryClient.invalidateQueries({ 
        queryKey: orpc.project.list.getQueryKey({}) 
      })
      toast.success('Project created successfully')
    },
    onError: (error: Error) => {
      // Log error for debugging
      console.error('Create project failed:', error)
      
      // Show user-friendly message
      if (error.message.includes('duplicate')) {
        toast.error('A project with this name already exists')
      } else if (error.message.includes('unauthorized')) {
        toast.error('You do not have permission to create projects')
      } else {
        toast.error(`Failed to create project: ${error.message}`)
      }
    },
  }))
}
```

### Global Error Boundary

```typescript
// components/ErrorBoundary.tsx
'use client'

import { Component, ReactNode } from 'react'
import { Button } from '@repo/ui'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  error?: Error
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false }
  }
  
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error }
  }
  
  componentDidCatch(error: Error, errorInfo: any) {
    console.error('Error boundary caught:', error, errorInfo)
  }
  
  render() {
    if (this.state.hasError) {
      return (
        <div className="error-boundary">
          <h2>Something went wrong</h2>
          <p>{this.state.error?.message}</p>
          <Button onClick={() => this.setState({ hasError: false })}>
            Try again
          </Button>
        </div>
      )
    }
    
    return this.props.children
  }
}
```

---

## Best Practices

### 1. Always Use Type-Safe Patterns

```typescript
// ✅ GOOD - Type-safe patterns
import { orpc } from '@/lib/orpc'
import { ProjectDetail } from '@/routes'
import { useSession } from '@/lib/auth'

const { data } = useQuery(orpc.project.list.queryOptions({ input: {} }))
<ProjectDetail.Link projectId={id}>View</ProjectDetail.Link>
const { data: session } = useSession()

// ❌ BAD - Manual/unsafe patterns
const data = await fetch('/api/projects')
<Link href={`/projects/${id}`}>View</Link>
const session = await fetch('/api/auth/session')
```

### 2. Colocate Related Code

```
app/dashboard/projects/
├── page.tsx                    # Server Component
├── page.info.ts                # Route definition
├── ProjectsList.tsx            # Client Component
├── CreateProjectDialog.tsx     # Client Component
└── hooks/
    └── useProjectFilters.ts    # Page-specific hooks
```

### 3. Extract Reusable Logic to Hooks

```typescript
// ❌ BAD - Logic in component
export function ProjectCard({ projectId }: Props) {
  const { data, isLoading } = useQuery(orpc.project.getById.queryOptions({
    input: { id: projectId },
  }))
  // ... more logic
}

// ✅ GOOD - Extracted to hook
export function useProject(projectId: string) {
  return useQuery(orpc.project.getById.queryOptions({
    input: { id: projectId },
    enabled: !!projectId,
  }))
}

export function ProjectCard({ projectId }: Props) {
  const { data, isLoading } = useProject(projectId)
  // ... render logic only
}
```

### 4. Handle Loading and Error States

```typescript
// ✅ GOOD - All states handled
export function ProjectsList() {
  const { data, isLoading, error } = useProjects()
  
  if (isLoading) return <Skeleton />
  if (error) return <ErrorMessage error={error} />
  if (!data || data.length === 0) return <EmptyState />
  
  return <div>{/* Render data */}</div>
}

// ❌ BAD - Missing states
export function ProjectsList() {
  const { data } = useProjects()
  return <div>{data.map(...)}</div> // Crashes if loading or error
}
```

### 5. Use Proper Cache Invalidation

```typescript
// ✅ GOOD - Specific invalidation
export function useUpdateProject() {
  const queryClient = useQueryClient()
  
  return useMutation(orpc.project.update.mutationOptions({
    onSuccess: (data, { id }) => {
      // Invalidate specific project
      queryClient.invalidateQueries({ 
        queryKey: orpc.project.getById.getQueryKey({ id }) 
      })
      // Invalidate list
      queryClient.invalidateQueries({ 
        queryKey: orpc.project.list.getQueryKey({}) 
      })
    },
  }))
}

// ❌ BAD - Over-invalidation
queryClient.invalidateQueries() // Invalidates EVERYTHING
```

### 6. Consistent File Naming

- **Components**: PascalCase - `ProjectCard.tsx`
- **Hooks**: camelCase with 'use' prefix - `useProjects.ts`
- **Utilities**: camelCase - `formatDate.ts`
- **Types**: PascalCase - `ProjectTypes.ts`
- **Stores**: camelCase with 'use' prefix - `useProjectStore.ts`

### 7. Component Prop Types

```typescript
// ✅ GOOD - Explicit interface
interface ProjectCardProps {
  projectId: string
  variant?: 'compact' | 'full'
  onSelect?: (id: string) => void
}

export function ProjectCard({ 
  projectId, 
  variant = 'full',
  onSelect 
}: ProjectCardProps) {
  // ...
}

// ❌ BAD - Inline types
export function ProjectCard({ projectId, variant }: { 
  projectId: string
  variant?: string 
}) {
  // ...
}
```

### 8. Keep Components Focused

```typescript
// ✅ GOOD - Single responsibility
export function ProjectCard({ project }: Props) {
  return (
    <Card>
      <ProjectCardHeader project={project} />
      <ProjectCardContent project={project} />
      <ProjectCardActions project={project} />
    </Card>
  )
}

// ❌ BAD - Too many responsibilities
export function ProjectCard({ project }: Props) {
  // 300 lines of JSX for header, content, actions, modals, forms...
}
```

---

## Summary

### The Three Pillars of Frontend Development

1. **ORPC Integration** - Type-safe API communication
   - Use `orpc.contract.method.queryOptions()` pattern
   - Handle loading, error, and success states
   - Invalidate queries after mutations

2. **Better Auth** - Session and authentication
   - Use `useSession()` for current user
   - Use `signIn/signOut` for authentication actions
   - Protect routes with session checks

3. **Declarative Routing** - Type-safe navigation
   - Use `Route.Link` components for navigation
   - Use `usePush` for programmatic navigation
   - Regenerate routes after structure changes

### Quick Checklist

Before implementing any frontend feature:

- [ ] ✅ Read this documentation
- [ ] ✅ Use ORPC with `queryOptions` pattern
- [ ] ✅ Use Better Auth hooks for authentication
- [ ] ✅ Use Declarative Routing for navigation
- [ ] ✅ Extract logic to custom hooks
- [ ] ✅ Handle all component states (loading, error, empty, success)
- [ ] ✅ Invalidate queries after mutations
- [ ] ✅ Use TypeScript for all code
- [ ] ✅ Follow naming conventions
- [ ] ✅ Keep components focused and small

---

## Related Documentation

- **ORPC Contracts**: [`reference/ORPC-TYPE-CONTRACTS.md`](../reference/ORPC-TYPE-CONTRACTS.md) - API contract definitions
- **Frontend Spec**: [`specifications/FRONTEND-SPECIFICATION.md`](../specifications/FRONTEND-SPECIFICATION.md) - UI/UX specifications
- **Declarative Routing**: [`apps/web/src/routes/README.md`](../../apps/web/src/routes/README.md) - Routing system details
- **Architecture**: [`architecture/ARCHITECTURE.md`](../architecture/ARCHITECTURE.md) - System architecture

---

**Status**: 📝 Specification (active development pattern)
