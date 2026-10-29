import { ORPCError } from "@orpc/client";
import { RPCLink } from "@orpc/client/message-port";
import { RPCHandler } from "@orpc/server/message-port";
import { describe, expect, it, vi } from "vitest";

import { buildNodeRouter, containerIds } from "./node-router";

import type { LocalNodeOperations } from "./mesh-handlers";
import type { ClientContext } from "@orpc/client";

const ack = { ok: true as const, timestamp: "2026-10-29T00:00:00.000Z" };

/** Local operations answering with fixed values; a test overrides the ones it looks at. */
function localOperations(overrides: Partial<LocalNodeOperations> = {}): LocalNodeOperations {
  const fail = () => Promise.reject(new Error("not expected"));
  return {
    listContainers: () => Promise.resolve({ data: [], meta: { total: 0, limit: 500, offset: 0, hasMore: false } }),
    getLocalDockerDaemonId: () => Promise.resolve("daemon-1"),
    inspectContainer: fail,
    getRuntimeCatalogSnapshot: fail,
    inspectImage: fail,
    logsSnapshot: () => Promise.resolve({ generatedAt: "t", entries: [] }),
    processes: () => Promise.resolve({ generatedAt: "t", data: [] }),
    processLogsSnapshot: () => Promise.resolve({ generatedAt: "t", entries: [] }),
    listFiles: () => Promise.resolve({ containerId: "c1", path: "/", generatedAt: "t", entries: [] }),
    readFile: () => Promise.resolve({ containerId: "c1", path: "/a", generatedAt: "t", encoding: "utf8" as const, content: "hi" }),
    writeFile: () => Promise.resolve(ack),
    deletePath: () => Promise.resolve(ack),
    renamePath: () => Promise.resolve(ack),
    createDirectory: () => Promise.resolve(ack),
    openTerminal: fail,
    terminalEvents: () => Promise.resolve({ sessionId: "s1", generatedAt: "t", closed: false, latestSequence: 0, events: [] }),
    sendTerminalInput: () => Promise.resolve(ack),
    closeTerminal: () => Promise.resolve(ack),
    ...overrides,
  };
}

/** The router over real oRPC RPC peers (in-memory ports), as a caller on the mesh would reach it. */
function clientFor(local: LocalNodeOperations) {
  const { port1, port2 } = new MessageChannel();
  new RPCHandler(buildNodeRouter(local) as never).upgrade(port1, { context: {} });
  port1.start();
  port2.start();
  const link = new RPCLink<ClientContext>({ port: port2 });
  return (path: string[], input: unknown) => link.call(path, input, { context: {} });
}

describe("node router", () => {
  it("answers a page of containers with the id of the daemon that answered", async () => {
    const listContainers = vi.fn().mockResolvedValue({ data: [], meta: { total: 0, limit: 20, offset: 0, hasMore: false } });
    const call = clientFor(localOperations({ listContainers }));

    await expect(call(["containers", "list"], { limit: 20, offset: 0 })).resolves.toEqual({
      data: [],
      meta: { total: 0, limit: 20, offset: 0, hasMore: false },
      daemonId: "daemon-1",
    });
    expect(listContainers).toHaveBeenCalledWith({ limit: 20, offset: 0 });
  });

  it("validates its input at the door: a limit past the maximum never reaches the engine", async () => {
    const listContainers = vi.fn();
    const call = clientFor(localOperations({ listContainers }));

    await expect(call(["containers", "list"], { limit: 100_000, offset: 0 })).rejects.toBeDefined();
    expect(listContainers).not.toHaveBeenCalled();
  });

  it.each([
    ["runtime", "writeFile", { containerId: "c1", path: "/a", content: "x" }],
    ["runtime", "deletePath", { containerId: "c1", path: "/a" }],
    ["runtime", "renamePath", { containerId: "c1", path: "/a", nextPath: "/b" }],
    ["runtime", "createDirectory", { containerId: "c1", path: "/d" }],
    ["runtime", "terminalInput", { sessionId: "s1", input: "ls\n" }],
    ["runtime", "terminalClose", { sessionId: "s1" }],
  ])("acknowledges %s.%s", async (group, name, input) => {
    const call = clientFor(localOperations());

    await expect(call([group, name], input)).resolves.toEqual(ack);
  });

  it("hands each operation its own query, untouched", async () => {
    const logsSnapshot = vi.fn().mockResolvedValue({ generatedAt: "t", entries: [] });
    const call = clientFor(localOperations({ logsSnapshot }));

    await call(["runtime", "logs"], { containerId: "c1", tail: 50 });

    expect(logsSnapshot).toHaveBeenCalledWith({ containerId: "c1", tail: 50 });
  });

  it("hands a container id and an image id to the engine reads, as the id and nothing around it", async () => {
    const inspectContainer = vi.fn().mockResolvedValue({});
    const inspectImage = vi.fn().mockResolvedValue({});
    const call = clientFor(localOperations({ inspectContainer, inspectImage }));

    // The engine's detail is a large entity; its shape is the entity schema's business, not this router's.
    await call(["containers", "inspect"], { containerId: "c1" }).catch(() => undefined);
    await call(["images", "inspect"], { imageId: "img1" }).catch(() => undefined);

    expect(inspectContainer).toHaveBeenCalledWith("c1");
    expect(inspectImage).toHaveBeenCalledWith("img1");
  });

  it("carries a failure of the engine to the caller as an error, not as a silent empty answer", async () => {
    const call = clientFor(localOperations({ logsSnapshot: () => Promise.reject(new ORPCError("NOT_FOUND", { message: "no such container" })) }));

    await expect(call(["runtime", "logs"], { containerId: "gone" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("containerIds", () => {
  const page = (ids: string[], hasMore: boolean) => ({ data: ids.map((id) => ({ id })), meta: { total: 0, limit: 500, offset: 0, hasMore } });

  it("reads every page, so a node with many containers announces all of them", async () => {
    const listContainers = vi.fn().mockResolvedValueOnce(page(["a", "b"], true)).mockResolvedValueOnce(page(["c"], false));

    const ids = await containerIds({ listContainers });

    expect(ids).toEqual(["a", "b", "c"]);
    expect(listContainers).toHaveBeenNthCalledWith(1, { limit: 500, offset: 0 });
    expect(listContainers).toHaveBeenNthCalledWith(2, { limit: 500, offset: 500 });
  });

  it("announces nothing for a node with no containers", async () => {
    expect(await containerIds({ listContainers: () => Promise.resolve(page([], false)) } as never)).toEqual([]);
  });
});
