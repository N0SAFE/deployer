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
import { MeshResourceService } from "@/core/modules/mesh/services/mesh-resource-service";
import { MeshQueryExecutor } from "@/core/modules/mesh/services/system-mesh-resource-discovery/query/mesh-query-executor";
import { MeshResourceDispatcher } from "@/core/modules/mesh/dispatcher/mesh-resource-dispatcher.service";
import { nodeInfoEntity } from "@/core/modules/mesh/entities/node-info.entity";

@Injectable()
export class NodeInfoService extends MeshResourceService<any> {
  constructor(
    executor: MeshQueryExecutor,
    dispatcher: MeshResourceDispatcher,
  ) {
    super(executor, dispatcher, nodeInfoEntity as any);
  }
}
