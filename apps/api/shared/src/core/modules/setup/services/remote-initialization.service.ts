import { Context, Data, Duration, Effect, Schedule } from 'effect'
import z from 'zod/v4'

import {
    meshEnrollmentDescribeResultSchema,
    meshEnrollmentEnrollResultSchema,
    type SetupInitializeRemoteInput,
} from '@deployer/contracts-entities'
import type { MeshSwarmJoinGrant } from '@deployer/contracts-entities'
import { meshEnrollmentContract } from '@deployer/fleet-contracts'
import {
    nodeAgentLink,
    nodeDoorFromEnv,
    serviceLink,
    type NodeDoorClient,
} from '@deployer/mesh-client'
import type { EffectHostShape } from '@deployer/nest-effect'
import { NodeConfigRepository } from '@deployer/node-state'
import { SwarmBootstrap, SwarmCluster } from '@deployer/swarm'

import {
    DEPLOYER_VERSION,
    semverCompare,
} from '../../../utils/deployer-version'
import { SetupInitializationFailed } from '../setup.errors'
import {
    runStepEffect,
    type EmitEvent,
    type StepLog,
    SetupStepTracker,
} from '../utils/setup-runner.utils'

import { ApiEnvironment } from '../../../../config/env/env.module'

import type { ClientContext, ClientLink } from '@orpc/client'

/** What `door.view()` must carry for a join to continue: the node's own identity. */
const nodeViewSchema = z.object({
    self: z.object({ nodeId: z.string().min(1) }),
})

/** How long a joining node waits for its agent to find the fleet, and how often it asks again. */
const FLEET_WAIT_MS = 60_000
const FLEET_POLL_MS = 2_000

/** How long the flow waits for the agent's WireGuard handshake before trying Swarm anyway. */
const LINK_WAIT_MS = 60_000
const LINK_POLL_MS = 2_000

/** A back-off that keeps asking while the agent has not found the fleet yet. */
const poll = Schedule.spaced(Duration.millis(FLEET_POLL_MS))

const messageOf = (cause: unknown): string =>
    cause instanceof Error ? cause.message : String(cause)

// ─── Errors ──────────────────────────────────────────────────────────────────

/**
 * The join could not continue at `stage`.
 *
 * A typed error rather than a bare `AppError`: it carries the stage, so the flow can report which
 * phase refused, and `initialize` maps it into the wizard's message at the boundary.
 */
export class RemoteJoinRejected extends Data.TaggedError('RemoteJoinRejected')<{
    readonly stage: string
    readonly message: string
    readonly cause?: unknown
}> {}

// ─── Types ───────────────────────────────────────────────────────────────────

/**
 * What one run resolves from the container.
 *
 * These are YIELDED, not constructed: the flow runs on the app runtime, so each collaborator comes
 * from the module that registered it — the same way a handler reaches its services.
 */
export type RemoteInitializationPorts =
    | NodeConfigRepository
    | SwarmBootstrap
    | SwarmCluster
    | ApiEnvironment

export type RemoteInitializationServiceShape = {
    /**
     * Run the remote join flow.
     *
     * Owns: agent_join → mesh_handshake → version_check → register_node → finalize. The operator
     * proved who they are when they issued the join token on a node of the fleet; this node redeems
     * it with its own agent, which joins the swarm, and then asks the fleet to enroll it over the
     * mesh. Nothing here is configured from an address or a password.
     */
    readonly initialize: (
        input: SetupInitializeRemoteInput,
        tracker: SetupStepTracker,
        emit: EmitEvent
    ) => Effect.Effect<
        { nodeId: string; databaseUrl: string },
        SetupInitializationFailed,
        RemoteInitializationPorts
    >
}

/**
 * The seams a spec substitutes.
 *
 * The door and the agent link are derived from the environment and from a socket that exists on
 * disk, so they are genuine per-instance configuration — not collaborators to yield.
 */
export type RemoteInitializationOptions = {
    /** The app runtime: `SwarmBootstrap.converge` yields `SwarmParticipation`, so it needs it. */
    readonly host: EffectHostShape
    /** This node's agent, over its node door: how the token is redeemed. Overridable in tests. */
    readonly nodeDoor?: (env: { get(key: string): unknown }) => NodeDoorClient
    /** The link to this node's agent. Overridable in tests. */
    readonly agentLink?: () => ClientLink<ClientContext> | undefined
}

// ─── Phases ──────────────────────────────────────────────────────────────────

