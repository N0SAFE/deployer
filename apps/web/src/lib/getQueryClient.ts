import { QueryClient } from '@tanstack/react-query'
import { cache } from 'react'

// Create a stable query client for server-side rendering
// Using React's cache() to ensure the same instance is reused during SSR
const getQueryClient = cache(() => {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Don't refetch immediately during SSR
        staleTime: 1000 * 60 * 5, // 5 minutes
        gcTime: 1000 * 60 * 10, // 10 minutes  
        // Don't retry on server
        retry: false,
      },
    },
  })
})

export default getQueryClient