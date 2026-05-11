import { Injectable } from "@nestjs/common";
import { Observable, ReplaySubject } from "rxjs";
import type { DockerImageSecurityScanStreamQueryInput } from "@repo/api-contracts/modules/docker/security/scanning/images/stream";
import type { DockerImageSecurityScanEvent, DockerRuntimeEvent } from "@repo/contracts-entities";
import { DockerRuntimeMeshRelayService } from "../../../common/mesh/docker-runtime-mesh-relay.service";
import { DockerImageSecurityRepository } from "../../../repositories/images/security/docker-image-security.repository";

const IMAGE_SCAN_STREAM_REPLAY_BUFFER_SIZE = 600;
const DEFAULT_IMAGE_SCAN_CACHE_AGE_MS = 6 * 60 * 60 * 1_000;

interface ActiveImageScanStream {
  imageId: string;
  subject: ReplaySubject<DockerImageSecurityScanEvent>;
  subscriberCount: number;
}

export interface EnsureImageSecurityScanResult {
  started: boolean;
  reason: "started" | "already-running" | "cached";
  imageId: string;
}

export interface EnsureImageSecurityScanOptions {
  waitForCompletion?: boolean;
}

@Injectable()
export class DockerImageSecurityScanService {
  private readonly imageSecurityScanStreamsInFlight = new Map<string, ActiveImageScanStream>();

  constructor(
    private readonly dockerImageSecurityRepository: DockerImageSecurityRepository,
    private readonly dockerRuntimeMeshRelayService: DockerRuntimeMeshRelayService,
  ) {}

  streamImageSecurityScan(input: DockerImageSecurityScanStreamQueryInput): Observable<DockerImageSecurityScanEvent> {
    const imageId = this.normalizeImageIdentifier(input.imageId);
    const forceScan = input.forceScan ?? false;
    const maxCacheAgeMs = input.maxCacheAgeMs ?? DEFAULT_IMAGE_SCAN_CACHE_AGE_MS;

    const active = this.imageSecurityScanStreamsInFlight.get(imageId);
    if (active) {
      return this.observeActiveImageScanStream(active);
    }

    if (forceScan) {
      return this.observeActiveImageScanStream(this.startImageSecurityScanStream(imageId, input));
    }

    return this.observePersistedImageSecuritySnapshot(imageId, maxCacheAgeMs);
  }

  async ensureImageSecurityScan(
    input: DockerImageSecurityScanStreamQueryInput,
    options: EnsureImageSecurityScanOptions = {},
  ): Promise<EnsureImageSecurityScanResult> {
    const imageId = this.normalizeImageIdentifier(input.imageId);
    const forceScan = input.forceScan ?? false;
    const maxCacheAgeMs = input.maxCacheAgeMs ?? DEFAULT_IMAGE_SCAN_CACHE_AGE_MS;
    const waitForCompletion = options.waitForCompletion ?? false;

    const existing = this.imageSecurityScanStreamsInFlight.get(imageId);
    if (existing) {
      if (waitForCompletion) {
        await this.waitForActiveImageScanCompletion(existing);
      }

      return {
        started: false,
        reason: "already-running",
        imageId,
      };
    }

    if (!forceScan) {
      const persisted = await this.dockerImageSecurityRepository.getPersistedImageSecurityScan(imageId, {
        maxAgeMs: maxCacheAgeMs,
      });

      if (persisted) {
        return {
          started: false,
          reason: "cached",
          imageId,
        };
      }
    }

    const active = this.startImageSecurityScanStream(imageId, input);

    if (waitForCompletion) {
      await this.waitForActiveImageScanCompletion(active);
    }

    return {
      started: true,
      reason: "started",
      imageId,
    };
  }

  private observeActiveImageScanStream(active: ActiveImageScanStream): Observable<DockerImageSecurityScanEvent> {
    return new Observable<DockerImageSecurityScanEvent>((subscriber) => {
      active.subscriberCount += 1;
      const subscription = active.subject.subscribe(subscriber);

      return () => {
        subscription.unsubscribe();
        active.subscriberCount = Math.max(0, active.subscriberCount - 1);
      };
    });
  }

