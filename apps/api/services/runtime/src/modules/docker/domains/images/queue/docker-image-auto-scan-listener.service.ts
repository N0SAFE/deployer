import { Context, Effect } from 'effect'

import type { DockerRuntimeEvent } from '@deployer/contracts-entities'
import { AppLogger } from '@deployer/logger'
import type { EnvService } from '@deployer/shared/config/env/env.module'
import { heavyWorkSnapshot } from '@deployer/shared/core/utils/heavy-work.registry'

import {
    planScanConcurrency,
    readScanPressure,
    resolveScanConcurrencyCeiling,
} from '../../../services/scan-concurrency'

import type { DockerRuntimeEventsStreamShape } from '../../../common/events/docker-runtime-events-stream.service'
import type { DockerRuntimeMeshRelayService } from '../../../common/mesh/docker-runtime-mesh-relay.service'
import type { DockerImageSecurityRepository } from '../../../repositories/images/security/docker-image-security.repository'
import type { DockerNodeMesh } from '../../containers/mesh/docker-node-mesh'
import type { DockerImagesApplicationService } from '../application/docker-images-application.service'
import type { Subscription } from 'rxjs'

const AUTO_SCAN_EVENT_ACTIONS = new Set(['start'])
const AUTO_SCAN_CACHE_MAX_AGE_MS = 6 * 60 * 60 * 1_000
const AUTO_SCAN_TRIGGER_COOLDOWN_MS = 20_000
const AUTO_SCAN_BOOTSTRAP_IMAGE_PAGE_LIMIT = 500
const DEFAULT_IMAGE_QUEUE_PARALLELISM = 1
/**
 * How long the background scan queue waits before re-checking whether the host
 * can take another image. Long enough not to spin while swapping, short enough
 * that the queue resumes promptly once a deployment or a scan finishes.
 */
const AUTO_SCAN_CAPACITY_RETRY_MS = 30_000

/** Scans the images of started containers in the background while the service is started. It has no methods, only a lifetime. */
export type DockerImageAutoScanListenerShape = {
    readonly onModuleInit: () => Effect.Effect<void>
    readonly onModuleDestroy: () => Effect.Effect<void>
}

export class DockerImageAutoScanListenerService extends Context.Service<
    DockerImageAutoScanListenerService,
    DockerImageAutoScanListenerShape
>()('runtime/DockerImageAutoScanListener') {
    static readonly make = makeDockerImageAutoScanListener
}

function makeDockerImageAutoScanListener(
    ...deps: ConstructorParameters<typeof AutoScanQueue>
): DockerImageAutoScanListenerShape {
    const queue = new AutoScanQueue(...deps)
    return {
        onModuleInit: () =>
            Effect.sync(() => {
                queue.start()
            }),
        onModuleDestroy: () =>
            Effect.sync(() => {
                queue.stop()
            }),
    }
}

/** The queue's state and loop; the tag above exposes only its start and stop. */
class AutoScanQueue {
    private readonly apiLogger = new AppLogger('api').scope(
        'DockerImageAutoScanListenerService'
    )
    private readonly debugLogger = this.apiLogger.createContextFilterLogger({
        defaultClassName: 'DockerImageAutoScanListenerService',
        filterEnvVar: 'APP_DEBUG_CONTEXT_FILTER',
        channel: 'docker-image-auto-scan-listener',
    })

    private runtimeEventSubscription: Subscription | null = null
    private readonly inFlightByImage = new Set<string>()
    private readonly queuedByImage = new Set<string>()
    private readonly pendingImageQueue: string[] = []
    private readonly lastTriggeredAtByImage = new Map<string, number>()
    private isProcessingQueue = false
    /** Background scans that hold a claim right now (see tryClaimNextImage). */
    private activeAutoScanJobs = 0
    private isBootstrapRunning = false

    constructor(
        /** Names this node: the id its agent gave it, known once the runtime has joined the mesh. */
        private readonly nodeMesh: Pick<DockerNodeMesh, 'selfNodeId'>,
        private readonly dockerRuntimeEventsStreamService: Pick<
            DockerRuntimeEventsStreamShape,
            'observeEvents'
        >,
        private readonly dockerRuntimeMeshRelayService: Pick<
            DockerRuntimeMeshRelayService,
            'relayRuntimeEvent'
        >,
        private readonly dockerImagesApplicationService: Pick<
            DockerImagesApplicationService,
            'listImages' | 'ensureImageSecurityScan'
        >,
        private readonly dockerImageSecurityRepository: Pick<
            DockerImageSecurityRepository,
            | 'reconcileImageLifecycleWithActiveSet'
            | 'ensureImageAutoScanEligibility'
        >,
        private readonly envService: Pick<EnvService, 'get'>
    ) {}

