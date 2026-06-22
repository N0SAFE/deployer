import { Injectable, type OnModuleInit, type OnModuleDestroy } from "@nestjs/common";
import { BaseMeshService } from "./base-mesh.service";
import { nodeInfoEntity } from "../entities/node-info.entity";
import { SystemMeshTopicService } from "./system-mesh-topic/orchestrator/system-mesh-topic.service";
import { SystemMeshTopologyService } from "./system-mesh-topology/orchestrator/system-mesh-topology.service";
import { SystemMeshConfigService } from "./system-mesh-config.service";
import { EnvService } from "@/config/env/env.service";
import { contractBuilder } from "@/core/modules/events/event-contract.builder";
import z from "zod/v4";

const nodeInfoGetInputSchema = z.object({});
const nodeInfoGetOutputSchema = z.object({
  nodeId: z.string(),
  databaseUrl: z.string(),
  serverUrl: z.string(),
});

const SystemMeshResourceContracts = {
  "system-resource:nodeInfo:get:req": contractBuilder()
    .input(nodeInfoGetInputSchema)
    .output(z.object({
      correlationId: z.string(),
      callerNodeId: z.string(),
      payload: nodeInfoGetInputSchema,
      emittedAt: z.string(),
    }))
    .build(),
  "system-resource:nodeInfo:get:res": contractBuilder()
    .input(z.object({ 
      organizationId: z.string().nullable().optional(), 
      correlationId: z.string() 
    }))
    .output(z.object({
      correlationId: z.string(),
      responderNodeId: z.string(),
      payload: nodeInfoGetOutputSchema,
      stopPropagation: z.boolean().optional(),
      emittedAt: z.string(),
    }))
    .build(),
  "system-resource:nodeInfo:get:cancel": contractBuilder()
    .input(z.object({ 
      organizationId: z.string().nullable().optional(), 
      correlationId: z.string().optional() 
    }))
    .output(z.object({
      correlationId: z.string(),
      callerNodeId: z.string(),
      reason: z.enum(["caller_stop", "handler_stop"]),
      emittedAt: z.string(),
    }))
    .build(),
} as const;

const SystemMeshResourceBase = BaseMeshService({
  namespace: "system-resource",
  entities: {
    nodeInfo: nodeInfoEntity,
  },
  contracts: SystemMeshResourceContracts,
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

    this.registerQueryHandler("nodeInfo", "get", async () => {
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
