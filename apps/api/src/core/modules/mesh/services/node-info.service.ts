/**
 * NodeInfoService
 *
 * Concrete example of MeshResourceService — demonstrates the pattern.
 * Automatically registers its "get" query handler with MeshResourceDispatcher
 * during onModuleInit(), making it available via:
 *   POST /api/mesh/node-info/get
 *
 * The developer writes only:
 * 1. Entity definition (in node-info.entity.ts)
 * 2. This service class
 * 3. Uses: service.from("get").request()
 *
 * NO ORPC contracts, NO @Implement, NO requireAuth() — all automatic.
 */

import { Injectable } from "@nestjs/common";
import { MeshResourceService } from "./mesh-resource-service";
import { MeshQueryExecutor } from "../services/system-mesh-resource-discovery/query/mesh-query-executor";
import { MeshResourceDispatcher } from "../dispatcher/mesh-resource-dispatcher.service";
import { nodeInfoEntity } from "../entities/node-info.entity";

@Injectable()
export class NodeInfoService extends MeshResourceService<typeof nodeInfoEntity> {
  constructor(
    executor: MeshQueryExecutor,
    dispatcher: MeshResourceDispatcher,
  ) {
    super(executor, dispatcher, nodeInfoEntity);
  }
}
