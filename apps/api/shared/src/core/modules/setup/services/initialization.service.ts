import { lookup } from 'node:dns/promises'

import { Logger } from '@nestjs/common'
import { Context, Effect } from 'effect'
import { Pool } from 'pg'
import {
    ReplaySubject,
    firstValueFrom,
    interval,
    map,
    merge,
    type Observable,
} from 'rxjs'

import type {
    SetupInitializeInput,
    SetupStreamEvent,
    SetupStateSnapshot,
} from '@deployer/contracts-entities'
import { runPromiseUnwrapped } from '@deployer/effect-core'
import {
    classifyAddress,
    isIpLiteral,
    stripBrackets,
} from '@deployer/effect-infra'
import type { AppLifecycleShape } from '@deployer/lifecycle'
import type {
    EffectHostShape,
    ServiceLifecycleShape,
} from '@deployer/nest-effect'
import type {
    NodeConfigRepositoryShape,
    NodeConfigRow,
} from '@deployer/node-state'

import { DatabaseProbeRefused, SetupAlreadyComplete } from '../setup.errors'
import { SetupStepTracker } from '../utils/setup-runner.utils'

import type { LocalInitializationServiceShape } from './local-initialization.service'
import type { RemoteInitializationServiceShape } from './remote-initialization.service'
import type { SetupEventService } from './setup-event.service'
import type { EmitEvent } from '../utils/setup-runner.utils'

export type SetupCompletionStatus = {
    nodeId: string
    connectedAt: Date | null
    databaseUrl: string | null
    strategy: 'local' | 'remote'
}

/**
 * A node is COMPLETE once setup recorded a database URL AND a completion
 * timestamp — the same test `getSetupState` answers. (`setup_done` alone is not
 * enough: an interrupted write can leave the flag without a usable database,
 * and that node must be allowed to run setup again.)
 */
const isSetupComplete = (
    config: NodeConfigRow | null
): config is NodeConfigRow & { configuredAt: string } =>
    Boolean(config?.configuredAt && config.databaseUrl?.trim())

/** Hostnames that always mean "this machine" or the cloud metadata service, whatever they resolve to. */
const LOCAL_HOSTNAMES = new Set([
    'localhost',
    'metadata',
    'metadata.google.internal',
])

/**
 * Why a wizard-supplied PostgreSQL URL must not be dialled, or null when it may.
 *
 * The setup probe is PRE-AUTH, so it must not double as a port scanner
 * (SEC-012): only public addresses are reachable, plus the platform's OWN
 * database — which legitimately lives on a loopback/private address inside the
 * cluster. The egress `operatorTarget` policy makes the same call for HTTP
 * probes; PostgreSQL has no HTTP policy, so this is its equivalent.
 */
export const databaseProbeRefusal = (
    databaseUrl: string,
    platformDatabaseUrl: string | null
): string | null => {
    let url: URL
    try {
        url = new URL(databaseUrl)
    } catch {
        return `"${databaseUrl}" is not a valid database URL.`
    }
    if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
        return `The database URL must start with postgres:// or postgresql:// (got ${url.protocol}).`
    }
    if (
        platformDatabaseUrl !== null &&
        sameDatabaseServer(url, platformDatabaseUrl)
    )
        return null

    const host = stripBrackets(url.hostname).toLowerCase()
    if (host === '') return 'The database URL has no host.'
    if (LOCAL_HOSTNAMES.has(host) || host.endsWith('.localhost')) {
        return `"${host}" is this machine or the cloud metadata service — the setup probe refuses those. Use the database's reachable address.`
    }
    if (!isIpLiteral(host)) return null
    const klass = classifyAddress(host)
    return klass === 'public'
        ? null
        : `${host} is a ${klass} address — the setup probe only reaches public database addresses, or this platform's own database.`
}

const sameDatabaseServer = (url: URL, platformDatabaseUrl: string): boolean => {
    try {
        return serverKey(url) === serverKey(new URL(platformDatabaseUrl))
    } catch {
        return false
    }
}

