import { Injectable, type OnModuleInit, type OnModuleDestroy } from "@nestjs/common";
import { BaseMeshService } from "./base-mesh.service";
import { nodeInfoEntity } from "../entities/node-info.entity";
import { SystemMeshTopicService } from "./system-mesh-topic/orchestrator/system-mesh-topic.service";
import { SystemMeshTopologyService } from "./system-mesh-topology/orchestrator/system-mesh-topology.service";
import { SystemMeshConfigService } from "./system-mesh-config.service";
import { EnvService } from "@/config/env/env.service";

const SystemMeshResourceBase = BaseMeshService({
  namespace: "system-resource",
  entities: {
    nodeInfo: nodeInfoEntity,
  },
});

@Injectable()
export class SystemMeshResourceService extends SystemMeshResourceBase implements OnModuleInit, OnModuleDestroy {
  constructor(
    meshTopicService: SystemMeshTopicService,
    meshTopologyService: SystemMeshTopologyService,
    private readonly meshConfig: SystemMeshConfigService,
    private readonly env: EnvService,
  ) {
    super(meshTopicService, meshTopologyService);
  }

  onModuleInit(): void {
    super.onModuleInit();

    this.registerEntityHandler("node-info", "get", async () => {
      return {
        payload: {
          nodeId: this.meshConfig.getNodeId(),
          databaseUrl: this.env.get("DATABASE_URL") || "",
          serverUrl: this.env.get("NEXT_PUBLIC_API_URL") || "",
        },
      };
    });
  }

  onModuleDestroy(): void {
    super.onModuleDestroy();
  }
}