    start(): void {
        if (this.runtimeEventSubscription) {
            return
        }

        if (this.isAutoScanDisabled()) {
            this.debug('start', {
                phase: 'auto_scan_disabled_by_env',
                envVar: 'DISABLE_AUTO_SCAN',
            })
            return
        }

        this.runtimeEventSubscription = this.dockerRuntimeEventsStreamService
            .observeEvents()
            .subscribe({
                next: (event) => {
                    void this.handleRuntimeEvent(event)
                },
                error: (error: unknown) => {
                    this.debug('start', {
                        phase: 'runtime_event_subscription_error',
                        message:
                            error instanceof Error
                                ? error.message
                                : String(error),
                    })
                },
            })

        this.debug('start', {
            phase: 'runtime_event_subscription_started',
        })

        void this.bootstrapUnscannedContainerImages()
    }

    private isAutoScanDisabled(): boolean {
        return this.envService.get('DISABLE_AUTO_SCAN')
    }

    stop(): void {
        this.runtimeEventSubscription?.unsubscribe()
        this.runtimeEventSubscription = null
        this.inFlightByImage.clear()
        this.queuedByImage.clear()
        this.pendingImageQueue.length = 0
        this.lastTriggeredAtByImage.clear()
        this.isProcessingQueue = false
        this.activeAutoScanJobs = 0
        this.isBootstrapRunning = false

        this.debug('stop', {
            phase: 'runtime_event_subscription_stopped',
        })
    }

    private async handleRuntimeEvent(event: DockerRuntimeEvent): Promise<void> {
        if (event.source !== 'container') {
            return
        }

        if (!this.shouldHandleEventOnLocalNode(event)) {
            return
        }

        if (!AUTO_SCAN_EVENT_ACTIONS.has(event.action)) {
            return
        }

        const imageId = this.resolveImageIdentifier(event)
        if (!imageId) {
            this.debug('handleRuntimeEvent', {
                phase: 'skip_missing_image_id',
                action: event.action,
                actorId: event.actorId,
                eventId: event.eventId,
            })
            return
        }

        this.enqueueImageForAutoScan(imageId, 'runtime_event')
    }

    private async bootstrapUnscannedContainerImages(): Promise<void> {
        if (this.isBootstrapRunning) {
            return
        }

        this.isBootstrapRunning = true

        try {
            const activeImageIds = await this.collectActiveImageIdentifiers()
            await this.dockerImageSecurityRepository.reconcileImageLifecycleWithActiveSet(
                activeImageIds
            )

            for (const imageId of activeImageIds) {
                this.enqueueImageForAutoScan(imageId, 'startup_bootstrap', {
                    ignoreCooldown: true,
                })
            }

            this.debug('bootstrapUnscannedContainerImages', {
                phase: 'bootstrap_queue_populated',
                imageCount: activeImageIds.length,
                activeImageCount: activeImageIds.length,
            })
        } catch (error: unknown) {
            this.debug('bootstrapUnscannedContainerImages', {
                phase: 'bootstrap_failed',
                message: error instanceof Error ? error.message : String(error),
            })
        } finally {
            this.isBootstrapRunning = false
        }
    }

    private async collectActiveImageIdentifiers(): Promise<string[]> {
        const imageIds: string[] = []
        const seen = new Set<string>()

        let offset = 0
        let hasMore = true

        while (hasMore) {
            const page = await this.dockerImagesApplicationService.listImages({
                limit: AUTO_SCAN_BOOTSTRAP_IMAGE_PAGE_LIMIT,
                offset,
                sortBy: 'lastSeenAt',
                sortDirection: 'desc',
                filter: {},
            })

            for (const image of page.data) {
                const imageId =
                    typeof image.id === 'string' ? image.id.trim() : ''
                if (imageId.length === 0 || seen.has(imageId)) {
                    continue
                }

                seen.add(imageId)
                imageIds.push(imageId)
            }

            hasMore = page.meta.hasMore
            offset += page.meta.limit
        }

        return imageIds
    }

