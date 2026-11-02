import { ConfigService } from "@nestjs/config";

import { openWebSocketConnection } from "@deployer/mesh-client";
import { createModuleContext } from "@deployer/nest-effect";

import {
  type NodeAgentEnv,
  resolveAdvertisedAddress,
  resolveCallTimeoutMs,
  resolveDeclaredAddresses,
  resolveDoorImage,
  resolveGossipFanout,
  resolveRelaySettings,
  resolveStunServers,
  resolveWireguardPort,
} from "../../config/node-agent.env";
import { AgentLocalModule } from "../../local/agent-local.module";
import { SwarmCredential } from "../../local/swarm-credential";
import { DockerEngine, DockerSocket, SocketDockerEngine } from "../../network/doors/docker-engine";
import { DoorConverger } from "../../network/doors/door-converger";
import { DoorAddresses, DoorsTick } from "../../network/doors/doors-tick.service";
import { DoorImage } from "../../network/doors/doors.setting";
import { OverlaySettings, WireguardTick } from "../../network/wireguard-tick.service";
import { HostCommands, WireguardDriver, WireguardPaths } from "../../network/wireguard.service";
import { NodeDoorController } from "../node/node-door.controller";
import { NodeStatus } from "../node/services/node-status.service";

import { AccessController } from "./controllers/access.controller";
import { DirectoryController } from "./controllers/directory.controller";
import { RelayController } from "./controllers/relay.controller";
import { RosterController } from "./controllers/roster.controller";
import { MeshDirectoryRepository } from "./repositories/directory.repository";
import { AccessChecks } from "./services/access-checks.service";
import { AgentLinkFactory, agentLinkFactoryOver } from "./services/agent-link-factory.service";
import { AgentLoad } from "./services/agent-load.service";
import { MeshBroker } from "./services/broker.service";
import { CredentialRotation } from "./services/credential-rotation.service";
import { MeshDirectory } from "./services/directory.service";
import { JoinTokens } from "./services/join-tokens.service";
import { KeyHints } from "./services/key-hints.service";
import { LeaseSigner, leaseSignerOver } from "./services/lease-signer.service";
import { MeshClock } from "./services/mesh-clock.service";
import { NodeAgents } from "./services/node-agents.service";
import { PendingSeeds } from "./services/pending-seeds.service";
import { RelayMetrics } from "./services/relay-metrics.service";
import { RelaySettings } from "./services/relay-settings.service";
import { MeshRelay } from "./services/relay.service";
import { ReplicaLinks, replicaLinksOver, withCredential } from "./services/replica-links.service";
import { AdvertisedAddress, GossipSettings, RosterGossip } from "./services/roster-gossip.service";

import type { NodeAgentsShape } from "./services/node-agents.service";

/** How long a direct grant lives: long enough to open a link, short enough that a dead replica's grant dies with it. */
const LEASE_TTL_MS = 30_000;

/**
 * A test seam, and nothing else writes it. `bootAgent` sets it before the module graph is imported, so a boot spec can
 * make one agent's link to another fail while the rest of the mesh stays real (a partial partition cannot be built from
 * environment variables, and gossip makes every address symmetric by design).
 */
export const meshBootOverrides: {
  nodeAgents?: (base: NodeAgentsShape) => NodeAgentsShape;
} = {};

/**
 * The mesh domain: the directory, the broker, the relay, the roster and what they run on.
 *
 * Every provider is a constant registered under its Effect tag, so the Effect runtime discovers it and a handler yields
 * what it needs from `effect/context`. The node's own state (its store, identity and credential) comes from
 * `AgentLocalModule`, which this module imports. The providers built here are the ones that must read the credential
 * at the moment they connect, not at boot: a node that joins a swarm changes it.
 */
