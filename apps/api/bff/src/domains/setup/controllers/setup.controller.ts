import { Controller } from '@nestjs/common'
import { Implement } from '@orpc/nest'
import { Effect } from 'effect'
import { Pool } from 'pg'

import { setupContract } from '@deployer/bff-contracts'
import { inBoundary, procedure } from '@deployer/nest-effect'
import { NodeConfigRepository } from '@deployer/node-state'
import { liveSnapshot } from '@deployer/shared/core/utils/live-snapshot.utils'

import { publicAccess } from '@/core/modules/auth/orpc/middlewares'
import { EgressService } from '@/core/modules/egress/egress.service'
import { ReachabilityService } from '@/core/modules/reachability/services/reachability.service'
import { InitializationService } from '@/core/modules/setup/services/initialization.service'
import { NodeConfigNotFound } from '@/core/modules/setup/setup.errors'

import { PostSetupDestinationService } from '../services/post-setup-destination.service'
import {
    PostSetupVerificationService,
    type PostSetupVerificationPorts,
} from '../services/post-setup-verification.service'

/**
 * Re-evaluation cadence for `getPostSetupVerificationStream` — the interval the
 * wizard used to poll at while the ingress is being replaced.
 */
const POST_SETUP_VERIFICATION_STREAM_INTERVAL_MS = 2_000

/**
 * Setup wizard surface — intentionally PRE-AUTH by design (the wizard runs
 * before any account exists).
 *
 * There is no global guard: nothing here requires a session by default, and
 * `publicAccess()` is what lets an ORPC handler read `context.auth` without
 * requiring one. Do not add `requireAuth()` to this surface.
 */
@Controller()
export class SetupController {
    constructor(
        private readonly reachabilityService: ReachabilityService,
        private readonly egress: EgressService
    ) {}

    // ─── State ────────────────────────────────────────────────────────────────

    @Implement(setupContract.getState)
    getState() {
        return procedure(setupContract.getState)
            .use(publicAccess())
            .effect(function* () {
                const initialization = yield* InitializationService
                return yield* initialization.getSetupState()
            })
    }

    @Implement(setupContract.getNodeStatus)
    getNodeStatus() {
        return procedure(setupContract.getNodeStatus)
            .use(publicAccess())
            .effect(function* () {
                const initialization = yield* InitializationService
                return yield* initialization.getNodeStatus()
            })
    }

    // ─── Pre-flight probes ────────────────────────────────────────────────────

    /**
     * Test a PostgreSQL URL — instant feedback, no side effects.
     * Used by the "use existing database" toggle in local Step 2.
     */
    @Implement(setupContract.probeDatabase)
    probeDatabase() {
        return procedure(setupContract.probeDatabase)
            .use(publicAccess())
            .effect(function* ({ input }) {
                const initialization = yield* InitializationService
                yield* initialization.assertSetupMutable()
                yield* initialization.assertDatabaseProbeAllowed(
                    input.databaseUrl.trim()
                )
                const start = Date.now()
                // The probe opens a throwaway connection: its outcome (reachable or not) is the answer, never a failure.
                return yield* Effect.promise(async () => {
                    const pool = new Pool({
                        connectionString: input.databaseUrl.trim(),
                        max: 1,
                        connectionTimeoutMillis: 5_000,
                    })
                    try {
                        await pool.query('SELECT 1')
                        return {
                            status: 201 as const,
                            headers: {},
                            body: {
                                reachable: true,
                                latencyMs: Date.now() - start,
                            },
                        }
                    } catch (err: unknown) {
                        return {
                            status: 201 as const,
                            headers: {},
                            body: {
                                reachable: false,
                                error:
                                    err instanceof Error
                                        ? err.message
                                        : String(err),
                            },
                        }
                    } finally {
                        await pool.end().catch(() => undefined)
                    }
                })
            })
    }

    /**
     * Start the initialization process in the background.
     * Returns immediately. Live progress can be consumed via `getInitializeStream`.
     */
    @Implement(setupContract.triggerInitialize)
    triggerInitialize() {
        return procedure(setupContract.triggerInitialize)
            .use(publicAccess())
            .effect(function* ({ input }) {
                const initialization = yield* InitializationService
                yield* initialization.assertSetupMutable()
                // Credentials are stored inside initializationService.triggerInitialize()
                const result = yield* initialization.triggerInitialize(input)
                return { status: 201 as const, headers: {}, body: result }
            })
    }

    // ─── Stream initialization events (SSE) ──────────────────────────────────

