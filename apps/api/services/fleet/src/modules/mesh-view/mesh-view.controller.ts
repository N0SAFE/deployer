import { Controller, Inject } from '@nestjs/common'
import { ORPCError } from '@orpc/client'
import { Implement } from '@orpc/nest'

import { meshContract } from '@deployer/fleet-contracts'
import { procedure } from '@deployer/nest-effect'
import { toAsyncIteratorFromObservable } from '@deployer/orpc-utils/utils/observable/contract'
import { requireAuth } from '@deployer/shared/core/modules/auth/orpc/middlewares'

import { MeshViewService } from './mesh-view.service'

/** The mesh as the dashboard sees it: the nodes, their replicas, and how a new node joins. All read from the agent. */
@Controller()
export class MeshViewController {
    constructor(
        @Inject(MeshViewService) private readonly view: MeshViewService
    ) {}

    @Implement(meshContract.getLocalNode)
    getLocalNode() {
        return procedure(meshContract.getLocalNode)
            .use(requireAuth())
            .handler(() => this.view.localNode())
    }

    @Implement(meshContract.listPeers)
    listPeers() {
        return procedure(meshContract.listPeers)
            .use(requireAuth())
            .handler(() => this.view.peers())
    }

    @Implement(meshContract.membershipSnapshot)
    membershipSnapshot() {
        return procedure(meshContract.membershipSnapshot)
            .use(requireAuth())
            .handler(() => this.view.snapshot())
    }

    @Implement(meshContract.streamTopology)
    streamTopology() {
        return procedure(meshContract.streamTopology)
            .use(requireAuth())
            .handler(() => this.view.topology())
    }

    @Implement(meshContract.lookupResource)
    lookupResource() {
        return procedure(meshContract.lookupResource)
            .use(requireAuth())
            .handler(({ input }) => this.view.lookup(input))
    }

    @Implement(meshContract.issueJoinToken)
    issueJoinToken() {
        return procedure(meshContract.issueJoinToken)
            .use(requireAuth())
            .handler(async ({ input }) => {
                try {
                    return await this.view.issueToken(input)
                } catch (error) {
                    throw new ORPCError('BAD_REQUEST', {
                        message:
                            error instanceof Error
                                ? error.message
                                : 'Cannot issue a join token',
                    })
                }
            })
    }
}
