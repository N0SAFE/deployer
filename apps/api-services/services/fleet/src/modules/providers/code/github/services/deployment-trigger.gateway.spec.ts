import { beforeEach, describe, expect, it, vi } from "vitest";
import { verifySystemActorClaim } from "@deployer/shared/core/modules/auth/system-actor/system-actor";
import { DeploymentTriggerGateway } from "./deployment-trigger.gateway";

const SECRET = "a-secret-that-is-long-enough-for-tests";

describe("DeploymentTriggerGateway", () => {
    const triggerFromEvent = vi.fn();
    const systemActorClientFor = vi.fn(() => ({ triggerFromEvent }));
    const env = { get: vi.fn() };
    let gateway: DeploymentTriggerGateway;

    beforeEach(() => {
        vi.clearAllMocks();
        env.get.mockImplementation((key: string) => (key === "BETTER_AUTH_SECRET" ? SECRET : undefined));
        gateway = new DeploymentTriggerGateway({ systemActorClientFor } as never, env as never);
    });

    it("calls runtime with a claim runtime accepts, naming the source and delivery", async () => {
        triggerFromEvent.mockResolvedValue({ dispatched: true, sourceId: "github-push", deploymentId: "d", reason: null });

        const result = await gateway.relay({ provider: "github", eventName: "push", deliveryId: "del-1", payload: { a: 1 } });

        const [service, , token] = systemActorClientFor.mock.calls[0] as unknown as [string, unknown, string];
        expect(service).toBe("runtime");
        expect(verifySystemActorClaim(token, SECRET, "runtime")).toMatchObject({
            source: "github-push",
            deliveryId: "del-1",
        });
        expect(triggerFromEvent).toHaveBeenCalledWith({
            provider: "github",
            eventName: "push",
            deliveryId: "del-1",
            payload: { a: 1 },
        });
        expect(result.dispatched).toBe(true);
    });

    it("refuses to relay when no platform secret is configured", async () => {
        env.get.mockReturnValue(undefined);

        await expect(
            gateway.relay({ provider: "github", eventName: "push", deliveryId: "del-1", payload: {} }),
        ).rejects.toThrow(/BETTER_AUTH_SECRET/);
        expect(triggerFromEvent).not.toHaveBeenCalled();
    });
});
