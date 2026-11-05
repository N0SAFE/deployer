import { Cause, Effect, Exit } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { Actor, CurrentActor } from "@deployer/effect-core";

import { DeploymentEventTriggerService } from "./deployment-event-trigger.service";
import { DeploymentTriggerRegistry, type TriggerSourceServices } from "./deployment-trigger-registry.service";
import { SystemDeploymentsPort, TriggerServiceLinkPort } from "./deployment-trigger.ports";

const event = { provider: "github", eventName: "push", payload: {} };

/** Run as the system component the claim named, rejecting with the ORIGINAL failure. */
async function run<A, E>(
    effect: Effect.Effect<A, E, CurrentActor | DeploymentTriggerRegistry | TriggerSourceServices | SystemDeploymentsPort>,
    ports: { registry: unknown; deploymentService: unknown },
): Promise<A> {
    const exit = await Effect.runPromiseExit(
        effect.pipe(
            Effect.provideService(CurrentActor, Actor.system("github-push")),
            Effect.provideService(DeploymentTriggerRegistry, ports.registry as never),
            Effect.provideService(TriggerServiceLinkPort, {} as never),
            Effect.provideService(SystemDeploymentsPort, ports.deploymentService as never),
        ),
    );
    if (Exit.isSuccess(exit)) return exit.value;
    throw Cause.squash(exit.cause);
}

describe("DeploymentEventTriggerService", () => {
    const registry = { toTriggerInput: vi.fn() };
    const deploymentService = { triggerDeploymentAsSystem: vi.fn() };
    const service = new DeploymentEventTriggerService.live();
    const runWith = <A, E>(effect: Effect.Effect<A, E, CurrentActor | DeploymentTriggerRegistry | TriggerSourceServices | SystemDeploymentsPort>) =>
        run(effect, { registry, deploymentService });

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("queues the deployment the matched source produced, as the system", async () => {
        const input = { serviceId: "svc-1", environment: "production" };
        registry.toTriggerInput.mockReturnValue(Effect.succeed({ sourceId: "github-push", input }));
        deploymentService.triggerDeploymentAsSystem.mockReturnValue(Effect.succeed({ id: "dep-1" }));

        const result = await runWith(service.trigger(event, "d-1"));

        expect(deploymentService.triggerDeploymentAsSystem).toHaveBeenCalledWith(input);
        expect(result).toEqual({ dispatched: true, sourceId: "github-push", deploymentId: "dep-1", reason: null });
    });

    it("reports no source as a normal outcome, not an error", async () => {
        registry.toTriggerInput.mockReturnValue(Effect.succeed(null));

        const result = await runWith(service.trigger(event, "d-1"));

        expect(result).toMatchObject({ dispatched: false, sourceId: null, reason: "no_trigger_source:github/push" });
        expect(deploymentService.triggerDeploymentAsSystem).not.toHaveBeenCalled();
    });

    it("reports a matched source that declined to produce input", async () => {
        registry.toTriggerInput.mockReturnValue(Effect.succeed({ sourceId: "github-push", input: null }));

        const result = await runWith(service.trigger(event, "d-1"));

        expect(result).toMatchObject({ dispatched: false, sourceId: "github-push", reason: "not_deployable:github-push" });
        expect(deploymentService.triggerDeploymentAsSystem).not.toHaveBeenCalled();
    });

    it("lets a deployment failure propagate, unchanged", async () => {
        registry.toTriggerInput.mockReturnValue(Effect.succeed({ sourceId: "api", input: { serviceId: "svc-1" } }));
        deploymentService.triggerDeploymentAsSystem.mockReturnValue(Effect.fail(new Error("boom")));

        await expect(runWith(service.trigger(event, null))).rejects.toThrow("boom");
    });
});
