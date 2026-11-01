import { runPromiseUnwrapped } from "@deployer/effect-core";
import { Injectable, Logger, type OnModuleInit, Inject } from '@nestjs/common'
import { classifyAddress, isIpLiteral, stripBrackets } from "@deployer/effect-infra"
import { standardErrorActions } from "@deployer/orpc-utils"
import { lookup } from "node:dns/promises"
import { Pool } from 'pg'
import { ReplaySubject, firstValueFrom, interval, map, merge, Observable } from 'rxjs'
import type {
    SetupInitializeInput,
    SetupStreamEvent,
    SetupStateSnapshot,
} from '@deployer/contracts-entities'
import { NodeConfigRepository, type NodeConfigRepositoryShape, type NodeConfigRow } from "@deployer/node-state"
import { LocalInitializationService } from './local-initialization.service'
import { RemoteInitializationService } from './remote-initialization.service'
import { SetupEventService } from './setup-event.service'
import { SetupStepTracker } from '../utils/setup-runner.utils'
import type { EmitEvent } from '../utils/setup-runner.utils'
import { AppLifecycle, type AppLifecycleShape } from "@deployer/lifecycle";


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
    config: NodeConfigRow | null,
): config is NodeConfigRow & { configuredAt: string } =>
    Boolean(config?.configuredAt && config.databaseUrl?.trim())

/** Hostnames that always mean "this machine" or the cloud metadata service, whatever they resolve to. */
const LOCAL_HOSTNAMES = new Set(["localhost", "metadata", "metadata.google.internal"])

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
    platformDatabaseUrl: string | null,
): string | null => {
    let url: URL
    try {
        url = new URL(databaseUrl)
    } catch {
        return `"${databaseUrl}" is not a valid database URL.`
    }
    if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
        return `The database URL must start with postgres:// or postgresql:// (got ${url.protocol}).`
    }
    if (platformDatabaseUrl !== null && sameDatabaseServer(url, platformDatabaseUrl)) return null

    const host = stripBrackets(url.hostname).toLowerCase()
    if (host === "") return "The database URL has no host."
    if (LOCAL_HOSTNAMES.has(host) || host.endsWith(".localhost")) {
        return `"${host}" is this machine or the cloud metadata service — the setup probe refuses those. Use the database's reachable address.`
    }
    if (!isIpLiteral(host)) return null
    const klass = classifyAddress(host)
    return klass === "public"
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
    `${stripBrackets(url.hostname).toLowerCase()}:${url.port || "5432"}`

@Injectable()
export class InitializationService implements OnModuleInit {
    private readonly logger = new Logger(InitializationService.name)
    private readonly completedSubject = new ReplaySubject<SetupCompletionStatus>(1)

    /** Track whether an initialization is currently running. */
    private initializationPromise: Promise<void> | null = null

    /**
     * Cached knowledge of whether the global DB actually contains users.
     *
     * hasUsers in the snapshot is NOT derived from the config row (that was a
     * hardcoded guess). It is refreshed by a cheap, cached background probe of
     * the "user" table whenever the node is configured, and set to true the
     * moment a setup completes (local seeding or remote join). Between boot and
     * the probe landing the value stays optimistically true for a configured
     * node (the common case) — never a false negative that would block sign-in.
     */
    private usersPresence: { known: boolean; checkedAt: number } | null = null
    private usersProbePromise: Promise<void> | null = null
    private readonly HAS_USERS_PROBE_TIMEOUT_MS = 1_500
    private readonly HAS_USERS_CACHE_TTL_MS = 30_000

    constructor(
        @Inject(NodeConfigRepository) private readonly nodeConfigRepository: NodeConfigRepositoryShape,
        private readonly localInitializationService: LocalInitializationService,
        private readonly remoteInitializationService: RemoteInitializationService,
        private readonly setupEventService: SetupEventService,
        /**
         * Advanced to READY when setup completes — see `emitCompleted`.
         *
         * Injected rather than signalled through an event: the lifecycle is what
         * readiness READS, so setting it at the moment the platform actually
         * becomes usable keeps the fact and the report in one place.
         */
        @Inject(AppLifecycle) private readonly lifecycle: AppLifecycleShape,
    ) {}

    // ─── Lifecycle ────────────────────────────────────────────────────────────

    async onModuleInit(): Promise<void> {
        this.logger.log(
            '🔍 InitializationService: checking existing node config…'
        )
        // Perform the eager setup check that may have been skipped by
        // the pool factory (run during construction, before onModuleInit).
        await this.checkConfigAndEmit()
    }

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
    async checkConfigAndEmit(): Promise<void> {
        try {
            const config = await runPromiseUnwrapped(this.nodeConfigRepository.find())
            const storedUrl = config?.databaseUrl?.trim() ?? ''
            if (config?.configuredAt && storedUrl.length > 0) {
                this.logger.log(
                    '✅ Node already configured — unblocking dependent modules'
                )
                this.emitCompleted({
                    nodeId: config.nodeId,
                    connectedAt: new Date(config.configuredAt),
                    databaseUrl: storedUrl,
                    strategy: config.strategy,
                })
                // Refresh the real user-presence answer in the background so
                // hasUsers on /setup/state is truthful shortly after boot.
                void this.refreshUserPresence(storedUrl).catch(() => undefined)
            } else if (config?.configuredAt) {
                this.logger.warn(
                    '⚠️ Node config has configuredAt but NO database URL — treating as unconfigured (global DB is mandatory)'
                )
            } else {
                this.logger.log('⏳ No config found — setup wizard required')
            }
        } catch (err: unknown) {
            this.logger.error('Failed to read node config:', err)
        }
    }

