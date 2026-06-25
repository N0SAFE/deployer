import { describe, expect, it } from "vitest";
import { DockerRuntimeActivityProjectorService } from "./docker-runtime-activity-projector.service";
import type { DockerRuntimeEvent } from "@repo/contracts-entities";

function makeEvent(overrides: Partial<DockerRuntimeEvent> = {}): DockerRuntimeEvent {
  const base = {
    eventId: "evt-1",
    source: "container" as const,
    action: "start" as const,
    actorId: "container-1" as string | null,
    actorAttributes: {} as Record<string, string>,
    payload: {} as DockerRuntimeEvent["payload"],
    from: "runtime" as string | null,
    timestamp: "2026-01-01T00:00:00.000Z",
    raw: {} as Record<string, unknown>,
  };
  return { ...base, ...overrides } as DockerRuntimeEvent;
}

describe("DockerRuntimeActivityProjectorService", () => {
  const service = new DockerRuntimeActivityProjectorService();

  it("projects a container start event into a running activity", () => {
    const activity = service.project(makeEvent());
    expect(activity.source).toBe("container");
    expect(activity.action).toBe("start");
    expect(activity.actorId).toBe("container-1");
    expect(activity.status).toBe("running");
    expect(activity.severity).toBe("info");
    expect(activity.category).toBe("runtime-event");
    expect(activity.occurredAt).toBe("2026-01-01T00:00:00.000Z");
  });

  it("marks failure actions as error severity", () => {
    const activity = service.project(
      makeEvent({ action: "die", actorId: "container-1" }),
    );
    expect(activity.severity).toBe("error");
  });

  it("marks actions that include 'error' as error status", () => {
    const activity = service.project(
      makeEvent({ action: "container_error", actorId: "container-1" }),
    );
    expect(activity.status).toBe("error");
    expect(activity.severity).toBe("error");
  });

  it("marks destroy/delete actions as warning severity", () => {
    const activity = service.project(
      makeEvent({ action: "destroy", actorId: "container-1" }),
    );
    expect(activity.status).toBe("info");
    expect(activity.severity).toBe("warning");
  });

  it("infers image-scanning category for image scan events", () => {
    const activity = service.project(
      makeEvent({ source: "image", action: "scan_progress", actorId: "image-1" }),
    );
    expect(activity.category).toBe("image-scanning");
  });

  it("extracts progress from actorAttributes", () => {
    const activity = service.project(
      makeEvent({
        source: "image",
        action: "scan_progress",
        actorId: "image-1",
        actorAttributes: { scanProgress: "42" },
      }),
    );
    expect(activity.progress).toBe(42);
  });

  it("clamps progress to 0..100", () => {
    expect(
      service.project(
        makeEvent({
          source: "image",
          action: "scan_progress",
          actorId: "image-1",
          actorAttributes: { scanProgress: "-5" },
        }),
      ).progress,
    ).toBe(0);
    expect(
      service.project(
        makeEvent({
          source: "image",
          action: "scan_progress",
          actorId: "image-1",
          actorAttributes: { scanProgress: "150" },
        }),
      ).progress,
    ).toBe(100);
  });

  it("uses scanStage/scanState as stage fallback", () => {
    const activity = service.project(
      makeEvent({
        source: "image",
        action: "scan_queued",
        actorId: "image-1",
        actorAttributes: { scanStage: "manifest" },
      }),
    );
    expect(activity.stage).toBe("manifest");
  });

  it("produces a stable fingerprint for identical events", () => {
    const a = service.project(makeEvent());
    const b = service.project(makeEvent());
    expect(a.eventFingerprint).toBe(b.eventFingerprint);
    expect(a.id).toBe(b.id);
  });

  it("produces a different fingerprint for different events", () => {
    const a = service.project(makeEvent({ eventId: "evt-1" }));
    const b = service.project(makeEvent({ eventId: "evt-2" }));
    expect(a.eventFingerprint).not.toBe(b.eventFingerprint);
  });

  it("handles missing actorId gracefully", () => {
    const activity = service.project(makeEvent({ actorId: null }));
    expect(activity.actorId).toBeNull();
  });

  it("links scan events via dependsOnFlowId to the queue", () => {
    const queued = service.project(
      makeEvent({
        source: "image",
        action: "scan_queued",
        actorId: "image-1",
      }),
    );
    const progress = service.project(
      makeEvent({
        source: "image",
        action: "scan_progress",
        actorId: "image-1",
        actorAttributes: { scanProgress: "50" },
      }),
    );
    const complete = service.project(
      makeEvent({
        source: "image",
        action: "scan_complete",
        actorId: "image-1",
        actorAttributes: { scanProgress: "100" },
      }),
    );
    // The queue gets a `image-scan-queue:*` flow, subsequent steps get
    // `image-scan-run:*` and depend on the queue.
    expect(queued.flowId).toBe("image-scan-queue:image-1");
    expect(progress.flowId).toBe("image-scan-run:image-1");
    expect(complete.flowId).toBe("image-scan-run:image-1");
    expect(progress.dependsOnFlowId).toBe(queued.flowId);
    expect(complete.dependsOnFlowId).toBe(queued.flowId);
  });
});
