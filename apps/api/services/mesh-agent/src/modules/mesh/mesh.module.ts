import { ConfigService } from "@nestjs/config";

import { createModuleContext } from "@deployer/nest-effect";

import { resolveNodeId } from "../../config/mesh-agent.env";

import { MeshDirectoryController } from "./controllers/mesh-directory.controller";
import { MeshDirectoryRepository } from "./repositories/directory.repository";
import { MeshBroker } from "./services/broker.service";
import { MeshDirectory } from "./services/directory.service";
import { KeyHints } from "./services/key-hints.service";
import { MeshClock } from "./services/mesh-clock.service";
import { NodeIdentity } from "./services/node-identity.service";

import type { MeshAgentEnv } from "../../config/mesh-agent.env";

/**
 * The mesh domain: the directory, the broker and what they run on.
 *
 * Every provider is a constant registered under its Effect tag, so `EffectRuntime` discovers it and a handler yields
 * what it needs from `effect/context`. `NodeIdentity` is the one built from the validated environment, so it is a
 * factory over `ConfigService` rather than a constant.
 */
export class MeshDomainModule extends createModuleContext({
  controllers: [MeshDirectoryController],
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
  ],
}) {}
