import type { TestingModule } from "@nestjs/testing";
import { Test } from "@nestjs/testing";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { of } from "rxjs";
import { DeploymentStreamOrchestratorService } from "./deployment-stream-orchestrator.service";
import { DeploymentService } from "../../services/deployment.service";
import { DeploymentStreamBridgeService } from "./deployment-stream-bridge.service";

describe("DeploymentStreamOrchestratorService", () => {
    let service: DeploymentStreamOrchestratorService;
    let mockDeploymentService: {
        streamDeploymentEvents: ReturnType<typeof vi.fn>;
    };
    let mockDeploymentStreamBridgeService: {
        tryProxyDeploymentStream: ReturnType<typeof vi.fn>;
    };

    beforeEach(async () => {
        mockDeploymentService = {
            streamDeploymentEvents: vi.fn(),
        };

        mockDeploymentStreamBridgeService = {
            tryProxyDeploymentStream: vi.fn(),
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                DeploymentStreamOrchestratorService,
                { provide: DeploymentService, useFactory: () => mockDeploymentService },
                {
                    provide: DeploymentStreamBridgeService,
                    useFactory: () => mockDeploymentStreamBridgeService,
                },
            ],
        }).compile();

        service = module.get<DeploymentStreamOrchestratorService>(DeploymentStreamOrchestratorService);

        vi.clearAllMocks();
    });

    it("returns proxied stream when mesh bridge resolves a remote owner", () => {
        const proxiedStream = of({
            type: "statusChanged",
            sequence: 1,
            replayed: false,
            status: "queued",
        });
        mockDeploymentStreamBridgeService.tryProxyDeploymentStream.mockReturnValue(proxiedStream);

        const result = service.openDeploymentStream({
            deploymentId: "00000000-0000-0000-0000-000000000010",
            replay: true,
            replayLimit: 25,
            context: {},
        });

        expect(result).toBe(proxiedStream);
        expect(mockDeploymentStreamBridgeService.tryProxyDeploymentStream).toHaveBeenCalledWith({
            deploymentId: "00000000-0000-0000-0000-000000000010",
            replay: true,
            replayLimit: 25,
            context: {},
        });
        expect(mockDeploymentService.streamDeploymentEvents).not.toHaveBeenCalled();
    });

    it("falls back to local deployment stream when no remote owner is resolved", () => {
        const localStream = of({
            type: "statusChanged",
            sequence: 2,
            replayed: true,
            status: "running",
        });

        mockDeploymentStreamBridgeService.tryProxyDeploymentStream.mockReturnValue(null);
        mockDeploymentService.streamDeploymentEvents.mockReturnValue(localStream);

        const result = service.openDeploymentStream({
            deploymentId: "00000000-0000-0000-0000-000000000020",
            replay: false,
            replayLimit: 10,
            context: {},
        });

        expect(result).toBe(localStream);
        expect(mockDeploymentService.streamDeploymentEvents).toHaveBeenCalledWith({
            deploymentId: "00000000-0000-0000-0000-000000000020",
            replay: false,
            replayLimit: 10,
        });
    });
});