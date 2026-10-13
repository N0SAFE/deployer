import type { AnyMeshQuery } from "@/core/modules/mesh/mesh-query";
import { meshQuery } from "@/core/modules/mesh/mesh-query";
import z from "zod/v4";
import { meshEntity } from "@/core/modules/mesh/mesh-entity";

export const nodeInfoEntity = meshEntity({
  key: "node-info",
  item: z.object({
    nodeId: z.string(),
    databaseUrl: z.string(),
    serverUrl: z.string(),
  }),
  itemKey: "nodeId",
  queries: {
    get: meshQuery(
      z.object({}),
      z.object({
        nodeId: z.string(),
        databaseUrl: z.string(),
        serverUrl: z.string(),
      }),
    ),
  },
  mutations: {}
});