  private observePersistedImageSecuritySnapshot(
    imageId: string,
    maxCacheAgeMs: number,
  ): Observable<DockerImageSecurityScanEvent> {
    return new Observable<DockerImageSecurityScanEvent>((subscriber) => {
      let cancelled = false;
      let activeSubscription: { unsubscribe: () => void } | null = null;

      const subscribeToRunningScan = (): boolean => {
        const active = this.imageSecurityScanStreamsInFlight.get(imageId);
        if (!active) {
          return false;
        }

        activeSubscription = this.observeActiveImageScanStream(active).subscribe(subscriber);
        return true;
      };

      if (subscribeToRunningScan()) {
        return () => {
          cancelled = true;
          activeSubscription?.unsubscribe();
        };
      }

      void this.dockerImageSecurityRepository
        .getPersistedImageSecurityScan(imageId, {
          maxAgeMs: maxCacheAgeMs,
        })
        .then((persisted) => {
          if (cancelled) {
            return;
          }

          if (subscribeToRunningScan()) {
            return;
          }

          if (persisted) {
            subscriber.next({
              imageId,
              timestamp: new Date().toISOString(),
              type: "complete",
              stage: "completed",
              scanner: null,
              message: "Using cached security scan result from database",
              progress: 100,
              logLine: null,
              scanSummary: persisted.scanSummary,
              vulnerabilities: persisted.vulnerabilities,
              payload: {
                scanSummary: persisted.scanSummary,
                vulnerabilities: persisted.vulnerabilities,
              },
            });
          }

          subscriber.complete();
        })
        .catch((error: unknown) => {
          if (cancelled) {
            return;
          }

          subscriber.error(error);
        });

      return () => {
        cancelled = true;
        activeSubscription?.unsubscribe();
      };
    });
  }

  private startImageSecurityScanStream(
    imageId: string,
    input: DockerImageSecurityScanStreamQueryInput,
  ): ActiveImageScanStream {
    let active = this.imageSecurityScanStreamsInFlight.get(imageId);
    if (active) {
      return active;
    }

    const subject = new ReplaySubject<DockerImageSecurityScanEvent>(IMAGE_SCAN_STREAM_REPLAY_BUFFER_SIZE);
    active = {
      imageId,
      subject,
      subscriberCount: 0,
    };
    this.imageSecurityScanStreamsInFlight.set(imageId, active);

    void this.runImageSecurityScanJob(imageId, input, active)
      .finally(() => {
        const current = this.imageSecurityScanStreamsInFlight.get(imageId);
        if (current === active) {
          this.imageSecurityScanStreamsInFlight.delete(imageId);
        }

        active.subject.complete();
      });

    return active;
  }

  private waitForActiveImageScanCompletion(active: ActiveImageScanStream): Promise<void> {
    return new Promise((resolve) => {
      let settled = false;

      const subscription = active.subject.subscribe({
        error: () => {
          if (settled) {
            return;
          }

          settled = true;
          subscription.unsubscribe();
          resolve();
        },
        complete: () => {
          if (settled) {
            return;
          }

          settled = true;
          subscription.unsubscribe();
          resolve();
        },
      });
    });
  }