    private enqueueImageForAutoScan(
        imageId: string,
        source: 'runtime_event' | 'startup_bootstrap',
        options: { ignoreCooldown?: boolean } = {}
    ): void {
        const normalizedImageId = imageId.trim()
        if (normalizedImageId.length === 0) {
            return
        }

        if (
            this.inFlightByImage.has(normalizedImageId) ||
            this.queuedByImage.has(normalizedImageId)
        ) {
            return
        }

        const now = Date.now()
        const lastTriggeredAt =
            this.lastTriggeredAtByImage.get(normalizedImageId) ?? 0
        if (
            !options.ignoreCooldown &&
            now - lastTriggeredAt < AUTO_SCAN_TRIGGER_COOLDOWN_MS
        ) {
            return
        }

        this.lastTriggeredAtByImage.set(normalizedImageId, now)
        this.pendingImageQueue.push(normalizedImageId)
        this.queuedByImage.add(normalizedImageId)
        this.publishImageScanQueueRuntimeEvent(
            normalizedImageId,
            'scan_queued',
            {
                state: 'queued',
                cached: false,
                queueDepth: String(this.pendingImageQueue.length),
                source,
            }
        )

        this.debug('enqueueImageForAutoScan', {
            phase: 'queued',
            imageId: normalizedImageId,
            source,
            queueSize: this.pendingImageQueue.length,
        })

        this.processQueue()
    }

    private processQueue(): void {
        if (this.isProcessingQueue) {
            return
        }

        this.isProcessingQueue = true

        void this.drainQueue().finally(() => {
            this.isProcessingQueue = false
        })
    }

    private async drainQueue(): Promise<void> {
        const workerCount = this.resolveImageQueueParallelism()
        await Promise.all(
            Array.from({ length: workerCount }).map(async () => {
                while (true) {
                    const imageId = this.tryClaimNextImage()

                    if (imageId === null) {
                        if (this.pendingImageQueue.length === 0) {
                            return
                        }

                        // Over capacity: wait instead of starting the next image. This is
                        // the gate that keeps a background bootstrap from filling the
                        // machine while a deployment or another scan is already running.
                        await this.delay(AUTO_SCAN_CAPACITY_RETRY_MS)
                        continue
                    }

                    try {
                        this.queuedByImage.delete(imageId)
                        await this.runAutoScanForImage(imageId)
                    } finally {
                        this.activeAutoScanJobs -= 1
                    }
                }
            })
        )
    }

    /**
     * Claim the next image iff the machine and the other work allow it.
     *
     * ── WHY THE CHECK AND THE CLAIM ARE SYNCHRONOUS ─────────────────────────
     * Several drain workers run at once (`APP_DOCKER_IMAGE_SCAN_IMAGE_PARALLELISM`).
     * If the capacity check `await`ed, two workers could both observe "nothing is
     * running" and start two images — the queue's parallelism would silently
     * defeat the point of the gate. Every read here is synchronous and the claim
     * happens in the same tick, so JS's run-to-completion makes it atomic.
     *
     * ── WHAT COUNTS AS "NOT ALLOWED" ────────────────────────────────────────
     *  - another background scan is in flight (this queue runs one at a time);
     *  - a scanner container from ANY source is running (interactive scan);
     *  - the shared policy says the host is strained or a build/deploy is running
     *    (`scan-concurrency.ts` — same rules the scanner itself uses).
     */
    private tryClaimNextImage(): string | null {
        if (this.activeAutoScanJobs > 0) {
            return null
        }

        if (heavyWorkSnapshot().scan > 0) {
            return null
        }

        const plan = planScanConcurrency({
            ceiling: resolveScanConcurrencyCeiling(),
            pressure: readScanPressure(),
            heavy: heavyWorkSnapshot(),
        })

        if (
            plan.reason === 'critical-memory' ||
            plan.reason === 'swap-pressure' ||
            plan.reason === 'build-or-deploy-in-flight'
        ) {
            this.debug('tryClaimNextImage', {
                phase: 'deferred',
                reason: plan.reason,
                queueSize: this.pendingImageQueue.length,
            })
            return null
        }

        const imageId = this.pendingImageQueue.shift() ?? null
        if (imageId !== null) {
            this.activeAutoScanJobs += 1
        }

        return imageId
    }

