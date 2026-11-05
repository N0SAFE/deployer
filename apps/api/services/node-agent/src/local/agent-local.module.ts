import { Global } from '@nestjs/common'
import { ConfigModule, ConfigService } from '@nestjs/config'
import { Effect } from 'effect'

import { createModuleContext } from '@deployer/nest-effect'
import {
    MESH_CREDENTIAL_VERIFIER,
    type MeshCredentialVerifier,
} from '@deployer/shared/server'

import {
    type NodeAgentEnv,
    parseNodeAgentEnv,
    resolveDataDir,
} from '../config/node-agent.env'
import { NodeIdentity } from '../modules/mesh/services/node-identity.service'
import { NodeLabels } from '../modules/node/services/node-labels.service'
import { NodeSettings } from '../modules/node/services/node-settings.service'
import { NodeState } from '../modules/node/services/node-state.service'

import { AgentStore, openAgentStore } from './agent-store'
import { SwarmCredential, swarmCredentialFrom } from './swarm-credential'

type Config = ConfigService<NodeAgentEnv, true>

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
    imports: [
        ConfigModule.forRoot({
            validate: (env) =>
                parseNodeAgentEnv(env) as Record<string, unknown>,
            isGlobal: true,
        }),
    ],
    providers: [
        {
            provide: AgentStore,
            inject: [ConfigService],
            useFactory: (config: Config) =>
                openAgentStore(
                    resolveDataDir({
                        NODE_AGENT_DATA_DIR: config.get('NODE_AGENT_DATA_DIR', {
                            infer: true,
                        }),
                    })
                ),
        },
        {
            provide: SwarmCredential,
            inject: [AgentStore, ConfigService],
            useFactory: async (
                store: AgentStore['Service'],
                config: Config
            ) => {
                const stored = await Effect.runPromise(store.credential())
                const pinned = config.get('NODE_AGENT_SECRET', { infer: true })
                return swarmCredentialFrom({
                    secret: pinned ?? stored.secret,
                    swarmId: stored.swarmId,
                    installedAt: stored.installedAt,
                    previousSecret: stored.previousSecret,
                    previousValidUntil: stored.previousValidUntil,
                })
            },
        },
        {
            provide: NodeIdentity,
            inject: [AgentStore, ConfigService],
            useFactory: async (
                store: AgentStore['Service'],
                config: Config
            ) => ({
                // The store is authoritative: the pin only names a node that does not exist yet (dev, a test).
                nodeId: (
                    await Effect.runPromise(
                        store.identity(
                            config.get('MESH_NODE_ID', { infer: true })
                        )
                    )
                ).nodeId,
            }),
        },
        { provide: NodeState, useClass: NodeState.live },
        { provide: NodeSettings, useClass: NodeSettings.live },
        { provide: NodeLabels, useClass: NodeLabels.live },
        {
            provide: MESH_CREDENTIAL_VERIFIER,
            inject: [SwarmCredential],
            useFactory: (
                credential: SwarmCredential['Service']
            ): MeshCredentialVerifier => credential.verify,
        },
    ],
    exports: [
        AgentStore,
        SwarmCredential,
        NodeIdentity,
        NodeState,
        NodeSettings,
        NodeLabels,
        MESH_CREDENTIAL_VERIFIER,
        ConfigModule,
    ],
}) {}

Global()(AgentLocalModule)
