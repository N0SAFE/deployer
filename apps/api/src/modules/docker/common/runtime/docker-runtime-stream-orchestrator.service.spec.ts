import { describe, expect, it, vi } from "vitest";
import { Subject, of } from "rxjs";
import { firstValueFrom } from "rxjs";
import { toArray } from "rxjs/operators";
import {
    dockerImageInspectDetailSchema,
    dockerContainerRuntimeEventSchema,
    dockerImageRuntimeEventSchema,
    dockerUnknownRuntimeEventSchema,
} from "@repo/contracts-entities";
import { DockerRuntimeStreamOrchestratorService } from "./docker-runtime-stream-orchestrator.service";

describe("DockerRuntimeStreamOrchestratorService", () => {
    it("filters runtime events by selected scope/action and time bounds", async () => {
        const dockerRuntimeMeshRelayService = {
            observeEvents: vi.fn(() =>
                of(
                    dockerUnknownRuntimeEventSchema.parse({
                        type: "docker_event",
                        source: "unknown",
                        action: "noop",
                        actorId: null,
                        actorAttributes: {},
                        scope: null,
                        from: null,
                        eventId: "evt-1",
                        nodeId: null,
                        timestamp: "2026-01-01T10:00:00.000Z",
                        timestampNano: null,
                        raw: {},
                        payload: {
                            entityId: null,
                            entityName: null,
                        },
                    }),
                    dockerContainerRuntimeEventSchema.parse({
                        type: "docker_event",
                        source: "container",
                        action: "start",
                        actorId: "ctr-1",
                        actorAttributes: {},
                        scope: null,
                        from: null,
                        eventId: "evt-2",
                        nodeId: null,
                        timestamp: "2026-01-01T10:01:00.000Z",
                        timestampNano: null,
                        raw: {},
                        payload: {
                            containerId: "ctr-1",
                            containerName: "api",
                            image: null,
                            exitCode: null,
                            signal: null,
                        },
                    }),
                    dockerImageRuntimeEventSchema.parse({
                        type: "docker_event",
                        source: "image",
                        action: "pull",
                        actorId: "img-1",
                        actorAttributes: {},
                        scope: null,
                        from: null,
                        eventId: "evt-3",
                        nodeId: null,
                        timestamp: "2026-01-01T10:02:00.000Z",
                        timestampNano: null,
                        raw: {},
                        payload: {
                            imageId: "img-1",
                            imageName: "repo/app",
                            repository: "repo/app",
                            tag: "latest",
                        },
                    }),
                ),
            ),
        };

        const dockerContainerResolutionService = {
            inspectContainer: vi.fn(),
        };

        const dockerContainerMetricsStreamService = {
            stream: vi.fn(() => of()),
        };

        const dockerRepository = {
            inspectImage: vi.fn(),
        };

        const service = new DockerRuntimeStreamOrchestratorService(
            dockerRuntimeMeshRelayService as never,
            dockerContainerResolutionService as never,
            dockerContainerMetricsStreamService as never,
            dockerRepository as never,
        );

        const events = await firstValueFrom(
            service.stream({
                since: new Date("2026-01-01T10:00:30.000Z"),
                until: new Date("2026-01-01T10:01:30.000Z"),
                filter: {
                    source: {
                        operator: "eq",
                        value: "container",
                    },
                    action: {
                        operator: "in",
                        value: ["start"],
                    },
                },
            }).pipe(toArray()),
        );

        expect(events).toHaveLength(1);
        expect(events[0]?.source).toBe("container");
        expect(events[0]?.action).toBe("start");
    });

    it("returns only selected scopes and actions when filter uses _or", async () => {
        const dockerRuntimeMeshRelayService = {
            observeEvents: vi.fn(() =>
                of(
                    dockerContainerRuntimeEventSchema.parse({
                        type: "docker_event",
                        source: "container",
                        action: "die",
                        actorId: "ctr-2",
                        actorAttributes: {},
                        scope: null,
                        from: null,
                        eventId: "evt-4",
                        nodeId: null,
                        timestamp: "2026-01-01T11:00:00.000Z",
                        timestampNano: null,
                        raw: {},
                        payload: {
                            containerId: "ctr-2",
                            containerName: "worker",
                            image: null,
                            exitCode: 1,
                            signal: null,
                        },
                    }),
                    dockerContainerRuntimeEventSchema.parse({
                        type: "docker_event",
                        source: "container",
                        action: "create",
                        actorId: "ctr-3",
                        actorAttributes: {},
                        scope: null,
                        from: null,
                        eventId: "evt-6",
                        nodeId: null,
                        timestamp: "2026-01-01T11:00:02.000Z",
                        timestampNano: null,
                        raw: {},
                        payload: {
                            containerId: "ctr-3",
                            containerName: "api",
                            image: null,
                            exitCode: null,
                            signal: null,
                        },
                    }),
                    dockerImageRuntimeEventSchema.parse({
                        type: "docker_event",
                        source: "image",
                        action: "delete",
                        actorId: "img-2",
                        actorAttributes: {},
                        scope: null,
                        from: null,
                        eventId: "evt-5",
                        nodeId: null,
                        timestamp: "2026-01-01T11:00:01.000Z",
                        timestampNano: null,
                        raw: {},
                        payload: {
                            imageId: "img-2",
                            imageName: null,
                            repository: null,
                            tag: null,
                        },
                    }),
                ),
            ),
        };

        const dockerContainerResolutionService = {
            inspectContainer: vi.fn(),
        };

        const dockerContainerMetricsStreamService = {
            stream: vi.fn(() => of()),
        };

        const dockerRepository = {
            inspectImage: vi.fn(),
        };

        const service = new DockerRuntimeStreamOrchestratorService(
            dockerRuntimeMeshRelayService as never,
            dockerContainerResolutionService as never,
            dockerContainerMetricsStreamService as never,
            dockerRepository as never,
        );

        const scopedOrFilter: Record<string, unknown> = {
            _or: [
                {
                    source: {
                        operator: "eq",
                        value: "container",
                    },
                    action: {
                        operator: "in",
                        value: ["die"],
                    },
                },
                {
                    source: {
                        operator: "eq",
                        value: "image",
                    },
                    action: {
                        operator: "in",
                        value: ["delete"],
                    },
                },
            ],
        };

        const events = await firstValueFrom(
            service.stream({
                filter: scopedOrFilter,
            }).pipe(toArray()),
        );

        expect(events).toHaveLength(2);
        expect(events.map((event) => `${event.source}:${event.action}`)).toEqual([
            "container:die",
            "image:delete",
        ]);
    });

    it("pauses inspect interval retries after not-found and resumes on runtime trigger", async () => {
        vi.useFakeTimers();

        try {
            const runtimeEvents$ = new Subject<ReturnType<typeof dockerContainerRuntimeEventSchema.parse>>();

            const dockerRuntimeMeshRelayService = {
                observeEvents: vi.fn(() => runtimeEvents$.asObservable()),
            };

            const dockerContainerResolutionService = {
                inspectContainer: vi
                    .fn()
                    .mockRejectedValueOnce({ statusCode: 404, message: "Container not found" })
                    .mockRejectedValue({ statusCode: 404, message: "Container not found" }),
            };

            const dockerContainerMetricsStreamService = {
                stream: vi.fn(() => of()),
            };

            const dockerRepository = {
                inspectImage: vi.fn(),
            };

            const service = new DockerRuntimeStreamOrchestratorService(
                dockerRuntimeMeshRelayService as never,
                dockerContainerResolutionService as never,
                dockerContainerMetricsStreamService as never,
                dockerRepository as never,
            );

            const subscription = service.streamContainerInspect({
                containerId: "ctr-paused",
                refreshIntervalMs: 500,
            }).subscribe();

            await vi.advanceTimersByTimeAsync(1_500);
            expect(dockerContainerResolutionService.inspectContainer).toHaveBeenCalledTimes(1);

            runtimeEvents$.next(dockerContainerRuntimeEventSchema.parse({
                type: "docker_event",
                source: "container",
                action: "start",
                actorId: "ctr-paused",
                actorAttributes: {},
                scope: null,
                from: null,
                eventId: "evt-resume-1",
                nodeId: null,
                timestamp: "2026-01-01T13:00:00.000Z",
                timestampNano: null,
                raw: {},
                payload: {
                    containerId: "ctr-paused",
                    containerName: "api",
                    image: null,
                    exitCode: null,
                    signal: null,
                },
            }));

            await vi.advanceTimersByTimeAsync(1);
            expect(dockerContainerResolutionService.inspectContainer).toHaveBeenCalledTimes(2);

            subscription.unsubscribe();
            runtimeEvents$.complete();
        } finally {
            vi.useRealTimers();
        }
    });

    it("enables container metrics stream when metrics action is requested", async () => {
        const dockerRuntimeMeshRelayService = {
            observeEvents: vi.fn(() => of()),
        };

        const dockerContainerResolutionService = {
            inspectContainer: vi.fn(),
        };

        const dockerContainerMetricsStreamService = {
            stream: vi.fn(() =>
                of(
                    dockerContainerRuntimeEventSchema.parse({
                        type: "docker_event",
                        source: "container",
                        action: "metrics",
                        actorId: "ctr-1",
                        actorAttributes: { metricsSource: "systeminformation" },
                        scope: null,
                        from: null,
                        eventId: "evt-metrics-1",
                        nodeId: null,
                        timestamp: "2026-01-01T11:00:05.000Z",
                        timestampNano: null,
                        raw: {},
                        payload: {
                            containerId: "ctr-1",
                            containerName: "api",
                            image: null,
                            exitCode: null,
                            signal: null,
                            metrics: {
                                at: "2026-01-01T11:00:05.000Z",
                                cpu: 10,
                                memory: 20,
                                networkRxKb: 1,
                                networkTxKb: 2,
                                ioReadKb: 0.5,
                                ioWriteKb: 0.75,
                            },
                            metricsSource: "systeminformation",
                        },
                    }),
                ),
            ),
        };

        const dockerRepository = {
            inspectImage: vi.fn(),
        };

        const service = new DockerRuntimeStreamOrchestratorService(
            dockerRuntimeMeshRelayService as never,
            dockerContainerResolutionService as never,
            dockerContainerMetricsStreamService as never,
            dockerRepository as never,
        );

        const events = await firstValueFrom(
            service.stream({
                filter: {
                    action: {
                        operator: "eq",
                        value: "metrics",
                    },
                    source: {
                        operator: "eq",
                        value: "container",
                    },
                },
            }).pipe(toArray()),
        );

        expect(dockerContainerMetricsStreamService.stream).toHaveBeenCalledTimes(1);
        expect(events).toHaveLength(1);
        expect(events[0]?.action).toBe("metrics");
    });

    it("enables metrics stream when action filter uses nested _and with in operator", async () => {
        const dockerRuntimeMeshRelayService = {
            observeEvents: vi.fn(() => of()),
        };

        const dockerContainerResolutionService = {
            inspectContainer: vi.fn(),
        };

        const dockerContainerMetricsStreamService = {
            stream: vi.fn(() =>
                of(
                    dockerContainerRuntimeEventSchema.parse({
                        type: "docker_event",
                        source: "container",
                        action: "metrics",
                        actorId: "ctr-1",
                        actorAttributes: { metricsSource: "systeminformation" },
                        scope: null,
                        from: null,
                        eventId: "evt-metrics-2",
                        nodeId: null,
                        timestamp: "2026-01-01T11:00:06.000Z",
                        timestampNano: null,
                        raw: {},
                        payload: {
                            containerId: "ctr-1",
                            containerName: "api",
                            image: null,
                            exitCode: null,
                            signal: null,
                            metrics: {
                                at: "2026-01-01T11:00:06.000Z",
                                cpu: 11,
                                memory: 21,
                                networkRxKb: 1,
                                networkTxKb: 2,
                                ioReadKb: 0.5,
                                ioWriteKb: 0.75,
                            },
                            metricsSource: "systeminformation",
                        },
                    }),
                ),
            ),
        };

        const dockerRepository = {
            inspectImage: vi.fn(),
        };

        const service = new DockerRuntimeStreamOrchestratorService(
            dockerRuntimeMeshRelayService as never,
            dockerContainerResolutionService as never,
            dockerContainerMetricsStreamService as never,
            dockerRepository as never,
        );

        const events = await firstValueFrom(
            service.stream({
                filter: {
                    _and: [
                        {
                            source: {
                                operator: "eq",
                                value: "container",
                            },
                        },
                        {
                            containerId: {
                                operator: "eq",
                                value: "ctr-1",
                            },
                        },
                        {
                            action: {
                                operator: "in",
                                value: ["metrics", "start"],
                            },
                        },
                    ],
                },
            }).pipe(toArray()),
        );

        expect(dockerContainerMetricsStreamService.stream).toHaveBeenCalledTimes(1);
        expect(events).toHaveLength(1);
        expect(events[0]?.action).toBe("metrics");
    });

    it("enables metrics stream when nested in-filter values are encoded as indexed objects", async () => {
        const dockerRuntimeMeshRelayService = {
            observeEvents: vi.fn(() => of()),
        };

        const dockerContainerResolutionService = {
            inspectContainer: vi.fn(),
        };

        const dockerContainerMetricsStreamService = {
            stream: vi.fn(() =>
                of(
                    dockerContainerRuntimeEventSchema.parse({
                        type: "docker_event",
                        source: "container",
                        action: "metrics",
                        actorId: "ctr-1",
                        actorAttributes: { metricsSource: "systeminformation" },
                        scope: null,
                        from: null,
                        eventId: "evt-metrics-object-in-1",
                        nodeId: null,
                        timestamp: "2026-01-01T11:00:07.000Z",
                        timestampNano: null,
                        raw: {},
                        payload: {
                            containerId: "ctr-1",
                            containerName: "api",
                            image: null,
                            exitCode: null,
                            signal: null,
                            metrics: {
                                at: "2026-01-01T11:00:07.000Z",
                                cpu: 12,
                                memory: 22,
                                networkRxKb: 1,
                                networkTxKb: 2,
                                ioReadKb: 0.5,
                                ioWriteKb: 0.75,
                            },
                            metricsSource: "systeminformation",
                        },
                    }),
                ),
            ),
        };

        const dockerRepository = {
            inspectImage: vi.fn(),
        };

        const service = new DockerRuntimeStreamOrchestratorService(
            dockerRuntimeMeshRelayService as never,
            dockerContainerResolutionService as never,
            dockerContainerMetricsStreamService as never,
            dockerRepository as never,
        );

        const events = await firstValueFrom(
            service.stream({
                filter: {
                    _and: [
                        {
                            source: {
                                operator: "eq",
                                value: "container",
                            },
                        },
                        {
                            action: {
                                operator: "in",
                                // Legacy JSON-safe wire encoding: indexed-object
                                // in-values (runtime normalizes via toUnknownArray).
                                value: {
                                    "0": "metrics",
                                    "1": "start",
                                } as unknown as string[],
                            },
                        },
                    ],
                },
            }).pipe(toArray()),
        );

        expect(dockerContainerMetricsStreamService.stream).toHaveBeenCalledTimes(1);
        expect(events).toHaveLength(1);
        expect(events[0]?.action).toBe("metrics");
    });

    it("enables metrics stream when _and groups are encoded as indexed objects", async () => {
        const dockerRuntimeMeshRelayService = {
            observeEvents: vi.fn(() => of()),
        };

        const dockerContainerResolutionService = {
            inspectContainer: vi.fn(),
        };

        const dockerContainerMetricsStreamService = {
            stream: vi.fn(() =>
                of(
                    dockerContainerRuntimeEventSchema.parse({
                        type: "docker_event",
                        source: "container",
                        action: "metrics",
                        actorId: "ctr-1",
                        actorAttributes: { metricsSource: "systeminformation" },
                        scope: null,
                        from: null,
                        eventId: "evt-metrics-object-and-1",
                        nodeId: null,
                        timestamp: "2026-01-01T11:00:08.000Z",
                        timestampNano: null,
                        raw: {},
                        payload: {
                            containerId: "ctr-1",
                            containerName: "api",
                            image: null,
                            exitCode: null,
                            signal: null,
                            metrics: {
                                at: "2026-01-01T11:00:08.000Z",
                                cpu: 13,
                                memory: 23,
                                networkRxKb: 1,
                                networkTxKb: 2,
                                ioReadKb: 0.5,
                                ioWriteKb: 0.75,
                            },
                            metricsSource: "systeminformation",
                        },
                    }),
                ),
            ),
        };

        const dockerRepository = {
            inspectImage: vi.fn(),
        };

        const service = new DockerRuntimeStreamOrchestratorService(
            dockerRuntimeMeshRelayService as never,
            dockerContainerResolutionService as never,
            dockerContainerMetricsStreamService as never,
            dockerRepository as never,
        );

        const events = await firstValueFrom(
            service.stream({
                filter: {
                    _and: [
                        {
                            source: {
                                operator: "eq",
                                value: "container",
                            },
                        },
                        {
                            action: {
                                operator: "in",
                                // Legacy JSON-safe wire encoding: indexed-object
                                // in-values (runtime normalizes via toUnknownArray).
                                value: {
                                    "0": "metrics",
                                    "1": "start",
                                } as unknown as string[],
                            },
                        },
                    ],
                },
            }).pipe(toArray()),
        );

        expect(dockerContainerMetricsStreamService.stream).toHaveBeenCalledTimes(1);
        expect(events).toHaveLength(1);
        expect(events[0]?.action).toBe("metrics");
    });

    it("applies fast-path ID filters before generic filter evaluation", async () => {
        const dockerRuntimeMeshRelayService = {
            observeEvents: vi.fn(() =>
                of(
                    dockerContainerRuntimeEventSchema.parse({
                        type: "docker_event",
                        source: "container",
                        action: "start",
                        actorId: "ctr-1",
                        actorAttributes: {},
                        scope: null,
                        from: null,
                        eventId: "evt-fastpath-1",
                        nodeId: "node-a",
                        timestamp: "2026-01-01T12:00:00.000Z",
                        timestampNano: null,
                        raw: {},
                        payload: {
                            containerId: "ctr-1",
                            containerName: "api",
                            image: null,
                            exitCode: null,
                            signal: null,
                        },
                    }),
                    dockerContainerRuntimeEventSchema.parse({
                        type: "docker_event",
                        source: "container",
                        action: "start",
                        actorId: "ctr-2",
                        actorAttributes: {},
                        scope: null,
                        from: null,
                        eventId: "evt-fastpath-2",
                        nodeId: "node-b",
                        timestamp: "2026-01-01T12:00:01.000Z",
                        timestampNano: null,
                        raw: {},
                        payload: {
                            containerId: "ctr-2",
                            containerName: "worker",
                            image: null,
                            exitCode: null,
                            signal: null,
                        },
                    }),
                ),
            ),
        };

        const dockerContainerResolutionService = {
            inspectContainer: vi.fn(),
        };

        const dockerContainerMetricsStreamService = {
            stream: vi.fn(() => of()),
        };

        const dockerRepository = {
            inspectImage: vi.fn(),
        };

        const service = new DockerRuntimeStreamOrchestratorService(
            dockerRuntimeMeshRelayService as never,
            dockerContainerResolutionService as never,
            dockerContainerMetricsStreamService as never,
            dockerRepository as never,
        );

        const events = await firstValueFrom(
            service.stream({
                filter: {
                    containerId: {
                        operator: "eq",
                        value: "ctr-2",
                    },
                },
            }).pipe(toArray()),
        );

        expect(events).toHaveLength(1);
        expect(events[0]?.actorId).toBe("ctr-2");
    });

    it("matches container filters with short/full container IDs", async () => {
        const dockerRuntimeMeshRelayService = {
            observeEvents: vi.fn(() =>
                of(
                    dockerContainerRuntimeEventSchema.parse({
                        type: "docker_event",
                        source: "container",
                        action: "start",
                        actorId: "0123456789abcdef",
                        actorAttributes: {},
                        scope: null,
                        from: null,
                        eventId: "evt-short-id-1",
                        nodeId: null,
                        timestamp: "2026-01-01T12:10:00.000Z",
                        timestampNano: null,
                        raw: {},
                        payload: {
                            containerId: "0123456789abcdef",
                            containerName: "api",
                            image: null,
                            exitCode: null,
                            signal: null,
                        },
                    }),
                ),
            ),
        };

        const dockerContainerResolutionService = {
            inspectContainer: vi.fn(),
        };

        const dockerContainerMetricsStreamService = {
            stream: vi.fn(() => of()),
        };

        const dockerRepository = {
            inspectImage: vi.fn(),
        };

        const service = new DockerRuntimeStreamOrchestratorService(
            dockerRuntimeMeshRelayService as never,
            dockerContainerResolutionService as never,
            dockerContainerMetricsStreamService as never,
            dockerRepository as never,
        );

        const events = await firstValueFrom(
            service.stream({
                filter: {
                    containerId: {
                        operator: "eq",
                        value: "0123456789ab",
                    },
                },
            }).pipe(toArray()),
        );

        expect(events).toHaveLength(1);
        const payload = events[0]?.payload;
        if (payload && "containerId" in payload) {
            expect(payload.containerId).toBe("0123456789abcdef");
        } else {
            throw new Error("expected a container runtime payload");
        }
    });

    it("streams image inspect details with runtime-trigger and polling inputs", async () => {
        const dockerRuntimeMeshRelayService = {
            observeEvents: vi.fn(() =>
                of(
                    dockerImageRuntimeEventSchema.parse({
                        type: "docker_event",
                        source: "image",
                        action: "pull",
                        actorId: "sha256:image-1",
                        actorAttributes: {},
                        scope: null,
                        from: null,
                        eventId: "evt-image-stream-1",
                        nodeId: null,
                        timestamp: "2026-01-01T13:00:00.000Z",
                        timestampNano: null,
                        raw: {},
                        payload: {
                            imageId: "sha256:image-1",
                            imageName: "docker.io/library/nginx",
                            repository: "library/nginx",
                            tag: "latest",
                        },
                    }),
                ),
            ),
        };

        const dockerContainerResolutionService = {
            inspectContainer: vi.fn(),
        };

        const dockerContainerMetricsStreamService = {
            stream: vi.fn(() => of()),
        };

        const dockerRepository = {
            inspectImage: vi.fn(() => Promise.resolve(
                dockerImageInspectDetailSchema.parse({
                    imageId: "sha256:image-1",
                    generatedAt: "2026-01-01T13:00:00.000Z",
                    registry: "docker.io",
                    repository: "library/nginx",
                    tag: "latest",
                    digest: null,
                    sizeBytes: 123,
                    createdAt: "2026-01-01T00:00:00.000Z",
                    lastSeenAt: "2026-01-01T13:00:00.000Z",
                    labels: {},
                    architecture: "amd64",
                    os: "linux",
                    variant: null,
                    author: null,
                    comment: null,
                    dockerVersion: null,
                    rootFsType: "layers",
                    repoTags: ["docker.io/library/nginx:latest"],
                    repoDigests: [],
                    layers: [],
                    vulnerabilities: [],
                    usedByContainerIds: [],
                    runtimeConfig: {
                        env: [],
                        exposedPorts: [],
                        workingDir: null,
                        user: null,
                        entrypoint: [],
                        command: [],
                    },
                }),
            )),
        };

        const service = new DockerRuntimeStreamOrchestratorService(
            dockerRuntimeMeshRelayService as never,
            dockerContainerResolutionService as never,
            dockerContainerMetricsStreamService as never,
            dockerRepository as never,
        );

        const detail = await firstValueFrom(service.streamImageInspect({ imageId: "sha256:image-1" }));

        expect(detail.imageId).toBe("sha256:image-1");
        expect(dockerRepository.inspectImage).toHaveBeenCalled();
    });
});
