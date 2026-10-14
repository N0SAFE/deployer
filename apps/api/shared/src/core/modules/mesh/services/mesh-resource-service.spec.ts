/**
 * MeshResourceService — Unit Tests
 *
 * Tests the abstract base class lifecycle hooks and convenience methods
 * using the existing nodeInfoEntity (avoids Zod import issues in test env).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { MeshResourceService } from "./mesh-resource-service";
import { MeshResourceDispatcher } from "../dispatcher/mesh-resource-dispatcher.service";
import type { MeshQueryExecutor } from "./system-mesh-resource-discovery/query/mesh-query-executor";
import { nodeInfoEntity } from "../entities/node-info.entity";

// ─── Mocks ─────────────────────────────────────────────────────────────────

function createMockExecutor(): MeshQueryExecutor {
  return {
    execute: vi.fn().mockResolvedValue({ items: [], total: 0, hasMore: false }),
    executeWithInput: vi.fn().mockResolvedValue({ success: true }),
  } as unknown as MeshQueryExecutor;
}

function createMockDispatcher(): MeshResourceDispatcher {
  return {
    register: vi.fn(),
    unregisterAll: vi.fn(),
    dispatch: vi.fn().mockResolvedValue({ success: true }),
    has: vi.fn().mockReturnValue(true),
  } as unknown as MeshResourceDispatcher;
}

// ─── Concrete test service using the existing nodeInfoEntity ───────────────

class NodeInfoTestService extends MeshResourceService<any> {
  constructor(executor: MeshQueryExecutor, dispatcher: MeshResourceDispatcher) {
    super(executor, dispatcher, nodeInfoEntity as any);
  }
}

describe("MeshResourceService", () => {
  let executor: MeshQueryExecutor;
  let dispatcher: MeshResourceDispatcher;
  let service: NodeInfoTestService;

  beforeEach(() => {
    executor = createMockExecutor();
    dispatcher = createMockDispatcher();
    service = new NodeInfoTestService(executor, dispatcher);
    vi.clearAllMocks();
  });

  // ─── Construction ──────────────────────────────────────────────────

  it("should store entity metadata from the entity definition", () => {
    expect(service.entityKey).toBe("node-info");
    expect(service.itemKey).toBe("nodeId");
  });

  // ─── Lifecycle ─────────────────────────────────────────────────────

  describe("onModuleInit", () => {
    it("should register all query handlers with dispatcher", () => {
      service.onModuleInit();
      // nodeInfoEntity has 1 query ("get") and 0 mutations
      expect(dispatcher.register).toHaveBeenCalledTimes(1);
    });

    it("should register with correct entity key and method name", () => {
      service.onModuleInit();
      expect(dispatcher.register).toHaveBeenCalledWith(
        "node-info",
        "get",
        expect.any(Function),
      );
    });
  });

  describe("onModuleDestroy", () => {
    it("should unregister all handlers for the entity", () => {
      service.onModuleDestroy();
      expect(dispatcher.unregisterAll).toHaveBeenCalledWith("node-info");
    });
  });

  // ─── Query API ─────────────────────────────────────────────────────

  describe("from", () => {
    it("should return a builder for the named query method", () => {
      const builder = service.from("get");
      expect(builder).toBeDefined();
      expect(typeof builder.request).toBe("function");
      expect(typeof builder.where).toBe("function");
    });

    it("should throw at runtime for nonexistent query methods", () => {
      expect(() => service.from("nonexistent" as any)).toThrow();
    });
  });

  // ─── Dispatch via call() ───────────────────────────────────────────

  describe("call", () => {
    it("should call the get query via dispatcher", async () => {
      vi.mocked(dispatcher.dispatch).mockResolvedValue({ nodeId: "n1" });
      const result = await (service as any).call("get", {});
      expect(dispatcher.dispatch).toHaveBeenCalledWith("node-info", "get", {});
      expect(result).toEqual({ nodeId: "n1" });
    });
  });
});
