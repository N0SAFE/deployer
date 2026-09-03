import type { TestingModule } from "@nestjs/testing";
import { Test } from "@nestjs/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { of } from "rxjs";
import { MeshStreamRuntimeService, type MeshOpenInternalBridgeInput } from "./mesh-stream-runtime.service";

/**
 * Current contract: cross-node stream proxying requires a registered mesh
 * stream-resource discovery registry, which does not exist yet (see the
 * service doc). openInternalBridge therefore ALWAYS serves the stream from
 * the local node by returning null — the honest, type-safe degraded behavior.
 * These tests pin that contract so a future registry implementation updates
 * them together with the service.
 */
describe("MeshStreamRuntimeService", () => {
    let service: MeshStreamRuntimeService;

    const buildInput = (overrides: Partial<MeshOpenInternalBridgeInput<unknown>> = {}): MeshOpenInternalBridgeInput<unknown> => ({
        context: {},
        resourceKey: "stream:deployment:dep_1",
        localEndpointPath: "/deployments/internal/dep_1/stream",
        metadata: {
            streamType: "deployment",
            streamId: "dep_1",
        },
        executeRemote: vi.fn(async () => of({ type: "statusChanged", sequence: 1 })),
        ...overrides,
    });

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [MeshStreamRuntimeService],
        }).compile();

        service = module.get<MeshStreamRuntimeService>(MeshStreamRuntimeService);
    });

    it("always serves streams from the local node (returns null) while no mesh stream registry exists", () => {
        const input = buildInput();

        const result = service.openInternalBridge(input);

        expect(result).toBeNull();
        expect(input.executeRemote).not.toHaveBeenCalled();
    });

    it("never constructs remote clients or executes remote streams (no cross-node data leak)", () => {
        const input = buildInput({
            context: {
                auth: {
                    session: {
                        activeOrganizationId: "00000000-0000-0000-0000-000000000111",
                    },
                },
            },
        });

        const result = service.openInternalBridge(input);

        expect(result).toBeNull();
        expect(input.executeRemote).not.toHaveBeenCalled();
        expect(vi.mocked(input.executeRemote).mock.calls).toHaveLength(0);
    });

    it("accepts request contexts and metadata without side effects", () => {
        const request = new Request("http://localhost/internal", {
            headers: {
                authorization: "Bearer mesh-user-token",
            },
        });

        const result = service.openInternalBridge(
            buildInput({
                context: { request },
                metadata: {
                    streamType: "deployment",
                    streamId: "dep_3",
                },
            }),
        );

        expect(result).toBeNull();
    });
});
