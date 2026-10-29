import { createHash } from "node:crypto";
import { dockerRuntimeEventSourceSchema, type DockerRuntimeEvent } from "@deployer/contracts-entities";
import { isRecord } from "@deployer/type-guards";

/**
 * How a runtime event becomes an activity entry: its status, severity, message, progress and fingerprint. Pure.
 */

export function toNullableNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function toTimestampDate(value: string): Date | null {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function toProgress(value: string | undefined): number | null {
  if (typeof value !== "string") {
    return null;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  if (parsed <= 0) return 0;
  if (parsed >= 100) return 100;
  return Math.round(parsed);
}

export function inferRuntimeActivityStatus(
  action: string,
  scanState?: string,
): "queued" | "running" | "completed" | "error" | "info" {
  const normalizedAction = action.toLowerCase();
  const normalizedState = scanState?.toLowerCase();

  if (normalizedState === "queued" || normalizedAction.includes("queued")) {
    return "queued";
  }

  if (normalizedState === "error" || normalizedAction.includes("error") || normalizedAction.includes("fail")) {
    return "error";
  }

  if (normalizedState === "completed" || normalizedAction.includes("complete") || normalizedAction.includes("done")) {
    return "completed";
  }

  if (
    normalizedAction.includes("start")
    || normalizedAction.includes("progress")
    || normalizedAction.includes("pull")
    || normalizedAction.includes("create")
    || normalizedAction.includes("update")
  ) {
    return "running";
  }

  return "info";
}

export function inferRuntimeActivitySeverity(action: string): "info" | "warning" | "error" {
  const normalizedAction = action.toLowerCase();
  if (normalizedAction.includes("error") || normalizedAction.includes("fail")) {
    return "error";
  }

  if (
    normalizedAction.includes("die")
    || normalizedAction.includes("kill")
    || normalizedAction.includes("destroy")
    || normalizedAction.includes("delete")
    || normalizedAction.includes("remove")
  ) {
    return "warning";
  }

  return "info";
}

export function resolveRuntimeActivityMessage(event: DockerRuntimeEvent): string | null {
  const payload: Record<string, unknown> = isRecord(event.payload) ? event.payload : {};
  const candidates = [
    payload.containerName,
    payload.imageName,
    payload.repository,
    payload.networkName,
    payload.volumeName,
    payload.serviceName,
  ];

  for (const candidate of candidates) {
    const normalized = toNullableNonEmptyString(candidate);
    if (normalized) {
      return normalized;
    }
  }

  return null;
}

export function createRuntimeActivityFingerprint(event: DockerRuntimeEvent): string {
  const payload = isRecord(event.payload) ? event.payload : {};
  return createHash("sha1")
    .update(
      [
        event.eventId ?? "",
        event.timestamp,
        event.source,
        event.action,
        event.actorId ?? "",
        JSON.stringify(payload),
      ].join("|"),
    )
    .digest("hex");
}

export function parseRuntimeActivitySource(value: string): DockerRuntimeEvent["source"] {
  const parsed = dockerRuntimeEventSourceSchema.safeParse(value);
  return parsed.success ? parsed.data : "unknown";
}
