import z from "zod/v4";

import { standard, standardDomainErrorContracts } from "@deployer/orpc-utils";

/**
 * A replicated roster setting: the API publishes it to this node's agent, and the agents gossip it to each other, so a
 * node converges its doors (or whatever the setting drives) even when the API runs elsewhere — or nowhere.
 *
 * `updatedAt` is the writer's clock: the higher value wins when two agents gossip the same key, which is why agent
 * clocks must be kept in sync.
 */
export const meshSettingSchema = z.object({
  key: z.string().min(1).max(128),
  /** 64 KiB: the largest setting is a doors plan, and a peer must not be able to push more than that into a store. */
  value: z.string().max(65_536),
  updatedAt: z.number().int().nonnegative(),
});

export const meshSettingInput = z.object({
  key: z.string().min(1).max(128),
  value: z.string().max(65_536),
});

export type MeshSetting = z.infer<typeof meshSettingSchema>;

const meshSettingOps = standard.zod(meshSettingSchema, "meshSetting");

/** Publish one setting into the local agent; gossip carries it to the rest of the swarm. */
export const meshSettingContract = meshSettingOps
  .create()
  .path("/setting")
  .input((b) => b.body(meshSettingInput))
  .output(meshSettingSchema)
  .errors((e) => [...standardDomainErrorContracts(e)])
  .build();
