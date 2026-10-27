import z from 'zod/v4'
import { setupStateSnapshotSchema } from './state.schema'

export const setupConfigureDatabaseInputSchema = z.object({
  databaseUrl: z.string().min(1, 'Database URL is required'),
  /** If true, only test the connection without saving — useful for validation UI */
  testOnly: z.boolean().optional().default(false),
  /** Node identity override. If omitted a UUID is auto-generated and stored. */
  nodeId: z.uuid().optional(),
})
export type SetupConfigureDatabaseInput = z.infer<typeof setupConfigureDatabaseInputSchema>

export const setupConfigureDatabaseResultSchema = z.object({
  state: setupStateSnapshotSchema,
  connected: z.boolean(),
  /** True when the target DB has no users yet (fresh install) */
  isNewDatabase: z.boolean(),
  /** The node ID that was saved (or already existed in the config) */
  nodeId: z.uuid(),
})
export type SetupConfigureDatabaseResult = z.infer<typeof setupConfigureDatabaseResultSchema>
