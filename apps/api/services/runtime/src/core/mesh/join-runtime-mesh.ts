import { type INestApplication, Logger } from '@nestjs/common'

import { apiServicePort } from '@deployer/env'
import {
    type MeshMembership,
    joinServiceMeshOnNode,
} from '@deployer/mesh-service'
import { toAsyncIteratorFromObservable } from '@deployer/orpc-utils/utils/observable/contract'
import { runtimeContract } from '@deployer/runtime-contracts'

import { DockerRuntimeMeshRelayService } from '../../modules/docker/common/mesh/docker-runtime-mesh-relay.service'
import {
    NODE_AGENT,
    type NodeAgent,
} from '../../modules/docker/domains/containers/mesh/docker-node-mesh'
import {
    LOCAL_NODE_OPERATIONS,
    type LocalNodeOperations,
} from '../../modules/docker/domains/containers/mesh/local-node-operations'
import {
    buildNodeRouter,
    containerIds,
} from '../../modules/docker/domains/containers/mesh/node-router'
import {
    DockerTerminalSessions,
    type DockerTerminalSessionsShape,
} from '../../modules/docker/domains/containers/runtime/docker-terminal-sessions'

import type { Server } from 'node:http'

const logger = new Logger('RuntimeMesh')

/**
 * Takes the runtime onto the mesh of its node, if the node has an agent.
 *
 * Without an agent the runtime runs as it always did. With one it is reached like every other service (its contracts,
 * served from its own HTTP surface) and also answers the node router, `mesh.node`, from its own engine, and it announces
 * every container id and terminal session id on the node as a key, so a call about one reaches the node that owns it. It holds no
 * credential: its agent vouches for the peers that connect.
 */
export function joinRuntimeMesh(
    app: INestApplication
): MeshMembership | undefined {
    const local = app.get<LocalNodeOperations>(LOCAL_NODE_OPERATIONS, {
        strict: false,
    })
    const relay = app.get(DockerRuntimeMeshRelayService, { strict: false })
    // Terminal sessions live on the replica that opened them, so they are announced as keys next to the container ids: a
    // call about a session then reaches that replica instead of every node.
    const terminals = app.get<DockerTerminalSessionsShape>(
        DockerTerminalSessions,
        { strict: false }
    )

    const membership = joinServiceMeshOnNode({
        service: 'runtime',
        port: apiServicePort('runtime'),
        server: app.getHttpServer() as Server,
        contracts: [runtimeContract as never],
        extraRouter: {
            mesh: {
                node: buildNodeRouter(local, {
                    stream: () =>
                        toAsyncIteratorFromObservable(relay.localEvents$()),
                }),
            },
        },
        // An engine that cannot be listed right now must not stop the replica from beating: it announces nothing this round.
        keys: async () => [
            ...(await containerIds(local).catch(() => [])),
            ...(terminals?.sessionIds() ?? []),
        ],
        log: (message) => {
            logger.log(message)
        },
    })

    if (membership !== undefined) {
        // From now on the runtime can ask the other nodes through the same link: the docker callers read it from this holder.
        const holder = app.get<NodeAgent>(NODE_AGENT, { strict: false })
        holder.link = membership.agent
        // The id of this node is what its agent generated; events and scans name the node by it, so learn it now rather
        // than at the first question to the other nodes.
        void membership.agent
            .call(['roster', 'view'], {}, { context: {} })
            .then((view) => {
                holder.selfNodeId = (
                    view as { self: { nodeId: string } }
                ).self.nodeId
            })
            .catch(() => undefined)
    }
    return membership
}
