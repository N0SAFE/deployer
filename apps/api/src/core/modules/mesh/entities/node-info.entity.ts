import { z } from "zod";
import { meshEntity } from "../mesh-entity";
import { meshQuery } from "../mesh-query";

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
      })
    )
  },
  mutations: {}
});