/** Redeem the join token with this node's agent and read back which node this is. */
const redeemJoinToken = (
    door: NodeDoorClient,
    joinToken: string
): Effect.Effect<string, RemoteJoinRejected> =>
    Effect.gen(function* () {
        const redeemed = yield* Effect.tryPromise({
            try: () => door.joinWithToken(joinToken),
            catch: (cause) =>
                new RemoteJoinRejected({
                    stage: 'agent_join',
                    message: messageOf(cause),
                    cause,
                }),
        })

        // Null means there is no agent on this node to join with.
        if (redeemed === null) {
            return yield* Effect.fail(
                new RemoteJoinRejected({
                    stage: 'agent_join',
                    message:
                        'This node has no mesh agent, so it cannot join a fleet. Start the node with its agent and try again.',
                })
            )
        }

        // The view arrives over the wire, so it is PARSED rather than trusted: a missing identity is
        // the one answer a join cannot continue from.
        const view = nodeViewSchema.safeParse(
            yield* Effect.tryPromise({
                try: () => door.view(),
                catch: (cause) =>
                    new RemoteJoinRejected({
                        stage: 'agent_join',
                        message: messageOf(cause),
                        cause,
                    }),
            })
        )
        if (!view.success) {
            return yield* Effect.fail(
                new RemoteJoinRejected({
                    stage: 'agent_join',
                    message:
                        "This node's agent did not report its identity. Check that the agent is running.",
                    cause: view.error,
                })
            )
        }

        return view.data.self.nodeId
    })

/** Whether an oRPC failure means "the agent has not found the fleet yet". */
const isRoutingNotReady = (cause: unknown): boolean => {
    const code =
        typeof cause === 'object' && cause !== null && 'code' in cause
            ? String(cause.code)
            : ''
    return (
        code === 'NOT_FOUND' ||
        code === 'SERVICE_UNAVAILABLE' ||
        code === 'INTERNAL_SERVER_ERROR'
    )
}

/**
 * Ask the fleet, through the mesh, until it answers.
 *
 * The agent has to learn where a fleet replica lives; until gossip teaches it, a call fails with
 * NOT_FOUND / UNAVAILABLE. Those are waits, not answers — anything else is final.
 */
const askFleet = (
    link: ClientLink<ClientContext> | undefined,
    path: string[],
    body: unknown,
    log: StepLog
): Effect.Effect<unknown, RemoteJoinRejected> => {
    if (link === undefined) {
        return Effect.fail(
            new RemoteJoinRejected({
                stage: 'mesh_handshake',
                message: 'This node has no mesh agent',
            })
        )
    }

    return Effect.tryPromise({
        try: () => link.call(path, body, { context: {} }),
        catch: (cause) =>
            new RemoteJoinRejected({
                stage: 'mesh_handshake',
                message: messageOf(cause),
                cause,
            }),
    }).pipe(
        // The retry predicate reads the CAUSE, so the routing code must survive the mapping.
        Effect.retry({ schedule: poll, while: (e) => isRoutingNotReady(e.cause) }),
        Effect.tapError(() => log('Waiting for the agent to find the fleet…')),
        // Effect 4 has no `timeoutFail`: `timeoutOrElse` interrupts the source and runs the failing
        // branch, which is the same contract with an explicit failure value.
        Effect.timeoutOrElse({
            duration: Duration.millis(FLEET_WAIT_MS),
            orElse: () =>
                Effect.fail(
                    new RemoteJoinRejected({
                        stage: 'mesh_handshake',
                        message:
                            'The fleet did not answer through the mesh in time. Check that a node of the fleet is reachable.',
                    })
                ),
        })
    )
}

/**
 * Wait until the agent has completed a WireGuard handshake with some member — the moment Swarm can
 * reach a manager's mesh address. Returns false on timeout: the caller proceeds and lets Swarm's own
 * join retry report the outcome.
 */
const waitForLink = (
    door: NodeDoorClient
): Effect.Effect<boolean, RemoteJoinRejected> =>
    Effect.gen(function* () {
        const linked = yield* Effect.tryPromise({
            try: () => door.status(),
            catch: (cause) =>
                new RemoteJoinRejected({
                    stage: 'finalize',
                    message: messageOf(cause),
                    cause,
                }),
        }).pipe(
            Effect.map(
                (status) =>
                    status?.interfaceUp === true &&
                    status.peers.some(
                        (peer) => peer.latestHandshakeAt !== null
                    )
            ),
            // Ask again until a handshake lands, or the budget runs out.
            Effect.repeat({
                schedule: Schedule.spaced(Duration.millis(LINK_POLL_MS)),
                until: (up) => up,
                times: Math.ceil(LINK_WAIT_MS / LINK_POLL_MS),
            })
        )
        return linked
    })

