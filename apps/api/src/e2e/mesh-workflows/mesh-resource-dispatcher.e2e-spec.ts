/**
 * Mesh Resource Dispatcher — E2E Tests
 *
 * Tests the full dispatcher lifecycle using a lightweight test module
 * that only provides the dispatcher (no ORPC/DB dependencies).
 */

import { Test, type TestingModule } from "@nestjs/testing";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { MeshResourceDispatcher } from "@/core/modules/mesh/dispatcher/mesh-resource-dispatcher.service";

describe("Mesh Resource Dispatcher E2E", () => {
  let moduleRef: TestingModule;
  let dispatcher: MeshResourceDispatcher;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      providers: [MeshResourceDispatcher],
    }).compile();

    dispatcher = moduleRef.get(MeshResourceDispatcher);
  }, 30_000);

  afterAll(async () => {
    await moduleRef.close();
  });

  it("should register a handler and dispatch to it", async () => {
    const handler = vi.fn().mockResolvedValue({ success: true });
    dispatcher.register("test", "action", handler);

    const result = await dispatcher.dispatch("test", "action", { id: "1" });

    expect(handler).toHaveBeenCalledWith({ id: "1" });
    expect(result).toEqual({ success: true });
  });

  it("should throw NOT_FOUND for unregistered handlers", async () => {
    await expect(
      dispatcher.dispatch("unknown", "method", {}),
    ).rejects.toThrow(/No mesh resource handler/);
  });

  it("should throw on duplicate registration", () => {
    dispatcher.register("dup", "method", vi.fn());
    expect(() => dispatcher.register("dup", "method", vi.fn()))
      .toThrow(/Duplicate mesh resource handler/);
  });

  it("should unregister handlers on request", () => {
    dispatcher.register("ephemeral", "list", vi.fn());
    dispatcher.register("persistent", "list", vi.fn());
    expect(dispatcher.totalHandlers).toBe(2);

    dispatcher.unregisterAll("ephemeral");
    expect(dispatcher.totalHandlers).toBe(1);
    expect(dispatcher.has("persistent", "list")).toBe(true);
  });
});
