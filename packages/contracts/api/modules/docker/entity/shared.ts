import { dockerEntityKindSchema, dockerEntityStreamQuerySchema } from "@repo/contracts-entities";
import z from "zod/v4";

export const dockerEntityListInputSchema = z.object({
  kind: dockerEntityKindSchema,
  limit: z.number().int().min(1).max(500).default(100),
  offset: z.number().int().min(0).default(0),
})
export type DockerEntityListInput = z.infer<typeof dockerEntityListInputSchema>

export const dockerEntityInspectInputSchema = z.object({
  kind: dockerEntityKindSchema,
  id: z.string().min(1),
})
export type DockerEntityInspectInput = z.infer<typeof dockerEntityInspectInputSchema>

export const dockerEntityStreamInputSchema = dockerEntityStreamQuerySchema
export type DockerEntityStreamInput = z.infer<typeof dockerEntityStreamInputSchema>