/** The URL this node advertises to the mesh: `APP_URL`, then `NEXT_PUBLIC_APP_URL`. */
const resolveServerUrl = (env: { get(key: string): unknown }): string | null => {
    const read = (key: string): string => {
        const value = env.get(key)
        return typeof value === 'string' ? value.trim() : ''
    }
    // `||` and not `??`: an EMPTY string is "not set" here, which is the whole point of the fallback.
    const candidate = read('APP_URL') || read('NEXT_PUBLIC_APP_URL')
    if (candidate === '') return null
    try {
        return new URL(candidate).toString()
    } catch {
        return null
    }
}

// ─── The flow ────────────────────────────────────────────────────────────────

/**
 * The join flow, yielding every collaborator it needs.
 *
 * Module scope on purpose: it holds no state — the test seams come from the instance, and everything
 * else is resolved from the container.
 */
function runFlow(
    input: SetupInitializeRemoteInput,
    tracker: SetupStepTracker,
    emit: EmitEvent,
    seams: {
        readonly nodeDoor: (env: { get(key: string): unknown }) => NodeDoorClient
        readonly agentLink: () => ClientLink<ClientContext> | undefined
        readonly host: EffectHostShape
    }
): Effect.Effect<
    { nodeId: string; databaseUrl: string },
    SetupInitializationFailed,
    RemoteInitializationPorts
