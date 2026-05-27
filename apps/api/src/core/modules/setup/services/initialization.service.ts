import { Injectable, Logger, type OnModuleInit } from '@nestjs/common'
import { Subject, firstValueFrom, Observable } from 'rxjs'
import type {
    SetupInitializeInput,
    SetupStreamEvent,
    SetupStateSnapshot,
    SetupStepId,
} from '@repo/contracts-entities'
import { NodeConfigRepository } from '../repositories/node-config.repository'
import { LocalInitializationService } from './local-initialization.service'
import { RemoteInitializationService } from './remote-initialization.service'
import { ReachabilityService } from '../../reachability/services/reachability.service'
import { MeshInitializationService } from '../../mesh/initialization/services/mesh-initialization.service'

export interface SetupCompletionStatus {
    nodeId: string
    connectedAt: Date
    databaseUrl: string
    strategy: 'local' | 'remote'
}

@Injectable()
export class InitializationService implements OnModuleInit {
    private readonly logger = new Logger(InitializationService.name)
    private readonly completedSubject = new Subject<SetupCompletionStatus>()

    constructor(
        private readonly nodeConfigRepository: NodeConfigRepository,
        private readonly localInitializationService: LocalInitializationService,
        private readonly remoteInitializationService: RemoteInitializationService,
        private readonly meshInitializationService: MeshInitializationService,
        private readonly reachabilityService: ReachabilityService
    ) {}

    // ─── Lifecycle ────────────────────────────────────────────────────────────

    async onModuleInit(): Promise<void> {
        this.logger.log(
            '🔍 InitializationService: checking existing node config…'
        )
        try {
            const config = this.nodeConfigRepository.find()
            if (config) {
                this.logger.log(
                    '✅ Node already configured — unblocking dependent modules'
                )

                // For remote strategy, attempt to reconnect to the mesh
                // to verify connectivity and refresh the databaseUrl.
                if (config.strategy === 'remote' && config.meshUrlsSnapshot?.length) {
                    for (const url of config.meshUrlsSnapshot) {
                        try {
                            await this.meshInitializationService.connectToMesh(url)
                            this.logger.log(`✅ Reconnected to mesh at ${url}`)
                            break
                        } catch (err: unknown) {
                            const message = err instanceof Error ? err.message : String(err)
                            this.logger.warn(`Failed to connect to mesh URL ${url}: ${message}`)
                        }
                    }
                }

                this.emitCompleted({
                    nodeId: config.nodeId,
                    connectedAt: new Date(config.configuredAt),
                    databaseUrl: config.databaseUrl,
                    strategy: config.strategy,
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
                state: 'awaiting_strategy',
                needsSetup: true,
                strategy: null,
                currentStep: 'choose_strategy',
                progressPercent: 0,
                steps: [
                    {
                        id: 'choose_strategy',
                        title: 'Choose how to get started',
                        status: 'in_progress',
                    },
                    {
                        id: 'reachability_check',
                        title: 'Check mesh reachability',
                        status: 'pending',
                    },
                    {
                        id: 'configure_account',
                        title: 'Create your account',
                        status: 'pending',
                    },
                    {
                        id: 'provision_database',
                        title: 'Set up the database',
                        status: 'pending',
                    },
                    {
                        id: 'run_migrations',
                        title: 'Run migrations',
                        status: 'pending',
                    },
                    {
                        id: 'register_node',
                        title: 'Register this node',
                        status: 'pending',
                    },
                    { id: 'finalize', title: 'Finalize', status: 'pending' },
                ],
                completedAt: null,
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
        }
    }

    getNodeStatus() {
        const config = this.nodeConfigRepository.find()
        return {
            isConfigured: !!config,
            nodeId: config?.nodeId ?? null,
            strategy: config?.strategy ?? null,
            meshUrlsSnapshot: config?.meshUrlsSnapshot ?? [],
            configuredAt: config ? new Date(config.configuredAt) : null,
        }
    }

    /**
     * Main entry point — returns an Observable<SetupStreamEvent>.
     * Dispatches to local or remote flow based on strategy.
     * ✅ No async callback — Promise is chained manually to satisfy TeardownLogic.
     */
    initialize(input: SetupInitializeInput): Observable<SetupStreamEvent> {
        return new Observable<SetupStreamEvent>((subscriber) => {
            subscriber.next(
                InitializationService.stepStart(
                    'reachability_check',
                    'Checking mesh reachability'
                )
            )
            this.reachabilityService
                .checkMeshUrlReachability(input.serverUrl)
                .then((result) => {
                    if (!result.reachable) {
                        subscriber.next(
                            InitializationService.stepFailed(
                                'reachability_check',
                                `Mesh URL is not reachable`,
                                result.latencyMs
                            )
                        )
                        subscriber.complete()
                        return
                    }
                    subscriber.next(
                        InitializationService.stepComplete(
                            'reachability_check',
                            result.latencyMs
                        )
                    )

                    const flow =
                        input.strategy === 'remote'
                            ? this.remoteInitializationService.initialize(
                                  input,
                                  subscriber
                              )
                            : this.localInitializationService.initialize(
                                  input,
                                  subscriber
                              )

                    return flow.then(() => {
                        const config = this.nodeConfigRepository.find()
                        if (config) {
                            this.emitCompleted({
                                nodeId: config.nodeId,
                                connectedAt: new Date(config.configuredAt),
                                databaseUrl: config.databaseUrl,
                                strategy: input.strategy,
                            })
                        }
                        subscriber.complete()
                    })
                }).catch((err: unknown) => {
                    const message = err instanceof Error ? err.message : String(err)
                    subscriber.error(new Error(message))
                })
        })
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

    // ─── Static event builders (used by sub-services) ────────────────────────

    static stepStart(stepId: SetupStepId, title: string): SetupStreamEvent {
        return { type: 'step_start', stepId, title }
    }

    static stepLog(stepId: SetupStepId, log: string): SetupStreamEvent {
        return { type: 'step_log', stepId, log }
    }

    static stepComplete(
        stepId: SetupStepId,
        durationMs: number
    ): SetupStreamEvent {
        return { type: 'step_complete', stepId, durationMs }
    }

    static stepFailed(
        stepId: SetupStepId,
        error: string,
        durationMs: number
    ): SetupStreamEvent {
        return { type: 'step_failed', stepId, error, durationMs }
    }

    static completed(
        nodeId: string,
        strategy: 'local' | 'remote',
        databaseUrl: string
    ): SetupStreamEvent {
        return {
            type: 'completed',
            result: {
                nodeId,
                strategy,
                databaseUrl,
                completedAt: new Date().toISOString(),
            },
        }
    }
}
