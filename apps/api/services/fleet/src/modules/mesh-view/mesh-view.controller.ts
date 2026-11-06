import { Controller } from '@nestjs/common'
import { Implement } from '@orpc/nest'

import { meshContract } from '@deployer/fleet-contracts'
import { accessRequired, procedure } from '@deployer/nest-effect'
import { requireAuth } from '@deployer/shared/core/modules/auth/orpc/middlewares'

import { Cluster, Mesh } from './access/mesh.resource'
import { MeshView } from './mesh-view.service'

/** The mesh as the dashboard sees it: the nodes, their replicas, and how a new node joins. All read from the agent. */
@Controller()
export class MeshViewController {
    @Implement(meshContract.getLocalNode)
    getLocalNode() {
        return procedure(meshContract.getLocalNode)
            .use(requireAuth())
            .use(accessRequired(Mesh.can('read')))
            .effect(function* () {
                const view = yield* MeshView
                return yield* view.localNode()
            })
    }

    @Implement(meshContract.listPeers)
    listPeers() {
        return procedure(meshContract.listPeers)
            .use(requireAuth())
            .use(accessRequired(Mesh.can('read')))
            .effect(function* () {
                const view = yield* MeshView
                return yield* view.peers()
            })
    }

    @Implement(meshContract.membershipSnapshot)
    membershipSnapshot() {
        return procedure(meshContract.membershipSnapshot)
            .use(requireAuth())
            .use(accessRequired(Mesh.can('read')))
            .effect(function* () {
                const view = yield* MeshView
                return yield* view.snapshot()
            })
    }

    @Implement(meshContract.streamTopology)
    streamTopology() {
        return procedure(meshContract.streamTopology)
            .use(requireAuth())
            .use(accessRequired(Mesh.can('read')))
            .effect(function* () {
                const view = yield* MeshView
                return yield* view.topology()
            })
    }

    @Implement(meshContract.lookupResource)
    lookupResource() {
        return procedure(meshContract.lookupResource)
            .use(requireAuth())
            .use(accessRequired(Mesh.can('read')))
            .effect(function* ({ input }) {
                const view = yield* MeshView
                return yield* view.lookup(input)
            })
    }

    @Implement(meshContract.issueJoinToken)
    issueJoinToken() {
        return procedure(meshContract.issueJoinToken)
            .use(requireAuth())
            .use(accessRequired(Cluster.can('join-token:reveal')))
            .effect(function* ({ input }) {
                const view = yield* MeshView
                return yield* view.issueToken(input)
            })
    }
}
