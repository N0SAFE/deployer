/**
 * MeshResourceDispatcher — Unit Tests
 *
 * Tests the registry + dispatch logic in isolation.
 * No NestJS DI required — pure TypeScript unit tests.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { MeshResourceDispatcher } from "./mesh-resource-dispatcher.service";

describe("MeshResourceDispatcher", () => {
  let dispatcher: MeshResourceDispatcher;

  beforeEach(() => {
    dispatcher = new MeshResourceDispatcher();
  });

  // ─── Registration ─────────────────────────────────────────────────

  describe("register", () => {
    it("should register a handler successfully", () => {
      const handler = vi.fn().mockResolvedValue({ data: "test" });
      dispatcher.register("test-entity", "test-method", handler);

      expect(dispatcher.has("test-entity", "test-method")).toBe(true);
      expect(dispatcher.totalHandlers).toBe(1);
    });

    it("should throw on duplicate registration", () => {
      const handler = vi.fn().mockResolvedValue({});
      dispatcher.register("entity", "method", handler);

      expect(() => {
        dispatcher.register("entity", "method", handler);
      }).toThrow("Duplicate mesh resource handler: entity/method");
    });

    it("should allow different methods on the same entity", () => {
      dispatcher.register("entity", "list", vi.fn());
      dispatcher.register("entity", "get", vi.fn());

      expect(dispatcher.totalHandlers).toBe(2);
      expect(dispatcher.has("entity", "list")).toBe(true);
      expect(dispatcher.has("entity", "get")).toBe(true);
    });

    it("should allow the same method on different entities", () => {
      dispatcher.register("entity-a", "list", vi.fn());
      dispatcher.register("entity-b", "list", vi.fn());

      expect(dispatcher.totalHandlers).toBe(2);
    });
  });

  // ─── Dispatch ─────────────────────────────────────────────────────

  describe("dispatch", () => {
    it("should call the registered handler with input", async () => {
      const handler = vi.fn().mockResolvedValue({ success: true });
      dispatcher.register("entity", "method", handler);

      const result = await dispatcher.dispatch("entity", "method", { foo: "bar" });

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith({ foo: "bar" });
      expect(result).toEqual({ success: true });
    });

    it("should throw ORPCError NOT_FOUND for unregistered handler", async () => {
      await expect(
        dispatcher.dispatch("unknown", "method", {}),
      ).rejects.toThrow(/No mesh resource handler/);
    });

    it("should propagate handler errors", async () => {
      const handler = vi.fn().mockRejectedValue(new Error("Handler error"));
      dispatcher.register("entity", "failing", handler);

      await expect(
        dispatcher.dispatch("entity", "failing", {}),
      ).rejects.toThrow("Handler error");
    });

    it("should handle concurrent dispatches to different handlers", async () => {
      const handlerA = vi.fn().mockResolvedValue("A");
      const handlerB = vi.fn().mockResolvedValue("B");
      dispatcher.register("entity-a", "method", handlerA);
      dispatcher.register("entity-b", "method", handlerB);

      const [resultA, resultB] = await Promise.all([
        dispatcher.dispatch("entity-a", "method", {}),
        dispatcher.dispatch("entity-b", "method", {}),
      ]);

      expect(resultA).toBe("A");
      expect(resultB).toBe("B");
    });
  });

  // ─── Unregister ───────────────────────────────────────────────────

  describe("unregisterAll", () => {
    it("should remove all handlers for an entity", () => {
      dispatcher.register("entity", "list", vi.fn());
      dispatcher.register("entity", "get", vi.fn());
      dispatcher.register("other", "list", vi.fn());
      expect(dispatcher.totalHandlers).toBe(3);

      dispatcher.unregisterAll("entity");

      expect(dispatcher.totalHandlers).toBe(1);
      expect(dispatcher.has("other", "list")).toBe(true);
    });

    it("should be idempotent for unknown entities", () => {
      dispatcher.register("entity", "method", vi.fn());
      dispatcher.unregisterAll("unknown");
      expect(dispatcher.totalHandlers).toBe(1);
    });
  });

  // ─── Introspection ────────────────────────────────────────────────

  describe("registeredEntities", () => {
    it("should list unique entity keys", () => {
      dispatcher.register("entity-a", "list", vi.fn());
      dispatcher.register("entity-a", "get", vi.fn());
      dispatcher.register("entity-b", "list", vi.fn());

      const entities = dispatcher.registeredEntities;
      expect(entities).toContain("entity-a");
      expect(entities).toContain("entity-b");
      expect(entities.length).toBe(2);
    });

    it("should return empty array when no handlers registered", () => {
      expect(dispatcher.registeredEntities).toEqual([]);
    });
  });

  describe("totalHandlers", () => {
    it("should reflect current handler count", () => {
      expect(dispatcher.totalHandlers).toBe(0);
      dispatcher.register("a", "x", vi.fn());
      expect(dispatcher.totalHandlers).toBe(1);
      dispatcher.register("a", "y", vi.fn());
      expect(dispatcher.totalHandlers).toBe(2);
    });
  });
});
