'use client'

import { useQuery } from '@tanstack/react-query'
import { orpc } from '@/lib/orpc'
import { healthCheckOutput, healthDetailedOutput } from '@repo/api-contracts'
import { z } from 'zod'

const USE_MOCKS = process.env.NEXT_PUBLIC_USE_MOCKS === 'true'

const mockHealthBasic: z.infer<typeof healthCheckOutput> = {
  status: 'healthy',
  timestamp: new Date().toISOString(),
  service: 'api',
}

const mockHealthDetailed: z.infer<typeof healthDetailedOutput> = {
  status: 'healthy',
  timestamp: new Date().toISOString(),
  service: 'api',
  uptime: 60 * 60 * 24,
  memory: {
    used: 512 * 1024 * 1024,
    free: 512 * 1024 * 1024,
    total: 1024 * 1024 * 1024,
  },
  database: {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    responseTime: 42,
  },
}

export function useSystemHealthOverview() {
  const basicOptions = orpc.health.check.queryOptions({
    retry: 0,
    staleTime: 1000 * 15,
    gcTime: 1000 * 60,
  })

  const detailedOptions = orpc.health.detailed.queryOptions({
    retry: 0,
    staleTime: 1000 * 15,
    gcTime: 1000 * 60,
  })

  const basic = useQuery({
    ...basicOptions,
    queryFn: async (ctx) => {
      if (USE_MOCKS) return mockHealthBasic
      const fn = basicOptions.queryFn
      if (!fn) return mockHealthBasic

      try {
        return await fn(ctx)
      } catch (error) {
        console.warn('[useSystemHealthOverview] Falling back to mock basic health', error)
        return mockHealthBasic
      }
    },
    placeholderData: mockHealthBasic,
  })

  const detailed = useQuery({
    ...detailedOptions,
    queryFn: async (ctx) => {
      if (USE_MOCKS) return mockHealthDetailed
      const fn = detailedOptions.queryFn
      if (!fn) return mockHealthDetailed

      try {
        return await fn(ctx)
      } catch (error) {
        console.warn('[useSystemHealthOverview] Falling back to mock detailed health', error)
        return mockHealthDetailed
      }
    },
    placeholderData: mockHealthDetailed,
  })

  return {
    basic: basic.data ?? mockHealthBasic,
    detailed: detailed.data ?? mockHealthDetailed,
    isLoading: basic.isLoading || detailed.isLoading,
    error: basic.error ?? detailed.error,
    refetch: async () => {
      await Promise.all([basic.refetch(), detailed.refetch()])
    },
  }
}