  private async runImageSecurityScanJob(
    imageId: string,
    input: DockerImageSecurityScanStreamQueryInput,
    active: ActiveImageScanStream,
  ): Promise<void> {
    this.publishImageScanRuntimeEvent(imageId, "scan_start", {
      state: "running",
      cached: false,
      subscribers: String(active.subscriberCount),
    });

    const emitEvent = (event: DockerImageSecurityScanEvent): void => {
      active.subject.next(event);
    };

    try {
      const forceScan = input.forceScan ?? false;
      const maxCacheAgeMs = input.maxCacheAgeMs ?? DEFAULT_IMAGE_SCAN_CACHE_AGE_MS;

      if (!forceScan) {
        const persisted = await this.dockerImageSecurityRepository.getPersistedImageSecurityScan(imageId, {
          maxAgeMs: maxCacheAgeMs,
        });

        if (persisted) {
          emitEvent({
            imageId,
            timestamp: new Date().toISOString(),
            type: "complete",
            stage: "completed",
            scanner: null,
            message: "Using cached security scan result from database",
            progress: 100,
            logLine: null,
            scanSummary: persisted.scanSummary,
            vulnerabilities: persisted.vulnerabilities,
            payload: {
              scanSummary: persisted.scanSummary,
              vulnerabilities: persisted.vulnerabilities,
            },
          });

          this.publishImageScanRuntimeEvent(imageId, "scan_complete", {
            state: "completed",
            cached: true,
            subscribers: String(active.subscriberCount),
          });
          return;
        }
      }

      let hasCompletionEvent = false;

      await this.dockerImageSecurityRepository.streamImageSecurityScan(imageId, {
        logPollIntervalMs: input.refreshIntervalMs,
        onEvent: (event) => {
          emitEvent(event);

          if (event.type !== "complete" && event.stage !== "completed") {
            this.publishImageScanRuntimeEvent(imageId, "scan_progress", {
              state: event.stage,
              cached: false,
              subscribers: String(active.subscriberCount),
              progress: event.progress,
              stage: event.stage,
              scanner: event.scanner,
              message: event.message,
            });
          }

          if (event.type === "complete" || event.stage === "completed") {
            hasCompletionEvent = true;
            this.publishImageScanRuntimeEvent(imageId, "scan_complete", {
              state: "completed",
              cached: Boolean(event.scanSummary?.cached),
              subscribers: String(active.subscriberCount),
              progress: event.progress,
              stage: event.stage,
              scanner: event.scanner,
              message: event.message,
            });
          }
        },
      });

      if (!hasCompletionEvent) {
        this.publishImageScanRuntimeEvent(imageId, "scan_complete", {
          state: "completed",
          cached: false,
          subscribers: String(active.subscriberCount),
        });
      }
    } catch (error: unknown) {
      emitEvent({
        imageId,
        timestamp: new Date().toISOString(),
        type: "error",
        stage: "error",
        scanner: null,
        message: "Security scan stream failed",
        progress: null,
        logLine: this.formatError(error),
        payload: {
          error: this.formatError(error),
          scannerResult: null,
        },
      });

      this.publishImageScanRuntimeEvent(imageId, "scan_error", {
        state: "error",
        cached: false,
        error: this.formatError(error),
        subscribers: String(active.subscriberCount),
        progress: null,
        stage: "error",
        scanner: null,
        message: "Security scan stream failed",
      });
    }
  }

  private publishImageScanRuntimeEvent(
    imageId: string,
    action: "scan_start" | "scan_progress" | "scan_complete" | "scan_error",
    context: {
      state: string;
      cached: boolean;
      subscribers: string;
      error?: string;
      progress?: number | null;
      stage?: DockerImageSecurityScanEvent["stage"];
      scanner?: DockerImageSecurityScanEvent["scanner"];
      message?: string;
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
        scanSubscribers: context.subscribers,
        ...(typeof context.progress === "number" ? { scanProgress: String(context.progress) } : {}),
        ...(context.stage ? { scanStage: context.stage } : {}),
        ...(context.scanner ? { scanScanner: context.scanner } : {}),
        ...(context.message ? { scanMessage: context.message } : {}),
        ...(context.error ? { scanError: context.error } : {}),
      },
      scope: "local",
      from: "docker-image-security-scan",
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

  private normalizeImageIdentifier(value: string): string {
    return value.trim();
  }

  private formatError(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }

    if (typeof error === "string") {
      return error;
    }

    try {
      return JSON.stringify(error);
    } catch {
      return String(error);
    }
  }
}
