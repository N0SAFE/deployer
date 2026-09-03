import { describe, expect, it, vi } from "vitest";
import { Subject } from "rxjs";
import { dockerContainerRuntimeEventSchema, dockerImageRuntimeEventSchema } from "@repo/contracts-entities";
import { DockerImageAutoScanListenerService } from "./docker-image-auto-scan-listener.service";

async function flushAsyncWork(): Promise<void> {
  // The bootstrap path awaits listImages + reconcile before the drain queue
  // runs, so give the microtask chain enough rounds to complete.
  for (let i = 0; i < 10; i++) {
    await Promise.resolve();
  }
}

function createServiceHarness(options?: {
  listImagesImpl?: (offset: number) => Promise<{
    data: Array<{ id: string | null }>;
    meta: { total: number; limit: number; offset: number; hasMore: boolean };
  }>;
}) {
  const runtimeEvents$ = new Subject<ReturnType<typeof dockerContainerRuntimeEventSchema.parse>>();

  const systemMeshTopologyService = {
    getLocalNode: vi.fn(() => ({ nodeId: "node-local" })),
  };

  const dockerRuntimeEventsStreamService = {
    observeEvents: vi.fn(() => runtimeEvents$),
  };

  const dockerRuntimeMeshRelayService = {
    relayRuntimeEvent: vi.fn(),
  };

  const dockerImagesApplicationService = {
    ensureImageSecurityScan: vi.fn(async (input: { imageId: string }) => ({
      started: true,
      reason: "started" as const,
      imageId: input.imageId,
    })),
    listImages: vi.fn(async ({ offset }: { offset: number }) => {
      const page = options?.listImagesImpl
        ? await options.listImagesImpl(offset)
        : {
            data: [],
            meta: { total: 0, limit: 500, offset, hasMore: false },
          };
      return page;
    }),
  };
  const dockerImageSecurityRepository = {
    recordAutoScanAttempt: vi.fn(async () => undefined),
    reconcileImageLifecycleWithActiveSet: vi.fn(async () => undefined),
    ensureImageAutoScanEligibility: vi.fn(async () => ({ shouldScan: true })),
  };

  const envService = {
    get: vi.fn(() => false),
  };

  const service = new DockerImageAutoScanListenerService(
    systemMeshTopologyService as never,
    dockerRuntimeEventsStreamService as never,
    dockerRuntimeMeshRelayService as never,
    dockerImagesApplicationService as never,
    dockerImageSecurityRepository as never,
    envService as never,
  );

  return {
    service,
    runtimeEvents$,
    dockerImagesApplicationService,
  };
}

