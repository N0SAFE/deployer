import { Test } from "@nestjs/testing";
import { describe, expect, it, vi } from "vitest";

import { DeploymentService } from "../../services/deployment.service";

import { DeploymentStreamOrchestratorService } from "./deployment-stream-orchestrator.service";

describe("DeploymentStreamOrchestratorService", () => {
    async function build(streamDeploymentEvents: ReturnType<typeof vi.fn>) {
        const module = await Test.createTestingModule({
            providers: [
                DeploymentStreamOrchestratorService,
                { provide: DeploymentService, useFactory: () => ({ streamDeploymentEvents }) },
            ],
        }).compile();
        return module.get(DeploymentStreamOrchestratorService);
    }

    it("opens the deployment's stream from this node, with the replay the caller asked for", async () => {
        const stream = { subscribe: vi.fn() };
        const streamDeploymentEvents = vi.fn().mockReturnValue(stream);
        const orchestrator = await build(streamDeploymentEvents);

        const result = orchestrator.openDeploymentStream({ deploymentId: "dep-1", replay: true, replayLimit: 25 });

        expect(result).toBe(stream);
        expect(streamDeploymentEvents).toHaveBeenCalledWith({ deploymentId: "dep-1", replay: true, replayLimit: 25 });
    });
});
