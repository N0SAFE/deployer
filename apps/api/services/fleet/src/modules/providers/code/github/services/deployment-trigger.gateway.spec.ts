import { provideTo } from "@deployer/effect-core";
import { Cause, Effect, Exit } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { verifySystemActorClaim } from "@deployer/shared/core/modules/auth/system-actor/system-actor";

import { PlatformEnv, type PlatformEnvShape } from "@/core/ports/platform-env.port";
import { SystemActorClients, type SystemActorClientsShape } from "@/core/ports/system-actor-clients.port";
import { DeploymentTriggerGateway } from "./deployment-trigger.gateway";

const SECRET = "a-secret-that-is-long-enough-for-tests";

/** Run an Effect and reject with the ORIGINAL failure. */
async function run<A, E>(effect: Effect.Effect<A, E>): Promise<A> {
    const exit = await Effect.runPromiseExit(effect);
    if (Exit.isSuccess(exit)) return exit.value;
    throw Cause.squash(exit.cause);
}

describe("DeploymentTriggerGateway", () => {
    const triggerFromEvent = vi.fn();
    const systemActorClientFor = vi.fn(() => ({ triggerFromEvent }));
    const env = { get: vi.fn() };
    // The fakes need nothing from the context beyond what is provided here.
    const gateway = provideTo(DeploymentTriggerGateway.live, (effect) =>
        effect.pipe(
            Effect.provideService(SystemActorClients, { systemActorClientFor } as unknown as SystemActorClientsShape),
            Effect.provideService(PlatformEnv, env as unknown as PlatformEnvShape),
        ) as Effect.Effect<unknown>,
    );

    beforeEach(() => {
        vi.clearAllMocks();
        env.get.mockImplementation((key: string) => (key === "BETTER_AUTH_SECRET" ? SECRET : undefined));
    });

    it("calls runtime with a claim runtime accepts, naming the source and delivery", async () => {
        triggerFromEvent.mockResolvedValue({ dispatched: true, sourceId: "github-push", deploymentId: "d", reason: null });

        const result = await run(gateway.relay({ provider: "github", eventName: "push", deliveryId: "del-1", payload: { a: 1 } }));

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

    it("falls back to AUTH_SECRET when BETTER_AUTH_SECRET is not set", async () => {
        env.get.mockImplementation((key: string) => (key === "AUTH_SECRET" ? SECRET : undefined));
        triggerFromEvent.mockResolvedValue({ dispatched: false, sourceId: null, deploymentId: null, reason: null });

        await run(gateway.relay({ provider: "github", eventName: "push", deliveryId: "del-2", payload: {} }));

        const [, , token] = systemActorClientFor.mock.calls[0] as unknown as [string, unknown, string];
        expect(verifySystemActorClaim(token, SECRET, "runtime")).toMatchObject({ deliveryId: "del-2" });
    });

    it("refuses to relay when no platform secret is configured", async () => {
        env.get.mockReturnValue(undefined);

        await expect(
            run(gateway.relay({ provider: "github", eventName: "push", deliveryId: "del-1", payload: {} })),
        ).rejects.toThrow(/BETTER_AUTH_SECRET/);
        expect(triggerFromEvent).not.toHaveBeenCalled();
    });

    it("lets the runtime's own refusal through unchanged", async () => {
        const refusal = new Error("runtime said no");
        triggerFromEvent.mockRejectedValue(refusal);

        await expect(
            run(gateway.relay({ provider: "github", eventName: "push", deliveryId: "del-3", payload: {} })),
        ).rejects.toBe(refusal);
    });
});
