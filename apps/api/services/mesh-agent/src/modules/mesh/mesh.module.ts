import { ConfigService } from "@nestjs/config";

import { openWebSocketConnection } from "@deployer/mesh-client";
import { createModuleContext } from "@deployer/nest-effect";

import { type MeshAgentEnv, resolveAdvertisedAddress } from "../../config/mesh-agent.env";
import { AgentLocalModule } from "../../local/agent-local.module";
import { SwarmCredential } from "../../local/swarm-credential";

import { MeshAccessController } from "./controllers/mesh-access.controller";
import { MeshDirectoryController } from "./controllers/mesh-directory.controller";
import { MeshRelayController } from "./controllers/mesh-relay.controller";
import { MeshRosterController } from "./controllers/mesh-roster.controller";
import { MeshDirectoryRepository } from "./repositories/directory.repository";
import { AccessChecks } from "./services/access-checks.service";
import { AgentLinkFactory, agentLinkFactoryOver } from "./services/agent-link-factory.service";
import { AgentLoad } from "./services/agent-load.service";
import { MeshBroker } from "./services/broker.service";
import { MeshDirectory } from "./services/directory.service";
import { JoinTokens } from "./services/join-tokens.service";
import { KeyHints } from "./services/key-hints.service";
import { LeaseSigner, leaseSignerOver } from "./services/lease-signer.service";
import { MeshClock } from "./services/mesh-clock.service";
import { NodeAgents } from "./services/node-agents.service";
import { PendingSeeds } from "./services/pending-seeds.service";
import { MeshRelay } from "./services/relay.service";
import { ReplicaLinks, replicaLinksOver, withCredential } from "./services/replica-links.service";
import { AdvertisedAddress, RosterGossip } from "./services/roster-gossip.service";

/** How long a direct grant lives: long enough to open a link, short enough that a dead replica's grant dies with it. */
const LEASE_TTL_MS = 30_000;

/**
 * The mesh domain: the directory, the broker, the relay, the roster and what they run on.
 *
 * Every provider is a constant registered under its Effect tag, so `EffectRuntime` discovers it and a handler yields
 * what it needs from `effect/context`. The node's own state (its store, identity and credential) comes from
 * `AgentLocalModule`, which this module imports. The providers built here are the ones that must read the credential
 * at the moment they connect, not at boot: a node that joins a swarm changes it.
 */
export class MeshDomainModule extends createModuleContext({
  imports: [AgentLocalModule],
  controllers: [MeshAccessController, MeshDirectoryController, MeshRelayController, MeshRosterController],
  providers: [
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
    { provide: JoinTokens, useValue: JoinTokens.live },
    { provide: AccessChecks, useValue: AccessChecks.live },
    {
      provide: AdvertisedAddress,
      inject: [ConfigService],
      useFactory: (config: ConfigService<MeshAgentEnv, true>) => ({
        address: resolveAdvertisedAddress({ MESH_ADVERTISE_URL: config.get("MESH_ADVERTISE_URL", { infer: true }) }),
      }),
    },
    {
      provide: AgentLinkFactory,
      inject: [SwarmCredential],
      useFactory: (credential: SwarmCredential["Service"]) =>
        agentLinkFactoryOver((address) => openWebSocketConnection({ url: withCredential(address, credential.current()) })),
    },
    {
      provide: ReplicaLinks,
      inject: [SwarmCredential],
      useFactory: (credential: SwarmCredential["Service"]) =>
        replicaLinksOver((replica) => openWebSocketConnection({ url: withCredential(replica.address, credential.current()) })),
    },
    {
      provide: LeaseSigner,
      inject: [SwarmCredential],
      useFactory: (credential: SwarmCredential["Service"]) => leaseSignerOver({ secret: () => credential.current(), ttlMs: LEASE_TTL_MS }),
    },
  ],
}) {}
