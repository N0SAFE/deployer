import { describe, expect, it, vi } from "vitest";

import { buildMeshHandlers, type LocalNodeOperations } from "./mesh-handlers";

const local = (overrides: Partial<Record<keyof LocalNodeOperations, unknown>> = {}) =>
  new Proxy(overrides, {
    get: (target, key: string) => (key in target ? target[key as keyof typeof target] : vi.fn(async () => `${key}-result`)),
  }) as unknown as LocalNodeOperations;

describe("buildMeshHandlers", () => {
  it("answers a container list with the page, this node and its daemon, without stopping the fan-out", async () => {
    const handlers = buildMeshHandlers(
      local({
        listContainers: vi.fn(async () => ({ data: [], meta: { total: 0, limit: 5, offset: 0, hasMore: false } })),
        getLocalDockerDaemonId: vi.fn(async () => "daemon-1"),
      }),
      "node-a",
    );
    const answer = await handlers.container.listContainers({ payload: { query: { limit: 5, offset: 0 } as never } });
    expect(answer).toEqual({
      payload: { data: [], meta: { total: 0, limit: 5, offset: 0, hasMore: false }, responderNodeId: "node-a", responderDaemonId: "daemon-1" },
    });
    expect("stopPropagation" in answer).toBe(false);
  });

  it("answers an inspect as the owner: the detail, this node, and stop asking others", async () => {
    const inspect = vi.fn(async () => ({ id: "c1" }));
    const handlers = buildMeshHandlers(local({ inspectContainer: inspect }), "node-a");
    await expect(handlers.container.inspectContainer({ payload: { query: { containerId: "c1" } } })).resolves.toEqual({
      payload: { detail: { id: "c1" }, responderNodeId: "node-a" },
      stopPropagation: true,
    });
    expect(inspect).toHaveBeenCalledWith("c1");
  });

  it("answers the catalog without stopping, and every runtime operation as the owner under its own key", async () => {
    const handlers = buildMeshHandlers(local(), "node-a");
    await expect(handlers.container.runtimeCatalog()).resolves.toEqual({
      payload: { catalog: "getRuntimeCatalogSnapshot-result", responderNodeId: "node-a" },
    });

    const snapshot = await handlers.runtime.filesSnapshot({ payload: { query: { containerId: "c1" } } });
    expect(snapshot).toEqual({ payload: { snapshot: "listFiles-result", responderNodeId: "node-a" }, stopPropagation: true });

    const ack = await handlers.runtime.renamePath({ payload: { body: { containerId: "c1", path: "/a", nextPath: "/b" } } });
    expect(ack.payload).toEqual({ ack: "renamePath-result", responderNodeId: "node-a" });

    const session = await handlers.runtime.terminalOpen({ payload: { body: { containerId: "c1" } } });
    expect(session.payload).toEqual({ session: "openTerminal-result", responderNodeId: "node-a" });

    const image = await handlers.runtime.imageInspect({ payload: { query: { imageId: "img" } } });
    expect(image.payload).toEqual({ detail: "inspectImage-result", responderNodeId: "node-a" });
  });

  it("lets a local failure reject, so the mesh sees no answer from this node", async () => {
    const handlers = buildMeshHandlers(local({ readFile: vi.fn(async () => { throw new Error("no such container"); }) }), "node-a");
    await expect(handlers.runtime.readFileSnapshot({ payload: { query: { containerId: "c1", path: "/x" } } })).rejects.toThrow("no such container");
  });
});