const serverKey = (url: URL): string =>
    `${stripBrackets(url.hostname).toLowerCase()}:${url.port || '5432'}`

type NodeConfigReadFailure = Effect.Error<
    ReturnType<NodeConfigRepositoryShape['find']>
>

export type InitializationServiceShape = ServiceLifecycleShape & {
    /** Checks the node config at boot and, when the node is configured, unblocks everything waiting on setup. Never fails. */
    readonly checkConfigAndEmit: () => Effect.Effect<void>
    readonly getSetupState: () => Effect.Effect<
        SetupStateSnapshot,
        NodeConfigReadFailure
    >
    readonly getNodeStatus: () => Effect.Effect<
        | {
              isConfigured: true
              nodeId: string
              strategy: 'local' | 'remote'
              meshUrlsSnapshot: string[]
              configuredAt: Date
          }
        | {
              isConfigured: false
              nodeId: null
              strategy: null
              meshUrlsSnapshot: string[]
              configuredAt: null
          },
        NodeConfigReadFailure
    >
    /**
     * Refuse a setup MUTATION once this node is configured (SEC-012 / SETUP-002). `/setup/*` is anonymous by design because
     * the wizard runs before any account exists; after completion nothing on it has a reason to run. One implementation,
     * called by every mutating handler.
     */
    readonly assertSetupMutable: () => Effect.Effect<
        void,
        NodeConfigReadFailure | SetupAlreadyComplete
    >
    /**
     * Refuse a database probe the SSRF policy forbids (SEC-012). A hostname is not an address but it becomes one, so the
     * name the operator typed is resolved too.
     */
    readonly assertDatabaseProbeAllowed: (
        databaseUrl: string
    ) => Effect.Effect<void, NodeConfigReadFailure | DatabaseProbeRefused>
    /**
     * Start the initialization in the background and answer at once; live progress comes from `getInitializeStream`. If a
     * run is already going, `{ accepted: false }`. `delivered` is always true here (this is the API's OWN service); it keeps
     * the response shape identical to the SETUP app's proxy, where the trigger can be accepted before the API is reachable.
     */
    readonly triggerInitialize: (
        input: SetupInitializeInput
    ) => Effect.Effect<{ accepted: boolean; delivered: boolean }>
    /**
     * The progress stream, with replay of recent events and a heartbeat merged in (so a quiet window is distinguishable
     * from a dead socket). Safe to call before `triggerInitialize`. A streaming surface: RxJS stays the contract.
     */
    readonly getInitializeStream: () => Observable<SetupStreamEvent>
    /** Resolves once setup completed (immediately for a node that already is). */
    readonly waitForSetup: () => Effect.Effect<SetupCompletionStatus>
}

type Ports = {
    readonly nodeConfigRepository: NodeConfigRepositoryShape
    readonly localInitializationService: LocalInitializationServiceShape
    readonly remoteInitializationService: RemoteInitializationServiceShape
    readonly setupEventService: Pick<
        SetupEventService,
        'emit' | 'observeProgress$'
    >
    /**
     * Advanced to READY when setup completes — see `emitCompleted`. Injected rather than signalled through an event: the
     * lifecycle is what readiness READS, so setting it at the moment the platform actually becomes usable keeps the fact
     * and the report in one place.
     */
    readonly lifecycle: Pick<
        AppLifecycleShape,
        'markDatabaseProbeNow' | 'markMeshConnectedNow' | 'markReadyNow'
    >
    /**
     * The app runtime, for the flows that YIELD their collaborators. `runPromiseUnwrapped` runs on a
     * throwaway context, so it cannot supply the ports — the app runtime's own context is the one
     * place that holds what the module registered.
     */
    readonly host: EffectHostShape
}

/** How often to prove the socket is alive while provisioning is quiet. */
const HEARTBEAT_INTERVAL_MS = 3_000
const HAS_USERS_PROBE_TIMEOUT_MS = 1_500
const HAS_USERS_CACHE_TTL_MS = 30_000

