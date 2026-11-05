export * from './enrollment'

import { oc } from '@orpc/contract'
import { openapi } from '@orpc/openapi'
import z from 'zod/v4'

import { access } from '@deployer/auth/authz/meta'
import {
    nodeAgentNodeSchema,
    nodeAgentNodesResultSchema,
    nodeAgentSnapshotSchema,
    nodeAgentLookupInputSchema,
    nodeAgentLookupResultSchema,
    nodeAgentJoinTokenInputSchema,
    nodeAgentJoinTokenResultSchema,
    coreEventStreamDefinitionSchema,
    coreSyncedEventEnvelopeSchema,
    meshPingResultSchema,
    meshStreamReplayQuerySchema,
    systemMetricsSnapshotSchema,
    meshNodeConfigSchema,
    meshNodeConfigUpdateInputSchema,
    meshNodeConfigUpdateResultSchema,
    meshNodeConfigRegenerateSecretResultSchema,
    meshNodeConfigTestDbInputSchema,
    meshNodeConfigTestDbResultSchema,
} from '@deployer/contracts-entities'
import { standard, type ComputeInputSchema } from '@deployer/orpc-utils'

const meshEventStreamOps = standard.zod(
    coreEventStreamDefinitionSchema,
    'meshEventStream'
)

// Reuse the CANONICAL event-stream list config from the events module — the
// mesh surface exposes the same streams, and re-declaring the config here
// created a structurally-identical but nominally-distinct input type (the
// mesh controller passes `input.query` straight into CoreEventSyncService,
// which expects CoreEventStreamListInput).
import { coreEventStreamListConfigSchemas as meshEventStreamListConfigSchemas } from '../events'

export type MeshEventStreamListInput = ComputeInputSchema<
    typeof meshEventStreamListConfigSchemas
>

const nodeAgentNodeOps = standard.zod(nodeAgentNodeSchema, 'nodeAgentNode')
const nodeAgentNodesOps = standard.zod(
    nodeAgentNodesResultSchema,
    'nodeAgentNodes'
)
const nodeAgentSnapshotOps = standard.zod(
    nodeAgentSnapshotSchema,
    'nodeAgentSnapshot'
)
const nodeAgentLookupOps = standard.zod(
    nodeAgentLookupResultSchema,
    'nodeAgentLookup'
)
const nodeAgentJoinTokenOps = standard.zod(
    nodeAgentJoinTokenResultSchema,
    'nodeAgentJoinToken'
)
const meshSystemMetricsOps = standard.zod(
    systemMetricsSnapshotSchema,
    'meshSystemMetrics'
)
const meshPingOps = standard.zod(meshPingResultSchema, 'meshPing')
const meshEventStreamByIdOps = standard.zod(
    coreEventStreamDefinitionSchema,
    'meshEventStreamById'
)
const meshStreamSubscribeOps = standard.zod(
    coreSyncedEventEnvelopeSchema,
    'meshStreamSubscribe'
)

const meshNodeConfigOps = standard.zod(meshNodeConfigSchema, 'meshNodeConfig')
const meshNodeConfigUpdateOps = standard.zod(
    meshNodeConfigUpdateResultSchema,
    'meshNodeConfigUpdate'
)
const meshNodeConfigRegenerateSecretOps = standard.zod(
    meshNodeConfigRegenerateSecretResultSchema,
    'meshNodeConfigRegenerateSecret'
)
const meshNodeConfigTestDbOps = standard.zod(
    meshNodeConfigTestDbResultSchema,
    'meshNodeConfigTestDb'
)

export const meshGetLocalNodeContract = nodeAgentNodeOps
    .list()
    .path('/node/local')
    .input(z.object({}))
    .output(() => nodeAgentNodeSchema)
    .meta(access({ permission: 'mesh:read' }))
    .build()

/**
 * Public, unauthenticated ping endpoint. The controller implementation
 * MUST NOT require a session or an internal mesh key — this is the
 * only route that lets a brand-new node check that a peer is reachable
 * before it has any credentials.
 *
 * Response shape: { ok: true, version, advertisedHost }
 *
 * See `meshPingResultSchema` for the contract.
 */
export const meshPingContract = meshPingOps
    .list()
    .path('/ping')
    .input(z.object({}))
    .output(meshPingResultSchema)
    .meta(access({ permission: 'mesh:read' }))
    .build()

export const meshGetNodeMetricsContract = meshSystemMetricsOps
    .list()
    .path('/node/metrics')
    .input(z.object({}))
    .output(systemMetricsSnapshotSchema)
    .meta(access({ permission: 'mesh:read' }))
    .build()

export const meshListPeersContract = nodeAgentNodesOps
    .list()
    .path('/peers')
    .input(z.object({}))
    .output(nodeAgentNodesResultSchema)
    .meta(access({ permission: 'mesh:read' }))
    .build()

