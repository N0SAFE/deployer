import { randomUUID } from 'node:crypto'
import { Injectable, Logger, type OnModuleInit } from '@nestjs/common'
import { ReplaySubject, firstValueFrom, Observable } from 'rxjs'
import type {
    SetupInitializeInput,
    SetupStreamEvent,
    SetupStateSnapshot,
} from '@repo/contracts-entities'
import { EnvService } from '@/config/env/env.service'
import { NodeConfigRepository } from '../repositories/node-config.repository'
import { LocalInitializationService } from './local-initialization.service'
import { RemoteInitializationService } from './remote-initialization.service'
import { SetupEventService } from './setup-event.service'
import { SetupStepTracker } from '../utils/setup-runner.utils'
import type { EmitEvent } from '../utils/setup-runner.utils'
import { runStep } from '../utils/setup-runner.utils'
import { ReachabilityService } from '../../reachability/services/reachability.service'
import { MeshInitializationService } from '../../mesh/initialization/services/mesh-initialization.service'
import { DEPLOYER_VERSION } from '@/core/utils/deployer-version'


export interface SetupCompletionStatus {
    nodeId: string
    connectedAt: Date | null
    databaseUrl: string | null
    strategy: 'local' | 'remote'
}

@Injectable()
export class InitializationService implements OnModuleInit {
    private readonly logger = new Logger(InitializationService.name)
    private readonly completedSubject = new ReplaySubject<SetupCompletionStatus>(1)

    /** Track whether an initialization is currently running. */
    private initializationPromise: Promise<void> | null = null

    constructor(
        private readonly nodeConfigRepository: NodeConfigRepository,
        private readonly localInitializationService: LocalInitializationService,
        private readonly remoteInitializationService: RemoteInitializationService,
        private readonly setupEventService: SetupEventService,
        private readonly meshInitializationService: MeshInitializationService,
        private readonly reachabilityService: ReachabilityService,
        private readonly envService: EnvService,
    ) {}

    // ─── Lifecycle ────────────────────────────────────────────────────────────

    async onModuleInit(): Promise<void> {
        this.logger.log(
            '🔍 InitializationService: checking existing node config…'
        )
        // Perform the eager setup check that may have been skipped by
        // the pool factory (run during construction, before onModuleInit).
        this.checkConfigAndEmit()

        // Remote strategy: attempt mesh reconnection after the config check.
        // This is an async operation that only applies on the full lifecycle.
        // The peer service token persisted at bootstrap time is forwarded so
        // the reconnection can hit authenticated peer endpoints without
        // re-enrolling. If the token is missing (e.g. legacy config from
        // before the column existed), we fall back to a no-token connect
        // which only exposes the public ping endpoint.
        const config = this.nodeConfigRepository.find()
        if (config?.configuredAt && config.strategy === 'remote' && config.meshUrlsSnapshot?.length) {
            const persistedToken = config.peerServiceToken?.trim() ?? ""
            for (const url of config.meshUrlsSnapshot) {
                try {
                    await this.meshInitializationService.connectToMesh(url, {
                        peerServiceToken: persistedToken.length > 0 ? persistedToken : undefined,
                    })
                    this.logger.log(`✅ Reconnected to mesh at ${url}`)
                    break
                } catch (err: unknown) {
                    const message = err instanceof Error ? err.message : String(err)
                    this.logger.warn(`Failed to connect to mesh URL ${url}: ${message}`)
                }
            }
        }
    }

