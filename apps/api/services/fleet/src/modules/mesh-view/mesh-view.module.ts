import { Effect } from 'effect'

import { nodeAgentLink } from '@deployer/mesh-client'
import { createModuleContext } from '@deployer/nest-effect'
import {
    NodeConfigRepository,
    type NodeConfigRepositoryShape,
} from '@deployer/node-state'

import { MeshViewController } from './mesh-view.controller'
import { MeshAgent, type MeshAgentShape } from './mesh-view.ports'
import { MeshView } from './mesh-view.service'

/** One pooled link for the life of the process, opened the first time the agent's socket is there. */
const sharedAgentLink = (() => {
    let link: ReturnType<typeof nodeAgentLink>
    return () => (link ??= nodeAgentLink())
})()

export class MeshViewModule extends createModuleContext(
    {
        controllers: [MeshViewController],
        providers: [
            {
                provide: MeshAgent,
                useFactory: (nodeConfig: NodeConfigRepositoryShape): MeshAgentShape => ({
                    link: sharedAgentLink,
                    standalone: () =>
                        nodeConfig.find().pipe(
                            Effect.map((row) => ({ nodeId: row?.nodeId ?? 'standalone' })),
                            Effect.catch(() => Effect.succeed({ nodeId: 'standalone' }))
                        ),
                }),
                inject: [NodeConfigRepository],
            },
            { provide: MeshView, useClass: MeshView.live },
        ],
    },
    MeshAgent,
    MeshView
) {}
