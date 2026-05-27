import { Module, type Provider } from "@nestjs/common";
import { MeshQueryExecutor } from "../services/system-mesh-resource-discovery/query/mesh-query-executor";
import { SystemMeshResourceDiscoveryService } from "../services/system-mesh-resource-discovery/system-mesh-resource-discovery.service";
import { TestDeploymentMeshService } from "./test-deployment-mesh.service";
import { TestDeploymentConsumerService } from "./test-deployment-consumer.service";

// ─── Mock Node Caller ─────────────────────────────────────────────────────────

/**
 * Mock implementation of MeshNodeCaller for testing.
 * In production, this would use the actual mesh transport (Redis, NATS, etc.).
 */
class MockMeshNodeCaller implements MeshNodeCaller {
  async callMany<TItem>(
    entityKey: string,
    methodName: string,
    payload: Record<string, unknown>,
    options: { organizationId?: string | null; timeoutMs?: number }
  ): Promise<readonly { nodeId: string; items: readonly TItem[]; durationMs: number }[]> {
    console.log(`[MockMeshNodeCaller] callMany:`, {
      entityKey,
      methodName,
      payload,
      options,
    });

    // Return mock data based on entity
    if (entityKey === "deployments") {
      const mockDeployments = [
        {
          deploymentId: "dep-1",
          serviceId: "svc-1",
          projectId: "proj-1",
          environment: "prod",
          status: "running",
          version: "1.2.3",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          replicas: 3,
          healthy: true,
        },
        {
          deploymentId: "dep-2",
          serviceId: "svc-1",
          projectId: "proj-1",
          environment: "staging",
          status: "running",
          version: "1.3.0-beta",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          replicas: 2,
          healthy: true,
        },
        {
          deploymentId: "dep-3",
          serviceId: "svc-2",
          projectId: "proj-2",
          environment: "prod",
          status: "failed",
          version: "2.0.0",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          replicas: 0,
          healthy: false,
        },
      ] as unknown as readonly TItem[];

      return [
        {
          nodeId: "node-1",
          items: mockDeployments,
          durationMs: 50,
        },
      ];
    }

    if (entityKey === "deploymentLogs") {
      const mockLogs = [
        {
          logId: "log-1",
          deploymentId: "dep-1",
          timestamp: new Date().toISOString(),
          level: "info",
          message: "Deployment started successfully",
        },
        {
          logId: "log-2",
          deploymentId: "dep-1",
          timestamp: new Date().toISOString(),
          level: "info",
          message: "All replicas healthy",
        },
      ] as unknown as readonly TItem[];

      return [
        {
          nodeId: "node-1",
          items: mockLogs,
          durationMs: 30,
        },
      ];
    }

    return [
      {
        nodeId: "node-1",
        items: [] as unknown as readonly TItem[],
        durationMs: 10,
      },
    ];
  }
}

// ─── Module ───────────────────────────────────────────────────────────────────

/**
 * Test module demonstrating the mesh resource discovery system.
 *
 * This module provides:
 * 1. TestDeploymentMeshService - A mesh service exposing deployment entities
 * 2. TestDeploymentConsumerService - A consumer demonstrating discovery usage
 * 3. Mock infrastructure for testing without a full mesh cluster
 */
@Module({
  providers: [
    // Core mesh infrastructure
    {
      provide: "MESH_NODE_CALLER",
      useClass: MockMeshNodeCaller,
    },
    {
      provide: MeshQueryExecutor,
      useFactory: (caller: MeshNodeCaller) => new MeshQueryExecutor(caller),
      inject: ["MESH_NODE_CALLER"],
    },
    SystemMeshResourceDiscoveryService,

    // Test services
    TestDeploymentMeshService,
    TestDeploymentConsumerService,
  ],
  exports: [
    SystemMeshResourceDiscoveryService,
    TestDeploymentMeshService,
    TestDeploymentConsumerService,
  ],
})
export class TestDeploymentMeshModule {}

// Import type for the interface
import type { MeshNodeCaller } from "../services/system-mesh-resource-discovery/query/mesh-query-executor";