describe("DockerImageAutoScanListenerService", () => {
  it("triggers auto-scan for container start events with image payload", async () => {
    const { service, runtimeEvents$, dockerImagesApplicationService } = createServiceHarness();

    service.onModuleInit();
    await flushAsyncWork();

    runtimeEvents$.next(dockerContainerRuntimeEventSchema.parse({
      type: "docker_event",
      source: "container",
      action: "start",
      actorId: "ctr-1",
      actorAttributes: {
        meshNodeId: "node-local",
      },
      scope: null,
      from: null,
      eventId: "evt-1",
      nodeId: null,
      timestamp: "2026-04-17T09:30:00.000Z",
      timestampNano: null,
      raw: {},
      payload: {
        containerId: "ctr-1",
        containerName: "api",
        image: "repo/app:latest",
        exitCode: null,
        signal: null,
      },
    }));

    await flushAsyncWork();

    expect(dockerImagesApplicationService.ensureImageSecurityScan).toHaveBeenCalledTimes(1);
    expect(dockerImagesApplicationService.ensureImageSecurityScan).toHaveBeenCalledWith({
      imageId: "repo/app:latest",
      forceScan: false,
      maxCacheAgeMs: 21_600_000,
    }, {
      waitForCompletion: true,
    });

    service.onModuleDestroy();
  });

  it("ignores non-container and non-create runtime events", async () => {
    const runtimeEvents$ = new Subject<unknown>();
    const { service, dockerImagesApplicationService } = createServiceHarness();

    const dockerRuntimeEventsStreamService = {
      observeEvents: vi.fn(() => runtimeEvents$),
    };

    const dockerImageSecurityRepository = { recordAutoScanAttempt: vi.fn(async () => undefined) };
    const envService = { get: vi.fn(() => false) };

    const serviceWithCustomStream = new DockerImageAutoScanListenerService(
      { getLocalNode: vi.fn(() => ({ nodeId: "node-local" })) } as never,
      dockerRuntimeEventsStreamService as never,
      { relayRuntimeEvent: vi.fn() } as never,
      dockerImagesApplicationService as never,
      dockerImageSecurityRepository as never,
      envService as never,
    );

    serviceWithCustomStream.onModuleInit();
    await flushAsyncWork();

    runtimeEvents$.next(dockerImageRuntimeEventSchema.parse({
      type: "docker_event",
      source: "image",
      action: "pull",
      actorId: "img-1",
      actorAttributes: {
        meshNodeId: "node-local",
      },
      scope: null,
      from: null,
      eventId: "evt-2",
      nodeId: null,
      timestamp: "2026-04-17T09:30:01.000Z",
      timestampNano: null,
      raw: {},
      payload: {
        imageId: "img-1",
        imageName: "repo/app",
        repository: "repo/app",
        tag: "latest",
      },
    }));

    runtimeEvents$.next(dockerContainerRuntimeEventSchema.parse({
      type: "docker_event",
      source: "container",
      action: "start",
      actorId: "ctr-2",
      actorAttributes: {
        meshNodeId: "node-local",
      },
      scope: null,
      from: null,
      eventId: "evt-3",
      nodeId: null,
      timestamp: "2026-04-17T09:30:02.000Z",
      timestampNano: null,
      raw: {},
      payload: {
        containerId: "ctr-2",
        containerName: "worker",
        image: "repo/worker:latest",
        exitCode: null,
        signal: null,
      },
    }));

    await flushAsyncWork();

    expect(dockerImagesApplicationService.ensureImageSecurityScan).not.toHaveBeenCalled();

    serviceWithCustomStream.onModuleDestroy();
    service.onModuleDestroy();
  });

  it("ignores container start events emitted by a different mesh node", async () => {
    const { service, runtimeEvents$, dockerImagesApplicationService } = createServiceHarness();

    service.onModuleInit();
    await flushAsyncWork();

    runtimeEvents$.next(dockerContainerRuntimeEventSchema.parse({
      type: "docker_event",
      source: "container",
      action: "start",
      actorId: "ctr-3",
      actorAttributes: {
        meshNodeId: "node-remote",
      },
      scope: null,
      from: null,
      eventId: "evt-4",
      nodeId: null,
      timestamp: "2026-04-17T09:30:03.000Z",
      timestampNano: null,
      raw: {},
      payload: {
        containerId: "ctr-3",
        containerName: "remote-api",
        image: "repo/remote:latest",
        exitCode: null,
        signal: null,
      },
    }));

    await flushAsyncWork();

    expect(dockerImagesApplicationService.ensureImageSecurityScan).not.toHaveBeenCalled();

    service.onModuleDestroy();
  });

  it("queues startup scans for unique local container images", async () => {
    const { service, dockerImagesApplicationService } = createServiceHarness({
      listImagesImpl: async () => ({
        data: [
          { id: "sha256:image-a" },
          { id: "sha256:image-a" },
          { id: "repo/worker:latest" },
        ],
        meta: {
          total: 3,
          limit: 500,
          offset: 0,
          hasMore: false,
        },
      }),
    });

    service.onModuleInit();
    await flushAsyncWork();

    expect(dockerImagesApplicationService.listImages).toHaveBeenCalledTimes(1);
    expect(dockerImagesApplicationService.listImages).toHaveBeenCalledWith({
      limit: 500,
      offset: 0,
      sortBy: "lastSeenAt",
      sortDirection: "desc",
      filter: {},
    });

    expect(dockerImagesApplicationService.ensureImageSecurityScan).toHaveBeenCalledTimes(2);
    expect(dockerImagesApplicationService.ensureImageSecurityScan).toHaveBeenNthCalledWith(1, {
      imageId: "sha256:image-a",
      forceScan: false,
      maxCacheAgeMs: 21_600_000,
    }, {
      waitForCompletion: true,
    });
    expect(dockerImagesApplicationService.ensureImageSecurityScan).toHaveBeenNthCalledWith(2, {
      imageId: "repo/worker:latest",
      forceScan: false,
      maxCacheAgeMs: 21_600_000,
    }, {
      waitForCompletion: true,
    });

    service.onModuleDestroy();
  });

  it("drains startup queue sequentially by waiting for each scan completion", async () => {
    // Deferred-resolve holder — TS narrows closure-written lets to never, so
    // keep the mutable slot OUT of the mock closure (a mutable holder object).
    const deferred: { resolveFirst: (() => void) | null } = { resolveFirst: null };

    const { service, dockerImagesApplicationService } = createServiceHarness({
      listImagesImpl: async () => ({
        data: [
          { id: "sha256:first" },
          { id: "sha256:second" },
        ],
        meta: {
          total: 2,
          limit: 500,
          offset: 0,
          hasMore: false,
        },
      }),
    });

    // Vitest's generic mockImplementationOnce collapses heterogeneous
    // implementations to never — keep the plain mock type at the fixture
    // boundary (consistent with the file's existing `as never` fixtures).
    (dockerImagesApplicationService as { ensureImageSecurityScan: ReturnType<typeof vi.fn> }).ensureImageSecurityScan = vi
      .fn()
      .mockImplementationOnce(() => new Promise<{ started: boolean; reason: string; imageId: string }>((resolve) => {
        deferred.resolveFirst = () => {
          resolve({
            started: true,
            reason: "started" as const,
            imageId: "sha256:first",
          });
        };
      }))
      .mockImplementationOnce(async () => ({
        started: true,
        reason: "started" as const,
        imageId: "sha256:second",
      })) as ReturnType<typeof vi.fn>;

    service.onModuleInit();
    await flushAsyncWork();

    expect(dockerImagesApplicationService.ensureImageSecurityScan).toHaveBeenCalledTimes(1);
    expect(dockerImagesApplicationService.ensureImageSecurityScan).toHaveBeenNthCalledWith(1, {
      imageId: "sha256:first",
      forceScan: false,
      maxCacheAgeMs: 21_600_000,
    }, {
      waitForCompletion: true,
    });

    deferred.resolveFirst?.();
    await flushAsyncWork();

    expect(dockerImagesApplicationService.ensureImageSecurityScan).toHaveBeenCalledTimes(2);
    expect(dockerImagesApplicationService.ensureImageSecurityScan).toHaveBeenNthCalledWith(2, {
      imageId: "sha256:second",
      forceScan: false,
      maxCacheAgeMs: 21_600_000,
    }, {
      waitForCompletion: true,
    });

    service.onModuleDestroy();
  });
});
