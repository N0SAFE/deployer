import { ConfigService } from "@nestjs/config";

import { openWebSocketConnection } from "@deployer/mesh-client";
import { createModuleContext } from "@deployer/nest-effect";

import { resolveAdvertisedAddress, resolveNodeId } from "../../config/mesh-agent.env";

import { MeshDirectoryController } from "./controllers/mesh-directory.controller";
import { MeshRelayController } from "./controllers/mesh-relay.controller";
import { MeshRosterController } from "./controllers/mesh-roster.controller";
import { MeshDirectoryRepository } from "./repositories/directory.repository";
import { AgentLinkFactory, agentLinkFactoryOver } from "./services/agent-link-factory.service";
import { AgentLoad } from "./services/agent-load.service";
import { MeshBroker } from "./services/broker.service";
import { MeshDirectory } from "./services/directory.service";
import { KeyHints } from "./services/key-hints.service";
import { LeaseSigner, leaseSignerOver } from "./services/lease-signer.service";
import { MeshClock } from "./services/mesh-clock.service";
import { NodeAgents } from "./services/node-agents.service";
import { NodeIdentity } from "./services/node-identity.service";
import { PendingSeeds } from "./services/pending-seeds.service";
import { MeshRelay } from "./services/relay.service";
import { ReplicaLinks, replicaLinksOver, withCredential } from "./services/replica-links.service";
import { AdvertisedAddress, RosterGossip } from "./services/roster-gossip.service";

import type { MeshAgentEnv } from "../../config/mesh-agent.env";

/** How long a direct grant lives: long enough to open a link, short enough that a dead replica's grant dies with it. */
const LEASE_TTL_MS = 30_000;

/**
 * The mesh domain: the directory, the broker and what they run on.
 *
 * Every provider is a constant registered under its Effect tag, so `EffectRuntime` discovers it and a handler yields
 * what it needs from `effect/context`. `NodeIdentity` is the one built from the validated environment, so it is a
 * factory over `ConfigService` rather than a constant.
 */
export class MeshDomainModule extends createModuleContext({
  controllers: [MeshDirectoryController, MeshRelayController, MeshRosterController],
  providers: [
    {
      provide: NodeIdentity,
      inject: [ConfigService],
      useFactory: (config: ConfigService<MeshAgentEnv, true>) => ({
        nodeId: resolveNodeId({ MESH_AGENT_SECRET: config.get("MESH_AGENT_SECRET"), MESH_NODE_ID: config.get("MESH_NODE_ID") }),
      }),
    },
    { provide: MeshDirectoryRepository, useValue: MeshDirectoryRepository.live },
    { provide: MeshClock, useValue: MeshClock.live },
    { provide: KeyHints, useValue: KeyHints.live },
    { provide: MeshDirectory, useValue: MeshDirectory.live },
    { provide: MeshBroker, useValue: MeshBroker.live },
    { provide: MeshRelay, useValue: MeshRelay.live },
    { provide: NodeAgents, useValue: NodeAgents.live },
    { provide: AgentLoad, useValue: AgentLoad.live },
    { provide: RosterGossip, useValue: RosterGossip.live },
    { provide: PendingSeeds, useValue: PendingSeeds.live },
    {
      provide: AdvertisedAddress,
      inject: [ConfigService],
      useFactory: (config: ConfigService<MeshAgentEnv, true>) => ({
        address: resolveAdvertisedAddress({
          MESH_AGENT_SECRET: config.get("MESH_AGENT_SECRET", { infer: true }),
          MESH_NODE_ID: config.get("MESH_NODE_ID", { infer: true }),
          MESH_ADVERTISE_URL: config.get("MESH_ADVERTISE_URL", { infer: true }),
        }),
      }),
    },
    {
      provide: AgentLinkFactory,
      inject: [ConfigService],
      useFactory: (config: ConfigService<MeshAgentEnv, true>) => {
        const secret = config.get("MESH_AGENT_SECRET", { infer: true });
        return agentLinkFactoryOver((address) => openWebSocketConnection({ url: withCredential(address, secret) }));
      },
    },
    {
      // The two collaborators built from the environment: how to reach a replica, and how to sign a grant for it.
      provide: ReplicaLinks,
      inject: [ConfigService],
      useFactory: (config: ConfigService<MeshAgentEnv, true>) => {
        const secret = config.get("MESH_AGENT_SECRET", { infer: true });
        return replicaLinksOver((replica) => openWebSocketConnection({ url: withCredential(replica.address, secret) }));
      },
    },
    {
      provide: LeaseSigner,
      inject: [ConfigService],
      useFactory: (config: ConfigService<MeshAgentEnv, true>) =>
        leaseSignerOver({ secret: config.get("MESH_AGENT_SECRET", { infer: true }), ttlMs: LEASE_TTL_MS }),
    },
  ],
}) {}
