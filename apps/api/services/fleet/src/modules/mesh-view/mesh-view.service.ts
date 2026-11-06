import { Context, Effect } from 'effect'
import { Observable } from 'rxjs'
import z from 'zod/v4'

import {
    nodeAgentLookupResultSchema,
    nodeAgentReplicaSchema,
    type NodeAgentJoinTokenInput,
    type NodeAgentJoinTokenResult,
    nodeAgentJoinTokenResultSchema,
    type NodeAgentLookupInput,
    type NodeAgentLookupResult,
    type NodeAgentNode,
    type NodeAgentNodesResult,
    type NodeAgentSnapshot,
} from '@deployer/contracts-entities'
import {
    domainError,
    runPromiseUnwrapped,
    serviceOver,
    type Over,
} from '@deployer/effect-core'

import { FleetInvalid } from '../../core/fleet.errors'

import { MeshAgent, type MeshAgentShape } from './mesh-view.ports'

import type { ClientContext, ClientLink } from '@orpc/client'

const CALL = { context: {} } as const

/** How often the topology stream looks again. */
const TOPOLOGY_POLL_MS = 3_000

/** The agent answered, but with something this service does not understand, or the call failed. */
export class MeshAgentCallFailed extends domainError(
    'MeshAgentCallFailed',
    'dependency_missing'
)<{ readonly path: string }>() {
    override publicMessage() {
        return "This node's mesh agent did not give a usable answer"
    }
}

/** The shapes of what an agent answers, parsed instead of trusted: the answer comes over a socket. */
const agentInfoSchema = z.object({ nodeId: z.string().min(1), address: z.string() })
const viewSchema = z.object({
    self: agentInfoSchema,
    agents: z.array(agentInfoSchema),
})
const directorySnapshotSchema = z.object({ replicas: z.array(nodeAgentReplicaSchema) })
const resolveSchema = z.object({
    replica: nodeAgentReplicaSchema,
    reason: nodeAgentLookupResultSchema.shape.reason.unwrap(),
})

type Link = ClientLink<ClientContext>

/** One call to the agent, answered in the shape `schema` says, or `MeshAgentCallFailed`. */
const ask = <S extends z.ZodType>(
    link: Link,
    path: string[],
    input: unknown,
    schema: S
): Effect.Effect<z.infer<S>, MeshAgentCallFailed | { readonly code: unknown }> =>
    Effect.tryPromise({
        try: () => link.call(path, input, CALL),
        // The caller may need the agent's own code (NOT_FOUND on a lookup): keep a failure that carries one as it is.
        catch: (error): MeshAgentCallFailed | { readonly code: unknown } =>
            typeof error === 'object' && error !== null && 'code' in error
                ? { code: error.code }
                : new MeshAgentCallFailed({ path: path.join('.'), cause: error }),
    }).pipe(
        Effect.flatMap((answer) => {
            const parsed = schema.safeParse(answer)
            return parsed.success
                ? Effect.succeed(parsed.data)
                : Effect.fail(new MeshAgentCallFailed({ path: path.join('.') }))
        })
    )

/** A failure of `ask` that is not the agent's own code is the typed one; the agent's own code is for the caller to read. */
const asCallFailure = (error: MeshAgentCallFailed | { readonly code: unknown }, path: string) =>
    error instanceof MeshAgentCallFailed
        ? error
        : new MeshAgentCallFailed({ path, cause: error })

const nodesOf = (link: Link) =>
    ask(link, ['roster', 'view'], {}, viewSchema).pipe(
        Effect.mapError((error) => asCallFailure(error, 'roster.view')),
        Effect.map(({ self, agents }): NodeAgentNode[] => [
            { ...self, local: true },
            ...agents.map((agent) => ({ ...agent, local: false })),
        ])
    )

const localNodeWith = (agent: MeshAgentShape) =>
    Effect.gen(function* () {
        const link = agent.link()
        if (link === undefined) {
            return {
                nodeId: (yield* agent.standalone()).nodeId,
                address: '',
                local: true,
            } satisfies NodeAgentNode
        }
        const { self } = yield* ask(link, ['roster', 'view'], {}, viewSchema).pipe(
            Effect.mapError((error) => asCallFailure(error, 'roster.view'))
        )
        return { ...self, local: true } satisfies NodeAgentNode
    })

