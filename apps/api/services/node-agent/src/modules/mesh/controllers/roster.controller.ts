import { Controller } from "@nestjs/common";
import { Effect } from "effect";

import { nodeAgentContract } from "@deployer/node-agent-contracts";
import { declareProcedures, MeshController } from "@deployer/nest-mesh";
import { procedure } from "@deployer/nest-effect";

import { AgentStore } from "../../../local/agent-store";
import { ROTATION_GRACE_MS } from "../../../local/swarm-credential";
import { OVERLAY_SELF_SECRET, parseOverlaySelf } from "../../../network/overlay";
import { serveMeshPeer } from "../../../core/orpc/serve";
import { NodeLabels } from "../../node/services/node-labels.service";
import { CredentialRotation } from "../services/credential-rotation.service";
import { JoinTokens } from "../services/join-tokens.service";
import { NodeIdentity } from "../services/node-identity.service";
import { AdvertisedAddress } from "../services/roster-gossip.service";
import { NodeAgents } from "../services/node-agents.service";
import { RosterGossip } from "../services/roster-gossip.service";

import { requireNodeDoor } from "../../../core/orpc/node-door.guard";

const roster = nodeAgentContract.roster;

/** How far a clock may drift between the originator of a rotation and its adopter. */
const EPOCH_WINDOW_MS = 5 * 60 * 1_000;
/** The shortest grace a rotation may grant: a peer that reads `validUntil` a moment late still gets through. */
const MIN_GRACE_MS = 1_000;

/** A rotation's window, clamped to what this node will accept: a peer's payload never decides how long a secret lives. */
const clampRotation = (input: { readonly validUntil?: number; readonly epoch?: number }, now: number) => ({
  // A past or absent window would lock the peer out of its own swarm: both become the full grace. That is inside
  // `[now + MIN_GRACE_MS, now + ROTATION_GRACE_MS]`, and so is a window that survives the clamp below.
  validUntil:
    input.validUntil === undefined || input.validUntil <= now
      ? now + ROTATION_GRACE_MS
      : Math.min(Math.max(input.validUntil, now + MIN_GRACE_MS), now + ROTATION_GRACE_MS),
  // A clock skewed by more than this is not this node's swarm: it adopts the rotation at its own time instead.
  epoch: Math.min(Math.max(input.epoch ?? now, now - EPOCH_WINDOW_MS), now + EPOCH_WINDOW_MS),
});

/** The gossip between agents: a peer says what it knows and is answered with what this agent knows. */
@Controller()
export class RosterController extends MeshController {
  static readonly procedures = declareProcedures({
    exchange: { door: "peer", group: "roster", contract: roster.exchange },
    join: { door: "peer", group: "roster", contract: roster.join },
    check: { door: "peer", group: "roster", contract: roster.check },
    token: { door: "peer", group: "roster", contract: roster.token },
    revoke: { door: "peer", group: "roster", contract: roster.revoke },
    rotate: { door: "peer", group: "roster", contract: roster.rotate },
    credential: { door: "peer", group: "roster", contract: roster.credential },
    setting: { door: "peer", group: "roster", contract: roster.setting },
    view: { door: "peer", group: "roster", contract: roster.view },
    block: { door: "peer", group: "roster", contract: roster.block },
    unblock: { door: "peer", group: "roster", contract: roster.unblock },
  });

  exchange() {
    return procedure(roster.exchange).effect(function* ({ input, context }) {
      return yield* serveMeshPeer(context)(
        Effect.gen(function* () {
          const gossip = yield* RosterGossip;
          return yield* gossip.exchange(input);
        }),
      );
    });
  }

  /** Joins the swarm a token names. It can be called at any time: the agent works alone until it is. */
  join() {
    return procedure(roster.join).effect(function* ({ input, context }) {
      return yield* serveMeshPeer(context)(
        Effect.gen(function* () {
          yield* requireNodeDoor(context);
          const tokens = yield* JoinTokens;
          const { learned } = yield* tokens.redeem(input.token);
          const known = yield* (yield* NodeAgents).known();
          return {
            learned,
            agents: known.map(({ nodeId, address, overlay, labels }) => ({ nodeId, address, overlay, labels })),
          };
        }),
      );
    });
  }

  /** Whether a join token is this swarm's and still good. Asked by the services on this node, never answered with the credential. */
  check() {
    return procedure(roster.check).effect(function* ({ input, context }) {
      return yield* serveMeshPeer(context)(
        Effect.gen(function* () {
          const tokens = yield* JoinTokens;
          return { valid: yield* tokens.check(input.token) };
        }),
      );
    });
  }

