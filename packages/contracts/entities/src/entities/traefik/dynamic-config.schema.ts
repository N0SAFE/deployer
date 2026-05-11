import z from 'zod/v4'

export const traefikDynamicConfigSchema = z.object({
  http: z
    .object({
      routers: z.record(z.string(), z.record(z.string(), z.unknown())).optional(),
      services: z.record(z.string(), z.record(z.string(), z.unknown())).optional(),
      middlewares: z.record(z.string(), z.record(z.string(), z.unknown())).optional(),
    })
    .optional(),
  tcp: z.record(z.string(), z.unknown()).optional(),
  udp: z.record(z.string(), z.unknown()).optional(),
})

export type TraefikDynamicConfig = z.infer<typeof traefikDynamicConfigSchema>
