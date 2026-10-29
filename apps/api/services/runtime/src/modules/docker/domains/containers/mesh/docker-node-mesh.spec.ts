import { ORPCError, type ClientContext, type ClientLink } from "@orpc/client";
import { describe, expect, it, vi } from "vitest";

import { type NodeMeshAgent, dockerNodeMeshOver } from "./docker-node-mesh";

type Handler = (path: string[], input: unknown) => unknown;

/**
 * The agent of the node this runtime runs on, as the runtime sees it: a directory of replicas, and a relay that hands a
 * call to the node it is pinned to. The nodes answer with the handlers a test gives them.
 */
function agentWith(options: { replicas: { replicaId: string; nodeId: string }[]; nodes: Record<string, Handler>; keyHolders?: Record<string, string> }) {
  const relayed: { node?: string; key?: string; path: string[] }[] = [];
  const link: ClientLink<ClientContext> = {
    call: (path, input) => {
      const [group, name] = path;
      if (group === "directory" && name === "snapshot") {
        return Promise.resolve({ replicas: options.replicas.map((replica) => ({ service: "runtime", ...replica })) });
      }
      if (group === "directory" && name === "resolve") {
        const { key } = input as { key: string };
        const holder = options.keyHolders?.[key];
        const replica = options.replicas.find((candidate) => candidate.nodeId === holder) ?? options.replicas[0];
        return Promise.resolve({ reason: holder ? "key-holder" : "least-loaded", replica: { service: "runtime", ...replica } });
      }
      const request = input as { node?: string; key?: string; path: string[]; input: unknown };
      relayed.push({ node: request.node, key: request.key, path: request.path });
      const handler = request.node === undefined ? undefined : options.nodes[request.node];
      return Promise.resolve(
        (async function* () {
          await Promise.resolve();
          if (!handler) throw new ORPCError("NOT_FOUND", { message: "no such node" });
          yield { kind: "value", value: await handler(request.path, request.input) };
        })(),
      );
    },
  };
  const holder: NodeMeshAgent = { link, selfReplicaId: "runtime-a" };
  return { mesh: dockerNodeMeshOver(holder), relayed, holder };
}

const replicas = [
  { replicaId: "runtime-a", nodeId: "A" },
  { replicaId: "runtime-b", nodeId: "B" },
  { replicaId: "runtime-c", nodeId: "C" },
];

