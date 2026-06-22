import { Test, type TestingModule } from "@nestjs/testing";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestDeploymentMeshModule } from "@/core/modules/mesh/examples/test-deployment-mesh.module";
import { TestDeploymentMeshService } from "@/core/modules/mesh/examples/test-deployment-mesh.service";
import { SystemMeshResourceDiscoveryService } from "@/core/modules/mesh/services/system-mesh-resource-discovery/system-mesh-resource-discovery.service";

/**
 * Tests for MeshQueryExecutor and query building from FULL_MESH_HISTORY.md:
 * - Complex where clause filtering
 * - OrderBy with multiple fields
 * - Pagination (limit, offset)
 * - explain() query plan output
 * - queryWithInput for custom queries
 * - query() convenience shorthand
 * - Empty result handling
 */
describe("Mesh E2E: Query Executor", () => {
  let moduleRef: TestingModule;
  let discovery: SystemMeshResourceDiscoveryService;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [TestDeploymentMeshModule],
    }).compile();

    discovery = moduleRef.get(SystemMeshResourceDiscoveryService);
  }, 120_000);

  afterAll(async () => {
    await moduleRef.close();
  });

  it("executes a simple query without where clause", async () => {
    const result = await discovery
      .from(TestDeploymentMeshService.queries.deployments)
      .execute();

    expect(result).toBeDefined();
    expect(Array.isArray(result.items)).toBe(true);
    expect(result.items.length).toBeGreaterThan(0);
    expect(typeof result.total).toBe("number");
    expect(typeof result.strategy).toBe("string");
  });

  it("filters items with where clause", async () => {
    const result = await discovery
      .from(TestDeploymentMeshService.queries.deployments)
      .where({ environment: "prod" })
      .execute();

    expect(result.items.length).toBeGreaterThan(0);
    for (const item of result.items) {
      expect((item as any).environment).toBe("prod");
    }
  });

  it("filters with multiple where conditions", async () => {
    const result = await discovery
      .from(TestDeploymentMeshService.queries.deployments)
      .where({ environment: "prod", status: "running" })
      .execute();

    for (const item of result.items) {
      expect((item as any).environment).toBe("prod");
      expect((item as any).status).toBe("running");
    }
  });

  it("orders results by a field", async () => {
    const result = await discovery
      .from(TestDeploymentMeshService.queries.deployments)
      .orderBy("environment", "asc")
      .execute();

    const envs = result.items.map((item) => (item as any).environment);
    const sorted = [...envs].sort();
    expect(envs).toEqual(sorted);
  });

  it("orders results descending", async () => {
    const result = await discovery
      .from(TestDeploymentMeshService.queries.deployments)
      .orderBy("environment", "desc")
      .execute();

    const envs = result.items.map((item) => (item as any).environment);
    const sorted = [...envs].sort().reverse();
    expect(envs).toEqual(sorted);
  });

  it("limits the number of results", async () => {
    const result = await discovery
      .from(TestDeploymentMeshService.queries.deployments)
      .limit(2)
      .execute();

    expect(result.items.length).toBeLessThanOrEqual(2);
  });

  it("supports offset pagination", async () => {
    const firstPage = await discovery
      .from(TestDeploymentMeshService.queries.deployments)
      .limit(1)
      .offset(0)
      .execute();

    const secondPage = await discovery
      .from(TestDeploymentMeshService.queries.deployments)
      .limit(1)
      .offset(1)
      .execute();

    expect(firstPage.items.length).toBeLessThanOrEqual(1);
    expect(secondPage.items.length).toBeLessThanOrEqual(1);

    // If there are at least 2 items, pages should be different
    if (firstPage.items.length === 1 && secondPage.items.length === 1) {
      const firstId = (firstPage.items[0] as any).deploymentId;
      const secondId = (secondPage.items[0] as any).deploymentId;
      expect(firstId).not.toBe(secondId);
    }
  });

  it("chains where + orderBy + limit fluently", async () => {
    const result = await discovery
      .from(TestDeploymentMeshService.queries.deployments)
      .where({ environment: "prod" })
      .orderBy("createdAt", "desc")
      .limit(5)
      .execute();

    expect(result.items.length).toBeLessThanOrEqual(5);
    for (const item of result.items) {
      expect((item as any).environment).toBe("prod");
    }

    // items should be in descending createdAt order
    const dates = result.items.map(
      (item) => new Date((item as any).createdAt).getTime()
    );
    for (let i = 1; i < dates.length; i++) {
      expect(dates[i]!).toBeLessThanOrEqual(dates[i - 1]!);
    }
  });

  it("uses query() convenience shorthand", async () => {
    const result = await discovery.query(
      TestDeploymentMeshService.queries.deployments,
      { environment: "prod" }
    );

    expect(Array.isArray(result.items)).toBe(true);
    for (const item of result.items) {
      expect((item as any).environment).toBe("prod");
    }
  });

  it("uses query() without where filter", async () => {
    const result = await discovery.query(
      TestDeploymentMeshService.queries.deployments
    );

    expect(Array.isArray(result.items)).toBe(true);
    expect(result.items.length).toBeGreaterThan(0);
  });

  it("uses queryWithInput for custom queries", async () => {
    const result = await discovery.queryWithInput(
      TestDeploymentMeshService.queries.searchDeployments,
      {
        query: "deployment",
        filters: { environment: "prod", healthy: true },
      }
    );

    expect(Array.isArray(result.items)).toBe(true);
    expect(typeof result.total).toBe("number");
  });

  it("generates explain plan without executing", () => {
    const builder = discovery
      .from(TestDeploymentMeshService.queries.deployments)
      .where({ environment: "prod" })
      .orderBy("createdAt", "desc")
      .limit(10);

    const plan = discovery.explain(builder);
    expect(plan).toBeDefined();
    expect(plan.entityKey).toBe("deployments");
    expect(typeof plan.strategy).toBe("string");
    expect(Array.isArray(plan.whereClauses)).toBe(true);

    // Formatted version
    const formatted = discovery.explainFormatted(builder);
    expect(typeof formatted).toBe("string");
    expect(formatted.length).toBeGreaterThan(0);
  });

  it("returns empty items for where clause matching nothing", async () => {
    const result = await discovery
      .from(TestDeploymentMeshService.queries.deployments)
      .where({ environment: "nonexistent" as any })
      .execute();

    expect(Array.isArray(result.items)).toBe(true);
    expect(result.items).toHaveLength(0);
    expect(result.total).toBe(0);
  });

  it("selects specific fields via select()", async () => {
    const result = await discovery
      .from(TestDeploymentMeshService.queries.deployments)
      .select(["deploymentId", "environment"])
      .execute();

    for (const item of result.items) {
      const keys = Object.keys(item);
      expect(keys.every((k) => ["deploymentId", "environment"].includes(k))).toBe(true);
    }
  });

  it("returns node response metadata", async () => {
    const result = await discovery
      .from(TestDeploymentMeshService.queries.deployments)
      .execute();

    expect(Array.isArray(result.nodeResponses)).toBe(true);
    if (result.nodeResponses.length > 0) {
      const firstNode = result.nodeResponses[0]!;
      expect(typeof firstNode.nodeId).toBe("string");
      expect(typeof firstNode.durationMs).toBe("number");
    }
  });

  it("handles scope options", async () => {
    const result = await discovery
      .from(TestDeploymentMeshService.queries.deployments)
      .scope({ organizationId: "org-123", timeoutMs: 5000 })
      .execute();

    expect(Array.isArray(result.items)).toBe(true);
  });
});