  /** Issues a token for a new node to join this agent's swarm. */
  token() {
    return procedure(roster.token).effect(function* ({ input, context }) {
      return yield* serveMeshPeer(context)(
        Effect.gen(function* () {
          const tokens = yield* JoinTokens;
          return yield* tokens.issue(input.ttlMs);
        }),
      );
    });
  }

  /** Revokes a join token before it expires. */
  revoke() {
    return procedure(roster.revoke).effect(function* ({ input, context }) {
      return yield* serveMeshPeer(context)(
        Effect.gen(function* () {
          const tokens = yield* JoinTokens;
          return yield* tokens.revoke(input.token);
        }),
      );
    });
  }

  /**
   * Rotates the swarm's credential. Without a secret this agent mints one, tells every peer, then installs it; with
   * one it adopts the rotation a peer broadcast. The old secret stays accepted until `validUntil`.
   */
  rotate() {
    return procedure(roster.rotate).effect(function* ({ input, context }) {
      return yield* serveMeshPeer(context)(
        Effect.gen(function* () {
          const rotation = yield* CredentialRotation;
          if (input.secret === undefined) {
            const { validUntil, epoch } = yield* rotation.rotate();
            return { rotated: true, validUntil, epoch };
          }
          const { validUntil, epoch } = clampRotation(input, Date.now());
          const before = (yield* rotation.currentForPeer()).epoch;
          yield* rotation.adopt(input.secret, validUntil, epoch);
          const after = yield* rotation.currentForPeer();
          return { rotated: after.epoch !== before, validUntil: after.validUntil, epoch: after.epoch };
        }),
      );
    });
  }

  /** The credential in force here, for a peer that missed the rotation. Behind the credential itself, on the peer door. */
  credential() {
    return procedure(roster.credential).effect(function* ({ context }) {
      return yield* serveMeshPeer(context)(
        Effect.gen(function* () {
          const rotation = yield* CredentialRotation;
          return yield* rotation.currentForPeer();
        }),
      );
    });
  }

  /** Publishes one setting into this agent (the API writes `node.doors`); gossip carries it to the swarm. */
  setting() {
    return procedure(roster.setting).effect(function* ({ input, context }) {
      return yield* serveMeshPeer(context)(
        Effect.gen(function* () {
          yield* requireNodeDoor(context);
          const store = yield* AgentStore;
          const updatedAt = Date.now();
          yield* store.putSetting(input.key, input.value, updatedAt);
          return { key: input.key, value: input.value, updatedAt };
        }),
      );
    });
  }

  /** What this agent knows of the swarm, for the dashboard. Read-only. */
  view() {
    return procedure(roster.view).effect(function* ({ context }) {
      return yield* serveMeshPeer(context)(
        Effect.gen(function* () {
          const self = yield* NodeIdentity;
          const advertised = yield* AdvertisedAddress;
          const store = yield* AgentStore;
          const overlay = parseOverlaySelf(
            yield* store.secret(OVERLAY_SELF_SECRET).pipe(Effect.catch(() => Effect.succeed(undefined))),
          );
          const labels = yield* (yield* NodeLabels).read().pipe(Effect.catch(() => Effect.succeed({} as Record<string, string>)));
          const known = yield* (yield* NodeAgents).known();
          return {
            self: { nodeId: self.nodeId, address: advertised.address, overlay, labels },
            agents: known.map(({ nodeId, address, overlay: theirs, labels: theirLabels }) => ({
              nodeId,
              address,
              overlay: theirs,
              labels: theirLabels,
            })),
          };
        }),
      );
    });
  }

  /** Excludes a node from this agent: it is forgotten, and nothing it gossips is absorbed from now on. */
  block() {
    return procedure(roster.block).effect(function* ({ input, context }) {
      return yield* serveMeshPeer(context)(
        Effect.gen(function* () {
          const store = yield* AgentStore;
          yield* store.blockNode(input.nodeId);
          yield* (yield* NodeAgents).forget(input.nodeId);
          return { blocked: [...(yield* store.blockedNodes())] };
        }),
      );
    });
  }

  /** Lifts a block: the node may be learned again the next time it gossips. */
  unblock() {
    return procedure(roster.unblock).effect(function* ({ input, context }) {
      return yield* serveMeshPeer(context)(
        Effect.gen(function* () {
          const store = yield* AgentStore;
          yield* store.unblockNode(input.nodeId);
          return { blocked: [...(yield* store.blockedNodes())] };
        }),
      );
    });
  }
}
