/**
 * NodeInfoService — Unit Tests
 *
 * Tests the concrete MeshResourceService implementation with mocked
 * dependencies. Uses Vitest mocking patterns consistent with the
 * existing codebase.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NodeInfoService } from "./node-info.service";
import { nodeInfoEntity } from "../entities/node-info.entity";
import { MeshResourceDispatcher } from "../dispatcher/mesh-resource-dispatcher.service";
import { MeshQueryExecutor } from "./system-mesh-resource-discovery/query/mesh-query-executor";

// ─── Mocks ─────────────────────────────────────────────────────────────────

const mockExecutor = {
  execute: vi.fn(),
  executeWithInput: vi.fn(),
  getEntityKey: vi.fn().mockReturnValue("node-info"),
} as unknown as MeshQueryExecutor;

const mockDispatcher = {
  register: vi.fn(),
  unregisterAll: vi.fn(),
  dispatch: vi.fn(),
} as unknown as MeshResourceDispatcher;

describe("NodeInfoService", () => {
  let service: NodeInfoService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new NodeInfoService(mockExecutor, mockDispatcher);
  });

  // ─── Construction ──────────────────────────────────────────────────

  it("should be constructable", () => {
    expect(service).toBeDefined();
  });

  it("should have entityKey matching the entity definition", () => {
    expect(service.entityKey).toBe(nodeInfoEntity.key);
  });

  it("should have itemKey matching the entity definition", () => {
    expect(service.itemKey).toBe(nodeInfoEntity.itemKey);
  });

  // ─── Lifecycle ─────────────────────────────────────────────────────

  describe("onModuleInit", () => {
    it("should register all query handlers with dispatcher", () => {
      const queryCount = Object.keys(nodeInfoEntity.queries).length;

      service.onModuleInit();

      // Should register one call per query
      expect(mockDispatcher.register).toHaveBeenCalledTimes(queryCount);
    });

    it("should register mutation handlers with dispatcher", () => {
      const mutationCount = Object.keys(nodeInfoEntity.mutations).length;

      service.onModuleInit();

      // Should register one call per mutation (plus queries)
      const total = Object.keys(nodeInfoEntity.queries).length + mutationCount;
      expect(mockDispatcher.register).toHaveBeenCalledTimes(total);
    });

    it("should call register with entity key and method name", () => {
      service.onModuleInit();

      // First query handler registered: "node-info" / "get"
      expect(mockDispatcher.register).toHaveBeenCalledWith(
        "node-info",
        "get",
        expect.any(Function),
      );
    });
  });

  describe("onModuleDestroy", () => {
    it("should unregister all handlers", () => {
      service.onModuleDestroy();
      expect(mockDispatcher.unregisterAll).toHaveBeenCalledWith("node-info");
    });
  });

  // ─── Query API ─────────────────────────────────────────────────────

  describe("from", () => {
    it("should return a builder for the given method name", () => {
      const builder = service.from("get");
      expect(builder).toBeDefined();
      expect(typeof builder.request).toBe("function");
    });
  });

  // ─── Type safety ───────────────────────────────────────────────────

  it("should have correct entity type inference", () => {
    // The service is typed as MeshResourceService<typeof nodeInfoEntity>
    // which means entityKey is the literal "node-info"
    const key: "node-info" = service.entityKey;
    expect(key).toBe("node-info");
  });
});
