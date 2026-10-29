import { ORPCError } from "@orpc/client";

import type { MeshRelayEvent, MeshTarget } from "@deployer/mesh-agent-contracts";

import type { ClientContext, ClientLink, ClientOptions } from "@orpc/client";

export type RelayLinkOptions<C extends ClientContext> = {
  /** The persistent RPC link to the local mesh-agent. */
  readonly agent: ClientLink<C>;
  readonly target: MeshTarget;
  /** The caller's credentials, read at every call: a link is shared by every caller, the credentials are not. */
  readonly headers?: () => Readonly<Record<string, string>>;
};

const withHeaders = (headers: Readonly<Record<string, string>> | undefined) =>
  headers !== undefined && Object.keys(headers).length > 0 ? { headers: { ...headers } } : {};

/** The relay's path in the agent's contract. */
const RELAY_CALL_PATH = ["relay", "call"];

/** The stream's elements, as the target produced them; the connection is the agent's to release when this ends. */
async function* itemsOf(events: AsyncIterator<MeshRelayEvent>): AsyncGenerator {
  try {
    for (let step = await events.next(); !step.done; step = await events.next()) {
      if (step.value.kind === "item") {
        yield step.value.value;
      }
    }
  } finally {
    await events.return?.();
  }
}

/**
 * A link whose every call is a relayed call: the caller names a target once, and each procedure on the resulting
 * client travels to the local agent as one `relay.call`. The agent brokers it to a replica, answers any redirect
 * itself, and streams the answer back, so the caller sees the target's own result, errors included.
 *
 * Compose it with `grantFollowingLink` to follow the agent's direct grants.
 */
export function relayLink<C extends ClientContext>(options: RelayLinkOptions<C>): ClientLink<C> {
  return {
    async call(path: string[], input: unknown, callOptions: ClientOptions<C>) {
      const events = (await options.agent.call(RELAY_CALL_PATH, { ...options.target, path, input, ...withHeaders(options.headers?.()) }, callOptions)) as AsyncIterator<MeshRelayEvent>;

      const first = await events.next();
      if (first.done) {
        throw new ORPCError("BAD_GATEWAY", { message: "The mesh-agent closed the relay without answering" });
      }
      if (first.value.kind === "value") {
        await events.return?.();
        return first.value.value;
      }
      if (first.value.kind === "stream") {
        return itemsOf(events);
      }
      throw new ORPCError("BAD_GATEWAY", { message: "The mesh-agent answered a relay with an item before announcing a stream" });
    },
  };
}