    /**
     * Eagerly check the SQLite node config and emit completion if possible.
     *
     * This is called from two places:
     * 1. The GLOBAL_DATABASE_POOL factory in GlobalModule (during construction)
     * 2. onModuleInit() (during NestJS lifecycle)
     *
     * Calling it from the pool factory breaks a deadlock: the factory awaits
     * waitForSetup() which blocks NestJS from ever reaching onModuleInit().
     * By checking config here first, we ensure completion is emitted before
     * the factory ever starts waiting.
     */
    checkConfigAndEmit(): void {
        try {
            const config = this.nodeConfigRepository.find()
            if (config?.configuredAt) {
                this.logger.log(
                    '✅ Node already configured — unblocking dependent modules'
                )
                // Persisted config may be missing databaseUrl if the env var
                // wasn't set during the original auto-setup, or it may have
                // been written as an empty string. The Phase 0 setup sub-app
                // should have populated this — if not, proceed without a DB
                // and let auth/modules handle null gracefully.
                const storedUrl = config.databaseUrl?.trim() ?? ''
                const fallbackUrl = process.env.SETUP_DATABASE_URL?.trim() ?? ''
                const resolvedDatabaseUrl =
                    storedUrl.length > 0
                        ? storedUrl
                        : (fallbackUrl.length > 0 ? fallbackUrl : null)
                if (
                    storedUrl.length === 0 &&
                    resolvedDatabaseUrl &&
                    config.strategy === 'local'
                ) {
                    this.nodeConfigRepository.upsert({
                        nodeId: config.nodeId,
                        strategy: config.strategy,
                        setupState: (config.setupState as string) === 'setup_done' ? 'setup_done' : 'setup_done',
                        deployerVersion: config.deployerVersion ?? DEPLOYER_VERSION,
                        databaseUrl: resolvedDatabaseUrl,
                        configuredAt:
                            config.configuredAt instanceof Date
                                ? config.configuredAt.toISOString()
                                : String(config.configuredAt),
                        meshUrlsSnapshot: config.meshUrlsSnapshot ?? [],
                        updatedAt: new Date().toISOString(),
                    })
                    this.logger.log(
                        '🩹 Repaired node_config row from SETUP_DATABASE_URL'
                    )
                }
                this.emitCompleted({
                    nodeId: config.nodeId,
                    connectedAt: new Date(config.configuredAt),
                    databaseUrl: resolvedDatabaseUrl,
                    strategy: config.strategy,
                })
            } else if ((process.env.SETUP_AUTO === "true" || this.envService.get("SETUP_AUTO") === true) && process.env.SETUP_DATABASE_URL) {
                // ── Dev-mode auto-setup with SETUP_DATABASE_URL ──────────────
                this.logger.log(
                    '🧪 SETUP_AUTO=true and SETUP_DATABASE_URL set — auto-seeding development config'
                )
                const nodeId = randomUUID()
                this.nodeConfigRepository.upsert({
                    nodeId,
                    strategy: 'local',
                    setupState: 'setup_done',
                    deployerVersion: DEPLOYER_VERSION,
                    databaseUrl: process.env.SETUP_DATABASE_URL,
                    configuredAt: new Date().toISOString(),
                    meshUrlsSnapshot: [],
                    updatedAt: new Date().toISOString(),
                })
                this.emitCompleted({
                    nodeId,
                    connectedAt: new Date(),
                    databaseUrl: process.env.SETUP_DATABASE_URL,
                    strategy: 'local',
                })
            } else if (process.env.SETUP_AUTO === "true" || this.envService.get("SETUP_AUTO") === true) {
                // ── Dev-mode auto-setup WITHOUT SETUP_DATABASE_URL ───────────
                // Phase 0 should have already written a local-only node_config.
                // We emit completion so modules unblock (they'll get null pool).
                this.logger.log(
                    '🧪 SETUP_AUTO=true (no SETUP_DATABASE_URL) — ' +
                    'local-only config emitted from Phase 0, unblocking modules'
                )
                this.emitCompleted({
                    nodeId: config?.nodeId ?? randomUUID(),
                    connectedAt: null,
                    databaseUrl: null,
                    strategy: 'local',
                })
            } else {
                this.logger.log('⏳ No config found — setup wizard required')
            }
        } catch (err: unknown) {
            this.logger.error('Failed to read node config:', err)
        }
    }

    // ─── Public API ───────────────────────────────────────────────────────────

    getSetupState(): SetupStateSnapshot {
        const config = this.nodeConfigRepository.find()

        if (!config) {
            return {
                state: 'not_started',
                needsSetup: true,
                strategy: null,
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
                availableStrategies: ['local', 'remote'],
            }
        }

        if (!config.configuredAt) {
            return {
                state: 'not_started',
                needsSetup: true,
                strategy: null,
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
                availableStrategies: ['local', 'remote'],
            }
        }

        return {
            state: 'completed',
            needsSetup: false,
            strategy: config.strategy,
            currentStep: null,
            progressPercent: 100,
            steps: [],
            completedAt: new Date(config.configuredAt),
            availableStrategies: ['local', 'remote'],
        }
    }

    getNodeStatus() {
        const config = this.nodeConfigRepository.find()
        if (config?.configuredAt) {
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

    // ─── Trigger + Stream ─────────────────────────────────────────────────────

    /**
     * Start the initialization process in the background.
     * Returns `{ accepted: true }` immediately. Live progress can be consumed
     * via `getInitializeStream()`.
     *
     * If an initialization is already running, returns `{ accepted: false }`.
     */
    triggerInitialize(input: SetupInitializeInput): { accepted: boolean } {
        if (this.initializationPromise) {
            this.logger.warn('triggerInitialize called but initialization already in progress')
            return { accepted: false }
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

        return { accepted: true }
    }

    /**
     * Subscribe to the initialization event stream.
     * Returns an Observable backed by the core event service's progress channel.
     * Safe to call before `triggerInitialize()` — the event service buffers events
     * and replays them to late subscribers.
     */
    getInitializeStream(): Observable<SetupStreamEvent> {
        return this.setupEventService.observeProgress$()
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

        const config = this.nodeConfigRepository.find()
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
        input: { meshUrl: string },
        tracker: SetupStepTracker,
        emit: EmitEvent,
    ): Promise<{ nodeId: string; databaseUrl: string }> {
        await runStep(tracker, emit, 'reachability_check', 'Check mesh reachability', async (stepLog) => {
            stepLog(`Probing mesh URL ${input.meshUrl}…`)
            const result = await this.reachabilityService.checkMeshUrlReachability(input.meshUrl)
            if (!result.reachable) {
                throw new Error('Mesh URL is not reachable')
            }
            stepLog('✅ Mesh node is reachable')
        })
        return await this.remoteInitializationService.initialize(
            input as never,
            tracker,
            emit,
        )
    }

    private async runLocalFlow(
        input: { name: string; email: string; password: string; organizationName: string; existingDatabaseUrl?: string; serverUrl: string },
        tracker: SetupStepTracker,
        emit: EmitEvent,
    ): Promise<{ nodeId: string; databaseUrl: string }> {
        return await this.localInitializationService.initialize(
            input as never,
            tracker,
            emit,
        )
    }

    waitForSetup(): Promise<SetupCompletionStatus> {
        return firstValueFrom(this.completedSubject.asObservable())
    }

    // ─── Helpers ──────────────────────────────────────────────────────────────

    private emitCompleted(status: SetupCompletionStatus): void {
        this.logger.log(
            `🚀 Setup complete — strategy=${status.strategy} nodeId=${status.nodeId}`
        )
        this.completedSubject.next(status)
        this.completedSubject.complete()
    }
}
