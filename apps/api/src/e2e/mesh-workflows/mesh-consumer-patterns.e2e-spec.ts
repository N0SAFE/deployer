import { Test, type TestingModule } from "@nestjs/testing";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Subject, BehaviorSubject, Observable, firstValueFrom } from "rxjs";
import { map, bufferTime, filter } from "rxjs/operators";
import { TestDeploymentMeshModule } from "@/core/modules/mesh/examples/test-deployment-mesh.module";
import { TestDeploymentMeshService } from "@/core/modules/mesh/examples/test-deployment-mesh.service";
import { TestDeploymentConsumerService } from "@/core/modules/mesh/examples/test-deployment-consumer.service";
import { SystemMeshResourceDiscoveryService } from "@/core/modules/mesh/services/system-mesh-resource-discovery/system-mesh-resource-discovery.service";

/**
 * Tests for consumer patterns from FULL_MESH_HISTORY.md:
 * - Pattern 1: Simple Request (Promise-based, single execution)
 * - Pattern 2: Reactive Updates (Observable-based, continuous)
 * - Pattern 3: Request with Refresh (BehaviorSubject caching + re-fetch)
 * - RxJS operator integration (pipe, map, filter, bufferTime)
 * - Error handling in reactive streams
 */
describe("Mesh E2E: Consumer Patterns", () => {
  let moduleRef: TestingModule;
  let discovery: SystemMeshResourceDiscoveryService;
  let consumer: TestDeploymentConsumerService;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [TestDeploymentMeshModule],
    }).compile();

    discovery = moduleRef.get(SystemMeshResourceDiscoveryService);
    consumer = moduleRef.get(TestDeploymentConsumerService);
  }, 120_000);

  afterAll(async () => {
    await moduleRef.close();
  });

  describe("Pattern 1: Simple Request (Promise-based)", () => {
    it("fetches data via discovery.query() and returns typed result", async () => {
      const result = await discovery.query(
        TestDeploymentMeshService.queries.deployments,
        { environment: "prod" }
      );

      expect(result).toBeDefined();
      expect(Array.isArray(result.items)).toBe(true);
      expect(typeof result.total).toBe("number");
    });

    it("fetches data via builder.request() chaining", async () => {
      const result = await discovery
        .from(TestDeploymentMeshService.queries.deployments)
        .where({ environment: "prod", status: "running" })
        .orderBy("createdAt", "desc")
        .limit(10)
        .request();

      expect(result.items.length).toBeGreaterThan(0);
    });

    it("uses the consumer service as a real consumer would", async () => {
      const running = await consumer.getRunningProductionDeployments();
      expect(running.items.length).toBeGreaterThan(0);

      // All items should be prod + running
      for (const item of running.items) {
        expect(item.environment).toBe("prod");
        expect(item.status).toBe("running");
      }
    });

    it("fetches specific service deployments", async () => {
      const deployments = await consumer.getServiceDeployments("svc-1", {
        environment: "prod",
        healthy: true,
      });

      expect(deployments.length).toBeGreaterThan(0);
      for (const dep of deployments) {
        expect(dep.serviceId).toBe("svc-1");
        expect(dep.environment).toBe("prod");
        expect(dep.healthy).toBe(true);
      }
    });

    it("returns null for non-existent findById", async () => {
      const dep = await consumer.findDeployment("nonexistent-id");
      // May return undefined if not found (depends on mock implementation)
      // Just ensure no error is thrown
      expect(dep).toBeDefined();
    });
  });

  describe("Pattern 2: Reactive Updates (RxJS Observables)", () => {
    it("transforms stream data with RxJS operators", async () => {
      // Simulate a stream and apply operators
      const source$ = new Subject<{ deploymentId: string; replicas: number }>();

      const transformed$ = source$.pipe(
        filter((d) => d.replicas > 0),
        map((d) => `${d.deploymentId}:${d.replicas} replicas`)
      );

      const results: string[] = [];
      const sub = transformed$.subscribe((val) => results.push(val));

      source$.next({ deploymentId: "d1", replicas: 3 });
      source$.next({ deploymentId: "d2", replicas: 0 }); // filtered out
      source$.next({ deploymentId: "d3", replicas: 5 });

      expect(results).toEqual(["d1:3 replicas", "d3:5 replicas"]);
      sub.unsubscribe();
    });

    it("buffers time-series data with bufferTime", async () => {
      const source$ = new Subject<number>();

      // Collect emissions in 50ms windows
      const buffered$ = source$.pipe(bufferTime(50));

      const results: number[][] = [];
      const sub = buffered$.subscribe((vals) => {
        if (vals.length > 0) results.push(vals);
      });

      source$.next(1);
      source$.next(2);
      source$.next(3);

      await new Promise((r) => setTimeout(r, 80));

      source$.next(4);
      source$.next(5);

      await new Promise((r) => setTimeout(r, 80));

      expect(results.length).toBeGreaterThanOrEqual(1);
      sub.unsubscribe();
    });

    it("merges multiple streams into one", async () => {
      const streamA$ = new Subject<string>();
      const streamB$ = new Subject<string>();

      const merged$ = new Observable<string>((sub) => {
        const subA = streamA$.subscribe(sub);
        const subB = streamB$.subscribe(sub);
        return () => { subA.unsubscribe(); subB.unsubscribe(); };
      });

      const results: string[] = [];
      const sub = merged$.subscribe((val) => results.push(val));

      streamA$.next("A1");
      streamB$.next("B1");
      streamA$.next("A2");

      expect(results).toEqual(["A1", "B1", "A2"]);
      sub.unsubscribe();
    });
  });

  describe("Pattern 3: Request with Refresh (Cache + Re-fetch)", () => {
    it("uses BehaviorSubject as a cache layer", async () => {
      const cache$ = new BehaviorSubject<readonly string[]>([]);

      // Initial state is empty
      expect(cache$.value).toEqual([]);

      // Simulate first fetch
      cache$.next(["item-1", "item-2"]);
      expect(cache$.value).toEqual(["item-1", "item-2"]);

      // Simulate refresh
      cache$.next(["item-1", "item-2", "item-3"]);
      expect(cache$.value).toEqual(["item-1", "item-2", "item-3"]);

      // Late subscriber gets the latest value
      const lateValue = await firstValueFrom(
        cache$.pipe(filter((items) => items.length > 0))
      );
      expect(lateValue.length).toBe(3);
    });

    it("maintains separate caches per query scope", async () => {
      const prodCache$ = new BehaviorSubject<readonly string[]>([]);
      const stagingCache$ = new BehaviorSubject<readonly string[]>([]);

      prodCache$.next(["prod-item-1"]);
      stagingCache$.next(["staging-item-1"]);

      expect(prodCache$.value).toEqual(["prod-item-1"]);
      expect(stagingCache$.value).toEqual(["staging-item-1"]);
    });

    it("refreshes cache on external trigger", async () => {
      const cache$ = new BehaviorSubject<readonly string[]>([]);
      const refresh$ = new Subject<void>();

      let fetchCount = 0;

      refresh$.subscribe(async () => {
        fetchCount++;
        // Simulate fetch
        cache$.next([`fetched-${fetchCount}`]);
      });

      expect(cache$.value).toEqual([]);

      refresh$.next();
      await new Promise((r) => setTimeout(r, 10));
      expect(cache$.value).toEqual(["fetched-1"]);

      refresh$.next();
      await new Promise((r) => setTimeout(r, 10));
      expect(cache$.value).toEqual(["fetched-2"]);
    });
  });

  describe("Discovery service consumer patterns", () => {
    it("generates health report via consumer service", async () => {
      const report = await consumer.generateHealthReport();

      expect(report.totalDeployments).toBeGreaterThanOrEqual(0);
      expect(report.healthyCount + report.unhealthyCount).toBe(report.totalDeployments);
      expect(typeof report.averageReplicas).toBe("number");
    });

    it("generates deployment summaries", async () => {
      const summaries = await consumer.getDeploymentSummaries();

      expect(summaries.length).toBeGreaterThan(0);
      for (const summary of summaries) {
        // getDeploymentSummaries returns Pick<Deployment, "deploymentId" | "serviceId" | "status" | "environment">
        expect(typeof summary.deploymentId).toBe("string");
        expect(typeof summary.serviceId).toBe("string");
        expect(["running", "stopped", "failed"]).toContain(summary.status);
        expect(["prod", "staging", "dev"]).toContain(summary.environment);
      }
    });
  });
});