export class MeshDomainModule extends createModuleContext({
  imports: [AgentLocalModule],
  controllers: [AccessController, DirectoryController, RelayController, RosterController, NodeDoorController],
  providers: [
    { provide: MeshDirectoryRepository, useClass: MeshDirectoryRepository.live },
    { provide: MeshClock, useClass: MeshClock.live },
    { provide: KeyHints, useClass: KeyHints.live },
    { provide: MeshDirectory, useClass: MeshDirectory.live },
    { provide: MeshBroker, useClass: MeshBroker.live },
    { provide: MeshRelay, useClass: MeshRelay.live },
    { provide: RelayMetrics, useClass: RelayMetrics.live },
    {
      provide: RelaySettings,
      inject: [ConfigService],
      useFactory: (config: ConfigService<NodeAgentEnv, true>) => ({
        ...resolveRelaySettings({
          MESH_RELAY_MAX_HOPS: config.get("MESH_RELAY_MAX_HOPS", { infer: true }),
          MESH_RELAY_NEXT_HOP_ATTEMPTS: config.get("MESH_RELAY_NEXT_HOP_ATTEMPTS", { infer: true }),
          MESH_RELAY_UNREACHABLE_MS: config.get("MESH_RELAY_UNREACHABLE_MS", { infer: true }),
        }),
        callTimeoutMs: resolveCallTimeoutMs({
          NODE_AGENT_CALL_TIMEOUT_MS: config.get("NODE_AGENT_CALL_TIMEOUT_MS", { infer: true }),
        }),
      }),
    },
    { provide: NodeAgents, useFactory: () => meshBootOverrides.nodeAgents?.(new NodeAgents.live()) ?? new NodeAgents.live() },
    { provide: AgentLoad, useClass: AgentLoad.live },
    { provide: RosterGossip, useClass: RosterGossip.live },
    { provide: PendingSeeds, useClass: PendingSeeds.live },
    { provide: JoinTokens, useClass: JoinTokens.live },
    { provide: CredentialRotation, useClass: CredentialRotation.live },
    { provide: AccessChecks, useClass: AccessChecks.live },
    { provide: NodeStatus, useClass: NodeStatus.live },
    { provide: DockerSocket, useClass: DockerSocket.live },
    {
      provide: DockerEngine,
      inject: [DockerSocket],
      useFactory: (socket: DockerSocket["Service"]) => SocketDockerEngine.live(socket.socketPath),
    },
    { provide: DoorConverger, useClass: DoorConverger.live },
    { provide: DoorAddresses, useClass: DoorAddresses.live },
    {
      // The image is the deployment's, not the setting's: `DoorsTick` refuses a plan that names another one.
      provide: DoorImage,
      inject: [ConfigService],
      useFactory: (config: ConfigService<NodeAgentEnv, true>) => ({
        image: resolveDoorImage({ NODE_AGENT_DOOR_IMAGE: config.get("NODE_AGENT_DOOR_IMAGE", { infer: true }) }),
      }),
    },
    { provide: DoorsTick, useClass: DoorsTick.live },
    // The kernel side of the mesh: the WireGuard driver and the port it runs host commands through.
    { provide: HostCommands, useClass: HostCommands.live },
    { provide: WireguardPaths, useClass: WireguardPaths.live },
    { provide: WireguardDriver, useValue: WireguardDriver.kernel },
    {
      provide: OverlaySettings,
      inject: [ConfigService],
      useFactory: (config: ConfigService<NodeAgentEnv, true>) => ({
        listenPort: resolveWireguardPort({ MESH_WIREGUARD_PORT: config.get("MESH_WIREGUARD_PORT", { infer: true }) }),
        declared: resolveDeclaredAddresses({
          MESH_DECLARED_ADDRESSES: config.get("MESH_DECLARED_ADDRESSES", { infer: true }),
        }),
        stunServers: resolveStunServers({ MESH_STUN_SERVERS: config.get("MESH_STUN_SERVERS", { infer: true }) }),
      }),
    },
    { provide: WireguardTick, useClass: WireguardTick.live },
    {
      provide: AdvertisedAddress,
      inject: [ConfigService],
      useFactory: (config: ConfigService<NodeAgentEnv, true>) => ({
        address: resolveAdvertisedAddress({ MESH_ADVERTISE_URL: config.get("MESH_ADVERTISE_URL", { infer: true }) }),
      }),
    },
    {
      provide: GossipSettings,
      inject: [ConfigService],
      useFactory: (config: ConfigService<NodeAgentEnv, true>) => ({
        fanout: resolveGossipFanout({ MESH_GOSSIP_FANOUT: config.get("MESH_GOSSIP_FANOUT", { infer: true }) }),
        callTimeoutMs: resolveCallTimeoutMs({
          NODE_AGENT_CALL_TIMEOUT_MS: config.get("NODE_AGENT_CALL_TIMEOUT_MS", { infer: true }),
        }),
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
