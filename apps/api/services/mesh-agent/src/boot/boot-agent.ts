import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { vi } from "vitest";

import { MESH_WEBSOCKET_PATH } from "@deployer/mesh-agent-contracts";
import { createApiServerApp } from "@deployer/shared/server";

import type { MeshTransport } from "@/transport/mesh-transport";

import type { INestApplication } from "@nestjs/common";
import type { AddressInfo } from "node:net";

export type BootedAgent = {
  readonly app: INestApplication;
  readonly transport: MeshTransport;
  readonly http: string;
  readonly ws: string;
  readonly dataDir: string;
  readonly stop: () => Promise<void>;
};

export type BootOptions = {
  /** The agent's data directory: boot again with the same one to restart the same node. Defaults to a fresh one. */
  readonly dataDir?: string;
  /** DEV pins. A node that is plug and play sets none of them. */
  readonly pin?: { readonly nodeId?: string; readonly secret?: string; readonly seeds?: readonly string[] };
};

export async function freePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const { port } = probe.address() as AddressInfo;
  await new Promise<void>((resolve) => probe.close(() => { resolve(); }));
  return port;
}

export const freshDataDir = () => mkdtempSync(join(tmpdir(), "mesh-agent-"));

/**
 * One real agent: the real root module on a real port, serving the real websocket, gossiping for real. Each boot loads
 * its own copy of the modules, because the environment is read once when the module graph is first imported.
 */
export async function bootAgent(options: BootOptions = {}): Promise<BootedAgent> {
  const port = await freePort();
  const ws = `ws://127.0.0.1:${String(port)}${MESH_WEBSOCKET_PATH}`;
  const dataDir = options.dataDir ?? freshDataDir();

  for (const name of ["MESH_NODE_ID", "MESH_AGENT_SECRET", "MESH_SEEDS"]) {
    Reflect.deleteProperty(process.env, name);
  }
  Object.assign(process.env, { MESH_DATA_DIR: dataDir, MESH_ADVERTISE_URL: ws });
  if (options.pin?.nodeId) process.env.MESH_NODE_ID = options.pin.nodeId;
  if (options.pin?.secret) process.env.MESH_AGENT_SECRET = options.pin.secret;
  if (options.pin?.seeds?.length) process.env.MESH_SEEDS = options.pin.seeds.join(",");

  vi.resetModules();
  // The Effect extension patches `@orpc/server`, and a reset gives the new graph a fresh, unpatched copy.
  await import("@orpc/effect/extensions/effect");
  await import("@deployer/shared/core/orpc/context");
  const { MeshAgentServiceModule } = await import("@/app.module");
  const { startMeshTransport } = await import("@/transport/mesh-transport");
  const app = await createApiServerApp(MeshAgentServiceModule);
  await app.listen(port, "127.0.0.1");
  const transport = await startMeshTransport(app, { gossipIntervalMs: 100 });

  return {
    app,
    transport,
    http: `http://127.0.0.1:${String(port)}`,
    ws,
    dataDir,
    stop: async () => {
      await transport.stop();
      await app.close();
    },
  };
}

export const removeDataDir = (dataDir: string) => { rmSync(dataDir, { recursive: true, force: true }); };
