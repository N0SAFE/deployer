import { Injectable } from "@nestjs/common"
import { isRecord } from "@repo/type-guards";
import type {
  DockerRuntimeEvent,
  DockerRuntimeActivityEntity,
  DockerRuntimeActivityStatus,
  DockerRuntimeActivitySeverity,
  DockerRuntimeActivityCategory,
} from "@repo/contracts-entities"
import type { SwarmActivityEnrichment } from "./swarm-activity-enricher.service"

/**
 * Pure projection of a `DockerRuntimeEvent` into a
 * `DockerRuntimeActivityEntity`. This used to live inside
 * `DockerRepository.persistRuntimeActivityEvent`; it is extracted here so
 * the activity stream endpoint can reuse the same logic without going
 * through the database.
 *
 * The projection is intentionally deterministic — given the same event it
 * always produces the same activity — so the same projector is used by
 * the persistence layer (`docker-runtime-activity.repository.ts`) and the
 * live stream (`docker-runtime-activity-domain.service.ts`).
 */


@Injectable()
export class DockerRuntimeActivityProjectorService {
  /**
   * Project an event, optionally carrying live swarm state.
   *
   * `enrichment` is what makes a swarm activity USEFUL. Without it a swarm event
   * can only render as `service.create` — the engine sends no state and never
   * sends task events at all, so the failure reason has to arrive from the live
   * read (see `SwarmActivityEnricherService`).
   */
  project(event: DockerRuntimeEvent, enrichment?: SwarmActivityEnrichment): DockerRuntimeActivityEntity {
    const now = new Date()
    const occurredAt = this.toTimestampDate(event.timestamp) ?? now
    const normalizedActorId = this.toNullableNonEmptyString(event.actorId)
    const isImageScanEvent = event.source === "image" && event.action.startsWith("scan_")

    const flowId = isImageScanEvent
      ? event.action === "scan_queued"
        ? `image-scan-queue:${normalizedActorId ?? "unknown"}`
        : `image-scan-run:${normalizedActorId ?? "unknown"}`
      : `${event.source}:${normalizedActorId ?? event.eventId ?? "event"}`

    const dependsOnFlowId = isImageScanEvent && event.action !== "scan_queued"
      ? `image-scan-queue:${normalizedActorId ?? "unknown"}`
      : null

    const swarmTasks = enrichment?.tasks ?? []
    const swarmService = enrichment?.service ?? null
    // A failed task outranks the event's own action for EVERY derived column:
    // the action is `update`/`create` regardless, while the task carries the
    // outcome. This is what turns an opaque `service.update` into
    // "2 of 3 tasks failed — no suitable node (host-mode port already in use)".
    const failedTask = swarmTasks.find((task) => task.error !== null) ?? null
    const hasFailedTask = failedTask !== null

    const status = hasFailedTask
      ? "error"
      : this.inferStatus(event.action, event.actorAttributes.scanState)
    const severity = hasFailedTask ? "error" : this.inferSeverity(event.action)
    const progress = this.toProgress(event.actorAttributes.scanProgress)
    const scanner = this.toNullableNonEmptyString(event.actorAttributes.scanScanner)
    const stage = this.toNullableNonEmptyString(event.actorAttributes.scanStage)
      ?? this.toNullableNonEmptyString(event.actorAttributes.scanState)
    // Priority: an explicit scan message, then the swarm failure reason, then the
    // generic derived message. The task error is the one an operator can ACT on.
    const message = this.toNullableNonEmptyString(event.actorAttributes.scanMessage)
      ?? this.toNullableNonEmptyString(event.actorAttributes.scanError)
      ?? failedTask?.error
      ?? swarmService?.updateMessage
      ?? this.resolveMessage(event)

    const eventFingerprint = this.createFingerprint(event)
    const key = event.eventId ?? eventFingerprint
    const id = `live:${key}`

    return {
      id,
      eventId: event.eventId ?? null,
      eventFingerprint,
      flowId,
      dependsOnFlowId,
      source: event.source,
      action: event.action,
      actorId: normalizedActorId,
      status,
      category: isImageScanEvent ? "image-scanning" : "runtime-event",
      severity,
      progress,
      stage,
      scanner,
      message,
      actorAttributes: event.actorAttributes,
      payload: isRecord(event.payload) ? event.payload : {},
      raw: event.raw,
      occurredAt: occurredAt.toISOString(),
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      swarmTasks: swarmTasks.map((task) => ({
        taskId: task.taskId,
        slot: task.slot,
        state: task.state,
        desiredState: task.desiredState,
        error: task.error,
      })),
      swarmService: swarmService === null
        ? null
        : {
            serviceId: swarmService.serviceId,
            serviceName: swarmService.serviceName,
            image: swarmService.image,
            mode: swarmService.mode,
            desiredTasks: swarmService.desiredTasks,
            runningTasks: swarmService.runningTasks,
            updateMessage: swarmService.updateMessage,
          },
    } satisfies DockerRuntimeActivityEntity
  }

  private inferStatus(
    action: string,
    scanState: string | undefined,
  ): DockerRuntimeActivityStatus {
    if (scanState === "queued" || action.includes("queued")) return "queued"
    if (scanState === "error" || action.includes("error") || action.includes("fail")) return "error"
    if (
      scanState === "completed"
      || action.includes("complete")
      || action.includes("done")
    ) return "completed"
    if (
      action.includes("start")
      || action.includes("progress")
      || action.includes("create")
      || action.includes("update")
      || action.includes("pull")
    ) return "running"
    return "info"
  }

  private inferSeverity(action: string): DockerRuntimeActivitySeverity {
    if (
      action.includes("error")
      || action.includes("fail")
      || action === "die"
      || action === "kill"
    ) return "error"
    if (action === "delete" || action === "destroy") return "warning"
    return "info"
  }

  private toProgress(raw: string | undefined): number | null {
    if (!raw) return null
    const parsed = Number(raw)
    if (!Number.isFinite(parsed)) return null
    if (parsed <= 0) return 0
    if (parsed >= 100) return 100
    return Math.round(parsed)
  }

  private toNullableNonEmptyString(value: string | null | undefined): string | null {
    if (typeof value !== "string") return null
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : null
  }

  private toTimestampDate(value: string | undefined): Date | null {
    if (typeof value !== "string") return null
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? null : parsed
  }

  private resolveMessage(event: DockerRuntimeEvent): string | null {
    const payload = isRecord(event.payload) ? event.payload : {}
    const candidates = [
      payload["containerName"],
      payload["imageName"],
      payload["repository"],
      payload["networkName"],
      payload["volumeName"],
      payload["serviceName"],
      payload["daemonName"],
      payload["builderName"],
    ]
    for (const candidate of candidates) {
      if (typeof candidate === "string" && candidate.trim().length > 0) {
        return candidate
      }
    }
    return null
  }

  private createFingerprint(event: DockerRuntimeEvent): string {
    const seed = [
      event.eventId ?? "",
      event.source,
      event.action,
      event.actorId ?? "",
      event.timestamp,
    ].join(":")
    return `live:${seed}`
  }
}
