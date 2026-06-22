import z from "zod/v4";
import { meshEntity } from "../mesh-entity";
import type { AnyMeshQuery } from "../mesh-query";

export const nodeInfoEntity = meshEntity({
  key: "node-info",
  item: z.object({
    nodeId: z.string(),
    databaseUrl: z.string(),
    serverUrl: z.string(),
  }),
  itemKey: "nodeId",
  queries: {
    get: {
      inputSchema: z.object({}),
      outputSchema: z.object({
        nodeId: z.string(),
        databaseUrl: z.string(),
        serverUrl: z.string(),
      }),
    } as AnyMeshQuery,
  },
  mutations: {}
});
