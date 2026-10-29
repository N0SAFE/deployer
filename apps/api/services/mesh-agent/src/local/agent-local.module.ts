import { Global } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { Effect } from "effect";

import { createModuleContext } from "@deployer/nest-effect";
import { MESH_CREDENTIAL_VERIFIER, type MeshCredentialVerifier } from "@deployer/shared/server";

import { type MeshAgentEnv, parseMeshAgentEnv, resolveDataDir } from "../config/mesh-agent.env";
import { NodeIdentity } from "../modules/mesh/services/node-identity.service";

import { AgentStore, openAgentStore } from "./agent-store";
import { SwarmCredential, swarmCredentialFrom } from "./swarm-credential";

type Config = ConfigService<MeshAgentEnv, true>;

/**
 * The node's own state, owned by its agent: identity, credential and the swarm it belongs to.
 *
 * Nothing here is configured from the environment. The store opens the agent's file, creates it on the first boot and
 * generates the node id and a standalone credential there; every later boot reads them back. The few environment
 * variables the agent still accepts are dev pins that win over what the store holds.
 *
 * Global because the oRPC host, a sibling of every domain module, injects the credential verifier, and the domain
 * module imports it so its handlers can `yield*` these services.
 */
export class AgentLocalModule extends createModuleContext({
  imports: [ConfigModule.forRoot({ validate: (env) => parseMeshAgentEnv(env) as Record<string, unknown>, isGlobal: true })],
  providers: [
    {
      provide: AgentStore,
      inject: [ConfigService],
      useFactory: (config: Config) =>
        openAgentStore(
          resolveDataDir({
            MESH_DATA_DIR: config.get("MESH_DATA_DIR", { infer: true }),
          }),
        ),
    },
    {
      provide: SwarmCredential,
      inject: [AgentStore, ConfigService],
      useFactory: async (store: AgentStore["Service"], config: Config) => {
        const stored = await Effect.runPromise(store.credential());
        const pinned = config.get("MESH_AGENT_SECRET", { infer: true });
        return swarmCredentialFrom({ secret: pinned ?? stored.secret, swarmId: stored.swarmId });
      },
    },
    {
      provide: NodeIdentity,
      inject: [AgentStore, ConfigService],
      useFactory: async (store: AgentStore["Service"], config: Config) => ({
        nodeId: config.get("MESH_NODE_ID", { infer: true }) ?? (await Effect.runPromise(store.identity())).nodeId,
      }),
    },
    {
      provide: MESH_CREDENTIAL_VERIFIER,
      inject: [SwarmCredential],
      useFactory: (credential: SwarmCredential["Service"]): MeshCredentialVerifier => credential.verify,
    },
  ],
  exports: [AgentStore, SwarmCredential, NodeIdentity, MESH_CREDENTIAL_VERIFIER, ConfigModule],
}) {}

Global()(AgentLocalModule);
