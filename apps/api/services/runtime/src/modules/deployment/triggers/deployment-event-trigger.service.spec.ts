import { beforeEach, describe, expect, it, vi } from "vitest";
import { DeploymentEventTriggerService } from "./deployment-event-trigger.service";

const actor = { kind: "system", source: "github-push", deliveryId: "d-1", aud: "runtime", exp: 0 } as const;
const event = { provider: "github", eventName: "push", payload: {} };

describe("DeploymentEventTriggerService", () => {
    const registry = { toTriggerInput: vi.fn() };
    const deploymentService = { triggerDeploymentAsSystem: vi.fn() };
    let service: DeploymentEventTriggerService;

    beforeEach(() => {
        vi.clearAllMocks();
        service = new DeploymentEventTriggerService(registry as never, deploymentService as never);
    });

    it("queues the deployment the matched source produced, as the system", async () => {
        const input = { serviceId: "svc-1", environment: "production" };
        registry.toTriggerInput.mockResolvedValue({ sourceId: "github-push", input });
        deploymentService.triggerDeploymentAsSystem.mockResolvedValue({ id: "dep-1" });

        const result = await service.trigger(event, actor);

        expect(deploymentService.triggerDeploymentAsSystem).toHaveBeenCalledWith(input);
        expect(result).toEqual({ dispatched: true, sourceId: "github-push", deploymentId: "dep-1", reason: null });
    });

    it("reports no source as a normal outcome, not an error", async () => {
        registry.toTriggerInput.mockResolvedValue(null);

        const result = await service.trigger(event, actor);

        expect(result).toMatchObject({ dispatched: false, sourceId: null, reason: "no_trigger_source:github/push" });
        expect(deploymentService.triggerDeploymentAsSystem).not.toHaveBeenCalled();
    });

    it("reports a matched source that declined to produce input", async () => {
        registry.toTriggerInput.mockResolvedValue({ sourceId: "github-push", input: null });

        const result = await service.trigger(event, actor);

        expect(result).toMatchObject({ dispatched: false, sourceId: "github-push", reason: "not_deployable:github-push" });
        expect(deploymentService.triggerDeploymentAsSystem).not.toHaveBeenCalled();
    });

    it("lets a deployment failure propagate", async () => {
        registry.toTriggerInput.mockResolvedValue({ sourceId: "api", input: { serviceId: "svc-1" } });
        deploymentService.triggerDeploymentAsSystem.mockRejectedValue(new Error("boom"));

        await expect(service.trigger(event, actor)).rejects.toThrow("boom");
    });
});
