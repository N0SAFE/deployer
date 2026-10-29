import { ORPCError } from "@orpc/client";
import { Context, Effect } from "effect";

import { type MeshRelayEvent, type MeshRelayInput, grantDirect, readRedirect } from "@deployer/mesh-agent-contracts";

import { MeshNoReplica, MeshRedirectExhausted } from "../mesh.errors";
import { leaseReason } from "../rules/lease-policy";

import { AgentLoad } from "./agent-load.service";
import { type CallOutcome, MeshBroker } from "./broker.service";
import { MeshDirectory } from "./directory.service";
import { LeaseSigner } from "./lease-signer.service";
import { NodeAgents } from "./node-agents.service";
import { NodeIdentity } from "./node-identity.service";
import { ReplicaLinks } from "./replica-links.service";

import type { KeyHints } from "./key-hints.service";
import type { MeshClock } from "./mesh-clock.service";
import type { MeshNoNode } from "../mesh.errors";
import type { MeshDirectoryRepository } from "../repositories/directory.repository";

/** What a relayed call came to. A stream stays a stream: the agent forwards it element by element, never buffers it. */
export type RelayOutcome =
  | { readonly kind: "value"; readonly value: unknown }
  | { readonly kind: "stream"; readonly items: AsyncIterator<unknown> }
  /** Another node's agent already answered in the relay's own events; they pass through untouched. */
  | { readonly kind: "events"; readonly events: AsyncIterator<MeshRelayEvent> };

export type MeshRelayShape = {
  readonly relay: (request: MeshRelayInput) => Effect.Effect<
    RelayOutcome,
    ORPCError<string, unknown> | MeshNoReplica | MeshRedirectExhausted | MeshNoNode,
    | MeshDirectory
    | MeshBroker
    | KeyHints
    | MeshDirectoryRepository
    | NodeIdentity
    | MeshClock
    | NodeAgents
    | ReplicaLinks
    | AgentLoad
    | LeaseSigner
  >;
};

const MAX_HOPS = 3;
const HINT_TTL_MS = 5_000;
const RELAY_PATH = ["relay", "call"];

const isAsyncIterator = (value: unknown): value is AsyncIterator<unknown> =>
  typeof value === "object" && value !== null && "next" in value && typeof value.next === "function";

/** An upstream failure as the oRPC error the caller should see: the target's own errors keep their code and data. */
const toOrpcError = (error: unknown): ORPCError<string, unknown> =>
  error instanceof ORPCError || (typeof error === "object" && error !== null && "code" in error && "data" in error)
    ? (error as ORPCError<string, unknown>)
    : new ORPCError("BAD_GATEWAY", { message: error instanceof Error ? error.message : "The target could not be reached", cause: error });

/** Counts a stream as open until it ends, however it ends, so the load the lease policy reads is true. */
function trackStream(items: AsyncIterator<unknown>, load: { streamOpened: () => void; streamClosed: () => void }): AsyncIterator<unknown> {
  load.streamOpened();
  let closed = false;
  const close = () => {
    if (!closed) {
      closed = true;
      load.streamClosed();
    }
  };
  return {
    async next() {
      try {
        const step = await items.next();
        if (step.done) {
          close();
        }
        return step;
      } catch (error) {
        close();
        throw error;
      }
    },
    async return(value) {
      close();
      return (await items.return?.(value)) ?? { done: true as const, value: undefined };
    },
    async throw(error) {
      close();
      return (await items.throw?.(error)) ?? Promise.reject(toOrpcError(error));
    },
  };
}

/**
 * The agent's answer to a relayed call, and the reason services never address each other.
 *
 * Every call arrives here. The agent either pins it to another node (forwarding it to that node's agent, which never
 * leaves its own node), grants a direct link when brokering would load it, or brokers it: resolve the replica by key,
 * then locality, then load; call it over the pooled link; and answer `MESH_REDIRECT` itself by replaying the call on
 * the replica the redirect names. The caller sees the target's own result, or its own errors, unchanged.
 */
export class MeshRelay extends Context.Service<MeshRelay, MeshRelayShape>()("mesh-agent/MeshRelay") {
  static readonly live: MeshRelayShape = {
    relay: Effect.fn("MeshRelay.relay")(function* (request: MeshRelayInput) {
      const self = yield* NodeIdentity;

      if (request.node !== undefined && request.node !== self.nodeId) {
        const agents = yield* NodeAgents;
        const link = yield* agents.linkTo(request.node);
        const events = yield* Effect.tryPromise({
          try: () => link.call(RELAY_PATH, request, { context: {} }) as Promise<AsyncIterator<MeshRelayEvent>>,
          catch: toOrpcError,
        });
        return { kind: "events", events } as const satisfies RelayOutcome;
      }

      const localOnly = request.node === self.nodeId;
      const load = yield* AgentLoad;
      const directory = yield* MeshDirectory;

      const reason = leaseReason({
        heavy: request.heavy === true,
        callerWantsDirect: request.direct === true,
        agent: load.sample(),
        pairCallsPerSecond: load.callStarted(request.service),
      });
      if (reason !== undefined) {
        const resolution = yield* directory.resolve({ service: request.service, key: request.key, localOnly });
        const signer = yield* LeaseSigner;
        return yield* Effect.fail(grantDirect(yield* signer.issue(resolution.replica)));
      }

      const links = yield* ReplicaLinks;
      const broker = yield* MeshBroker;
      const value = yield* broker.call({
        service: request.service,
        key: request.key,
        localOnly,
        maxHops: MAX_HOPS,
        hintTtlMs: HINT_TTL_MS,
        invoke: (replica) =>
          Effect.tryPromise({ try: () => links.linkTo(replica).call(request.path, request.input, { context: { headers: request.headers ?? {} } }), catch: (error) => error }).pipe(
            Effect.map((answer): CallOutcome<unknown> => ({ kind: "ok", value: answer })),
            Effect.catch((error) => {
              const redirect = readRedirect(error);
              return redirect
                ? Effect.succeed<CallOutcome<unknown>>({ kind: "redirect", replicaId: redirect.replicaId, reason: redirect.reason })
                : Effect.fail(toOrpcError(error));
            }),
          ),
      });

      return isAsyncIterator(value) ? ({ kind: "stream", items: trackStream(value, load) } as const) : ({ kind: "value", value } as const);
    }),
  };
}

/** The relay's outcome as the events the contract declares: one `value`, or `stream` then one `item` per element. */
export async function* relayEvents(outcome: RelayOutcome): AsyncGenerator<MeshRelayEvent> {
  if (outcome.kind === "value") {
    yield { kind: "value", value: outcome.value };
    return;
  }
  if (outcome.kind === "events") {
    try {
      for (let step = await outcome.events.next(); !step.done; step = await outcome.events.next()) {
        yield step.value;
      }
    } finally {
      await outcome.events.return?.();
    }
    return;
  }
  yield { kind: "stream" };
  try {
    for (let step = await outcome.items.next(); !step.done; step = await outcome.items.next()) {
      yield { kind: "item", value: step.value };
    }
  } finally {
    await outcome.items.return?.();
  }
}

