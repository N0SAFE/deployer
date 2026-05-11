import { describe, expect, it, vi } from "vitest";
import { Subject } from "rxjs";
import { dockerContainerRuntimeEventSchema } from "@repo/contracts-entities";
import { DockerRuntimeEventsStreamService } from "./docker-runtime-events-stream.service";

describe("DockerRuntimeEventsStreamService", () => {
  it("subscribes to relay on module init and forwards runtime events", async () => {
    const relayEvents$ = new Subject<ReturnType<typeof dockerContainerRuntimeEventSchema.parse>>();

    const dockerRuntimeMeshRelayService = {
      observeRuntimeEvents: vi.fn(() => relayEvents$),
    };

    const service = new DockerRuntimeEventsStreamService(dockerRuntimeMeshRelayService as never);

    const received: Array<ReturnType<typeof dockerContainerRuntimeEventSchema.parse>> = [];
    const subscription = service.observeEvents().subscribe((event) => {
      received.push(event as ReturnType<typeof dockerContainerRuntimeEventSchema.parse>);
    });

    service.onModuleInit();
    service.onModuleInit();

    relayEvents$.next(dockerContainerRuntimeEventSchema.parse({
      type: "docker_event",
      source: "container",
      action: "create",
      actorId: "ctr-stream-1",
      actorAttributes: {
        meshNodeId: "node-local",
      },
      scope: null,
      from: null,
      eventId: "evt-stream-1",
      nodeId: null,
      timestamp: "2026-04-17T10:00:00.000Z",
      timestampNano: null,
      raw: {},
      payload: {
        containerId: "ctr-stream-1",
        containerName: "api",
        image: "repo/app:latest",
        exitCode: null,
        signal: null,
      },
    }));

    await Promise.resolve();

    expect(dockerRuntimeMeshRelayService.observeRuntimeEvents).toHaveBeenCalledTimes(1);
    expect(received).toHaveLength(1);
    expect(received[0]?.action).toBe("create");

    service.onModuleDestroy();
    subscription.unsubscribe();
    relayEvents$.complete();
  });
});