export const meshListEventStreamsContract = meshEventStreamOps
    .list(meshEventStreamListConfigSchemas)
    .meta(access({ permission: 'mesh:read' }))
    .build()

export const meshFindEventStreamByIdContract = meshEventStreamByIdOps
    .read({ idFieldName: 'id', idSchema: z.uuid() })
    .input((b) => b.params((p) => p`/streams/${p('id', z.uuid())}`))
    .output(coreEventStreamDefinitionSchema)
    .meta(access({ permission: 'mesh:read' }))
    .build()

export const meshStreamSubscribeContract = meshStreamSubscribeOps
    .list()
    .input((b) =>
        b
            .params((p) => p`/streams/${p('id', z.uuid())}/subscribe`)
            .query(meshStreamReplayQuerySchema)
    )
    .output((b) => b.observable(coreSyncedEventEnvelopeSchema))
    .meta(access({ permission: 'mesh:read' }))
    .build()

export const meshMembershipSnapshotContract = nodeAgentSnapshotOps
    .list()
    .path('/membership/snapshot')
    .input(z.object({}))
    .output(nodeAgentSnapshotSchema)
    .meta(access({ permission: 'mesh:read' }))
    .build()

/** The swarm as the agents report it, sent again whenever it changes. */
export const meshTopologyStreamContract = nodeAgentSnapshotOps
    .list()
    .path('/topology/stream')
    .input(z.object({}))
    .output((b) => b.observable(nodeAgentSnapshotSchema))
    .meta(access({ permission: 'mesh:read' }))
    .build()

export const meshLookupResourceContract = nodeAgentLookupOps
    .create()
    .path('/lookup')
    .input((b) => b.body(nodeAgentLookupInputSchema))
    .output(nodeAgentLookupResultSchema)
    .meta(access({ permission: 'mesh:read' }))
    .build()

/**
 * Issues the token a new node redeems with its own agent (`roster.join`) to join the swarm. The grant above is the
 * enrollment of the setup flow, which this replaces when onboarding moves onto the agent.
 */
export const meshIssueJoinTokenContract = nodeAgentJoinTokenOps
    .create()
    .path('/enrollment/tokens/issue')
    .input((b) => b.body(nodeAgentJoinTokenInputSchema))
    .output(nodeAgentJoinTokenResultSchema)
    .meta(access({ permission: 'cluster:join-token:reveal' }))
    .build()

export const meshGetNodeConfigContract = meshNodeConfigOps
    .list()
    .path('/node/config')
    .input((b) => b.body(z.object({}).optional()))
    .output(meshNodeConfigSchema)
    .meta(access({ permission: 'mesh:read' }))
    .build()

export const meshUpdateNodeConfigContract = meshNodeConfigUpdateOps
    .create()
    .path('/node/config')
    .input((b) => b.body(meshNodeConfigUpdateInputSchema))
    .output(meshNodeConfigUpdateResultSchema)
    .meta(access({ permission: 'mesh:operate' }))
    .build()

export const meshRegenerateNodeConfigSecretContract =
    meshNodeConfigRegenerateSecretOps
        .create()
        .path('/node/config/regenerate-secret')
        .input((b) => b.body(z.object({}).optional()))
        .output(meshNodeConfigRegenerateSecretResultSchema)
        .meta(access({ permission: 'mesh:operate' }))
        .build()

export const meshTestNodeConfigDbContract = meshNodeConfigTestDbOps
    .create()
    .path('/node/config/test-db')
    .input((b) => b.body(meshNodeConfigTestDbInputSchema))
    .output(meshNodeConfigTestDbResultSchema)
    .meta(access({ permission: 'mesh:operate' }))
    .build()

export const meshContract = oc
    .meta(openapi({ tags: ['Core Mesh'], prefix: '/mesh' }))
    .router({
        ping: meshPingContract,
        getLocalNode: meshGetLocalNodeContract,
        getNodeMetrics: meshGetNodeMetricsContract,
        listPeers: meshListPeersContract,
        listEventStreams: meshListEventStreamsContract,
        findEventStreamById: meshFindEventStreamByIdContract,
        subscribeEventStream: meshStreamSubscribeContract,
        membershipSnapshot: meshMembershipSnapshotContract,
        streamTopology: meshTopologyStreamContract,
        lookupResource: meshLookupResourceContract,
        issueJoinToken: meshIssueJoinTokenContract,
        getNodeConfig: meshGetNodeConfigContract,
        updateNodeConfig: meshUpdateNodeConfigContract,
        regenerateNodeConfigSecret: meshRegenerateNodeConfigSecretContract,
        testNodeConfigDb: meshTestNodeConfigDbContract,
    })

export type MeshContract = typeof meshContract