    // ─── Public API ───────────────────────────────────────────────────────────

    async getSetupState(): Promise<SetupStateSnapshot> {
        const config = await runPromiseUnwrapped(this.nodeConfigRepository.find())

        if (!config) {
            return {
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
        }

        if (isSetupComplete(config)) {
            return {
                state: 'completed',
                needsSetup: false,
                // Truthful — see usersPresence. Optimistically true until the
                // background probe resolves; never a false negative.
                hasUsers: this.usersPresence?.known ?? true,
                bootstrapStrategy: config.strategy,
                availableStrategies: ['local', 'remote'],
                currentStep: null,
                progressPercent: 100,
                steps: [],
                completedAt: new Date(config.configuredAt),
            }
        }

        // configuredAt without a database URL (or no config) → needs setup.
        return {
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
    }

    async getNodeStatus() {
        const config = await runPromiseUnwrapped(this.nodeConfigRepository.find())
        if (isSetupComplete(config)) {
            return {
                isConfigured: true,
                nodeId: config.nodeId,
                strategy: config.strategy,
                meshUrlsSnapshot: config.meshUrlsSnapshot ?? [],
                configuredAt: new Date(config.configuredAt),
            }
        }
        return {
            isConfigured: false,
            nodeId: null,
            strategy: null,
            meshUrlsSnapshot: config?.meshUrlsSnapshot ?? [],
            configuredAt: null,
        }
    }

    // ─── Post-setup refusal (SEC-012 / SETUP-002) ─────────────────────────────

    /**
     * Refuse a setup MUTATION once this node is configured.
     *
     * `/setup/*` is anonymous by design because the wizard runs before any
     * account exists, and it must stay reachable DURING onboarding. After
     * completion nothing on it has a reason to run: a second trigger would
     * provision another database, the probe would be an unauthenticated port
     * scanner, and dismissing a hint writes operator state. Read-only
     * procedures (state, node status, destination, verification) stay open —
     * the wizard reads them on its last step.
     *
     * One implementation, called by every mutating handler: the rule lives here,
     * not in the controllers.
     */
    async assertSetupMutable(): Promise<void> {
        const config = await runPromiseUnwrapped(this.nodeConfigRepository.find())
        if (isSetupComplete(config)) {
            throw standardErrorActions.CONFLICT(
                "Setup is already complete on this node, so setup procedures are closed. Use the dashboard, or reset the node from the host to run setup again.",
            )
        }
    }

    /**
     * Refuse a database probe the SSRF policy forbids (SEC-012).
     *
     * A hostname is not an address but it becomes one, so the name the operator
     * typed is resolved too: a public-looking name pointing at `127.0.0.1` is
     * the same scanner as typing the loopback literal.
     */
    async assertDatabaseProbeAllowed(databaseUrl: string): Promise<void> {
        const config = await runPromiseUnwrapped(this.nodeConfigRepository.find())
        const refusal = databaseProbeRefusal(databaseUrl, config?.databaseUrl?.trim() || null)
        if (refusal !== null) throw standardErrorActions.BAD_REQUEST(refusal)

        const host = stripBrackets(new URL(databaseUrl).hostname)
        if (isIpLiteral(host)) return
        // A lookup failure is not a refusal: the pool will report the same
        // name-resolution error with a message the operator can act on.
        const answers = await lookup(host, { all: true, verbatim: true }).catch(() => [])
        if (answers.some((answer) => classifyAddress(answer.address) !== "public")) {
            throw standardErrorActions.BAD_REQUEST(
                `"${host}" resolves to a private address, which the setup probe does not reach. Use the database's public address.`,
            )
        }
    }

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
    triggerInitialize(input: SetupInitializeInput): { accepted: boolean; delivered: boolean } {
        if (this.initializationPromise) {
            this.logger.warn('triggerInitialize called but initialization already in progress')
            return { accepted: false, delivered: true }
        }

        this.logger.log(`🚀 Starting initialization (strategy=${input.strategy})`)

        // One tracker per run — owns the canonical step state. The
        // event service handles the actual emission (buffering,
        // persistence, Subjects).
        const tracker = new SetupStepTracker()
        const emit: EmitEvent = (event) => {
            this.setupEventService.emit('progress', {}, event)
        }

        this.initializationPromise = this.runInitialize(input, tracker, emit)
            .catch((err: unknown) => {
                const message = err instanceof Error ? err.message : String(err)
                this.logger.error(`❌ Initialization failed: ${message}`)
                emit(tracker.abortEvent(message))
            })
            .finally(() => {
                this.initializationPromise = null
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
    getInitializeStream(): Observable<SetupStreamEvent> {
        return merge(
            this.setupEventService.observeProgress$(),
            interval(InitializationService.HEARTBEAT_INTERVAL_MS).pipe(
                map(() => ({
                    type: "heartbeat" as const,
                    seq: 0,
                    ts: new Date().toISOString(),
                })),
            ),
        )
    }

    /** How often to prove the socket is alive while provisioning is quiet. */
    private static readonly HEARTBEAT_INTERVAL_MS = 3_000;

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
    private async runInitialize(
        input: SetupInitializeInput,
        tracker: SetupStepTracker,
        emit: EmitEvent,
    ): Promise<void> {
        const finish = input.strategy === 'remote'
            ? await this.runRemoteFlow(input, tracker, emit)
            : await this.runLocalFlow(input, tracker, emit)

        // Always emit the terminal completed event.
        emit(tracker.finishEvent({
            nodeId: finish.nodeId,
            strategy: input.strategy,
            databaseUrl: finish.databaseUrl,
        }))

        const config = await runPromiseUnwrapped(this.nodeConfigRepository.find())
        if (config) {
            this.emitCompleted({
                nodeId: config.nodeId,
                connectedAt: config.configuredAt ? new Date(config.configuredAt) : null,
                databaseUrl: config.databaseUrl,
                strategy: input.strategy,
            })
        }
    }

    private async runRemoteFlow(
        input: Extract<SetupInitializeInput, { strategy: 'remote' }>,
        tracker: SetupStepTracker,
        emit: EmitEvent,
    ): Promise<{ nodeId: string; databaseUrl: string }> {
        return await this.remoteInitializationService.initialize(
            input,
            tracker,
            emit,
        )
    }

    private async runLocalFlow(
        input: Extract<SetupInitializeInput, { strategy: 'local' }>,
        tracker: SetupStepTracker,
        emit: EmitEvent,
    ): Promise<{ nodeId: string; databaseUrl: string }> {
        return await this.localInitializationService.initialize(
            input,
            tracker,
            emit,
        )
    }

    waitForSetup(): Promise<SetupCompletionStatus> {
        return firstValueFrom(this.completedSubject.asObservable())
    }

    // ─── Helpers ──────────────────────────────────────────────────────────────

    /**
     * Refresh the cached user-presence answer for a configured node.
     * Cheap (SELECT EXISTS … LIMIT 1), cached for HAS_USERS_CACHE_TTL_MS,
     * never throws. On probe failure the previous answer is kept (unknown).
     */
    private async refreshUserPresence(databaseUrl: string): Promise<void> {
        const now = Date.now()
        if (
            this.usersPresence &&
            now - this.usersPresence.checkedAt < this.HAS_USERS_CACHE_TTL_MS
        ) {
            return
        }
        if (this.usersProbePromise) {
            await this.usersProbePromise
            return
        }
        this.usersProbePromise = (async () => {
            const found = await this.probeUsersExist(databaseUrl)
            if (found !== null) {
                this.usersPresence = { known: found, checkedAt: Date.now() }
            }
        })().finally(() => {
            this.usersProbePromise = null
        })
        await this.usersProbePromise
    }

    /**
     * SELECT EXISTS … on the "user" table. Returns true/false when the DB
     * answers, null when the DB is unreachable (keep the previous answer).
     */
    private async probeUsersExist(databaseUrl: string): Promise<boolean | null> {
        const pool = new Pool({
            connectionString: databaseUrl,
            max: 1,
            connectionTimeoutMillis: this.HAS_USERS_PROBE_TIMEOUT_MS,
        })
        try {
            const res = await pool.query<{ exists: boolean }>(
                'SELECT EXISTS (SELECT 1 FROM "user" LIMIT 1) AS exists',
            )
            return Boolean(res.rows[0]?.exists)
        } catch {
            return null
        } finally {
            await pool.end().catch(() => undefined)
        }
    }

    private emitCompleted(status: SetupCompletionStatus): void {
        // A completed setup always seeded/joined a DB that has the admin user.
        this.usersPresence = { known: true, checkedAt: Date.now() }
        this.logger.log(
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
        this.lifecycle.markDatabaseProbeNow(status.databaseUrl ?? "", status.databaseUrl !== null)
        // The mesh is SETTLED once onboarding is done, even with no peers: a
        // single-node cluster is legitimately "connected" (see the `mesh`
        // indicator). This is the writer that was lost when the old
        // orchestrator was deleted — without it `meshConnected` stayed null and
        // the indicator reported `down` forever.
        this.lifecycle.markMeshConnectedNow(true)
        this.lifecycle.markReadyNow()

        this.completedSubject.next(status)
        this.completedSubject.complete()
    }
}
