import { eventIterator } from "@orpc/contract";
import z from "zod/v4";

import { standard, standardDomainErrorContracts } from "@deployer/orpc-utils";

/**
 * Where a call is going. A caller names a service, optionally the resource it needs (`key`) and optionally a node
 * (`node`), and never a replica: the agent resolves that.
 */
export const meshTargetSchema = z.object({
  service: z.string().min(1),
  /** The resource the call is about (a deployment, a terminal session, a stream). The agent routes to the replica holding it. */
  key: z.string().optional(),
  /** Serve the call from this node only: the agent forwards it to that node's agent, which never leaves the node. */
  node: z.string().optional(),
  /** The caller asks for a direct link instead of a brokered call. */
  direct: z.boolean().optional(),
  /** The procedure is marked `heavy` in its contract (a stream, an upload, a big read): the agent grants a direct link. */
  heavy: z.boolean().optional(),
});

/**
 * The routing metadata of a call that already travelled: which agents it has been through, and how many agent hops it
 * may still take. Only an agent adds it; a caller never names hops. A receiver validates both (list length, ttl cap),
 * so a lying peer can only spoil its own path.
 */
export const meshRelayViaSchema = z.object({
  /** Agents already visited, oldest first. The receiving agent appends itself before forwarding. */
  visited: z.array(z.string().min(1)).max(16).default([]),
  /** Remaining agent hops. The receiver refuses at 0. */
  ttl: z.number().int().min(0).max(8),
});

export const meshRelayInput = meshTargetSchema.extend({
  /** The procedure path in the target's contract, e.g. `["logs", "stream"]`. Bounded: a path is a name, not a payload. */
  path: z.array(z.string().max(128)).min(1).max(16),
  /** The procedure's input, forwarded untouched. A procedure with no input sends none, and JSON has no way to say `undefined`. */
  input: z.unknown().optional(),
  /**
   * The caller's credentials for this one call (its session cookie, its authorization), forwarded to the target as the
   * headers of the call. The agent holds no session and reads none: it only carries what the caller says, so the target
   * authenticates the caller exactly as if it had called directly.
   *
   * Bounded (32 headers, 128-byte names, 8 KiB values): an agent carries these untouched, so the cap is what stops one
   * caller from making every agent on the route hold an unbounded set.
   */
  headers: z
    .record(z.string().max(128), z.string().max(8192))
    .refine((headers) => Object.keys(headers).length <= 32, "at most 32 headers")
    .optional(),
  /** Present only on a call an agent already forwarded: it must be brokered, never leased. */
  via: meshRelayViaSchema.optional(),
});

/**
 * What a relayed call answers, as a sequence so one procedure carries both shapes: a unary result is a single `value`
 * event, and a stream is a `stream` event followed by one `item` per element.
 */
export const meshRelayEvent = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("value"), value: z.unknown() }),
  z.object({ kind: z.literal("stream") }),
  z.object({ kind: z.literal("item"), value: z.unknown() }),
]);

export type MeshTarget = z.infer<typeof meshTargetSchema>;
export type MeshRelayInput = z.infer<typeof meshRelayInput>;
export type MeshRelayVia = z.infer<typeof meshRelayViaSchema>;
export type MeshRelayEvent = z.infer<typeof meshRelayEvent>;

/**
 * The relay's output is a plain oRPC event iterator, not the builder's `observable`: an iterator is pulled, so a slow
 * caller slows the stream at its source instead of an unbounded buffer growing on the agent, which is what a relay that
 * carries other services' streams cannot afford. It is the one mesh contract that is not RxJS-typed, deliberately.
 */
const meshRelayOps = standard.zod(meshTargetSchema, "meshRelay");

export const meshRelayCallContract = meshRelayOps
  .create()
  .path("/call")
  .input((b) => b.body(meshRelayInput))
  .output(eventIterator(meshRelayEvent))
  .errors((e) => [...standardDomainErrorContracts(e)])
  .build();
