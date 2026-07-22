/**
 * DeploymentsResourceService — Unit Tests
 *
 * Tests the concrete deployment resource service extending MeshResourceService.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { DeploymentsMeshService } from "./deployments.mesh.service";
import { deploymentResourceEntity } from "../entities/deployment-resource.entity";
import { MeshResourceDispatcher } from "@/core/modules/mesh/dispatcher/mesh-resource-dispatcher.service";
import type { MeshQueryExecutor } from "@/core/modules/mesh/services/system-mesh-resource-discovery/query/mesh-query-executor";

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
    dispatch: vi.fn().mockResolvedValue({ items: [], total: 0 }),
    has: vi.fn().mockReturnValue(true),
  } as unknown as MeshResourceDispatcher;
}

describe("DeploymentsMeshService", () => {
  let executor: MeshQueryExecutor;
  let dispatcher: MeshResourceDispatcher;
  let service: DeploymentsMeshService;

  beforeEach(() => {
    executor = createMockExecutor();
    dispatcher = createMockDispatcher();
    service = new DeploymentsMeshService(executor, dispatcher);
    vi.clearAllMocks();
  });

  // ─── Construction ──────────────────────────────────────────────────

  it("should be constructable", () => {
    expect(service).toBeDefined();
  });

  it("should have entity metadata from the entity definition", () => {
    expect(service.entityKey).toBe("deployments");
    expect(service.itemKey).toBe("deploymentId");
  });

  // ─── Lifecycle — onModuleInit ──────────────────────────────────────

  describe("onModuleInit", () => {
    it("should register all query handlers with dispatcher", () => {
      service.onModuleInit();

      const registerCalls = vi.mocked(dispatcher.register).mock.calls;
      // deploymentResourceEntity has 3 queries: list, resolve, search — 0 mutations
      expect(registerCalls.length).toBe(3);
    });

    it("should register list, resolve, and search handlers", () => {
      service.onModuleInit();

      expect(dispatcher.register).toHaveBeenCalledWith("deployments", "list", expect.any(Function));
      expect(dispatcher.register).toHaveBeenCalledWith("deployments", "resolve", expect.any(Function));
      expect(dispatcher.register).toHaveBeenCalledWith("deployments", "search", expect.any(Function));
    });
  });

  // ─── Lifecycle — onModuleDestroy ───────────────────────────────────

  describe("onModuleDestroy", () => {
    it("should unregister all handlers for deployments", () => {
      service.onModuleDestroy();
      expect(dispatcher.unregisterAll).toHaveBeenCalledWith("deployments");
    });
  });

  // ─── Query API ─────────────────────────────────────────────────────

  describe("from", () => {
    it("should return a builder for each query method", () => {
      const listBuilder = service.from("list");
      expect(listBuilder).toBeDefined();
      expect(typeof listBuilder.request).toBe("function");

      const resolveBuilder = service.from("resolve");
      expect(resolveBuilder).toBeDefined();

      const searchBuilder = service.from("search");
      expect(searchBuilder).toBeDefined();
    });
  });

  // ─── Entity definition integrity ───────────────────────────────────

  it("should have entity matching the source schema", () => {
    expect(deploymentResourceEntity.key).toBe("deployments");
    expect(deploymentResourceEntity.itemKey).toBe("deploymentId");
  });
});
