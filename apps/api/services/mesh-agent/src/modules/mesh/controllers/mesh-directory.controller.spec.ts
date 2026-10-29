import "@orpc/effect/extensions/effect";

import { Context } from "effect";
import { beforeEach, describe, expect, it } from "vitest";

import { effectContext } from "@deployer/nest-effect/testing";
import { callProcedure } from "@deployer/orpc-utils/testing";

import { MeshDirectoryRepository, createDirectoryStore, directoryRepositoryOver } from "../repositories/directory.repository";
import { MeshDirectory } from "../services/directory.service";
import { MeshClock } from "../services/mesh-clock.service";
import { NodeIdentity } from "../services/node-identity.service";

import { MeshDirectoryController } from "./mesh-directory.controller";

/**
 * The mesh directory's contract surface.
 *
 * `.effect()` handlers resolve services from `effect/context`, so the controller is a plain class and the context is
 * built explicitly from the real services over an empty directory.
 */
describe("MeshDirectoryController", () => {
  let controller: MeshDirectoryController;
  let context: ReturnType<typeof contextFor>;

  const contextFor = () =>
    effectContext(
      Context.empty().pipe(
        Context.add(MeshDirectory, MeshDirectory.live),
        Context.add(MeshDirectoryRepository, directoryRepositoryOver(createDirectoryStore())),
        Context.add(NodeIdentity, { nodeId: "A" }),
        Context.add(MeshClock, { now: () => 1_000 }),
      ),
    );

  beforeEach(() => {
    context = contextFor();
    controller = new MeshDirectoryController();
  });

  const call = <TOutput>(implementation: unknown, input: unknown = {}) => callProcedure<TOutput>(implementation, input, context);

  const registration = { service: "runtime", replicaId: "runtime-1", address: "http://runtime-1", load: 0.1, keys: ["stream-1"], ttlMs: 5_000 };

  describe("register", () => {
    it("stamps the agent's node and returns the stored record", async () => {
      await expect(call(controller.register(), registration)).resolves.toMatchObject({
        replicaId: "runtime-1",
        nodeId: "A",
        generation: 1,
        expiresAt: 6_000,
        keys: ["stream-1"],
      });
    });
  });

  describe("resolve", () => {
    it("answers with the replica and why it was chosen", async () => {
      await call(controller.register(), registration);

      await expect(call(controller.resolve(), { service: "runtime", key: "stream-1" })).resolves.toMatchObject({
        reason: "key-holder",
        replica: { replicaId: "runtime-1" },
      });
    });

    it("surfaces an unknown service as the declared NOT_FOUND error", async () => {
      await expect(call(controller.resolve(), { service: "ghost" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    });
  });

  describe("unregister", () => {
    it("reports whether the replica was known", async () => {
      await call(controller.register(), registration);

      await expect(call(controller.unregister(), { replicaId: "runtime-1" })).resolves.toEqual({ removed: true });
      await expect(call(controller.unregister(), { replicaId: "runtime-1" })).resolves.toEqual({ removed: false });
    });
  });

  describe("snapshot", () => {
    it("lists every live replica", async () => {
      await call(controller.register(), registration);

      const result = await call<{ replicas: { replicaId: string }[] }>(controller.snapshot());

      expect(result.replicas.map((replica) => replica.replicaId)).toEqual(["runtime-1"]);
    });
  });
});