    private delay(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms))
    }

    private async runAutoScanForImage(imageId: string): Promise<void> {
        if (this.inFlightByImage.has(imageId)) {
            return
        }

        this.inFlightByImage.add(imageId)

        try {
            const eligibility =
                await this.dockerImageSecurityRepository.ensureImageAutoScanEligibility(
                    imageId,
                    {
                        maxAgeMs: AUTO_SCAN_CACHE_MAX_AGE_MS,
                    }
                )
            if (!eligibility.shouldScan) {
                this.publishImageScanQueueRuntimeEvent(
                    imageId,
                    'scan_complete',
                    {
                        state: 'completed',
                        cached: true,
                        progress: 100,
                        source: 'runtime_event',
                    }
                )

                this.debug('runAutoScanForImage', {
                    phase: 'auto_scan_skipped_already_scanned_generation',
                    imageId,
                    identifier: eligibility.imageIdentifierNormalized,
                    generation: eligibility.imageGeneration,
                })
                return
            }

            const ensured =
                await this.dockerImagesApplicationService.ensureImageSecurityScan(
                    {
                        imageId,
                        forceScan: false,
                        maxCacheAgeMs: AUTO_SCAN_CACHE_MAX_AGE_MS,
                    },
                    {
                        waitForCompletion: true,
                    }
                )

            if (ensured.reason === 'cached') {
                this.publishImageScanQueueRuntimeEvent(
                    imageId,
                    'scan_complete',
                    {
                        state: 'completed',
                        cached: true,
                        progress: 100,
                        source: 'runtime_event',
                    }
                )
            }

            this.debug('runAutoScanForImage', {
                phase: 'auto_scan_evaluated',
                imageId,
                result: ensured.reason,
                started: ensured.started,
            })
        } catch (error: unknown) {
            this.publishImageScanQueueRuntimeEvent(imageId, 'scan_error', {
                state: 'error',
                cached: false,
                error: error instanceof Error ? error.message : String(error),
                source: 'runtime_event',
            })

            this.debug('runAutoScanForImage', {
                phase: 'auto_scan_failed',
                imageId,
                message: error instanceof Error ? error.message : String(error),
            })
        } finally {
            this.inFlightByImage.delete(imageId)
        }
    }

    private resolveImageIdentifier(
        event: Extract<DockerRuntimeEvent, { source: 'container' }>
    ): string | null {
        const payloadImage =
            typeof event.payload.image === 'string'
                ? event.payload.image.trim()
                : ''
        if (payloadImage.length > 0) {
            return payloadImage
        }

        const actorImage =
            typeof event.actorAttributes.image === 'string'
                ? event.actorAttributes.image.trim()
                : ''

        return actorImage.length > 0 ? actorImage : null
    }

    private resolveImageQueueParallelism(): number {
        const raw = process.env.APP_DOCKER_IMAGE_SCAN_IMAGE_PARALLELISM
        if (typeof raw !== 'string') {
            return DEFAULT_IMAGE_QUEUE_PARALLELISM
        }

        const parsed = Number.parseInt(raw, 10)
        if (!Number.isFinite(parsed)) {
            return DEFAULT_IMAGE_QUEUE_PARALLELISM
        }

        return Math.max(1, Math.min(16, parsed))
    }

    private shouldHandleEventOnLocalNode(event: DockerRuntimeEvent): boolean {
        if (event.source !== 'container') {
            return false
        }

        const eventNodeId =
            typeof event.actorAttributes.meshNodeId === 'string'
                ? event.actorAttributes.meshNodeId.trim()
                : ''

        const localNodeId = this.nodeMesh.selfNodeId()?.trim() ?? ''

        if (eventNodeId.length === 0 || localNodeId.length === 0) {
            return true
        }

        return eventNodeId === localNodeId
    }

    private debug(source: unknown, context?: Record<string, unknown>): void {
        this.debugLogger.debug(source, context)
    }

    private publishImageScanQueueRuntimeEvent(
        imageId: string,
        action: 'scan_queued' | 'scan_complete' | 'scan_error',
        context: {
            state: string
            cached: boolean
            queueDepth?: string
            source: 'runtime_event' | 'startup_bootstrap'
            progress?: number
            error?: string
        }
    ): void {
        const event: DockerRuntimeEvent = {
            type: 'docker_event',
            source: 'image',
            action,
            actorId: imageId,
            actorAttributes: {
                scanState: context.state,
                scanCached: context.cached ? 'true' : 'false',
                scanQueueSource: context.source,
                ...(context.queueDepth
                    ? { scanQueueDepth: context.queueDepth }
                    : {}),
                ...(typeof context.progress === 'number'
                    ? { scanProgress: String(context.progress) }
                    : {}),
                ...(context.error ? { scanError: context.error } : {}),
            },
            scope: 'local',
            from: 'docker-image-auto-scan-listener',
            eventId: `scan:${action}:${imageId}:${Date.now()}`,
            nodeId: null,
            timestamp: new Date().toISOString(),
            timestampNano: null,
            raw: {
                synthetic: true,
                lifecycle: 'image_security_scan',
            },
            payload: {
                imageId,
                imageName: null,
                repository: null,
                tag: null,
            },
        }

        this.dockerRuntimeMeshRelayService.relayRuntimeEvent(event)
    }
}