> {
    return Effect.fn('RemoteInitialization.initialize')(function* () {
        const nodeConfigRepository = yield* NodeConfigRepository
        const swarmBootstrap = yield* SwarmBootstrap
        const swarmCluster = yield* SwarmCluster
        const env = yield* ApiEnvironment

        const door = seams.nodeDoor(env)
        const agent = seams.agentLink()
        const serverUrl = resolveServerUrl(env) ?? input.serverUrl

        /**
         * The token the agent handshake uses. `meshJoinToken` is the agent's own (the encoded one
         * `roster.join` accepts); `token` is the platform's grant. They are the same string on a node
         * added from the fleet's UI, so the explicit field wins and `token` remains its fallback.
         */
        const joinToken = input.meshJoinToken ?? input.token

        // The fleet is reached like any service: through the agent, which finds a replica as gossip
        // teaches it where they are.
        const fleet =
            agent === undefined
                ? undefined
                : serviceLink<ClientContext>({
                      agent,
                      service: 'fleet',
                      contract: meshEnrollmentContract,
                  })

        const nodeId = yield* runStepEffect(
            tracker,
            emit,
            'agent_join',
            'Join the swarm',
            (log) =>
                Effect.gen(function* () {
                    yield* log(
                        "Redeeming the join token with this node's agent…"
                    )
                    // The agent joins by token over its own door: it adopts the credential the
                    // token carries and merges what it knows.
                    const id = yield* redeemJoinToken(door, joinToken)
                    yield* log(`This node is ${id}`)
                    return id
                })
        )

        let fleetVersion = ''
        yield* runStepEffect(
            tracker,
            emit,
            'mesh_handshake',
            'Connect to the fleet',
            (log) =>
                Effect.gen(function* () {
                    yield* log('Asking the fleet to describe itself…')
                    const described = meshEnrollmentDescribeResultSchema.parse(
                        yield* askFleet(
                            fleet,
                            ['describe'],
                            { token: joinToken },
                            log
                        )
                    )
                    fleetVersion = described.version
                    yield* log(`✅ Reached the fleet, running ${fleetVersion}`)
                })
        )

        // ── Version Check ──────────────────────────────────────────────
        // A node cannot join a fleet running a higher version: it must be upgraded first. A node
        // ahead of the fleet may join, and the fleet's upgrade is for a super admin to trigger.
        yield* runStepEffect(
            tracker,
            emit,
            'version_check',
            'Version compatibility check',
            (log) =>
                Effect.gen(function* () {
                    yield* log(`Local deployer version: ${DEPLOYER_VERSION}`)
                    yield* log(`Fleet version: ${fleetVersion}`)
                    const comparison = semverCompare(
                        DEPLOYER_VERSION,
                        fleetVersion
                    )
                    if (comparison === 0) {
                        yield* log(
                            `✅ Version match: both on ${DEPLOYER_VERSION}. Proceeding with join.`
                        )
                        return
                    }
                    if (comparison < 0) {
                        return yield* Effect.fail(
                            new RemoteJoinRejected({
                                stage: 'version_check',
                                message:
                                    `⛔ Version mismatch: this node is at ${DEPLOYER_VERSION} but the fleet is at ${fleetVersion}. ` +
                                    `A node cannot join a fleet running a higher version. Please upgrade this node to ${fleetVersion} before joining.`,
                            })
                        )
                    }
                    yield* log(
                        `⚠️  This node (${DEPLOYER_VERSION}) is ahead of the fleet (${fleetVersion}). ` +
                            `The fleet should be upgraded to ${DEPLOYER_VERSION}. Proceeding with join.`
                    )
                })
        )

        const enrolled = yield* runStepEffect(
            tracker,
            emit,
            'register_node',
            'Register this node',
            (log) =>
                Effect.gen(function* () {
                    yield* log(`Advertising server URL: ${serverUrl}`)
                    const result = meshEnrollmentEnrollResultSchema.parse(
                        yield* askFleet(
                            fleet,
                            ['enroll'],
                            {
                                token: joinToken,
                                nodeId,
                                serverUrl,
                                // The role THIS node asked for. The fleet replies with what it
                                // actually grants: asking for "auto" makes the node a candidate for
                                // master, not a manager by right.
                                requestedSwarmPolicy: input.swarm?.policy,
                            },
                            log
                        )
                    )
                    yield* log(`✅ Enrolled in the fleet as ${result.nodeId}`)
                    yield* log(
                        '✅ Joined the swarm by token — the agent brings up the WireGuard links'
                    )
                    if (result.swarmGrant === null) {
                        yield* log(
                            '⚠️  The fleet has no Swarm cluster to hand over — swarm convergence deferred'
                        )
                    } else {
                        yield* log(
                            `✅ Swarm role granted by the fleet: ${result.swarmGrant.role}`
                        )
                        yield* log(`  reason  = ${result.swarmGrant.reason}`)
                        yield* log(
                            `  control = ${result.swarmGrant.controlPlaneAddrs.join(', ')}`
                        )
                    }
                    return result
                })
        )

        const databaseUrl = enrolled.databaseUrl
        const platformSecret = enrolled.platformSecret
        const platformSecretGeneration = enrolled.platformSecretGeneration
        const platformSecretPrevious = enrolled.platformSecretPrevious
        const swarmGrant: MeshSwarmJoinGrant | null = enrolled.swarmGrant

        yield* runStepEffect(
            tracker,
            emit,
            'finalize',
            'Finalize',
            (log) =>
                Effect.gen(function* () {
                    yield* log('Persisting node config…')
                    const now = new Date().toISOString()
                    yield* nodeConfigRepository.upsert({
                        nodeId,
                        strategy: 'remote',
                        setupState: 'setup_done',
                        deployerVersion: DEPLOYER_VERSION,
                        meshUrlsSnapshot: [],
                        databaseUrl,
                        // Remote-join shares the mesh owner's database — externally managed, never
                        // supervised by this node's GlobalDbSupervisorService.
                        databaseProvisioning: 'external' as const,
                        configuredAt: now,
                        // The fleet's secret replaces any this node generated before it joined: one
                        // value signs and verifies everywhere. Left alone only when the fleet
                        // predates it.
                        ...(platformSecret === null
                            ? {}
                            : {
                                  platformSecret,
                                  platformSecretUpdatedAt: now,
                                  platformSecretGeneration,
                                  platformSecretPrevious,
                              }),
                        // The FLEET's role decision, persisted so a restart re-converges from the
                        // same answer instead of re-asking the mesh.
                        swarmConfig:
                            swarmGrant === null
                                ? undefined
                                : {
                                      mode: 'join' as const,
                                      // "auto" = MAY be master. The mesh already answered whether
                                      // this node actually is (swarmGrant.role), so a granted
                                      // manager keeps the mixed policy.
                                      policy:
                                          swarmGrant.role === 'manager'
                                              ? ('auto' as const)
                                              : ('worker' as const),
                                      advertiseAddr: null,
                                      joinToken:
                                          swarmGrant.role === 'manager'
                                              ? (swarmGrant.managerToken ??
                                                swarmGrant.workerToken)
                                              : swarmGrant.workerToken,
                                      joinAddrs: swarmGrant.controlPlaneAddrs,
                                  },
                        updatedAt: now,
                    })
                    yield* log('✅ Node config persisted')

                    // ── Join the FLEET's swarm ─────────────────────────────────────
                    // The role comes from the mesh, never from this node's own ambition: the manager
                    // join token is withheld unless the fleet admitted this node to quorum. Deferred
                    // (not fatal) when the mesh offered no cluster — a node whose fleet has no swarm
                    // yet must still complete setup and can converge later from the Cluster page.
                    if (swarmGrant === null) {
                        yield* log(
                            '⚠️  No Swarm cluster offered by the mesh — convergence deferred'
                        )
                        return
                    }

                    yield* log(
                        `▸ Joining the mesh Swarm cluster as ${swarmGrant.role}…`
                    )
                    yield* log(
                        `  control = ${swarmGrant.controlPlaneAddrs.join(', ')}`
                    )
                    // The managers advertise MESH addresses, so the join can only succeed once a
                    // WireGuard link is up — wait for it rather than racing it.
                    const linked = yield* waitForLink(door)
                    yield* log(
                        linked
                            ? '✅ Mesh link established'
                            : '⚠️  No mesh link yet — attempting the join anyway'
                    )

                    // `SwarmBootstrap.converge` yields `SwarmParticipation`, so it needs the app
                    // runtime's context — the host is exactly that.
                    yield* Effect.promise(() =>
                        seams.host.runUnwrapped(swarmBootstrap.converge('setup'))
                    )
                    const snapshot = yield* swarmCluster.getLocalClusterSnapshot()

                    if (snapshot.localNodeState === 'active') {
                        yield* log('✅ Joined the Swarm cluster')
                        yield* log(`  role   = ${snapshot.localNode.swarmRole}`)
                        yield* log(
                            `  master = ${snapshot.master?.nodeId ?? 'elected elsewhere'}`
                        )
                        yield* log(
                            `  nodes  = ${String(snapshot.nodeCount)} (managers ${String(snapshot.managerCount)})`
                        )
                    } else {
                        yield* log(
                            `⚠️  Swarm join not active (state=${snapshot.localNodeState}) — retry from the Cluster page`
                        )
                    }
                })
        )

        return { nodeId, databaseUrl }
    })().pipe(
        // One place converts whatever the phases threw — a `RemoteJoinRejected`, a repository
        // conflict, a docker failure — into the message the wizard shows.
        Effect.mapError(
            (cause) =>
                new SetupInitializationFailed({
                    reason: messageOf(cause),
                    cause,
                })
        )
    )
}

