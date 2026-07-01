import { z } from 'zod/v4'

export const migrationEntrySchema = z.object({
  version: z.string().regex(/^\d{4}$/),
  name: z.string().min(1),
  minAppVersion: z.string().regex(/^[><=!~^]+\d+\.\d+\.\d+/),
  minSchemaVersion: z.string().nullable(),
  description: z.string().optional(),
})

export const migrationManifestSchema = z.object({
  $schema: z.string().optional(),
  currentSchemaVersion: z.string().regex(/^\d{4}$/),
  migrations: z.array(migrationEntrySchema),
})

export type MigrationManifest = z.infer<typeof migrationManifestSchema>
export type MigrationEntry = z.infer<typeof migrationEntrySchema>
