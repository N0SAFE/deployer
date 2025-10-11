import { z } from 'zod'

export const Route = {
    name: 'Autherror',
    params: z.object({}),
    search: z.object({
        error: z.string().optional(),
    }),
}
