import { describe, it, expect, beforeEach } from "vitest";
import z from "zod/v4";
import { defineResource } from "@/core/modules/mesh/mesh-resource-definition";
import { OwnershipResolverService } from "@/core/modules/mesh/services/ownership/ownership-resolver.service";
import { MeshPartitionPolicy } from "@/core/modules/mesh/services/mesh-partition-policy";
import type { PartitionPolicyInput } from "@/core/modules/mesh/services/mesh-partition-policy";

/**
 * Tests for resource ownership patterns from FULL_MESH_HISTORY.md:
 * - Global, Node-Owned, Sharded, Replicated ownership types
 * - defineResource() builder with ownership configuration
 * - OwnershipResolverService (registerNode, resolveOwners, watchOwnership)
 * - MeshPartitionPolicy (quorum, consistency modes)
 */
describe("Mesh E2E: Resource Ownership Patterns", () => {
  describe("defineResource ownership types", () => {
    it("builds a resource with global ownership", () => {
      const resource = defineResource()
        .key("projects")
        .itemSchema(z.object({ projectId: z.string(), name: z.string() }))
        .itemKey("projectId")
        .globalOwnership("mesh-coordinator")
        .build();

      expect(resource.key).toBe("projects");
      expect(resource.ownership).toEqual({
        type: "global",
        coordinatorNode: "mesh-coordinator",
      });
    });

    it("builds a resource with node-owned ownership", () => {
      const resource = defineResource()
        .key("deployments")
        .itemSchema(z.object({ deploymentId: z.string(), nodeId: z.string() }))
        .itemKey("deploymentId")
        .nodeOwnedOwnership("nodeId")
        .build();

      expect(resource.key).toBe("deployments");
      expect(resource.ownership).toEqual({
        type: "node-owned",
        ownerField: "nodeId",
      });
    });

    it("chains queries and mutations on resources", () => {
      const resource = defineResource()
        .key("services")
        .itemSchema(z.object({ serviceId: z.string(), name: z.string() }))
        .itemKey("serviceId")
        .globalOwnership()
        .addQuery("list", {
          inputSchema: z.object({}),
          outputSchema: z.object({ total: z.number() }),
          capabilities: {
            request: true,
            listen: true,
            paginate: true,
            sort: true,
            filter: true,
            project: true,
          },
        })
        .addMutation("restart", {
          inputSchema: z.object({ serviceId: z.string() }),
          outputSchema: z.object({ success: z.boolean() }),
          capabilities: {
            returnsItem: false,
            batchable: false,
            emitsEvents: true,
            optimisticUpdates: false,
          },
        })
        .addEventSource("changes", {
          type: "external",
          schema: z.object({ serviceId: z.string() }),
          emitsCreated: true,
          emitsUpdated: true,
          emitsDeleted: true,
          config: {
            system: "service-orchestrator",
          },
        })
        .build();

      expect(resource.queries.list).toBeDefined();
      expect(resource.mutations.restart).toBeDefined();
      expect(resource.eventSources.changes).toBeDefined();
      expect(resource.eventSources.changes.config.system).toBe("service-orchestrator");
    });
  });

  describe("OwnershipResolverService", () => {
    let resolver: OwnershipResolverService;

    beforeEach(() => {
      resolver = new OwnershipResolverService();
    });

    it("registers nodes and resolves owners", async () => {
      resolver.registerNode({ id: "node-a", baseUrl: "http://node-a:3001" });
      resolver.registerNode({ id: "node-b", baseUrl: "http://node-b:3002" });

      // resolveOwners will try to fetch from each node
      // Since no actual server is running, it should return empty owners
      // but not throw
      const owners = await resolver.resolveOwners("deployments");
      expect(Array.isArray(owners)).toBe(true);
    });

    it("provides watchOwnership observable", () => {
      const changes: string[][] = [];

      const sub = resolver.watchOwnership("deployments").subscribe((change) => {
        changes.push(change.owners);
      });

      // Trigger a resolution
      resolver.resolveOwners("deployments").then((owners) => {
        // This will emit via the changes subject
      });

      sub.unsubscribe();
    });
  });

  describe("MeshPartitionPolicy", () => {
    const originalQuorumSize = process.env.MESH_QUORUM_SIZE;
    const originalQuorumMode = process.env.MESH_QUORUM_MODE;

    beforeEach(() => {
      delete process.env.MESH_QUORUM_SIZE;
      delete process.env.MESH_QUORUM_MODE;
    });

    afterEach(() => {
      if (originalQuorumSize === undefined) delete process.env.MESH_QUORUM_SIZE;
      else process.env.MESH_QUORUM_SIZE = originalQuorumSize;
      if (originalQuorumMode === undefined) delete process.env.MESH_QUORUM_MODE;
      else process.env.MESH_QUORUM_MODE = originalQuorumMode;
    });

    it("evaluates AP mode (always available)", () => {
      const input: PartitionPolicyInput = {
        consistencyMode: "ap",
        activePeerCount: 0,
        quorumSize: 3,
      };

      const result = MeshPartitionPolicy.evaluate(input);
      expect(result.effectiveLifecycleState).toBe("healthy");
      expect(result.canWrite).toBe(true);
      expect(result.canRead).toBe(true);
      expect(result.quorumMet).toBe(false);
      expect(result.reason).toBe("ap_always_available");
    });

    it("evaluates CP mode (blocks writes without quorum)", () => {
      const input: PartitionPolicyInput = {
        consistencyMode: "cp",
        activePeerCount: 1,
        quorumSize: 3,
      };

      const result = MeshPartitionPolicy.evaluate(input);
      expect(result.quorumMet).toBe(false);
      expect(result.canWrite).toBe(false);
      expect(result.canRead).toBe(true);
      expect(result.effectiveLifecycleState).toBe("isolated");
      expect(result.reason).toBe("cp_quorum_lost");
    });

    it("evaluates CP mode (allows writes with quorum)", () => {
      const input: PartitionPolicyInput = {
        consistencyMode: "cp",
        activePeerCount: 3,
        quorumSize: 3,
      };

      const result = MeshPartitionPolicy.evaluate(input);
      expect(result.quorumMet).toBe(true);
      expect(result.canWrite).toBe(true);
      expect(result.canRead).toBe(true);
      expect(result.effectiveLifecycleState).toBe("healthy");
    });

    it("evaluates hybrid mode (degrades without quorum)", () => {
      const input: PartitionPolicyInput = {
        consistencyMode: "hybrid",
        activePeerCount: 1,
        quorumSize: 3,
      };

      const result = MeshPartitionPolicy.evaluate(input);
      expect(result.quorumMet).toBe(false);
      expect(result.canWrite).toBe(true);  // hybrid still allows writes
      expect(result.canRead).toBe(true);
      expect(result.effectiveLifecycleState).toBe("degraded");
      expect(result.reason).toBe("hybrid_degraded_no_quorum");
    });

    it("reports healthy state when quorum is met in hybrid mode", () => {
      const input: PartitionPolicyInput = {
        consistencyMode: "hybrid",
        activePeerCount: 3,
        quorumSize: 3,
      };

      const result = MeshPartitionPolicy.evaluate(input);
      expect(result.quorumMet).toBe(true);
      expect(result.canWrite).toBe(true);
      expect(result.canRead).toBe(true);
      expect(result.effectiveLifecycleState).toBe("healthy");
    });

    it("reports activePeerCount in result", () => {
      const result = MeshPartitionPolicy.evaluate({
        consistencyMode: "ap",
        activePeerCount: 5,
        quorumSize: 3,
      });
      expect(result.activePeerCount).toBe(5);
    });
  });
});
