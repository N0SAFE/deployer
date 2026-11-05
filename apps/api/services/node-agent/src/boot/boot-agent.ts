import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { vi } from "vitest";

import { agentLink, createMeshClient, openWebSocketConnection, pooledLink } from "@deployer/mesh-client";
import { MESH_WEBSOCKET_PATH, type nodeAgentContract } from "@deployer/node-agent-contracts";
import { createApiServerApp } from "@deployer/shared/server";

import type { NodeAgentsShape } from "@/modules/mesh/services/node-agents.service";
import type { MeshTransportService } from "@/transport/mesh-transport.service";

import type { INestApplication } from "@nestjs/common";
import type { ClientContext } from "@orpc/client";
import type { ContractRouterClient } from "@orpc/contract";
import type { AddressInfo } from "node:net";

/** The client every spec talks through: the contract, on the peer door or on the local socket, depending on the link. */
export type NodeAgentClient = ContractRouterClient<typeof nodeAgentContract>;

export type BootedAgent = {
  readonly app: INestApplication;
  /** The module-owned transport: its `localSocketPath` is bound by the time the boot resolves. */
  readonly transport: MeshTransportService;
  readonly http: string;
  readonly ws: string;
  readonly dataDir: string;
  readonly stop: () => Promise<void>;
};

/** A pooled link to an agent's peer door. Omit the credential to be refused at the upgrade, as a stranger is. */
export const peerLink = (ws: string, credential?: string) =>
  pooledLink<ClientContext>({
    target: ws,
    maxConnections: 1,
    multiplex: 8,
    idleMs: 1_000,
    open: () =>
      Promise.resolve(
        openWebSocketConnection({
          url: credential === undefined ? ws : `${ws}?credential=${credential}`,
          reconnectDelayMs: 20,
        }),
      ),
  });

/** A client on an agent's peer door, with the credential the caller holds. Calls are Effects. */
export const peerClient = (agent: BootedAgent, credential?: string) =>
  createMeshClient<NodeAgentClient>(peerLink(agent.ws, credential));

/**
 * A client on an agent's ADMIN door: the operator procedures (token, join, rotate, block, configure). The service door
 * does not serve them, which is what a service container holds.
 */
export const adminClient = (agent: BootedAgent) =>
  createMeshClient<NodeAgentClient>(agentLink(agent.transport.adminSocketPath));

export type BootOptions = {
  /** The agent's data directory: boot again with the same one to restart the same node. Defaults to a fresh one. */
  readonly dataDir?: string;
  /** DEV pins. A node that is plug and play sets none of them. */
  readonly pin?: { readonly nodeId?: string; readonly secret?: string; readonly seeds?: readonly string[] };
  /** Bind the agent's local socket here instead of the data dir (the deployment's shared run volume). */
  readonly socketPath?: string;
  /** Deployment settings for the booted agent, set before its module graph reads the environment. */
  readonly env?: Readonly<Record<string, string>>;
  /**
   * Replace this agent's roster before its services are built: the one thing no environment can express is a *partial*
   * partition (A cannot dial C, B can), which is what multi-hop relay exists for.
   */
  readonly nodeAgents?: (base: NodeAgentsShape) => NodeAgentsShape;
};

export async function freePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const { port } = probe.address() as AddressInfo;
  await new Promise<void>((resolve) => probe.close(() => { resolve(); }));
  return port;
}

export const freshDataDir = () => mkdtempSync(join(tmpdir(), "node-agent-"));

/**
 * One real agent: the real root module on a real port, serving the real websocket, gossiping for real. Each boot loads
 * its own copy of the modules, because the environment is read once when the module graph is first imported.
 *
 * The transport is a module: `app.listen` starts it, and `app.close()` stops it. The loops run fast because their
 * intervals are environment settings, which is the only thing a test changes.
 *
 * ── WHY `vi.resetModules()` IS THE EXPENSIVE PART ────────────────────────────
 * Measured on the reference machine: a boot is 300-400ms of real work, but the six
 * specs under `src/boot/` (58 `bootAgent()` calls between them) account for 60 of
 * the suite's 65 seconds of file time, and `node-door.spec.ts` alone spends 11.5s
 * importing against 5.5s testing. The reset discards the module cache, so the NEXT
 * `await import` re-executes and re-transforms the whole Nest graph per boot, and
 * the discarded graph stays resident: +25 MB RSS per call, uncollected
 * (397 → 421 → 448 MB over three boots).
 *
 * So prefer ONE boot per spec file and read-only assertions on it. A spec that
 * boots per `it()` pays the graph again for each case. Where a case genuinely needs
 * a fresh environment (a different data dir, a pin, a restart) pass `dataDir` to
 * reuse the directory rather than re-booting an unchanged node.
 */
export async function bootAgent(options: BootOptions = {}): Promise<BootedAgent> {
  const port = await freePort();
  const ws = `ws://127.0.0.1:${String(port)}${MESH_WEBSOCKET_PATH}`;
  const dataDir = options.dataDir ?? freshDataDir();

  for (const name of [
    "MESH_NODE_ID",
    "NODE_AGENT_SECRET",
    "MESH_SEEDS",
    "NODE_AGENT_SOCKET",
    "MESH_GOSSIP_FANOUT",
    "MESH_GOSSIP_INTERVAL_MS",
    "MESH_DOORS_INTERVAL_MS",
  ]) {
    Reflect.deleteProperty(process.env, name);
  }
  Object.assign(
    process.env,
    {
      NODE_AGENT_DATA_DIR: dataDir,
      MESH_ADVERTISE_URL: ws,
      MESH_GOSSIP_INTERVAL_MS: "100",
      MESH_DOORS_INTERVAL_MS: "100",
    },
    options.env ?? {},
  );
  if (options.socketPath) process.env.NODE_AGENT_SOCKET = options.socketPath;
  if (options.pin?.nodeId) process.env.MESH_NODE_ID = options.pin.nodeId;
  if (options.pin?.secret) process.env.NODE_AGENT_SECRET = options.pin.secret;
  if (options.pin?.seeds?.length) process.env.MESH_SEEDS = options.pin.seeds.join(",");

  vi.resetModules();
  // The Effect extension patches `@orpc/server`, and a reset gives the new graph a fresh, unpatched copy.
  await import("@orpc/effect/extensions/effect");
  await import("@deployer/shared/core/orpc/context");
  // The seam lives in the mesh module, so it must be set on the instance this graph will import.
  const { meshBootOverrides } = await import("@/modules/mesh/mesh.module");
  meshBootOverrides.nodeAgents = options.nodeAgents;
  const { NodeAgentServiceModule } = await import("@/app.module");
  const { MeshTransportService } = await import("@/transport/mesh-transport.service");
  const app = await createApiServerApp(NodeAgentServiceModule);
  await app.listen(port, "127.0.0.1");
  const transport = app.get(MeshTransportService);

  return {
    app,
    transport,
    http: `http://127.0.0.1:${String(port)}`,
    ws,
    dataDir,
    stop: async () => {
      await app.close();
    },
  };
}

export const removeDataDir = (dataDir: string) => { rmSync(dataDir, { recursive: true, force: true }); };
