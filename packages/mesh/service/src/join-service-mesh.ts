

import { type MeshMembership, joinMesh } from "./join-mesh";
import { type LoopbackContext, loopbackRouter } from "./loopback-router";

import type { RouterContract } from "@orpc/contract";
import type { Server } from "node:http";

export type JoinServiceMeshOptions = {
  readonly service: string;
  readonly replicaId: string;
  readonly server: Server;
  /** The contracts this service serves, which the mesh serves under their ids. */
  readonly contracts: readonly RouterContract[];
  /** Where the service's own HTTP surface answers on the loopback interface, e.g. `http://127.0.0.1:3103`. */
  readonly loopbackOrigin: string;
  readonly agentSocketPath: string;
  readonly advertiseUrl: string;
  /** Extra procedures the service answers over the mesh only (a node router), next to its contracts. */
  readonly extraRouter?: Record<string, unknown>;
  readonly keys?: () => readonly string[] | Promise<readonly string[]>;
  readonly load?: () => number;
  readonly heartbeatMs?: number;
  /** Told once when the first registration with the agent fails. */
  readonly onRegistrationFailure?: (error: unknown) => void;
};

/**
 * Takes a service onto the mesh: its contracts, served from its own HTTP surface, and its registration with its agent.
 * The service changes nothing about how it works; it gains a second way to be reached.
 */
export function joinServiceMesh(options: JoinServiceMeshOptions): MeshMembership {
  return joinMesh({
    service: options.service,
    replicaId: options.replicaId,
    server: options.server,
    router: { ...loopbackRouter(options.contracts, { origin: options.loopbackOrigin }), ...options.extraRouter } as never,
    context: (_upgrade, call): LoopbackContext => ({ headers: call.headers }),
    agentSocketPath: options.agentSocketPath,
    advertiseUrl: options.advertiseUrl,
    keys: options.keys,
    load: options.load,
    heartbeatMs: options.heartbeatMs,
    onRegistrationFailure: options.onRegistrationFailure,
  });
}
