/**
 * Server-side utility functions for error handling and data fetching
 */

import type { QueryClient } from '@tanstack/react-query'

/**
 * A utility function to simplify try-catch blocks when prefetching data in server components.
 * Instead of using let data: Type | null = null; try { data = await fetchData() } catch {},
 * you can use: const data = await tryCatch(() => fetchData(), (error) => console.error(error))
 * 
 * @param tryFn - The function to execute that might throw an error
 * @param catchFn - Optional function to handle the error (receives the error as parameter)
 * @returns The result of tryFn if successful, null if an error occurs
 * 
 * @example
 * // Instead of:
 * let userData: User | null = null;
 * try {
 *   userData = await orpc.user.getById({ input: { id: userId } });
 * } catch (error) {
 *   console.error('Failed to fetch user:', error);
 * }
 * 
 * // Use:
 * const userData = await tryCatch(
 *   () => orpc.user.getById({ input: { id: userId } }),
 *   (error) => console.error('Failed to fetch user:', error)
 * );
 */
export async function tryCatch<T>(
  tryFn: () => Promise<T>,
  catchFn?: (error: unknown) => void
): Promise<T | null> {
  try {
    return await tryFn()
  } catch (error) {
    if (catchFn) {
      catchFn(error)
    }
    return null
  }
}

/**
 * Synchronous version of tryCatch for non-async operations
 * 
 * @param tryFn - The function to execute that might throw an error
 * @param catchFn - Optional function to handle the error (receives the error as parameter)
 * @returns The result of tryFn if successful, null if an error occurs
 * 
 * @example
 * const parsedData = tryCatchSync(
 *   () => JSON.parse(jsonString),
 *   (error) => console.error('Failed to parse JSON:', error)
 * );
 */
export function tryCatchSync<T>(
  tryFn: () => T,
  catchFn?: (error: unknown) => void
): T | null {
  try {
    return tryFn()
  } catch (error) {
    if (catchFn) {
      catchFn(error)
    }
    return null
  }
}

/**
 * A utility function to handle multiple async operations with individual error handling.
 * Returns an array of results where failed operations return null.
 * 
 * @param operations - Array of async functions to execute
 * @param catchFn - Optional function to handle errors (receives error and index)
 * @returns Array of results where successful operations return their value and failed ones return null
 * 
 * @example
 * const [userData, projectData, serviceData] = await tryCatchAll([
 *   () => orpc.user.getById({ input: { id: userId } }),
 *   () => orpc.project.getById({ input: { id: projectId } }),
 *   () => orpc.service.getById({ input: { id: serviceId } })
 * ], (error, index) => console.error(`Operation ${index} failed:`, error));
 */
export async function tryCatchAll<T extends readonly unknown[]>(
  operations: readonly [...{ [K in keyof T]: () => Promise<T[K]> }],
  catchFn?: (error: unknown, index: number) => void
): Promise<{ [K in keyof T]: T[K] | null }> {
  const results = await Promise.allSettled(
    operations.map((fn, index) => 
      fn().catch((error) => {
        if (catchFn) {
          catchFn(error, index)
        }
        throw error
      })
    )
  )

  return results.map((result) => 
    result.status === 'fulfilled' ? result.value : null
  ) as { [K in keyof T]: T[K] | null }
}

/**
 * A utility function specifically for QueryClient prefetch operations.
 * Handles the common pattern of prefetching data and continuing on error.
 * 
 * @param queryClient - The TanStack Query client instance
 * @param queryOptions - The query options to prefetch
 * @param catchFn - Optional function to handle the error
 * @returns Promise that resolves when prefetch is complete (success or failure)
 * 
 * @example
 * await prefetchWithFallback(
 *   queryClient,
 *   orpc.user.getById.queryOptions({ input: { id: userId } }),
 *   (error) => console.error('Failed to prefetch user data:', error)
 * );
 */
export async function prefetchWithFallback(
  queryClient: QueryClient,
  queryOptions: Parameters<QueryClient['prefetchQuery']>[0],
  catchFn?: (error: unknown) => void
): Promise<void> {
  try {
    await queryClient.prefetchQuery(queryOptions)
  } catch (error) {
    if (catchFn) {
      catchFn(error)
    }
    // Continue silently - client-side will handle the loading state
  }
}