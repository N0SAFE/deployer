/**
 * DeploymentsMeshService
 *
 * Mesh resource service for deployments — demonstrates the MeshResourceService
 * pattern on a real domain entity.
 *
 * Automatically registers all queries (list, resolve, search) with the
 * MeshResourceDispatcher during onModuleInit(), making them available via:
 *   POST /api/mesh/deployments/list
 *   POST /api/mesh/deployments/resolve
 *   POST /api/mesh/deployments/search
 *
 * @see deployment-resource.entity.ts — entity definition
 * @see MeshResourceService — base class with auto-registration
 */

import { Injectable } from "@nestjs/common";
import { MeshResourceService } from "@/core/modules/mesh/services/mesh-resource-service";
import { MeshQueryExecutor } from "@/core/modules/mesh/services/system-mesh-resource-discovery/query/mesh-query-executor";
import { MeshResourceDispatcher } from "@/core/modules/mesh/dispatcher/mesh-resource-dispatcher.service";
import { deploymentResourceEntity } from "../entities/deployment-resource.entity";

@Injectable()
export class DeploymentsMeshService extends MeshResourceService<any> {
  constructor(
    executor: MeshQueryExecutor,
    dispatcher: MeshResourceDispatcher,
  ) {
    super(executor, dispatcher, deploymentResourceEntity as any);
  }
}
