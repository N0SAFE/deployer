import { describe, expect, it, vi } from "vitest";
import { Subject } from "rxjs";
import { dockerContainerRuntimeEventSchema, dockerImageRuntimeEventSchema } from "@repo/contracts-entities";
import { DockerImageAutoScanListenerService } from "./docker-image-auto-scan-listener.service";

async function flushAsyncWork(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function createServiceHarness(options?: {
  listContainersImpl?: () => Promise<{
    data: Array<{ imageId: string | null; managedImageRef: string | null }>;
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

  const dockerContainerResolutionService = {
    listContainers: vi.fn(
      options?.listContainersImpl
      ?? (async () => ({
        data: [],
        meta: {
          total: 0,
          limit: 250,
          offset: 0,
          hasMore: false,
        },
      })),
    ),
  };

  const dockerImagesApplicationService = {
    ensureImageSecurityScan: vi.fn(async (input: { imageId: string }) => ({
      started: true,
      reason: "started" as const,
      imageId: input.imageId,
    })),
  };

  const service = new DockerImageAutoScanListenerService(
    systemMeshTopologyService as never,
    dockerRuntimeEventsStreamService as never,
    dockerRuntimeMeshRelayService as never,
    dockerContainerResolutionService as never,
    dockerImagesApplicationService as never,
  );

  return {
    service,
    runtimeEvents$,
    dockerContainerResolutionService,
    dockerImagesApplicationService,
  };
}

describe("DockerImageAutoScanListenerService", () => {
  it("triggers auto-scan for container create events with image payload", async () => {
    const { service, runtimeEvents$, dockerImagesApplicationService } = createServiceHarness();

    service.onModuleInit();
    await flushAsyncWork();

    runtimeEvents$.next(dockerContainerRuntimeEventSchema.parse({
      type: "docker_event",
      source: "container",
      action: "create",
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
    const { service, dockerContainerResolutionService, dockerImagesApplicationService } = createServiceHarness();

    const dockerRuntimeEventsStreamService = {
      observeEvents: vi.fn(() => runtimeEvents$),
    };

    const serviceWithCustomStream = new DockerImageAutoScanListenerService(
      { getLocalNode: vi.fn(() => ({ nodeId: "node-local" })) } as never,
      dockerRuntimeEventsStreamService as never,
      { relayRuntimeEvent: vi.fn() } as never,
      dockerContainerResolutionService as never,
      dockerImagesApplicationService as never,
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

  it("ignores container create events emitted by a different mesh node", async () => {
    const { service, runtimeEvents$, dockerImagesApplicationService } = createServiceHarness();

    service.onModuleInit();
    await flushAsyncWork();

    runtimeEvents$.next(dockerContainerRuntimeEventSchema.parse({
      type: "docker_event",
      source: "container",
      action: "create",
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
    const { service, dockerContainerResolutionService, dockerImagesApplicationService } = createServiceHarness({
      listContainersImpl: async () => ({
        data: [
          { imageId: "sha256:image-a", managedImageRef: null },
          { imageId: "sha256:image-a", managedImageRef: null },
          { imageId: null, managedImageRef: "repo/worker:latest" },
        ],
        meta: {
          total: 3,
          limit: 250,
          offset: 0,
          hasMore: false,
        },
      }),
    });

    service.onModuleInit();
    await flushAsyncWork();

    expect(dockerContainerResolutionService.listContainers).toHaveBeenCalledTimes(1);
    expect(dockerContainerResolutionService.listContainers).toHaveBeenCalledWith(
      {
        limit: 250,
        offset: 0,
        sortBy: "updatedAt",
        sortDirection: "desc",
        filter: {},
      },
      {
        localOnly: true,
      },
    );

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
    let firstResolve: (() => void) | null = null;

    const { service, dockerImagesApplicationService } = createServiceHarness({
      listContainersImpl: async () => ({
        data: [
          { imageId: "sha256:first", managedImageRef: null },
          { imageId: "sha256:second", managedImageRef: null },
        ],
        meta: {
          total: 2,
          limit: 250,
          offset: 0,
          hasMore: false,
        },
      }),
    });

    dockerImagesApplicationService.ensureImageSecurityScan = vi
      .fn()
      .mockImplementationOnce(async () => new Promise((resolve) => {
        firstResolve = () => {
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
      }));

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

    firstResolve?.();
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
