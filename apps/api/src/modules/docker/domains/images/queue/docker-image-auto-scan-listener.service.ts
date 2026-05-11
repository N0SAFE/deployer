import { Injectable, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import type { Subscription } from "rxjs";
import type { DockerRuntimeEvent } from "@repo/contracts-entities";
import { AppLogger } from "@repo/logger";
import { SystemMeshTopologyService } from "@/core/modules/mesh/services/system-mesh-topology/orchestrator/system-mesh-topology.service";
import { DockerRuntimeEventsStreamService } from "../../../common/events/docker-runtime-events-stream.service";
import { DockerRuntimeMeshRelayService } from "../../../common/mesh/docker-runtime-mesh-relay.service";
import { DockerImagesApplicationService } from "../application/docker-images-application.service";
import { DockerImageSecurityRepository } from "../../../repositories/images/security/docker-image-security.repository";

const AUTO_SCAN_EVENT_ACTIONS = new Set(["start"]);
const AUTO_SCAN_CACHE_MAX_AGE_MS = 6 * 60 * 60 * 1_000;
const AUTO_SCAN_TRIGGER_COOLDOWN_MS = 20_000;
const AUTO_SCAN_BOOTSTRAP_IMAGE_PAGE_LIMIT = 500;
const DEFAULT_IMAGE_QUEUE_PARALLELISM = 1;

@Injectable()
export class DockerImageAutoScanListenerService implements OnModuleInit, OnModuleDestroy {
	private readonly apiLogger = new AppLogger("api").scope(DockerImageAutoScanListenerService.name);
	private readonly debugLogger = this.apiLogger.createContextFilterLogger({
		defaultClassName: DockerImageAutoScanListenerService.name,
		filterEnvVar: "APP_DEBUG_CONTEXT_FILTER",
		channel: "docker-image-auto-scan-listener",
	});

	private runtimeEventSubscription: Subscription | null = null;
	private readonly inFlightByImage = new Set<string>();
	private readonly queuedByImage = new Set<string>();
	private readonly pendingImageQueue: string[] = [];
	private readonly lastTriggeredAtByImage = new Map<string, number>();
	private localNodeId: string | null = null;
	private isProcessingQueue = false;
	private isBootstrapRunning = false;

	constructor(
		private readonly systemMeshTopologyService: SystemMeshTopologyService,
		private readonly dockerRuntimeEventsStreamService: DockerRuntimeEventsStreamService,
		private readonly dockerRuntimeMeshRelayService: DockerRuntimeMeshRelayService,
		private readonly dockerImagesApplicationService: DockerImagesApplicationService,
		private readonly dockerImageSecurityRepository: DockerImageSecurityRepository,
	) {}

	onModuleInit(): void {
		if (this.runtimeEventSubscription) {
			return;
		}

		this.localNodeId = this.systemMeshTopologyService.getLocalNode().nodeId;

		this.runtimeEventSubscription = this.dockerRuntimeEventsStreamService.observeEvents().subscribe({
			next: (event) => {
				void this.handleRuntimeEvent(event);
			},
			error: (error: unknown) => {
				this.debug("onModuleInit", {
					phase: "runtime_event_subscription_error",
					message: error instanceof Error ? error.message : String(error),
				});
			},
		});

		this.debug("onModuleInit", {
			phase: "runtime_event_subscription_started",
		});

		void this.bootstrapUnscannedContainerImages();
	}

	onModuleDestroy(): void {
		this.runtimeEventSubscription?.unsubscribe();
		this.runtimeEventSubscription = null;
		this.inFlightByImage.clear();
		this.queuedByImage.clear();
		this.pendingImageQueue.length = 0;
		this.lastTriggeredAtByImage.clear();
		this.isProcessingQueue = false;
		this.isBootstrapRunning = false;

		this.debug("onModuleDestroy", {
			phase: "runtime_event_subscription_stopped",
		});
	}

	private async handleRuntimeEvent(event: DockerRuntimeEvent): Promise<void> {
		if (event.source !== "container") {
			return;
		}

		if (!this.shouldHandleEventOnLocalNode(event)) {
			return;
		}

		if (!AUTO_SCAN_EVENT_ACTIONS.has(event.action)) {
			return;
		}

		const imageId = this.resolveImageIdentifier(event);
		if (!imageId) {
			this.debug("handleRuntimeEvent", {
				phase: "skip_missing_image_id",
				action: event.action,
				actorId: event.actorId,
				eventId: event.eventId,
			});
			return;
		}

		this.enqueueImageForAutoScan(imageId, "runtime_event");
	}

	private async bootstrapUnscannedContainerImages(): Promise<void> {
		if (this.isBootstrapRunning) {
			return;
		}

		this.isBootstrapRunning = true;

		try {
			const activeImageIds = await this.collectActiveImageIdentifiers();
			await this.dockerImageSecurityRepository.reconcileImageLifecycleWithActiveSet(activeImageIds);

			for (const imageId of activeImageIds) {
				this.enqueueImageForAutoScan(imageId, "startup_bootstrap", {
					ignoreCooldown: true,
				});
			}

			this.debug("bootstrapUnscannedContainerImages", {
				phase: "bootstrap_queue_populated",
				imageCount: activeImageIds.length,
				activeImageCount: activeImageIds.length,
			});
		} catch (error: unknown) {
			this.debug("bootstrapUnscannedContainerImages", {
				phase: "bootstrap_failed",
				message: error instanceof Error ? error.message : String(error),
			});
		} finally {
			this.isBootstrapRunning = false;
		}
	}

	private async collectActiveImageIdentifiers(): Promise<string[]> {
		const imageIds: string[] = [];
		const seen = new Set<string>();

		let offset = 0;
		let hasMore = true;

		while (hasMore) {
			const page = await this.dockerImagesApplicationService.listImages({
				limit: AUTO_SCAN_BOOTSTRAP_IMAGE_PAGE_LIMIT,
				offset,
				sortBy: "lastSeenAt",
				sortDirection: "desc",
				filter: {},
			});

			for (const image of page.data) {
				const imageId = typeof image.id === "string" ? image.id.trim() : "";
				if (imageId.length === 0 || seen.has(imageId)) {
					continue;
				}

				seen.add(imageId);
				imageIds.push(imageId);
			}

			hasMore = page.meta.hasMore;
			offset += page.meta.limit;
		}

		return imageIds;
	}

	private enqueueImageForAutoScan(
		imageId: string,
		source: "runtime_event" | "startup_bootstrap",
		options: { ignoreCooldown?: boolean } = {},
	): void {
		const normalizedImageId = imageId.trim();
		if (normalizedImageId.length === 0) {
			return;
		}

		if (this.inFlightByImage.has(normalizedImageId) || this.queuedByImage.has(normalizedImageId)) {
			return;
		}

		const now = Date.now();
		const lastTriggeredAt = this.lastTriggeredAtByImage.get(normalizedImageId) ?? 0;
		if (!options.ignoreCooldown && now - lastTriggeredAt < AUTO_SCAN_TRIGGER_COOLDOWN_MS) {
			return;
		}

		this.lastTriggeredAtByImage.set(normalizedImageId, now);
		this.pendingImageQueue.push(normalizedImageId);
		this.queuedByImage.add(normalizedImageId);
		this.publishImageScanQueueRuntimeEvent(normalizedImageId, "scan_queued", {
			state: "queued",
			cached: false,
			queueDepth: String(this.pendingImageQueue.length),
			source,
		});

		this.debug("enqueueImageForAutoScan", {
			phase: "queued",
			imageId: normalizedImageId,
			source,
			queueSize: this.pendingImageQueue.length,
		});

		this.processQueue();
	}

	private processQueue(): void {
		if (this.isProcessingQueue) {
			return;
		}

		this.isProcessingQueue = true;

		void this.drainQueue().finally(() => {
			this.isProcessingQueue = false;
		});
	}

	private async drainQueue(): Promise<void> {
		const workerCount = this.resolveImageQueueParallelism();
		await Promise.all(Array.from({ length: workerCount }).map(async () => {
			while (this.pendingImageQueue.length > 0) {
				const imageId = this.pendingImageQueue.shift();
				if (!imageId) {
					continue;
				}

				this.queuedByImage.delete(imageId);
				await this.runAutoScanForImage(imageId);
			}
		}));
	}

	private async runAutoScanForImage(imageId: string): Promise<void> {
		if (this.inFlightByImage.has(imageId)) {
			return;
		}

		this.inFlightByImage.add(imageId);

		try {
			const eligibility = await this.dockerImageSecurityRepository.ensureImageAutoScanEligibility(imageId, {
				maxAgeMs: AUTO_SCAN_CACHE_MAX_AGE_MS,
			});
			if (!eligibility.shouldScan) {
				this.publishImageScanQueueRuntimeEvent(imageId, "scan_complete", {
					state: "completed",
					cached: true,
					progress: 100,
					source: "runtime_event",
				});

				this.debug("runAutoScanForImage", {
					phase: "auto_scan_skipped_already_scanned_generation",
					imageId,
					identifier: eligibility.imageIdentifierNormalized,
					generation: eligibility.imageGeneration,
				});
				return;
			}

			const ensured = await this.dockerImagesApplicationService.ensureImageSecurityScan({
				imageId,
				forceScan: false,
				maxCacheAgeMs: AUTO_SCAN_CACHE_MAX_AGE_MS,
			}, {
				waitForCompletion: true,
			});

			if (ensured.reason === "cached") {
				this.publishImageScanQueueRuntimeEvent(imageId, "scan_complete", {
					state: "completed",
					cached: true,
					progress: 100,
					source: "runtime_event",
				});
			}

			this.debug("runAutoScanForImage", {
				phase: "auto_scan_evaluated",
				imageId,
				result: ensured.reason,
				started: ensured.started,
			});
		} catch (error: unknown) {
			this.publishImageScanQueueRuntimeEvent(imageId, "scan_error", {
				state: "error",
				cached: false,
				error: error instanceof Error ? error.message : String(error),
				source: "runtime_event",
			});

			this.debug("runAutoScanForImage", {
				phase: "auto_scan_failed",
				imageId,
				message: error instanceof Error ? error.message : String(error),
			});
		} finally {
			this.inFlightByImage.delete(imageId);
		}
	}

	private resolveImageIdentifier(event: Extract<DockerRuntimeEvent, { source: "container" }>): string | null {
		const payloadImage = typeof event.payload.image === "string" ? event.payload.image.trim() : "";
		if (payloadImage.length > 0) {
			return payloadImage;
		}

		const actorImage = typeof event.actorAttributes.image === "string"
			? event.actorAttributes.image.trim()
			: "";

		return actorImage.length > 0 ? actorImage : null;
	}

	private resolveImageQueueParallelism(): number {
		const raw = process.env.APP_DOCKER_IMAGE_SCAN_IMAGE_PARALLELISM;
		if (typeof raw !== "string") {
			return DEFAULT_IMAGE_QUEUE_PARALLELISM;
		}

		const parsed = Number.parseInt(raw, 10);
		if (!Number.isFinite(parsed)) {
			return DEFAULT_IMAGE_QUEUE_PARALLELISM;
		}

		return Math.max(1, Math.min(16, parsed));
	}

	private shouldHandleEventOnLocalNode(event: DockerRuntimeEvent): boolean {
		if (event.source !== "container") {
			return false;
		}

		const eventNodeId = typeof event.actorAttributes.meshNodeId === "string"
			? event.actorAttributes.meshNodeId.trim()
			: "";

		const localNodeId = typeof this.localNodeId === "string" ? this.localNodeId.trim() : "";

		if (eventNodeId.length === 0 || localNodeId.length === 0) {
			return true;
		}

		return eventNodeId === localNodeId;
	}

	private debug(source: unknown, context?: Record<string, unknown>): void {
		this.debugLogger.debug(source, context);
	}

	private publishImageScanQueueRuntimeEvent(
		imageId: string,
		action: "scan_queued" | "scan_complete" | "scan_error",
		context: {
			state: string;
			cached: boolean;
			queueDepth?: string;
			source: "runtime_event" | "startup_bootstrap";
			progress?: number;
			error?: string;
		},
	): void {
		const event: DockerRuntimeEvent = {
			type: "docker_event",
			source: "image",
			action,
			actorId: imageId,
			actorAttributes: {
				scanState: context.state,
				scanCached: context.cached ? "true" : "false",
				scanQueueSource: context.source,
				...(context.queueDepth ? { scanQueueDepth: context.queueDepth } : {}),
				...(typeof context.progress === "number" ? { scanProgress: String(context.progress) } : {}),
				...(context.error ? { scanError: context.error } : {}),
			},
			scope: "local",
			from: "docker-image-auto-scan-listener",
			eventId: `scan:${action}:${imageId}:${Date.now()}`,
			nodeId: null,
			timestamp: new Date().toISOString(),
			timestampNano: null,
			raw: {
				synthetic: true,
				lifecycle: "image_security_scan",
			},
			payload: {
				imageId,
				imageName: null,
				repository: null,
				tag: null,
			},
		};

		this.dockerRuntimeMeshRelayService.relayRuntimeEvent(event);
	}
}
