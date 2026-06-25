import { z } from 'zod'

// Auto-generated flags - DO NOT EDIT manually, these are synced by dr:build
export const page = true
export const layout = false
export const Route = {
    name: 'AuthDashboardDockerImages',
    params: z.object({}),
    search: z.object({
        q: z.string().default(''),
        view: z.enum(['all', 'failed', 'popular']).default('all'),
        sortBy: z
            .enum(['usage', 'name', 'failed', 'lastSeen'])
            .default('usage'),
        sortDirection: z.enum(['asc', 'desc']).default('desc'),
        page: z.number().int().min(1).default(1),
        pageSize: z.number().int().min(10).max(100).default(20),
    }),
}
