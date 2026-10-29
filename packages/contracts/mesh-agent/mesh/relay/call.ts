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

export const meshRelayInput = meshTargetSchema.extend({
  /** The procedure path in the target's contract, e.g. `["logs", "stream"]`. */
  path: z.array(z.string()).min(1),
  /** The procedure's input, forwarded untouched. A procedure with no input sends none, and JSON has no way to say `undefined`. */
  input: z.unknown().optional(),
  /**
   * The caller's credentials for this one call (its session cookie, its authorization), forwarded to the target as the
   * headers of the call. The agent holds no session and reads none: it only carries what the caller says, so the target
   * authenticates the caller exactly as if it had called directly.
   */
  headers: z.record(z.string(), z.string()).optional(),
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
