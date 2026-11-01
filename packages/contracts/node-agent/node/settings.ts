import z from "zod/v4";
import { standard, standardDomainErrorContracts } from "@deployer/orpc-utils";

/**
 * The roster settings this node's agent holds: the `settings` table of its own database.
 *
 * The answer the old control API served on `GET /v1/settings`. Replicated settings (the API publishes them, gossip
 * carries them), so this reads and never writes: a local write would be overwritten by the newest `updatedAt`.
 */
export const meshNodeSettingSchema = z.object({
  key: z.string().min(1),
  value: z.string(),
  /** The writer's clock, in epoch milliseconds: the newest value per key wins. */
  updatedAt: z.number().int(),
});

export const meshNodeSettingsSchema = z.object({ settings: z.array(meshNodeSettingSchema) });

export type MeshNodeSetting = z.infer<typeof meshNodeSettingSchema>;
export type MeshNodeSettings = z.infer<typeof meshNodeSettingsSchema>;

const meshNodeSettingsOps = standard.zod(meshNodeSettingsSchema, "meshNodeSettings");

/** The settings this node acts on. Read-only. */
export const meshNodeSettingsContract = meshNodeSettingsOps
  .list()
  .path("/settings")
  .input(z.object({}))
  .output(meshNodeSettingsSchema)
  .errors((e) => [...standardDomainErrorContracts(e)])
  .build();