const snapshotWith = (agent: MeshAgentShape) =>
    Effect.gen(function* () {
        const link = agent.link()
        if (link === undefined) {
            return {
                generatedAt: new Date().toISOString(),
                nodes: [yield* localNodeWith(agent)],
                replicas: [],
            } satisfies NodeAgentSnapshot
        }
        const nodes = yield* nodesOf(link)
        const { replicas } = yield* ask(
            link,
            ['directory', 'snapshot'],
            {},
            directorySnapshotSchema
        ).pipe(Effect.mapError((error) => asCallFailure(error, 'directory.snapshot')))
        return {
            generatedAt: new Date().toISOString(),
            nodes,
            replicas,
        } satisfies NodeAgentSnapshot
    })

/**
 * The dashboard's picture of the mesh, read from the agent of this node.
 *
 * Nothing is measured here: the nodes and replicas are what the agents report, and a join token is issued by the agent,
 * which alone holds the swarm's credential. A node without an agent is a swarm of one.
 */
const makeMeshView = ({ agent }: { readonly agent: MeshAgentShape }) => ({
    localNode: Effect.fn('MeshView.localNode')(function* () {
        return yield* localNodeWith(agent)
    }),

    peers: Effect.fn('MeshView.peers')(function* () {
        const link = agent.link()
        const items =
            link === undefined ? [yield* localNodeWith(agent)] : yield* nodesOf(link)
        return { items } satisfies NodeAgentNodesResult
    }),

    snapshot: Effect.fn('MeshView.snapshot')(function* () {
        return yield* snapshotWith(agent)
    }),

    /** The swarm now, and again each time it differs from what was last sent. */
    topology: (pollMs: number = TOPOLOGY_POLL_MS) =>
        Effect.sync(
            () =>
                new Observable<NodeAgentSnapshot>((subscriber) => {
                    let last = ''
                    let closed = false
                    const look = async () => {
                        try {
                            const current = await runPromiseUnwrapped(
                                snapshotWith(agent)
                            )
                            const fingerprint = JSON.stringify({
                                nodes: current.nodes,
                                replicas: current.replicas,
                            })
                            if (!closed && fingerprint !== last) {
                                last = fingerprint
                                subscriber.next(current)
                            }
                        } catch {
                            // The agent is not reachable right now: say nothing, and look again.
                        }
                    }
                    void look()
                    const timer = setInterval(() => void look(), pollMs)
                    return () => {
                        closed = true
                        clearInterval(timer)
                    }
                })
        ),

    lookup: Effect.fn('MeshView.lookup')(function* (input: NodeAgentLookupInput) {
        const link = agent.link()
        const none: NodeAgentLookupResult = { found: false, replica: null, reason: null }
        if (link === undefined) return none
        return yield* ask(link, ['directory', 'resolve'], input, resolveSchema).pipe(
            Effect.map(
                ({ replica, reason }): NodeAgentLookupResult => ({
                    found: true,
                    replica,
                    reason,
                })
            ),
            // No live replica is an answer, not a failure.
            Effect.catch((error) =>
                !(error instanceof MeshAgentCallFailed) && error.code === 'NOT_FOUND'
                    ? Effect.succeed(none)
                    : Effect.fail(asCallFailure(error, 'directory.resolve'))
            )
        )
    }),

    /** A token for a new node. A node with no agent cannot issue one: there is no swarm credential to hand over. */
    issueToken: Effect.fn('MeshView.issueToken')(function* (
        input: NodeAgentJoinTokenInput
    ) {
        const link = agent.link()
        if (link === undefined) {
            return yield* new FleetInvalid({
                reason: 'This node has no mesh agent, so it cannot issue a join token',
            })
        }
        const token: NodeAgentJoinTokenResult = yield* ask(
            link,
            ['roster', 'token'],
            input,
            nodeAgentJoinTokenResultSchema
        ).pipe(Effect.mapError((error) => asCallFailure(error, 'roster.token')))
        return token
    }),
})

export type MeshViewShape = Over<ReturnType<typeof makeMeshView>, MeshAgent>

/** Tag and implementation together: the tag is the contract, `live` the one implementation. */
export class MeshView extends Context.Service<MeshView, MeshViewShape>()(
    'fleet/MeshView'
) {
    /** The agent is yielded when a method runs, so this is a constant the module provides with `useValue`. */
    static readonly live: MeshViewShape = serviceOver(
        Effect.all({ agent: MeshAgent }),
        makeMeshView
    )
}

