import type { TestingModule } from "@nestjs/testing";
import { Test } from "@nestjs/testing";
import { describe, it, expect, beforeAll } from "vitest";
import { TestDeploymentMeshModule } from "./test-deployment-mesh.module";
import { TestDeploymentConsumerService } from "./test-deployment-consumer.service";
import { TestDeploymentMeshService } from "./test-deployment-mesh.service";
import { SystemMeshResourceDiscoveryService } from "../services/system-mesh-resource-discovery/system-mesh-resource-discovery.service";
import { eq, and, gt } from "../services/system-mesh-resource-discovery/query/mesh-where";

describe("TestDeploymentMesh", () => {
  let module: TestingModule;
  let consumer: TestDeploymentConsumerService;
  let meshService: TestDeploymentMeshService;
  let discovery: SystemMeshResourceDiscoveryService;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [TestDeploymentMeshModule],
    }).compile();

    consumer = module.get(TestDeploymentConsumerService);
    meshService = module.get(TestDeploymentMeshService);
    discovery = module.get(SystemMeshResourceDiscoveryService);
  });

  describe("Entity Definitions", () => {
    it("should expose typed deployment entities", () => {
      // Verify entity structure is correct
      expect(TestDeploymentMeshService.entities.deployments.key).toBe("deployments");
      expect(TestDeploymentMeshService.entities.deployments.itemKey).toBe("deploymentId");
      expect(TestDeploymentMeshService.entities.deploymentLogs.key).toBe("deploymentLogs");
    });

    it("should have typed query operations", () => {
      const queries = TestDeploymentMeshService.entities.deployments.queries;

      expect(queries.list).toBeDefined();
      expect(queries.findById).toBeDefined();
      expect(queries.search).toBeDefined();

      // Entity metadata is attached by meshEntity()
      expect(queries.list.entityKey).toBe("deployments");
      expect(queries.list.methodName).toBe("list");
      expect(queries.list.itemKey).toBe("deploymentId");
    });

    it("should have typed mutation operations", () => {
      const mutations = TestDeploymentMeshService.entities.deployments.mutations;

      expect(mutations.create).toBeDefined();
      expect(mutations.update).toBeDefined();
      expect(mutations.delete).toBeDefined();
      expect(mutations.restart).toBeDefined();
      expect(mutations.scale).toBeDefined();

      // Entity metadata is attached by meshEntity()
      expect(mutations.create.entityKey).toBe("deployments");
      expect(mutations.create.methodName).toBe("create");
    });
  });

  describe("Discovery Service", () => {
    it("should create a typed query builder from entity reference", () => {
      const builder = discovery.from(TestDeploymentMeshService.queries.deployments);

      expect(builder).toBeDefined();
      expect(typeof builder.where).toBe("function");
      expect(typeof builder.select).toBe("function");
      expect(typeof builder.orderBy).toBe("function");
      expect(typeof builder.limit).toBe("function");
      expect(typeof builder.execute).toBe("function");
    });

    it("should execute a simple query", async () => {
      const result = await discovery
        .from(TestDeploymentMeshService.queries.deployments)
        .where({ environment: "prod" })
        .execute();

      expect(result).toBeDefined();
      expect(Array.isArray(result.items)).toBe(true);
      expect(typeof result.total).toBe("number");
      expect(typeof result.strategy).toBe("string");
    });

    it("should support functional where expressions", async () => {
      const result = await discovery
        .from(TestDeploymentMeshService.queries.deployments)
        .where(
          and(
            eq("environment", "prod"),
            eq("status", "running")
          )
        )
        .execute();

      expect(result).toBeDefined();
      expect(Array.isArray(result.items)).toBe(true);
    });

    it("should support projections with select", async () => {
      const result = await discovery
        .from(TestDeploymentMeshService.queries.deployments)
        .select(["deploymentId", "serviceId", "status"])
        .limit(10)
        .execute();

      expect(result).toBeDefined();
      // Result items should only have the selected fields
      const firstItem = result.items[0];
      if (firstItem) {
        expect(firstItem.deploymentId).toBeDefined();
        expect(firstItem.serviceId).toBeDefined();
        expect(firstItem.status).toBeDefined();
      }
    });

    it("should support ordering", async () => {
      const result = await discovery
        .from(TestDeploymentMeshService.queries.deployments)
        .orderBy("createdAt", "desc")
        .orderBy("deploymentId", "asc")
        .limit(10)
        .execute();

      expect(result).toBeDefined();
      expect(Array.isArray(result.items)).toBe(true);
    });

    it("should support pagination with limit and offset", async () => {
      const result = await discovery
        .from(TestDeploymentMeshService.queries.deployments)
        .limit(5)
        .offset(0)
        .execute();

      expect(result).toBeDefined();
      expect(result.items.length <= 5).toBe(true);
      expect(typeof result.hasMore).toBe("boolean");
    });

    it("should explain a query without executing", () => {
      const builder = discovery
        .from(TestDeploymentMeshService.queries.deployments)
        .where({ environment: "prod" })
        .limit(100);

      const plan = discovery.explain(builder);

      expect(plan).toBeDefined();
      expect(plan.entityKey).toBe("deployments");
      expect(plan.methodName).toBe("list");
      expect(Array.isArray(plan.whereClauses)).toBe(true);
      expect(plan.pagination.limit).toBe(100);
    });

    it("should support query convenience method", async () => {
      const result = await discovery.query(
        TestDeploymentMeshService.queries.deployments,
        { environment: "prod" }
      );

      expect(result).toBeDefined();
      expect(Array.isArray(result.items)).toBe(true);
    });
  });

  describe("Consumer Service", () => {
    it("should get running production deployments", async () => {
      const result = await consumer.getRunningProductionDeployments();

      expect(result).toBeDefined();
      expect(Array.isArray(result.items)).toBe(true);
      expect(typeof result.total).toBe("number");
      expect(result.strategy).toBeDefined();
    });

    it("should get service deployments with filters", async () => {
      const deployments = await consumer.getServiceDeployments("svc-1", {
        environment: "prod",
        healthy: true,
      });

      expect(Array.isArray(deployments)).toBe(true);
    });

    it("should find a deployment by ID", async () => {
      const deployment = await consumer.findDeployment("dep-1");

      // May be null if not in mock data
      if (deployment) {
        expect(deployment.deploymentId).toBe("dep-1");
      }
    });

    it("should get deployment summaries", async () => {
      const summaries = await consumer.getDeploymentSummaries();

      expect(Array.isArray(summaries)).toBe(true);
      const firstSummary = summaries[0];
      if (firstSummary) {
        expect(firstSummary.deploymentId).toBeDefined();
        expect(firstSummary.serviceId).toBeDefined();
        expect(firstSummary.status).toBeDefined();
      }
    });

    it("should generate health report", async () => {
      const report = await consumer.generateHealthReport();

      expect(report).toBeDefined();
      expect(typeof report.totalDeployments).toBe("number");
      expect(typeof report.healthyCount).toBe("number");
      expect(typeof report.unhealthyCount).toBe("number");
      expect(typeof report.averageReplicas).toBe("number");
      expect(report.byEnvironment).toBeDefined();
    });

    it("should get deployment statistics", async () => {
      const stats = await consumer.getDeploymentStats();

      expect(stats).toBeDefined();
      expect(typeof stats.total).toBe("number");
      expect(typeof stats.avgReplicas).toBe("number");
      expect(typeof stats.byStatus).toBe("object");
    });

    it("should get service summaries", async () => {
      const summaries = await consumer.getServiceSummaries();

      expect(Array.isArray(summaries)).toBe(true);
      const firstSummary = summaries[0];
      if (firstSummary) {
        expect(firstSummary.serviceId).toBeDefined();
        expect(Array.isArray(firstSummary.deployments)).toBe(true);
      }
    });

    it("should find unhealthy deployments", async () => {
      const unhealthy = await consumer.findUnhealthyDeployments();

      expect(Array.isArray(unhealthy)).toBe(true);
    });

    it("should explain a deployment query", () => {
      const plan = consumer.explainDeploymentQuery();

      expect(typeof plan).toBe("string");
      expect(plan).toContain("MeshQueryPlan");
    });
  });

  describe("Type Safety", () => {
    it("should have correct entity types", () => {
      // This test verifies TypeScript compilation succeeds
      // The types are verified at compile time

      const entity = TestDeploymentMeshService.entities.deployments;

      // TypeScript knows these are the correct types
      const _key: typeof entity.key = "deployments";
      const _itemKey: typeof entity.itemKey = "deploymentId";
      void _key;
      void _itemKey;

      // Queries are typed
      const listQuery = entity.queries.list;
      expect(listQuery.inputSchema).toBeDefined();
      expect(listQuery.outputSchema).toBeDefined();

      // Mutations are typed
      const createMutation = entity.mutations.create;
      expect(createMutation.inputSchema).toBeDefined();
      expect(createMutation.outputSchema).toBeDefined();
    });

    it("should preserve types through builder chain", async () => {
      // The builder chain should preserve type information
      const builder = discovery
        .from(TestDeploymentMeshService.queries.deployments)
        .where({ environment: "prod" })
        .select(["deploymentId", "status"]);

      const result = await builder.execute();

      // TypeScript knows result.items is Pick<Deployment, "deploymentId" | "status">[]
      expect(Array.isArray(result.items)).toBe(true);
    });
  });

  describe("Streaming", () => {
    it("should stream deployment updates", async () => {
      const stream = consumer.streamDeploymentUpdates();

      expect(stream).toBeDefined();
      expect(typeof stream[Symbol.asyncIterator]).toBe("function");

      // Consume a few items from the stream
      const items: unknown[] = [];
      for await (const item of stream) {
        items.push(item);
        if (items.length >= 2) break;
      }

      expect(items.length).toBeGreaterThan(0);
    });
  });

  describe("Scoped Queries", () => {
    it("should support organization-scoped queries", async () => {
      const deployments = await consumer.getDeploymentsWithScope(
        "org-123",
        "broadcast-merge"
      );

      expect(Array.isArray(deployments)).toBe(true);
    });
  });
});
