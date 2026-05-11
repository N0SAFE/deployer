import z from 'zod/v4'

export const traefikRuleSchema = z.object({
  rule: z.string(),
  priority: z.number().int().optional(),
  entryPoints: z.array(z.string()).optional(),
  middlewares: z.array(z.string()).optional(),
  tls: z
    .object({
      enabled: z.boolean().optional(),
      certResolver: z.string().optional(),
      domains: z.array(z.object({ main: z.string(), sans: z.array(z.string()).optional() })).optional(),
    })
    .optional(),
})

export const traefikServiceSchema = z.object({
  name: z.string(),
  loadBalancer: z
    .object({
      servers: z.array(z.object({ url: z.string().url().optional(), address: z.string().optional() })),
      passHostHeader: z.boolean().optional(),
    })
    .optional(),
})
