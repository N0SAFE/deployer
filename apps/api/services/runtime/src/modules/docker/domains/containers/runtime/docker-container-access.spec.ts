import { DockerEngine } from "@deployer/docker";
import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";

import { ContainerAccessMeshPort, DockerContainerAccess } from "./docker-container-access";
import { DockerContainerOps } from "./docker-container-ops";
import { DockerTerminalSessions } from "./docker-terminal-sessions";

const run = <A>(effect: Effect.Effect<A, unknown, unknown>, ports: { ops?: unknown; sessions?: unknown; mesh?: unknown }) =>
  Effect.runPromise(
    effect.pipe(
      Effect.provideService(DockerContainerOps, (ports.ops ?? {}) as never),
      Effect.provideService(DockerTerminalSessions, (ports.sessions ?? {}) as never),
      Effect.provideService(ContainerAccessMeshPort, (ports.mesh ?? {}) as never),
      Effect.provideService(DockerEngine, {} as never),
    ) as Effect.Effect<A>,
  );

const noSuchContainer = () => Effect.fail(new Error("No such container: c1"));

describe("DockerContainerAccess", () => {
  it("serves a local container without asking the mesh", async () => {
    const mesh = { listContainerFilesSnapshotAcrossInstances: vi.fn() };
    const ops = { listFiles: () => Effect.succeed({ entries: [], path: "/" }) };
    await expect(run(DockerContainerAccess.live.listFiles({ containerId: "c1" } as never), { ops, mesh })).resolves.toEqual({
      entries: [],
      path: "/",
    });
    expect(mesh.listContainerFilesSnapshotAcrossInstances).not.toHaveBeenCalled();
  });

  it("reads a file from the node that owns the container when this one does not", async () => {
    const snapshot = { content: "remote" };
    const mesh = { readContainerFileSnapshotAcrossInstances: vi.fn(async () => ({ responses: [{ snapshot }] })) };
    const ops = { readFile: noSuchContainer };
    const result = await run(DockerContainerAccess.live.readFile({ containerId: "c1", path: "/x" } as never), { ops, mesh });
    expect(result).toBe(snapshot);
    expect(mesh.readContainerFileSnapshotAcrossInstances).toHaveBeenCalledWith(
      { query: { containerId: "c1", path: "/x" } },
      expect.objectContaining({ maxCollectedResponses: 1 }),
    );
  });

  it("reports the local error when no node has the container", async () => {
    const mesh = { deleteContainerPathAcrossInstances: vi.fn(async () => ({ responses: [] })) };
    await expect(
      run(DockerContainerAccess.live.deletePath({ containerId: "c1", path: "/x" } as never), { ops: { deletePath: noSuchContainer }, mesh }),
    ).rejects.toThrow(/No such container/);
  });

  it("forwards terminal input to the owning node when the session is not here", async () => {
    const ack = { ok: true };
    const mesh = { sendContainerTerminalInputAcrossInstances: vi.fn(async () => ({ responses: [{ ack }] })) };
    const sessions = { sendInput: () => Effect.fail(new Error("Terminal session 's1' not found")) };
    await expect(run(DockerContainerAccess.live.sendTerminalInput({ sessionId: "s1", input: "ls" } as never), { sessions, mesh })).resolves.toBe(ack);
  });

  it("treats closing a session nobody has as a success", async () => {
    const mesh = { closeContainerTerminalSessionAcrossInstances: vi.fn(async () => ({ responses: [] })) };
    const sessions = { close: () => Effect.fail(new Error("Terminal session 's1' not found")) };
    const closed = (await run(DockerContainerAccess.live.closeTerminal({ sessionId: "s1" } as never), { sessions, mesh })) as { ok: boolean };
    expect(closed.ok).toBe(true);
  });

  it("does not hide an unrelated terminal failure behind the mesh", async () => {
    const mesh = { sendContainerTerminalInputAcrossInstances: vi.fn() };
    const sessions = { sendInput: () => Effect.fail(new Error("stream write failed")) };
    await expect(run(DockerContainerAccess.live.sendTerminalInput({ sessionId: "s1", input: "x" } as never), { sessions, mesh })).rejects.toThrow("stream write failed");
    expect(mesh.sendContainerTerminalInputAcrossInstances).not.toHaveBeenCalled();
  });
});