export function makeInitializationService(
    ports: Ports
): InitializationServiceShape {
    const {
        nodeConfigRepository,
        localInitializationService,
        remoteInitializationService,
        setupEventService,
        lifecycle,
        host,
    } = ports
    const logger = new Logger('InitializationService')
    const completedSubject = new ReplaySubject<SetupCompletionStatus>(1)

    /** Track whether an initialization is currently running. */
    let initializationPromise: Promise<void> | null = null

    /**
     * Cached knowledge of whether the global DB actually contains users.
     *
     * hasUsers in the snapshot is NOT derived from the config row (that was a hardcoded guess). It is refreshed by a cheap,
     * cached background probe of the "user" table whenever the node is configured, and set to true the moment a setup
     * completes (local seeding or remote join). Between boot and the probe landing the value stays optimistically true for
     * a configured node (the common case) — never a false negative that would block sign-in.
     */
    let usersPresence: { known: boolean; checkedAt: number } | null = null
    let usersProbePromise: Promise<void> | null = null

    const readConfig = nodeConfigRepository.find

    const NOT_STARTED: SetupStateSnapshot = {
        state: 'not_started',
        needsSetup: true,
        hasUsers: false,
        bootstrapStrategy: null,
        availableStrategies: ['local', 'remote'],
        currentStep: 'choose_strategy',
        progressPercent: 0,
        steps: [
            {
                id: 'choose_strategy',
                title: 'Choose bootstrap strategy',
                status: 'pending',
            },
            {
                id: 'configure_account',
                title: 'Configure account',
                status: 'pending',
            },
        ],
        completedAt: null,
    }

    const getSetupState = (): Effect.Effect<
        SetupStateSnapshot,
        NodeConfigReadFailure
    > =>
        readConfig().pipe(
            Effect.map((config): SetupStateSnapshot => {
                // configuredAt without a database URL (or no config) → needs setup.
                if (!isSetupComplete(config)) return NOT_STARTED
                return {
                    state: 'completed',
                    needsSetup: false,
                    // Truthful — see usersPresence. Optimistically true until the background probe resolves; never a false negative.
                    hasUsers: usersPresence?.known ?? true,
                    bootstrapStrategy: config.strategy,
                    availableStrategies: ['local', 'remote'],
                    currentStep: null,
                    progressPercent: 100,
                    steps: [],
                    completedAt: new Date(config.configuredAt),
                }
            })
        )

    const getNodeStatus: InitializationServiceShape['getNodeStatus'] = () =>
        readConfig().pipe(
            Effect.map((config) =>
                isSetupComplete(config)
                    ? {
                          isConfigured: true as const,
                          nodeId: config.nodeId,
                          strategy: config.strategy,
                          meshUrlsSnapshot: config.meshUrlsSnapshot ?? [],
                          configuredAt: new Date(config.configuredAt),
                      }
                    : {
                          isConfigured: false as const,
                          nodeId: null,
                          strategy: null,
                          meshUrlsSnapshot: config?.meshUrlsSnapshot ?? [],
                          configuredAt: null,
                      }
            )
        )

    const assertSetupMutable: InitializationServiceShape['assertSetupMutable'] =
        () =>
            readConfig().pipe(
                Effect.flatMap((config) =>
                    isSetupComplete(config)
                        ? Effect.fail(new SetupAlreadyComplete({}))
                        : Effect.void
                )
            )

    const assertDatabaseProbeAllowed: InitializationServiceShape['assertDatabaseProbeAllowed'] =
        (databaseUrl) =>
            Effect.gen(function* () {
                const config = yield* readConfig()
                const stored = config?.databaseUrl?.trim()
                // An empty stored URL is not a URL: `||` was doing that job, spelled out here so the types stay honest.
                const refusal = databaseProbeRefusal(
                    databaseUrl,
                    stored === undefined || stored === '' ? null : stored
                )
                if (refusal !== null)
                    return yield* new DatabaseProbeRefused({ reason: refusal })

                const host = stripBrackets(new URL(databaseUrl).hostname)
                if (isIpLiteral(host)) return
                // A lookup failure is not a refusal: the pool will report the same name-resolution error with a message the
                // operator can act on.
                const answers = yield* Effect.promise(() =>
                    lookup(host, { all: true, verbatim: true }).catch(() => [])
                )
                if (
                    answers.some(
                        (answer) => classifyAddress(answer.address) !== 'public'
                    )
                ) {
                    return yield* new DatabaseProbeRefused({
                        reason: `"${host}" resolves to a private address, which the setup probe does not reach. Use the database's public address.`,
                    })
                }
            })

    // ─── Lifecycle ────────────────────────────────────────────────────────────

    /**
     * Check the SQLite node config and emit completion if the node is configured.
     *
     * This is called from two places:
     * 1. The GLOBAL_DATABASE_POOL factory in GlobalModule (during construction)
     * 2. onModuleInit() (during NestJS lifecycle)
     *
     * "Configured" REQUIRES a real database URL. A row with `configuredAt` but
     * an empty `databaseUrl` is a stale/partial write (e.g. an interrupted
     * provisioning attempt) and must NOT unblock dependent modules — the
     * global database is mandatory. Such rows are treated as needing setup so
     * the wizard can re-provision from scratch.
     */
    async function checkConfigAndEmit(): Promise<void> {
        try {
            const config = await runPromiseUnwrapped(
                nodeConfigRepository.find()
            )
            const storedUrl = config?.databaseUrl?.trim() ?? ''
            if (config?.configuredAt && storedUrl.length > 0) {
                logger.log(
                    '✅ Node already configured — unblocking dependent modules'
                )
                emitCompleted({
                    nodeId: config.nodeId,
                    connectedAt: new Date(config.configuredAt),
                    databaseUrl: storedUrl,
                    strategy: config.strategy,
                })
                // Refresh the real user-presence answer in the background so
                // hasUsers on /setup/state is truthful shortly after boot.
                void refreshUserPresence(storedUrl).catch(() => undefined)
            } else if (config?.configuredAt) {
                logger.warn(
                    '⚠️ Node config has configuredAt but NO database URL — treating as unconfigured (global DB is mandatory)'
                )
            } else {
                logger.log('⏳ No config found — setup wizard required')
            }
        } catch (err: unknown) {
            logger.error('Failed to read node config:', err)
        }
    }

    // ─── Public API ───────────────────────────────────────────────────────────

    // ─── Post-setup refusal (SEC-012 / SETUP-002) ─────────────────────────────

    // ─── Trigger + Stream ─────────────────────────────────────────────────────

    /**
     * Start the initialization process in the background.
     *
     * Returns immediately. Live progress can be consumed via
     * `getInitializeStream()`.
     *
     * If an initialization is already running, returns `{ accepted: false }`.
     *
     * `delivered` is always true here: this is the API's OWN service, so the
     * trigger is by definition already in the process that provisions. It exists
     * to keep the response shape identical to the SETUP app's proxy, where the
     * trigger can be accepted while the API is not yet reachable (the handover
     * delivers it later) — one contract, two implementers.
     */
    function triggerInitialize(input: SetupInitializeInput): {
        accepted: boolean
        delivered: boolean
    } {
        if (initializationPromise) {
            logger.warn(
                'triggerInitialize called but initialization already in progress'
            )
            return { accepted: false, delivered: true }
        }

        logger.log(`🚀 Starting initialization (strategy=${input.strategy})`)

        // One tracker per run — owns the canonical step state. The
        // event service handles the actual emission (buffering,
        // persistence, Subjects).
        const tracker = new SetupStepTracker()
        const emit: EmitEvent = (event) => {
            setupEventService.emit('progress', {}, event)
        }

        initializationPromise = runInitialize(input, tracker, emit)
            .catch((err: unknown) => {
                const message = err instanceof Error ? err.message : String(err)
                logger.error(`❌ Initialization failed: ${message}`)
                emit(tracker.abortEvent(message))
            })
            .finally(() => {
                initializationPromise = null
            })

        return { accepted: true, delivered: true }
    }

    /**
     * Subscribe to the initialization event stream.
     * Returns an Observable backed by the core event service's progress channel.
     * Safe to call before `triggerInitialize()` — the event service buffers events
     * and replays them to late subscribers.
     *
     * ── WHY A HEARTBEAT IS MERGED IN ──────────────────────────────────────────
     * Provisioning WAITS on slow work and emits nothing while it does: a swarm
     * service being scheduled, migrations running, a database accepting its first
     * connection. SSE carries no heartbeat of its own, so during those windows
     * the socket delivers no bytes at all — indistinguishable from a DEAD
     * connection.
     *
     * That ambiguity forced the client to choose between two bad options: a long
     * timeout (a dropped connection takes minutes to notice) or a short one
     * (healthy runs get aborted mid-step). A periodic ping removes the ambiguity,
     * so a SHORT client timeout becomes correct and a real drop is retried in
     * seconds.
     *
     * `merge` rather than appending to the event service's own buffer: a
     * heartbeat carries no state, and recording one every few seconds would evict
     * real events from the replay buffer that a reconnecting client depends on.
     */
    function getInitializeStream(): Observable<SetupStreamEvent> {
        return merge(
            setupEventService.observeProgress$(),
            interval(HEARTBEAT_INTERVAL_MS).pipe(
                map(() => ({
                    type: 'heartbeat' as const,
                    seq: 0,
                    ts: new Date().toISOString(),
                }))
            )
        )
    }

    /**
     * Internal — runs the initialization process, driving a fresh
     * {@link SetupStepTracker} for the run.
     *
     * 1. Emits `step_detail` events for every step in the strategy's
     *    flow definition, so the UI can render placeholders immediately.
     * 2. Dispatches to the local or remote execution path.
     * 3. Emits the terminal `completed` event.
     *
     * Step `step_detail` events are emitted automatically by `runStep()`
     * inside each service, so the UI learns about every step dynamically —
     * no hardcoded templates or config-based flow files needed.
     */
    async function runInitialize(
        input: SetupInitializeInput,
        tracker: SetupStepTracker,
        emit: EmitEvent
    ): Promise<void> {
        const finish =
            input.strategy === 'remote'
                ? await runRemoteFlow(input, tracker, emit)
                : await runLocalFlow(input, tracker, emit)

        // Always emit the terminal completed event.
        emit(
            tracker.finishEvent({
                nodeId: finish.nodeId,
                strategy: input.strategy,
                databaseUrl: finish.databaseUrl,
            })
        )

        const config = await runPromiseUnwrapped(nodeConfigRepository.find())
        if (config) {
            emitCompleted({
                nodeId: config.nodeId,
                connectedAt: config.configuredAt
                    ? new Date(config.configuredAt)
                    : null,
                databaseUrl: config.databaseUrl,
                strategy: input.strategy,
            })
        }
    }

    async function runRemoteFlow(
        input: Extract<SetupInitializeInput, { strategy: 'remote' }>,
        tracker: SetupStepTracker,
        emit: EmitEvent
    ): Promise<{ nodeId: string; databaseUrl: string }> {
        // The remote flow YIELDS its ports, so it needs the app runtime's context — the same
        // reason the local flow does.
        return await host.runUnwrapped(
            remoteInitializationService.initialize(input, tracker, emit)
        )
    }

    async function runLocalFlow(
        input: Extract<SetupInitializeInput, { strategy: 'local' }>,
        tracker: SetupStepTracker,
        emit: EmitEvent
    ): Promise<{ nodeId: string; databaseUrl: string }> {
        return await host.runUnwrapped(
            localInitializationService.initialize(input, tracker, emit)
        )
    }

    function waitForSetup(): Promise<SetupCompletionStatus> {
        return firstValueFrom(completedSubject.asObservable())
    }

    // ─── Helpers ──────────────────────────────────────────────────────────────

    /**
     * Refresh the cached user-presence answer for a configured node.
     * Cheap (SELECT EXISTS … LIMIT 1), cached for HAS_USERS_CACHE_TTL_MS,
     * never throws. On probe failure the previous answer is kept (unknown).
     */
    async function refreshUserPresence(databaseUrl: string): Promise<void> {
        const now = Date.now()
        if (
            usersPresence &&
            now - usersPresence.checkedAt < HAS_USERS_CACHE_TTL_MS
        ) {
            return
        }
        if (usersProbePromise) {
            await usersProbePromise
            return
        }
        usersProbePromise = (async () => {
            const found = await probeUsersExist(databaseUrl)
            if (found !== null) {
                usersPresence = { known: found, checkedAt: Date.now() }
            }
        })().finally(() => {
            usersProbePromise = null
        })
        await usersProbePromise
    }

    /**
     * SELECT EXISTS … on the "user" table. Returns true/false when the DB
     * answers, null when the DB is unreachable (keep the previous answer).
     */
    async function probeUsersExist(
        databaseUrl: string
    ): Promise<boolean | null> {
        const pool = new Pool({
            connectionString: databaseUrl,
            max: 1,
            connectionTimeoutMillis: HAS_USERS_PROBE_TIMEOUT_MS,
        })
        try {
            const res = await pool.query<{ exists: boolean }>(
                'SELECT EXISTS (SELECT 1 FROM "user" LIMIT 1) AS exists'
            )
            return Boolean(res.rows[0]?.exists)
        } catch {
            return null
        } finally {
            await pool.end().catch(() => undefined)
        }
    }

    function emitCompleted(status: SetupCompletionStatus): void {
        // A completed setup always seeded/joined a DB that has the admin user.
        usersPresence = { known: true, checkedAt: Date.now() }
        logger.log(
            `🚀 Setup complete — strategy=${status.strategy} nodeId=${status.nodeId}`
        )

        // ── ADVANCE THE LIFECYCLE: THIS IS WHAT LETS READINESS GO GREEN ────────
        // `BootstrapOrchestratorService.onApplicationBootstrap` runs BEFORE the
        // wizard finishes, so on a FIRST install it sees
        // `setupState !== "setup_done"`, logs "the boot pipeline will run on the
        // next start" and returns early. Nothing re-ran it, so the phase stayed
        // `initialized` forever and TWO readiness indicators failed permanently:
        //
        //   swarm    (setup is not complete — lifecycle phase is initialized)
        //   database (no database configured yet)
        //
        // `/health/ready` therefore never returned 200, setup's handover timed
        // out after 300s, and the platform never converged on a first install —
        // which is exactly why a RESTART appeared to fix it (the second boot
        // finds `setup_done` and runs the full pipeline).
        //
        // Publishing both facts here also covers the RESTART path, where setup
        // is already complete and `emitCompleted` is what runs first.
        lifecycle.markDatabaseProbeNow(
            status.databaseUrl ?? '',
            status.databaseUrl !== null
        )
        // The mesh is SETTLED once onboarding is done, even with no peers: a
        // single-node cluster is legitimately "connected" (see the `mesh`
        // indicator). This is the writer that was lost when the old
        // orchestrator was deleted — without it `meshConnected` stayed null and
        // the indicator reported `down` forever.
        lifecycle.markMeshConnectedNow(true)
        lifecycle.markReadyNow()

        completedSubject.next(status)
        completedSubject.complete()
    }

    return {
        onModuleInit: () => Effect.promise(() => checkConfigAndEmit()),
        checkConfigAndEmit: () => Effect.promise(() => checkConfigAndEmit()),
        getSetupState,
        getNodeStatus,
        assertSetupMutable,
        assertDatabaseProbeAllowed,
        triggerInitialize: (input) =>
            Effect.sync(() => triggerInitialize(input)),
        getInitializeStream: () => getInitializeStream(),
        waitForSetup: () => Effect.promise(() => waitForSetup()),
    }
}

export class InitializationService extends Context.Service<
    InitializationService,
    InitializationServiceShape
>()('shared/InitializationService') {}
