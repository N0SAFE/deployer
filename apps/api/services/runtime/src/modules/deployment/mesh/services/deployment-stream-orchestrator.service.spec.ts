import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";

import { DeploymentStreamsPort } from "../../deployment.ports";

import { DeploymentStreamOrchestratorService } from "./deployment-stream-orchestrator.service";

describe("DeploymentStreamOrchestratorService", () => {
    it("opens the deployment's stream from this node, with the replay the caller asked for", async () => {
        const stream = { subscribe: vi.fn() };
        const streamDeploymentEvents = vi.fn().mockReturnValue(stream);

        const result = await Effect.runPromise(
            DeploymentStreamOrchestratorService.live
                .openDeploymentStream({ deploymentId: "dep-1", replay: true, replayLimit: 25 })
                .pipe(Effect.provideService(DeploymentStreamsPort, { streamDeploymentEvents } as never)),
        );

        expect(result).toBe(stream);
        expect(streamDeploymentEvents).toHaveBeenCalledWith({ deploymentId: "dep-1", replay: true, replayLimit: 25 });
    });
});