// ─── Service ─────────────────────────────────────────────────────────────────

/**
 * The one implementation of `RemoteInitializationServiceShape`.
 *
 * A NAMED class: this package emits declarations, and TS4094 forbids private members on an
 * anonymous exported class whose type is exported. Only the two test seams and the runtime host are
 * constructor arguments; every collaborator is yielded per run.
 */
class RemoteInitializationServiceImpl implements RemoteInitializationServiceShape {
    private readonly nodeDoor: NonNullable<
        RemoteInitializationOptions['nodeDoor']
    >
    private readonly agentLink: NonNullable<
        RemoteInitializationOptions['agentLink']
    >
    private readonly host: EffectHostShape

    constructor(options: RemoteInitializationOptions) {
        // `nodeDoorFromEnv`/`nodeAgentLink` are the defaults: both read the environment, so a spec
        // substitutes them rather than the whole service.
        this.nodeDoor = options.nodeDoor ?? nodeDoorFromEnv
        this.agentLink = options.agentLink ?? (() => nodeAgentLink())
        this.host = options.host
    }

    initialize(
        input: SetupInitializeRemoteInput,
        tracker: SetupStepTracker,
        emit: EmitEvent
    ): Effect.Effect<
        { nodeId: string; databaseUrl: string },
        SetupInitializationFailed,
        RemoteInitializationPorts
    > {
        return runFlow(input, tracker, emit, {
            nodeDoor: this.nodeDoor,
            agentLink: this.agentLink,
            host: this.host,
        })
    }
}

export class RemoteInitializationService extends Context.Service<
    RemoteInitializationService,
    RemoteInitializationServiceShape
>()('shared/RemoteInitializationService') {
    /** The implementation: only the test seams and the runtime host are per-instance. */
    static readonly live = RemoteInitializationServiceImpl
}
