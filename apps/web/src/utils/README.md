# Server Utils - Error Handling Utilities for Server Components

This module provides utility functions to simplify error handling when prefetching data in server components, eliminating the need for verbose try-catch blocks and manual null initialization.

## Quick Start

```typescript
import { tryCatch, tryCatchAll, prefetchWithFallback } from '@/utils/server'

// Instead of this verbose pattern:
let userData: User | null = null
try {
  userData = await orpc.user.getById({ input: { id: userId } })
} catch (error) {
  console.error('Failed to fetch user:', error)
}

// Use this clean pattern:
const userData = await tryCatch(
  () => orpc.user.getById({ input: { id: userId } }),
  (error) => console.error('Failed to fetch user:', error)
)
```

## Available Functions

### `tryCatch<T>(tryFn, catchFn?) → Promise<T | null>`

Simplifies async try-catch blocks with automatic null return on error.

**Parameters:**
- `tryFn: () => Promise<T>` - The async function to execute
- `catchFn?: (error: unknown) => void` - Optional error handler

**Returns:** `Promise<T | null>` - Result of tryFn or null on error

**Example:**
```typescript
const orpc = await tryCatch(
  async () => await fetch(),
  (error) => console.error('Failed to create ORPC client:', error)
)

if (orpc) {
  // Use orpc safely
}
```

### `tryCatchSync<T>(tryFn, catchFn?) → T | null`

Synchronous version of tryCatch for non-async operations.

**Example:**
```typescript
const config = tryCatchSync(
  () => JSON.parse(configString),
  (error) => console.error('Failed to parse JSON:', error)
)
```

### `tryCatchAll<T>(operations, catchFn?) → Promise<Array<T | null>>`

Handles multiple async operations with individual error handling.

**Parameters:**
- `operations: Array<() => Promise<T>>` - Array of async functions
- `catchFn?: (error: unknown, index: number) => void` - Optional error handler with operation index

**Example:**
```typescript
const [userData, projectData, serviceData] = await tryCatchAll([
  () => orpc.user.getById({ input: { id: userId } }),
  () => orpc.project.getById({ input: { id: projectId } }),
  () => orpc.service.getById({ input: { id: serviceId } })
], (error, index) => {
  const operations = ['user', 'project', 'service']
  console.error(`Failed to fetch ${operations[index]} data:`, error)
})
```

### `prefetchWithFallback(queryClient, queryOptions, catchFn?) → Promise<void>`

Specialized utility for QueryClient prefetch operations.

**Example:**
```typescript
await prefetchWithFallback(
  queryClient,
  orpc.user.getById.queryOptions({ input: { id: userId } }),
  (error) => console.error('Failed to prefetch user data:', error)
)
```

## Real-World Examples

### Before and After Comparison

**❌ Old verbose pattern:**
```typescript
export default async function ServiceLayout({ params }) {
  const { projectId, serviceId } = await params
  const queryClient = getQueryClient()

  let service: ServiceType | null = null
  let deploymentsData: DeploymentsType | null = null

  try {
    const [serviceResult, deploymentsResult] = await Promise.allSettled([
      queryClient.fetchQuery(orpc.service.getById.queryOptions({ input: { id: serviceId } })),
      queryClient.fetchQuery(orpc.service.getDeployments.queryOptions({ input: { id: serviceId, limit: 50 } }))
    ])

    if (serviceResult.status === 'fulfilled') {
      service = serviceResult.value
      queryClient.setQueryData(orpc.service.getById.queryKey({ input: { id: serviceId } }), serviceResult.value)
    }

    if (deploymentsResult.status === 'fulfilled') {
      deploymentsData = deploymentsResult.value
      queryClient.setQueryData(orpc.service.getDeployments.queryKey({ input: { id: serviceId, limit: 50 } }), deploymentsResult.value)
    }
  } catch (error) {
    console.error('Failed to prefetch service data:', error)
  }

  // Rest of component...
}
```

**✅ New clean pattern:**
```typescript
import { tryCatchAll } from '@/utils/server'

export default async function ServiceLayout({ params }) {
  const { projectId, serviceId } = await params
  const queryClient = getQueryClient()

  const [service, deploymentsData] = await tryCatchAll([
    async () => {
      const result = await queryClient.fetchQuery(orpc.service.getById.queryOptions({ input: { id: serviceId } }))
      queryClient.setQueryData(orpc.service.getById.queryKey({ input: { id: serviceId } }), result)
      return result
    },
    async () => {
      const result = await queryClient.fetchQuery(orpc.service.getDeployments.queryOptions({ input: { id: serviceId, limit: 50 } }))
      queryClient.setQueryData(orpc.service.getDeployments.queryKey({ input: { id: serviceId, limit: 50 } }), result)
      return result
    }
  ], (error, index) => {
    const operation = index === 0 ? 'service data' : 'deployments data'
    console.error(`Failed to fetch ${operation}:`, error)
  })

  // Rest of component...
}
```

