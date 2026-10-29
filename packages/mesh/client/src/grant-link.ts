import { type MeshDirectGrant, readDirectGrant } from "@deployer/mesh-agent-contracts";

import type { ClientContext, ClientLink, ClientOptions } from "@orpc/client";

export type GrantLinkOptions<C extends ClientContext> = {
  /** The link to the local mesh-agent: every call goes here first. */
  readonly agent: ClientLink<C>;
  /** Builds the pooled link to the replica a grant names. Called once per grant, and again when that grant expires. */
  readonly direct: (grant: MeshDirectGrant) => ClientLink<C>;
  readonly now?: () => number;
  /** Direct links followed per call before giving up. A grant that keeps failing must not loop. */
  readonly maxFollows?: number;
};

const codeOf = (error: unknown): string | undefined =>
  typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" ? error.code : undefined;

/** A direct link that was refused or died: the lease is no good, ask the agent again. A real answer from the replica is not this. */
const isLeaseFailure = (error: unknown): boolean => {
  const code = codeOf(error);
  return code === undefined || code === "UNAUTHORIZED" || code === "FORBIDDEN";
};

/**
 * The caller's interceptor for `MESH_DIRECT`, as a link.
 *
 * The agent answers with a grant when it will not relay a call (a stream, a big payload, a hot resource, or its own
 * load). This link catches it, opens or reuses a pooled link to the named replica, and replays the call there. A grant
 * that was refused or whose link died is dropped and the agent is asked again, which brokers or re-grants; it follows
 * at most `maxFollows` times, so a failing replica fails the call instead of looping.
 *
 * It is the only thing a caller does about the mesh. A `MESH_REDIRECT` never reaches it: the agent answers that itself.
 */
export function grantFollowingLink<C extends ClientContext>(options: GrantLinkOptions<C>): ClientLink<C> {
  const now = options.now ?? (() => Date.now());
  const maxFollows = options.maxFollows ?? 2;
  const links = new Map<string, { grant: MeshDirectGrant; link: ClientLink<C> }>();

  const linkFor = (grant: MeshDirectGrant): ClientLink<C> => {
    const cached = links.get(grant.replicaId);
    if (cached?.grant.token === grant.token && cached.grant.expiresAt > now()) {
      return cached.link;
    }
    const link = options.direct(grant);
    links.set(grant.replicaId, { grant, link });
    return link;
  };

  return {
    async call(path: string[], input: unknown, callOptions: ClientOptions<C>) {
      for (let follow = 0; ; follow += 1) {
        let grant: MeshDirectGrant | undefined;
        try {
          return await options.agent.call(path, input, callOptions);
        } catch (error) {
          grant = readDirectGrant(error);
          if (!grant || follow >= maxFollows) {
            throw error;
          }
        }

        try {
          return await linkFor(grant).call(path, input, callOptions);
        } catch (error) {
          if (!isLeaseFailure(error) || follow + 1 >= maxFollows) {
            throw error;
          }
          links.delete(grant.replicaId);
        }
      }
    },
  };
}
