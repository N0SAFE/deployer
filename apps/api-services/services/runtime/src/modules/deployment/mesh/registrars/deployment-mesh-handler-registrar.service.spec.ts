import { describe, expect, it, vi } from "vitest";
import { NotFoundException } from "@nestjs/common";
import { DeploymentMeshHandlerRegistrar } from "./deployment-mesh-handler-registrar.service";

describe("DeploymentMeshHandlerRegistrar", () => {
    it("registers resolve/search/list handlers on module init", () => {
        const deploymentMeshService = {
            registerResolveDeploymentHandler: vi.fn(),
            registerSearchDeploymentsHandler: vi.fn(),
            registerListDeploymentsHandler: vi.fn(),
        };

        const deploymentService = {
            getDeploymentById: vi.fn(),
            listDeployments: vi.fn(),
            getProjectServiceIds: vi.fn(),
        };

        const topologyService = {
            getLocalNode: vi.fn(() => ({ nodeId: "00000000-0000-4000-8000-000000000001" })),
        };

        const registrar = new DeploymentMeshHandlerRegistrar(
            deploymentMeshService as never,
            deploymentService as never,
            topologyService as never,
        );

        registrar.onModuleInit();

        expect(deploymentMeshService.registerResolveDeploymentHandler).toHaveBeenCalledTimes(1);
        expect(deploymentMeshService.registerSearchDeploymentsHandler).toHaveBeenCalledTimes(1);
        expect(deploymentMeshService.registerListDeploymentsHandler).toHaveBeenCalledTimes(1);
    });

    it("resolve handler returns found=true when deployment exists", async () => {
        let resolveHandler: ((input: any) => Promise<any>) | undefined;

        const deploymentMeshService = {
            registerResolveDeploymentHandler: vi.fn((handler) => {
                resolveHandler = handler;
            }),
            registerSearchDeploymentsHandler: vi.fn(),
            registerListDeploymentsHandler: vi.fn(),
        };

        const deploymentService = {
            getDeploymentById: vi.fn(() => ({
                id: "00000000-0000-4000-8000-000000000101",
            })),
            listDeployments: vi.fn(),
            getProjectServiceIds: vi.fn(),
        };

        const topologyService = {
            getLocalNode: vi.fn(() => ({ nodeId: "00000000-0000-4000-8000-000000000001" })),
        };

        const registrar = new DeploymentMeshHandlerRegistrar(
            deploymentMeshService as never,
            deploymentService as never,
            topologyService as never,
        );

        registrar.onModuleInit();

        const result = await resolveHandler?.({
            payload: {
                deploymentId: "00000000-0000-4000-8000-000000000101",
                key: "deployment:00000000-0000-4000-8000-000000000101",
            },
        });

        expect(result.payload.found).toBe(true);
        expect(result.stopPropagation).toBe(true);
        expect(result.payload.ownerNodeId).toBe("00000000-0000-4000-8000-000000000001");
    });

    it("resolve handler returns found=false when deployment does not exist", async () => {
        let resolveHandler: ((input: any) => Promise<any>) | undefined;

        const deploymentMeshService = {
            registerResolveDeploymentHandler: vi.fn((handler) => {
                resolveHandler = handler;
            }),
            registerSearchDeploymentsHandler: vi.fn(),
            registerListDeploymentsHandler: vi.fn(),
        };

        const deploymentService = {
            getDeploymentById: vi.fn(() => {
                throw new NotFoundException("missing");
            }),
            listDeployments: vi.fn(),
            getProjectServiceIds: vi.fn(),
        };

        const topologyService = {
            getLocalNode: vi.fn(() => ({ nodeId: "00000000-0000-4000-8000-000000000001" })),
        };

        const registrar = new DeploymentMeshHandlerRegistrar(
            deploymentMeshService as never,
            deploymentService as never,
            topologyService as never,
        );

        registrar.onModuleInit();

        const result = await resolveHandler?.({
            payload: {
                deploymentId: "00000000-0000-4000-8000-000000000999",
                key: "deployment:00000000-0000-4000-8000-000000000999",
            },
        });

        expect(result.payload.found).toBe(false);
        expect(result.stopPropagation).toBeUndefined();
    });

    it("search handler filters results by query and marks stopPropagation when matches exist", async () => {
        let searchHandler: ((input: any) => Promise<any>) | undefined;

        const deploymentMeshService = {
            registerResolveDeploymentHandler: vi.fn(),
            registerSearchDeploymentsHandler: vi.fn((handler) => {
                searchHandler = handler;
            }),
            registerListDeploymentsHandler: vi.fn(),
        };

        const deploymentService = {
            getDeploymentById: vi.fn(),
            listDeployments: vi.fn(() => ({
                data: [
                    {
                        id: "00000000-0000-4000-8000-000000000101",
                        serviceId: "00000000-0000-4000-8000-000000000501",
                        status: "success",
                        environment: "production",
                        metadata: null,
                    },
                    {
                        id: "00000000-0000-4000-8000-000000000102",
                        serviceId: "00000000-0000-4000-8000-000000000502",
                        status: "failed",
                        environment: "staging",
                        metadata: null,
                    },
                ],
                meta: { total: 2, limit: 25, offset: 0 },
            })),
            getProjectServiceIds: vi.fn(),
        };

        const topologyService = {
            getLocalNode: vi.fn(() => ({ nodeId: "00000000-0000-4000-8000-000000000001" })),
        };

        const registrar = new DeploymentMeshHandlerRegistrar(
            deploymentMeshService as never,
            deploymentService as never,
            topologyService as never,
        );

        registrar.onModuleInit();

        const result = await searchHandler?.({
            payload: {
                query: "staging",
                limit: 25,
            },
        });

        expect(result.payload.items).toHaveLength(1);
        expect(result.payload.items[0]?.environment).toBe("staging");
        expect(result.stopPropagation).toBe(true);
    });

    it("list handler fans out by project service ids", async () => {
        let listHandler: ((input: any) => Promise<any>) | undefined;

        const deploymentMeshService = {
            registerResolveDeploymentHandler: vi.fn(),
            registerSearchDeploymentsHandler: vi.fn(),
            registerListDeploymentsHandler: vi.fn((handler) => {
                listHandler = handler;
            }),
        };

        const deploymentService = {
            getDeploymentById: vi.fn(),
            getProjectServiceIds: vi.fn(() => [
                "00000000-0000-4000-8000-000000000601",
                "00000000-0000-4000-8000-000000000602",
            ]),
            listDeployments: vi
                .fn()
                .mockResolvedValueOnce({
                    data: [
                        {
                            id: "00000000-0000-4000-8000-000000000201",
                            serviceId: "00000000-0000-4000-8000-000000000601",
                            status: "success",
                            environment: "production",
                            metadata: null,
                        },
                    ],
                    meta: { total: 1, limit: 50, offset: 0 },
                })
                .mockResolvedValueOnce({
                    data: [
                        {
                            id: "00000000-0000-4000-8000-000000000202",
                            serviceId: "00000000-0000-4000-8000-000000000602",
                            status: "failed",
                            environment: "staging",
                            metadata: null,
                        },
                    ],
                    meta: { total: 1, limit: 50, offset: 0 },
                }),
        };

        const topologyService = {
            getLocalNode: vi.fn(() => ({ nodeId: "00000000-0000-4000-8000-000000000001" })),
        };

        const registrar = new DeploymentMeshHandlerRegistrar(
            deploymentMeshService as never,
            deploymentService as never,
            topologyService as never,
        );

        registrar.onModuleInit();

        const result = await listHandler?.({
            payload: {
                projectId: "00000000-0000-4000-8000-000000000777",
                limit: 50,
            },
        });

        expect(deploymentService.listDeployments).toHaveBeenCalledTimes(2);
        expect(result.payload.items).toHaveLength(2);
        expect(result.payload.total).toBe(2);
    });
});
