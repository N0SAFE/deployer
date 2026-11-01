import { oc } from "@orpc/contract";
import z from "zod/v4";

/**
 * What one replica answers the other replicas of its own service about itself.
 *
 * A peer is a visibility class, not a second socket: `peers.*` is mounted next to the service's contracts on the one
 * mesh surface it already has, and what makes a caller a peer is the credential the transport checks on every
 * connection. Splitting the listeners per class is a later change; this one keeps the classes apart in the router, which
 * is what decides who may call what.
 */
export const meshPeerLoadSchema = z.object({
  /** How late the replica's event loop ran, in milliseconds. */
  eventLoopLagMs: z.number().min(0),
  bytesPerSecond: z.number().min(0),
  openStreams: z.number().int().min(0),
});

export const meshPeerInfoSchema = z.object({
  /** The service this replica belongs to, e.g. `project`. */
  service: z.string().min(1),
  /** The id it registered with: the one its node's directory knows it by. */
  replicaId: z.string().min(1),
  /** The node it runs on, as that node's agent names itself. Null when the agent does not answer. */
  nodeId: z.string().min(1).nullable(),
  /** The agent's measurement of this replica, or null while nothing measures it. */
  load: meshPeerLoadSchema.nullable(),
  /** The keys it announces at every heartbeat: what a call for one of them reaches this replica for. */
  keys: z.array(z.string()),
});

export type MeshPeerInfo = z.infer<typeof meshPeerInfoSchema>;

/**
 * Served by every service that joins a mesh, at `peers.info`, from the facts the join already holds.
 *
 * No OpenAPI metadata, by design: this is not an HTTP route, is never composed into the BFF router, and is answered over
 * the mesh only. A peer-class procedure that has no HTTP path cannot leak into the public surface by accident.
 *
 * `oc`, not the platform's `standard` builder: this package is framework-free (no `@deployer/orpc-utils` dependency) and
 * the procedure is an input-less read with one output schema, which the builder would only restate.
 */
export const meshPeerInfoContract = oc.input(z.object({})).output(meshPeerInfoSchema);
