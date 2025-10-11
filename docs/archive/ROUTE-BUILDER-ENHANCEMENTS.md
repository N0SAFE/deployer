# Enhanced RouteBuilder Utilities

The RouteBuilder has been enhanced with additional utilities to provide better type safety and developer experience for page components. These utilities intelligently handle server-side vs client-side rendering.

## New Features

### 1. `Page` - Smart Page Component Wrapper

Wrap your page component for automatic type inference with smart server/client handling:

```tsx
import { DashboardProjectsProjectIdTabsSsl } from '@/routes'

export default DashboardProjectsProjectIdTabsSsl.Page(function ProjectSslPage({ params, searchParams }) {
  // params: { projectId: string } - automatically typed!
  // searchParams: {} - typed based on route schema
  const { projectId } = params
  
  return <div>SSL for project: {projectId}</div>
})
```

**Smart Behavior:**
- **Server-side**: Uses `params` and `searchParams` from Next.js page props directly
- **Client-side**: Automatically uses `useParams` and `useSearchParams` hooks for updated values

### 2. Async Server Components

The `Page` wrapper works seamlessly with async server components:

```tsx
export default DashboardProjectsProjectIdTabsSsl.Page(async function ProjectSslPage({ 
  params, 
  searchParams 
}) {
  const { projectId } = params
  
  // Async operations work naturally in server components
  const data = await fetch(`/api/projects/${projectId}/ssl`)
  
  return <div>SSL for project: {projectId}</div>
})
```

### 3. `createPage` - Smart Page Factory with Additional Props

Create a page factory for components that need additional props with smart server/client handling:

```tsx
const createSslPage = DashboardProjectsProjectIdTabsSsl.createPage<{ 
  additionalProp?: string 
}>()

export const ProjectSslPageWithProps = createSslPage(function ProjectSslPage({ 
  params, 
  searchParams, 
  additionalProp 
}) {
  // All props are properly typed
  const { projectId } = params
  
  return (
    <div>
      <h1>SSL for project: {projectId}</h1>
      {additionalProp && <p>Additional: {additionalProp}</p>}
    </div>
  )
})
```

**Smart Behavior:**
- **Server-side**: Uses props as-is
- **Client-side**: Dynamically imports and uses route hooks to get current params/search

### 4. Validation Helpers

Manual validation with proper typing:

```tsx
export function ProjectSslPageWithValidation({ params: rawParams, searchParams: rawSearch }: any) {
  // Manual validation with proper typing
  const params = DashboardProjectsProjectIdTabsSsl.validateParams(rawParams)
  const searchParams = DashboardProjectsProjectIdTabsSsl.validateSearch(rawSearch)
  
  const { projectId } = params // Fully typed
  
  return <div>SSL for project: {projectId}</div>
}
```

### 5. Type Utilities

Get typed shapes for use in other places:

```tsx
import type { RouteBuilderParams, RouteBuilderSearch } from '@/routes/makeRoute'
import { DashboardProjectsProjectIdTabsSsl } from '@/routes'

function someUtility() {
  // Extract types from RouteBuilder
  type ParamsType = RouteBuilderParams<typeof DashboardProjectsProjectIdTabsSsl>  // { projectId: string }
  type SearchType = RouteBuilderSearch<typeof DashboardProjectsProjectIdTabsSsl>  // {} (empty object)
  
  // Use in function parameters
  function handleParams(params: ParamsType) {
    console.log(params.projectId) // Fully typed!
  }
  
  function handleSearch(search: SearchType) {
    // Typed based on route's search schema
  }
}
```

## API Reference

### Types

- `BasePageProps` - Base props all pages receive (includes `children?`)
- `PageProps<Params, Search>` - Standard page props with typed params and searchParams
- `PageComponent<Params, Search, AdditionalProps>` - Page component type
- `RouteBuilderParams<Builder>` - Extract params type from RouteBuilder
- `RouteBuilderSearch<Builder>` - Extract search type from RouteBuilder

### Methods

- `Page<AdditionalProps>(component)` - Wrap a page component (supports both sync and async)
- `createPage<AdditionalProps>()` - Create a page factory function
- `validateParams(params)` - Validate and return typed params
- `validateSearch(search)` - Validate and return typed search

## Migration

### Before
```tsx
export default function ProjectSslPage() {
  const params = useParams(DashboardProjectsProjectIdTabsSsl)
  const projectId = params.projectId // Could be undefined, manual typing
  
  return <div>SSL for project: {projectId}</div>
}
```

### After
```tsx
export default DashboardProjectsProjectIdTabsSsl.Page(function ProjectSslPage({ params }) {
  const { projectId } = params // Guaranteed to be string, fully typed
  
  return <div>SSL for project: {projectId}</div>
})
```

## Benefits

1. **Type Safety**: Automatic type inference from route schemas
2. **Developer Experience**: Less boilerplate, clearer intent
3. **Runtime Safety**: Built-in validation using existing Zod schemas
4. **Flexibility**: Multiple patterns for different use cases
5. **Migration Friendly**: Can be adopted incrementally
6. **Smart Server/Client Handling**: Automatically adapts behavior based on execution environment
   - Server: Uses Next.js props directly for optimal performance
   - Client: Uses route hooks for reactive updates
7. **Tree Shaking**: Client-side hooks are only imported when needed (dynamic imports)
8. **Zero Runtime Overhead**: Server-side components have no additional runtime cost