    /**
     * Subscribe to the initialization event stream.
     * Returns an Observable of SetupStreamEvent (SSE).
     * Replays past events for late subscribers (page reload / reconnection).
     */
    @Implement(setupContract.getInitializeStream)
    getInitializeStream() {
        return procedure(setupContract.getInitializeStream)
            .use(publicAccess())
            .effect(function* () {
                const initialization = yield* InitializationService
                return initialization.getInitializeStream()
            })
    }

    // ─── Post-setup hints (ORPC) ────────────────────────────────────────────

    /**
     * List pending post-setup hint IDs.
     * Called by PostSetupHints component on mount.
     */
    @Implement(setupContract.listPostSetupHints)
    listPostSetupHints() {
        return procedure(setupContract.listPostSetupHints)
            .use(publicAccess())
            .handler(() => ({
                hintIds: ['scanning' as const, 'notifications' as const],
            }))
    }

    /**
     * Dismiss a post-setup hint. Persisted so the hint never appears again.
     */
    @Implement(setupContract.dismissPostSetupHint)
    setupDismissPostSetupHint() {
        return procedure(setupContract.dismissPostSetupHint)
            .use(publicAccess())
            .effect(function* ({ input }) {
                const initialization = yield* InitializationService
                const nodeConfig = yield* NodeConfigRepository
                yield* initialization.assertSetupMutable()
                yield* Effect.logInfo(`Hint dismissed: ${input.hintId}`)
                const config = yield* nodeConfig.find()
                if (!config) return yield* new NodeConfigNotFound({})
                const flags = config.postSetupFlags ?? {}
                yield* nodeConfig.upsert({
                    nodeId: config.nodeId,
                    strategy: config.strategy,
                    setupState: config.setupState,
                    deployerVersion: config.deployerVersion,
                    databaseUrl: config.databaseUrl,
                    databaseProvisioning: config.databaseProvisioning ?? null,
                    configuredAt: config.configuredAt,
                    meshUrlsSnapshot: config.meshUrlsSnapshot ?? [],
                    meshSharedSecret: config.meshSharedSecret,
                    meshSharedSecretUpdatedAt: config.meshSharedSecretUpdatedAt,
                    peerServiceToken: config.peerServiceToken,
                    peerServiceTokenExpiresAt: config.peerServiceTokenExpiresAt,
                    upgradedAtVersion: config.upgradedAtVersion,
                    postSetupFlags: { ...flags, [input.hintId]: 'dismissed' },
                    updatedAt: new Date().toISOString(),
                })
                return { status: 201 as const, headers: {}, body: { ok: true } }
            })
    }

    // ─── Where the operator goes next ───────────────────────────────────────

    /**
     * The destination for the wizard's final "continue to dashboard" click.
     *
     * Answered by the API because it owns the one fact the client cannot see:
     * whether a dashboard is actually running. With the managed web app enabled
     * the destination is its hostname; without it, this API's own console page —
     * which is answerable and offers to enable one. The client no longer derives
     * this from its own hostname, which could only ever guess and produced a 404
     * on the last click of a successful "API only" setup.
     */
    @Implement(setupContract.getPostSetupDestination)
    getPostSetupDestination() {
        return procedure(setupContract.getPostSetupDestination)
            .use(publicAccess())
            .effect(function* () {
                const destination = yield* PostSetupDestinationService
                return yield* destination.resolve()
            })
    }

    /**
     * Do the API and the dashboard really answer through the cluster ingress?
     *
     * The wizard asks this (and dials the returned URLs from the browser) before
     * it lets the operator leave: the ingress is replaced at the end of setup and
     * the stream reporting "done" is not evidence that the new one routes.
     */
    @Implement(setupContract.getPostSetupVerification)
    getPostSetupVerification() {
        return procedure(setupContract.getPostSetupVerification)
            .use(publicAccess())
            .effect(function* () {
                const verification = yield* PostSetupVerificationService
                return yield* verification.verify()
            })
    }

    @Implement(setupContract.getPostSetupVerificationStream)
    getPostSetupVerificationStream() {
        return procedure(setupContract.getPostSetupVerificationStream)
            .use(publicAccess())
            .effect(function* ({ context }) {
                const verification = yield* PostSetupVerificationService
                // The ports are captured once; each tick re-enters the request boundary for the timer-driven probe.
                const ports =
                    yield* Effect.context<PostSetupVerificationPorts>()
                return liveSnapshot(
                    () =>
                        Effect.runPromise(
                            inBoundary(context, verification.verify()).pipe(
                                Effect.provide(ports)
                            )
                        ),
                    { intervalMs: POST_SETUP_VERIFICATION_STREAM_INTERVAL_MS }
                )
            })
    }
}
