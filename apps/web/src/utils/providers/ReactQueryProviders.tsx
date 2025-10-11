'use client'

import { useState, ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

export default function ReactQueryProviders({
    children,
}: Readonly<{ children: ReactNode }>) {
    const [queryClient] = useState(() => new QueryClient({
        defaultOptions: {
            queries: {
                // Prevent queries from retrying on abort errors
                retry: (failureCount, error) => {
                    // Don't retry on abort errors
                    if (error?.name === 'AbortError' || (error && typeof error === 'object' && 'code' in error && error.code === 'ABORT_ERR')) {
                        return false;
                    }
                    // Don't retry on 401/403 errors
                    if (error && typeof error === 'object' && 'status' in error && (error.status === 401 || error.status === 403)) {
                        return false;
                    }
                    // Retry up to 3 times for other errors
                    return failureCount < 3;
                },
                // Reduce stale time for real-time data
                staleTime: 1000 * 30, // 30 seconds
                // Cache time for inactive queries
                gcTime: 1000 * 60 * 5, // 5 minutes
            },
            mutations: {
                // Don't retry mutations on abort errors
                retry: (failureCount, error) => {
                    if (error?.name === 'AbortError' || (error && typeof error === 'object' && 'code' in error && error.code === 'ABORT_ERR')) {
                        return false;
                    }
                    return failureCount < 1;
                }
            }
        }
    }))
    
    return (
        <QueryClientProvider client={queryClient}>
            {children}
        </QueryClientProvider>
    )
}
