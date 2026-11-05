/**
 * MeshNodeModule — the API's handle on THIS node's mesh agent.
 *
 * Global because the agent holds the cluster-wide settings several planes read
 * (ingress lanes, the public edge's state, the node doors — via
 * `ClusterSettings`) and the swarm plane asks it for this node's mesh address;
 * threading an import through each of them would only spread the same one-line
 * dependency.
 */

import { nodeDoorFromEnv } from '@deployer/mesh-client'
import { createGlobalModule } from '@deployer/nest-effect'

import { EnvModule, EnvService } from '../../../config/env/env.module'

import { ClusterSettings, makeClusterSettings } from './cluster-settings'
import {
    NodeAgentBootstrap,
    nodeAgentBootstrapLifecycle,
} from './node-agent-bootstrap.service'

export const MeshNodeModule = createGlobalModule({
    imports: [EnvModule],
    providers: [
        // The cluster settings live on this node's agent, reached through its node door; the factory is how the door
        // gets its socket, and how a spec hands it a fake one.
        {
            provide: ClusterSettings,
            useFactory: (env: EnvService) =>
                makeClusterSettings(nodeDoorFromEnv(env)),
            inject: [EnvService],
        },
        NodeAgentBootstrap.provider,
        nodeAgentBootstrapLifecycle(),
    ],
    exports: [ClusterSettings],
})