### Complex Server Component Example

```typescript
import { tryCatch, tryCatchAll } from '@/utils/server'

export default async function ComplexServerComponent({ params }) {
  const { projectId, serviceId } = await params
  const queryClient = getQueryClient()
  
  // Step 1: Create ORPC client with error handling
  const orpc = await tryCatch(
    async () => await fetch(),
    (error) => console.error('Failed to create ORPC client:', error)
  )
  
  if (!orpc) {
    return <ErrorFallback message="Failed to initialize API client" />
  }
  
  // Step 2: Fetch multiple data sources with individual error handling
  const [projectData, serviceData, metricsData, logsData] = await tryCatchAll([
    () => queryClient.fetchQuery(orpc.project.getById.queryOptions({ input: { id: projectId } })),
    () => queryClient.fetchQuery(orpc.service.getById.queryOptions({ input: { id: serviceId } })),
    () => queryClient.fetchQuery(orpc.service.getMetrics.queryOptions({ input: { id: serviceId, timeRange: '1h' } })),
    () => queryClient.fetchQuery(orpc.service.getLogs.queryOptions({ input: { id: serviceId, limit: 100 } }))
  ], (error, index) => {
    const operations = ['project', 'service', 'metrics', 'logs']
    console.error(`Failed to fetch ${operations[index]} data:`, error)
  })
  
  return (
    <div>
      <ProjectInfo data={projectData} />
      <ServiceInfo data={serviceData} />
      <MetricsChart data={metricsData} />
      <LogsTable data={logsData} />
    </div>
  )
}
```

## Benefits

### 🎯 **Cleaner Code**
- Eliminates manual null initialization: `let data: Type | null = null`
- Reduces boilerplate try-catch blocks
- More readable and maintainable code

### 🛡️ **Better Error Handling**
- Consistent error handling patterns across components
- Individual error messages for different operations
- Graceful degradation when operations fail

### 🚀 **Type Safety**
- Maintains TypeScript types through the error handling chain
- Automatic null handling with proper type inference
- Better IntelliSense and development experience

### 🔧 **Reusability**
- Utilities can be used across different server components
- Consistent patterns across the entire codebase
- Easy to test and maintain

### 📈 **Better Debugging**
- Specific error messages for each operation
- Clear indication of which operation failed
- Enhanced logging and monitoring capabilities

## Testing

The utilities come with comprehensive test coverage. Run tests with:

```bash
bun run test utils/__tests__/server.test.ts
```

## Migration Guide

To migrate existing server components:

1. **Replace manual null initialization:**
   ```diff
   - let userData: User | null = null
   - try {
   -   userData = await fetchUser()
   - } catch (error) {
   -   console.error(error)
   - }
   + const userData = await tryCatch(
   +   () => fetchUser(),
   +   (error) => console.error(error)
   + )
   ```

2. **Replace Promise.allSettled patterns:**
   ```diff
   - const results = await Promise.allSettled([op1(), op2(), op3()])
   - const data1 = results[0].status === 'fulfilled' ? results[0].value : null
   - const data2 = results[1].status === 'fulfilled' ? results[1].value : null
   - const data3 = results[2].status === 'fulfilled' ? results[2].value : null
   + const [data1, data2, data3] = await tryCatchAll([op1, op2, op3])
   ```

3. **Simplify prefetch operations:**
   ```diff
   - try {
   -   await queryClient.prefetchQuery(queryOptions)
   - } catch (error) {
   -   console.error('Prefetch failed:', error)
   - }
   + await prefetchWithFallback(queryClient, queryOptions, (error) => console.error('Prefetch failed:', error))
   ```

## Best Practices

1. **Always provide meaningful error messages** that help with debugging
2. **Use tryCatchAll for related operations** that can be handled together
3. **Check for null returns** before using the data in your components
4. **Combine with React's Suspense** and Error Boundaries for complete error handling
5. **Log errors with context** (component name, operation type, relevant IDs)

## Related

- See `server-examples.ts` for more detailed usage examples
- Check existing server components for real-world implementations
- Review the test file for edge cases and expected behaviors