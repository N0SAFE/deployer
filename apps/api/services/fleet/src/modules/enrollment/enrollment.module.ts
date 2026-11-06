import { Effect } from 'effect'

import { nodeDoorFromEnv } from '@deployer/mesh-client'
import { createModuleContext } from '@deployer/nest-effect'
import {
    NodeConfigRepository,
    type NodeConfigRepositoryShape,
} from '@deployer/node-state'
import { EnvModule, EnvService } from '@deployer/shared/config/env/env.module'
import { MeshCoreModule } from '@deployer/shared/core/modules/mesh/mesh-core.module'
import {
    SystemMeshClusterRepository,
    type SystemMeshClusterRepositoryShape,
} from '@deployer/shared/core/modules/mesh/repositories/system-mesh-cluster.repository'
import { SwarmCoreModule } from '@deployer/shared/core/modules/swarm/swarm.module'
import { SwarmJoinGrant, type SwarmJoinGrantShape } from '@deployer/swarm'

import { EnrollmentController } from './enrollment.controller'
import {
    FleetConfig,
    JoinTokenVoucher,
    NodeRegistry,
    SwarmGrants,
    type FleetConfigShape,
    type JoinTokenVoucherShape,
    type NodeRegistryShape,
    type SwarmGrantsShape,
} from './enrollment.ports'
import { Enrollment } from './enrollment.service'

export class EnrollmentModule extends createModuleContext(
    {
        // This node's agent vouches for the token, the fleet's swarm role decision is the grant, and the registry of nodes is
        // what an enrollment writes to.
        imports: [MeshCoreModule, SwarmCoreModule, EnvModule],
        controllers: [EnrollmentController],
        providers: [
            {
                provide: JoinTokenVoucher,
                // Checked by THIS node's agent, over the admin door; an absent door answers null.
                useFactory: (env: EnvService): JoinTokenVoucherShape => ({
                    check: (token) =>
                        Effect.promise(() => nodeDoorFromEnv(env).checkJoinToken(token)),
                }),
                inject: [EnvService],
            },
            {
                provide: SwarmGrants,
                useFactory: (grants: SwarmJoinGrantShape): SwarmGrantsShape => ({
                    grantFor: (policy) => grants.buildGrant(policy),
                }),
                inject: [SwarmJoinGrant],
            },
            {
                provide: FleetConfig,
                useFactory: (nodeConfig: NodeConfigRepositoryShape): FleetConfigShape => ({
                    databaseUrl: () =>
                        Effect.map(
                            nodeConfig.find(),
                            (row) => row?.databaseUrl?.trim() ?? null
                        ),
                    // Generated on first use, so a fleet node that never needed it yet still has one to hand over.
                    platformSecretRing: () =>
                        nodeConfig
                            .ensurePlatformSecret()
                            .pipe(Effect.andThen(nodeConfig.platformSecretRing())),
                }),
                inject: [NodeConfigRepository],
            },
            {
                provide: NodeRegistry,
                useFactory: (clusters: SystemMeshClusterRepositoryShape): NodeRegistryShape => ({
                    register: (input) =>
                        Effect.map(
                            clusters.registerOrUpdateNode({
                                ...input,
                                metadata: { enrolledVia: 'join_token' },
                            }),
                            (registered) => ({
                                nodeId: registered.nodeId,
                                enrolledAt: registered.enrolledAt,
                            })
                        ),
                }),
                inject: [SystemMeshClusterRepository],
            },
            { provide: Enrollment, useValue: Enrollment.live },
        ],
    },
    JoinTokenVoucher,
    SwarmGrants,
    FleetConfig,
    NodeRegistry,
    Enrollment
) {}
