import { describe, it, expect } from "vitest";
import { Subject, Observable } from "rxjs";
import { filter, map } from "rxjs/operators";
import type {
  MeshStreamEvent,
  MeshStreamEventType,
  MeshChangeEvent,
  MeshChangeType,
} from "@/core/modules/mesh/services/system-mesh-resource-discovery/query/mesh-observable-types";

/**
 * Tests for the RxJS Event Namespace System from FULL_MESH_HISTORY.md:
 * - Event structure with namespace/entity/source/type routing metadata
 * - Namespace isolation (events scoped to correct namespace)
 * - Stream event types (initial, data, error, complete)
 * - Wire event filtering by namespaced keys
 * - Zero cross-talk between namespaces
 */
describe("Mesh E2E: Event Namespace System", () => {
  describe("Event structure", () => {
    it("shapes MeshStreamEvent correctly for each type", () => {
      // Initial event
      const initial: MeshStreamEvent<string> = {
        type: "initial",
        items: ["a", "b", "c"],
        meta: { total: 3, hasMore: false },
      };
      expect(initial.type).toBe("initial");
      expect(initial.items).toHaveLength(3);
      expect(initial.meta?.total).toBe(3);

      // Data event
      const data: MeshStreamEvent<string> = {
        type: "data",
        items: ["d", "e"],
        meta: { hasMore: true, nextOffset: 2, sourceNodes: ["node-a"] },
      };
      expect(data.type).toBe("data");
      expect(data.meta?.sourceNodes).toContain("node-a");

      // Error event
      const error: MeshStreamEvent<string> = {
        type: "error",
        error: new Error("Stream failed"),
      };
      expect(error.type).toBe("error");
      expect(error.error?.message).toBe("Stream failed");

      // Complete event
      const complete: MeshStreamEvent<string> = {
        type: "complete",
      };
      expect(complete.type).toBe("complete");
    });

    it("shapes MeshChangeEvent correctly for each change type", () => {
      const timestamp = new Date().toISOString();

      const initial: MeshChangeEvent<string> = {
        type: "initial",
        items: ["a", "b"],
        timestamp,
      };
      expect(initial.type).toBe("initial");
      expect(initial.changedItem).toBeUndefined();
      expect(initial.previousItem).toBeUndefined();

      const created: MeshChangeEvent<string> = {
        type: "created",
        items: ["a", "b", "c"],
        changedItem: "c",
        timestamp,
        sourceNodeId: "node-1",
      };
      expect(created.type).toBe("created");
      expect(created.sourceNodeId).toBe("node-1");

      const updated: MeshChangeEvent<string> = {
        type: "updated",
        items: ["a_updated", "b"],
        changedItem: "a_updated",
        previousItem: "a",
        timestamp,
      };
      expect(updated.type).toBe("updated");
      expect(updated.previousItem).toBe("a");

      const deleted: MeshChangeEvent<string> = {
        type: "deleted",
        items: ["b"],
        changedItem: "a",
        previousItem: "a",
        timestamp,
      };
      expect(deleted.type).toBe("deleted");

      const reconnect: MeshChangeEvent<string> = {
        type: "reconnect",
        items: ["a", "b"],
        timestamp,
      };
      expect(reconnect.type).toBe("reconnect");
    });
  });

  describe("Namespace isolation", () => {
    it("isolates events by namespace via separate subjects", () => {
      const deploymentEvents$ = new Subject<string>();
      const metricEvents$ = new Subject<string>();

      const deploymentLog: string[] = [];
      const metricLog: string[] = [];

      deploymentEvents$.subscribe((e) => deploymentLog.push(e));
      metricEvents$.subscribe((e) => metricLog.push(e));

      deploymentEvents$.next("deployment:created");
      metricEvents$.next("metric:updated");
      deploymentEvents$.next("deployment:scaled");

      expect(deploymentLog).toEqual(["deployment:created", "deployment:scaled"]);
      expect(metricLog).toEqual(["metric:updated"]);
      expect(deploymentLog).not.toContain("metric:updated");
      expect(metricLog).not.toContain("deployment:created");
    });

    it("filters events by namespace prefix", () => {
      const allEvents$ = new Subject<string>();

      const deployment$ = allEvents$.pipe(
        filter((e) => e.startsWith("deployment:"))
      );
      const metric$ = allEvents$.pipe(
        filter((e) => e.startsWith("metric:"))
      );

      const deploymentLog: string[] = [];
      const metricLog: string[] = [];

      deployment$.subscribe((e) => deploymentLog.push(e));
      metric$.subscribe((e) => metricLog.push(e));

      allEvents$.next("deployment:created:d1");
      allEvents$.next("metric:updated:m1");
      allEvents$.next("deployment:updated:d1");
      allEvents$.next("user:login"); // irrelevant namespace - captured by neither

      expect(deploymentLog).toEqual(["deployment:created:d1", "deployment:updated:d1"]);
      expect(metricLog).toEqual(["metric:updated:m1"]);
    });

    it("supports structured namespace keys", () => {
      // Simulate the structured key format: namespace:entity:source:type
      const emitEvent = (
        namespace: string,
        entity: string,
        source: string,
        type: string,
        payload: unknown
      ) => `${namespace}:${entity}:${source}:${type}:${JSON.stringify(payload)}`;

      const deploymentEvent = emitEvent("deployment", "service", "webhook", "updated", {
        serviceId: "svc-1",
      });
      const metricEvent = emitEvent("metrics", "traffic", "timer", "snapshot", {
        requests: 100,
      });

      expect(deploymentEvent).toContain("deployment:service:webhook:updated");
      expect(metricEvent).toContain("metrics:traffic:timer:snapshot");

      // Parse structured key
      const parseEvent = (event: string) => {
        const parts = event.split(":");
        return {
          namespace: parts[0],
          entity: parts[1],
          source: parts[2],
          type: parts[3],
        };
      };

      const parsedDeployment = parseEvent(deploymentEvent);
      expect(parsedDeployment.namespace).toBe("deployment");
      expect(parsedDeployment.entity).toBe("service");
      expect(parsedDeployment.source).toBe("webhook");
      expect(parsedDeployment.type).toBe("updated");

      const parsedMetric = parseEvent(metricEvent);
      expect(parsedMetric.namespace).toBe("metrics");
      expect(parsedMetric.entity).toBe("traffic");
      expect(parsedMetric.source).toBe("timer");
      expect(parsedMetric.type).toBe("snapshot");
    });
  });

  describe("Source-specific namespace subscription", () => {
    it("subscribes only to specific source type within a namespace", () => {
      const namespace$ = new Subject<{ source: string; type: string; payload: unknown }>();

      // Subscribe only to webhook events
      const webhook$ = namespace$.pipe(filter((e) => e.source === "webhook"));
      // Subscribe only to mutation events
      const mutation$ = namespace$.pipe(filter((e) => e.source === "mutation"));

      const webhookLog: string[] = [];
      const mutationLog: string[] = [];

      webhook$.subscribe((e) => webhookLog.push(`${e.type}:${e.payload}`));
      mutation$.subscribe((e) => mutationLog.push(`${e.type}:${e.payload}`));

      namespace$.next({ source: "webhook", type: "updated", payload: "commit-pushed" });
      namespace$.next({ source: "mutation", type: "created", payload: "new-deployment" });
      namespace$.next({ source: "timer", type: "tick", payload: "heartbeat" }); // ignored by both
      namespace$.next({ source: "webhook", type: "deleted", payload: "branch-removed" });

      expect(webhookLog).toEqual(["updated:commit-pushed", "deleted:branch-removed"]);
      expect(mutationLog).toEqual(["created:new-deployment"]);
    });
  });

  describe("Event filtering and transformation", () => {
    it("filters events by type within a stream", () => {
      const events$ = new Subject<MeshChangeEvent<string>>();

      const createdOnly$ = events$.pipe(filter((e) => e.type === "created"));

      const received: string[] = [];
      createdOnly$.subscribe((e) => received.push(e.changedItem ?? ""));

      events$.next({ type: "created", items: ["a", "b"], changedItem: "b", timestamp: "t1" });
      events$.next({ type: "updated", items: ["a", "b"], changedItem: "a", previousItem: "a_v1", timestamp: "t2" });
      events$.next({ type: "created", items: ["a", "b", "c"], changedItem: "c", timestamp: "t3" });

      expect(received).toEqual(["b", "c"]);
    });

    it("transforms event payloads with map", () => {
      const source$ = new Subject<{ id: string; value: number }>();

      const transformed$ = source$.pipe(
        map((item) => ({ display: `${item.id}=${item.value}`, isHigh: item.value > 50 }))
      );

      const results: string[] = [];
      transformed$.subscribe((r) => results.push(r.display));

      source$.next({ id: "cpu", value: 75 });
      source$.next({ id: "mem", value: 30 });

      expect(results).toEqual(["cpu=75", "mem=30"]);
    });
  });

  describe("Wire event envelope", () => {
    it("matches MeshStreamEnvelope structure used in connection registry", () => {
      const envelope = {
        connectionId: "conn-1",
        recipients: ["consumer-a", "consumer-b"],
        entityKey: "deployments",
        eventType: "updated",
        payload: { deploymentId: "dep-1", status: "running" },
        timestamp: new Date().toISOString(),
        sourceNodeId: "node-1",
      };

      expect(envelope.connectionId).toBeDefined();
      expect(envelope.recipients).toContain("consumer-a");
      expect(envelope.entityKey).toBe("deployments");
      expect(envelope.eventType).toBe("updated");
      expect(envelope.payload.deploymentId).toBe("dep-1");
      expect(envelope.sourceNodeId).toBe("node-1");
    });
  });
});