describe("dockerNodeMesh", () => {
  describe("a question for every node", () => {
    it("asks every node but its own, and names each answer after the node that gave it", async () => {
      const { mesh, relayed } = agentWith({
        replicas,
        nodes: {
          B: () => ({ data: [{ id: "b1" }], meta: { total: 1, limit: 20, offset: 0, hasMore: false }, daemonId: "daemon-b" }),
          C: () => ({ data: [{ id: "c1" }], meta: { total: 1, limit: 20, offset: 0, hasMore: false }, daemonId: "daemon-c" }),
        },
      });

      const result = await mesh.listContainersAcrossInstances({ query: { limit: 20, offset: 0 } });

      expect(relayed.map((call) => call.node).sort()).toEqual(["B", "C"]);
      expect(result.responses.map((response) => [response.responderNodeId, response.responderDaemonId]).sort()).toEqual([
        ["B", "daemon-b"],
        ["C", "daemon-c"],
      ]);
      expect(result.metrics).toMatchObject({ expectedResponders: 2, receivedResponses: 2, timedOut: false });
    });

    it("goes on without a node that fails", async () => {
      const { mesh } = agentWith({
        replicas,
        nodes: { B: () => Promise.reject(new Error("docker is down")), C: () => ({ catalog: { c: true } }) },
      });

      const result = await mesh.listRuntimeCatalogAcrossInstances({});

      expect(result.responses).toEqual([{ catalog: { c: true }, responderNodeId: "C" }]);
    });

    it("stops as soon as it has as many answers as it was told to want", async () => {
      const { mesh } = agentWith({ replicas, nodes: { B: () => ({ detail: { id: "b" } }), C: () => new Promise((resolve) => { setTimeout(() => resolve({ detail: { id: "c" } }), 500); }) } });

      const started = Date.now();
      const result = await mesh.inspectImageAcrossInstances({ query: { imageId: "img" } }, { maxCollectedResponses: 1 });

      expect(result.responses).toHaveLength(1);
      expect(result.stoppedEarly).toBe(true);
      expect(Date.now() - started).toBeLessThan(400);
    });

    it("gives up on a node that does not answer in time, keeping the answers it has", async () => {
      const { mesh } = agentWith({ replicas, nodes: { B: () => ({ catalog: { b: true } }), C: () => new Promise(() => undefined) } });

      const result = await mesh.listRuntimeCatalogAcrossInstances({}, { timeoutMs: 50 });

      expect(result.responses).toEqual([{ catalog: { b: true }, responderNodeId: "B" }]);
      expect(result.metrics.timedOut).toBe(true);
    });

    it("asks the nodes for a terminal session, which is not announced as a key, and uses the first answer", async () => {
      const { mesh } = agentWith({ replicas, nodes: { B: () => Promise.reject(new Error("terminal session not found")), C: () => ({ ok: true, timestamp: "t" }) } });

      const result = await mesh.sendContainerTerminalInputAcrossInstances({ body: { sessionId: "s1", input: "ls\n" } }, { maxCollectedResponses: 1 });

      expect(result.responses).toEqual([{ ack: { ok: true, timestamp: "t" }, responderNodeId: "C" }]);
    });
  });

  describe("a question about a container", () => {
    it("asks the node that announced the container, and only that one", async () => {
      const { mesh, relayed } = agentWith({
        replicas,
        keyHolders: { c1: "C" },
        nodes: { B: () => Promise.reject(new Error("not asked")), C: () => ({ generatedAt: "t", entries: [] }) },
      });

      const result = await mesh.listContainerLogsSnapshotAcrossInstances({ query: { containerId: "c1" } });

      expect(result.responses).toEqual([{ snapshot: { generatedAt: "t", entries: [] }, responderNodeId: "C" }]);
      expect(relayed).toEqual([{ node: "C", key: "c1", path: ["mesh", "node", "runtime", "logs"] }]);
    });

    it("asks the other nodes when the one that announced it cannot answer", async () => {
      const { mesh, relayed } = agentWith({
        replicas,
        keyHolders: { c1: "B" },
        nodes: { B: () => Promise.reject(new Error("engine hiccup")), C: () => ({ ok: true, timestamp: "t" }) },
      });

      const result = await mesh.writeContainerFileAcrossInstances({ body: { containerId: "c1", path: "/a", content: "x" } }, { maxCollectedResponses: 1 });

      expect(result.responses).toEqual([{ ack: { ok: true, timestamp: "t" }, responderNodeId: "C" }]);
      expect(relayed.map((call) => call.node)).toEqual(["B", "C"]);
    });

    it("asks every other node when nobody has announced the container yet", async () => {
      const { mesh, relayed } = agentWith({ replicas, nodes: { B: () => Promise.reject(new Error("no such container")), C: () => ({ detail: { id: "c1" } }) } });

      const result = await mesh.inspectContainerAcrossInstances({ query: { containerId: "c1" } });

      expect(result.responses).toEqual([{ detail: { id: "c1" }, responderNodeId: "C" }]);
      expect(relayed.map((call) => call.node).sort()).toEqual(["B", "C"]);
    });

    it("does not ask its own node, which the caller has already tried", async () => {
      const { mesh, relayed } = agentWith({ replicas, keyHolders: { c1: "A" }, nodes: { B: () => ({ ok: true, timestamp: "t" }) } });

      await mesh.deleteContainerPathAcrossInstances({ body: { containerId: "c1", path: "/a" } }, { maxCollectedResponses: 1 });

      expect(relayed.every((call) => call.node !== "A")).toBe(true);
    });
  });

  describe("with no one to ask", () => {
    it("answers with nobody when the runtime has no agent, as a lone node always did", async () => {
      const { mesh, holder } = agentWith({ replicas, nodes: {} });
      holder.link = undefined;

      const result = await mesh.listContainersAcrossInstances({ query: { limit: 20, offset: 0 } });

      expect(result.responses).toEqual([]);
    });

    it("answers with nobody when the agent cannot be reached", async () => {
      const { mesh, holder } = agentWith({ replicas, nodes: {} });
      holder.link = { call: vi.fn().mockRejectedValue(new Error("agent restarting")) };

      expect((await mesh.listRuntimeCatalogAcrossInstances({})).responses).toEqual([]);
      expect((await mesh.inspectContainerAcrossInstances({ query: { containerId: "c1" } })).responses).toEqual([]);
    });

    it("answers with nobody when this is the only node", async () => {
      const { mesh } = agentWith({ replicas: [{ replicaId: "runtime-a", nodeId: "A" }], nodes: {} });

      const result = await mesh.listContainersAcrossInstances({ query: { limit: 20, offset: 0 } });

      expect(result.responses).toEqual([]);
      expect(result.metrics.expectedResponders).toBe(0);
    });
  });
});
