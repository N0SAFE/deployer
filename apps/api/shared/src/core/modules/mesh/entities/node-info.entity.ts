import type { AnyMeshQuery } from "../mesh-query";
import { meshQuery } from "../mesh-query";
import z from "zod/v4";
import { meshEntity } from "../mesh-entity";

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
