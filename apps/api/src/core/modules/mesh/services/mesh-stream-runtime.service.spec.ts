import type { TestingModule } from "@nestjs/testing";
import { Test } from "@nestjs/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { firstValueFrom, of, toArray } from "rxjs";
import { verifyMeshToken } from "@repo/auth/mesh";
import { MeshStreamRuntimeService } from "./mesh-stream-runtime.service";
import { EnvService } from "@/config/env/env.service";
import { SystemMeshConfigService } from "./system-mesh-config.service";
import { SystemMeshResourceDiscoveryService } from "./system-mesh-resource-discovery.service";
import { MeshInternalRequestService } from "./mesh-internal-request.service";

const { createORPCClientMock, openAPILinkConstructorMock } = vi.hoisted(() => {
    return {
        createORPCClientMock: vi.fn(),
        openAPILinkConstructorMock: vi.fn(),
    };
});

vi.mock("@orpc/client", () => ({
    createORPCClient: createORPCClientMock,
}));

vi.mock("@orpc/openapi-client/fetch", () => ({
    OpenAPILink: class OpenAPILink {
        constructor(contract: unknown, options: unknown) {
            openAPILinkConstructorMock(contract, options);
            return { contract, options };
        }
    },
}));

describe("MeshStreamRuntimeService", () => {
    let queryBuilder: {
        where: ReturnType<typeof vi.fn>;
        autoRegister: ReturnType<typeof vi.fn>;
        firstRemote: ReturnType<typeof vi.fn>;
    };

    let meshResourceDiscoveryService: {
        select: ReturnType<typeof vi.fn>;
    };

    let envService: {
        get: ReturnType<typeof vi.fn>;
    };

    let meshConfigService: {
        getNodeServerUrl: ReturnType<typeof vi.fn>;
        getStreamSharedSecret: ReturnType<typeof vi.fn>;
    };

    let service: MeshStreamRuntimeService;

    const hasHeaderFactory = (value: unknown): value is { headers: () => Record<string, string> } => {
        if (!value || typeof value !== "object") {
            return false;
        }

        if (!("headers" in value)) {
            return false;
        }

        return typeof value.headers === "function";
    };

    beforeEach(async () => {
        queryBuilder = {
            where: vi.fn(),
            autoRegister: vi.fn(),
            firstRemote: vi.fn(),
        };

        queryBuilder.where.mockReturnValue(queryBuilder);
        queryBuilder.autoRegister.mockReturnValue(queryBuilder);

        meshResourceDiscoveryService = {
            select: vi.fn(() => queryBuilder),
        };

        envService = {
            get: vi.fn((key: string) => {
                if (key === "MESH_NODE_SERVER_URL") {
                    return "http://local.mesh.internal:3005";
                }

                if (key === "APP_URL") {
                    return "http://fallback.app.internal:3005";
                }

                return undefined;
            }),
        };

        meshConfigService = {
            getNodeServerUrl: vi.fn(() => "http://local.mesh.internal:3005"),
            getStreamSharedSecret: vi.fn(() => null),
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                MeshStreamRuntimeService,
                {
                    provide: SystemMeshResourceDiscoveryService,
                    useFactory: () => meshResourceDiscoveryService,
                },
                {
                    provide: EnvService,
                    useFactory: () => envService,
                },
                {
                    provide: SystemMeshConfigService,
                    useFactory: () => meshConfigService,
                },
                MeshInternalRequestService,
            ],
        }).compile();

        service = module.get<MeshStreamRuntimeService>(MeshStreamRuntimeService);

        createORPCClientMock.mockReset();
        openAPILinkConstructorMock.mockReset();
    });

    it("returns null when no remote owner is discovered", () => {
        queryBuilder.firstRemote.mockReturnValue(null);

        const executeRemote = vi.fn();

        const result = service.openInternalBridge({
            context: {
                auth: {
                    session: {
                        activeOrganizationId: "00000000-0000-0000-0000-000000000111",
                    },
                },
            },
            resourceKey: "stream:deployment:dep_1",
            localEndpointPath: "/deployments/internal/dep_1/stream",
            metadata: {
                streamType: "deployment",
                streamId: "dep_1",
            },
            executeRemote,
        });

        expect(result).toBeNull();
        expect(queryBuilder.autoRegister).toHaveBeenCalledTimes(1);
        expect(createORPCClientMock).not.toHaveBeenCalled();
        expect(executeRemote).not.toHaveBeenCalled();
    });

    it("opens remote bridge and emits remote observable values lazily", async () => {
        queryBuilder.firstRemote.mockReturnValue({
            ownerServerUrl: "https://remote.mesh.internal",
        });

        createORPCClientMock.mockReturnValue({
            deployment: {
                streamInternal: vi.fn(),
            },
        });

        const executeRemote = vi.fn(async () =>
            of(
                { type: "statusChanged", sequence: 1 },
                { type: "statusChanged", sequence: 2 },
            ),
        );

        const stream$ = service.openInternalBridge({
            context: {
                auth: {
                    session: {
                        activeOrganizationId: "00000000-0000-0000-0000-000000000222",
                    },
                },
            },
            resourceKey: "stream:deployment:dep_2",
            localEndpointPath: "/deployments/internal/dep_2/stream",
            metadata: {
                streamType: "deployment",
                streamId: "dep_2",
            },
            executeRemote,
        });

        expect(stream$).not.toBeNull();
        expect(executeRemote).not.toHaveBeenCalled();

        if (!stream$) {
            throw new Error("Expected an observable stream when remote owner exists");
        }

        const values = await firstValueFrom(stream$.pipe(toArray()));

        expect(values).toEqual([
            { type: "statusChanged", sequence: 1 },
            { type: "statusChanged", sequence: 2 },
        ]);
        expect(executeRemote).toHaveBeenCalledTimes(1);
    });

    it("forwards auth headers and signs mesh internal header when shared secret exists", async () => {
        queryBuilder.firstRemote.mockReturnValue({
            ownerServerUrl: "https://remote.mesh.internal",
        });

        meshConfigService.getNodeServerUrl.mockReturnValue("http://local.mesh.internal:3005");
        meshConfigService.getStreamSharedSecret.mockReturnValue("runtime-shared-secret");

        createORPCClientMock.mockReturnValue({
            deployment: {
                streamInternal: vi.fn(),
            },
        });

        const request = new Request("http://localhost/internal", {
            headers: {
                authorization: "Bearer mesh-user-token",
                cookie: "sid=test-session",
                "x-mesh-internal-key": "forwarded-token-ignored-when-secret-configured",
            },
        });

        const stream$ = service.openInternalBridge({
            context: { request },
            resourceKey: "stream:deployment:dep_3",
            localEndpointPath: "/deployments/internal/dep_3/stream",
            metadata: {
                streamType: "deployment",
                streamId: "dep_3",
            },
            executeRemote: async () => of({ type: "statusChanged", sequence: 1 }),
        });

        if (!stream$) {
            throw new Error("Expected an observable stream when remote owner exists");
        }

        await firstValueFrom(stream$);

        const openApiCall = openAPILinkConstructorMock.mock.calls[0];
        expect(openApiCall).toBeDefined();

        const options = openApiCall?.[1];
        if (!hasHeaderFactory(options)) {
            throw new Error("Expected OpenAPILink options to provide a headers() function");
        }

        const headers = options.headers();

        expect(headers.authorization).toBe("Bearer mesh-user-token");
        expect(headers.cookie).toBe("sid=test-session");
        expect(typeof headers["x-mesh-internal-key"]).toBe("string");
        expect(verifyMeshToken(headers["x-mesh-internal-key"], "runtime-shared-secret")).toBe(true);
    });
});