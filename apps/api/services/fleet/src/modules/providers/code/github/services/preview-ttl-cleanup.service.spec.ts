import { Effect, Fiber } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { provideTo } from "@deployer/effect-core";
import type { EffectHostShape } from "@deployer/nest-effect";

import { PreviewProvisioningService, type PreviewProvisioningServiceShape } from "./preview-provisioning.service";
import {
    PreviewTtlCleanupService,
    startPreviewTtlCleanup,
    type PreviewTtlCleanupServiceShape,
} from "./preview-ttl-cleanup.service";

const expired = (id: string) => ({ id, serviceId: `svc-${id}`, previewName: `pr-${id}`, fullDomain: `pr-${id}.example.com` });

const provisioning = {
    findExpiredPreviews: vi.fn(() => Effect.succeed([expired("1"), expired("2")])),
    expirePreview: vi.fn((_id: string, _serviceId: string, _previewName: string) => Effect.succeed({})),
};
// The fake needs nothing from the context beyond what is provided here.
const service = provideTo(PreviewTtlCleanupService.live, (effect) =>
    effect.pipe(
        Effect.provideService(PreviewProvisioningService, provisioning as unknown as PreviewProvisioningServiceShape),
    ) as Effect.Effect<unknown>,
);

/** A host that records the program instead of running it, so the loop can be started on demand. */
function fakeHost() {
    const forks: { label: string; effect: unknown }[] = [];
    const stop = vi.fn(() => Promise.resolve());
    const host = {
        fork: vi.fn((label: string, effect: unknown) => {
            forks.push({ label, effect });
            return stop;
        }),
    } as unknown as EffectHostShape;
    return { host, forks, stop };
}

/** Run a forked loop for a short real slice, then interrupt it as shutdown would. */
async function runFor(effect: unknown, ms: number): Promise<void> {
    const fiber = Effect.runFork(
        (effect as Effect.Effect<void, never, PreviewTtlCleanupService>).pipe(
            Effect.provideService(PreviewTtlCleanupService, service),
        ),
    );
    await new Promise((resolve) => setTimeout(resolve, ms));
    await Effect.runPromise(Fiber.interrupt(fiber));
}

describe("PreviewTtlCleanupService", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        provisioning.findExpiredPreviews.mockReturnValue(Effect.succeed([expired("1"), expired("2")]));
        provisioning.expirePreview.mockImplementation(() => Effect.succeed({}));
    });

    it("expires every preview whose TTL has passed", async () => {
        await Effect.runPromise(service.runCleanup());

        expect(provisioning.expirePreview).toHaveBeenCalledTimes(2);
        expect(provisioning.expirePreview).toHaveBeenCalledWith("1", "svc-1", "pr-1");
        expect(provisioning.expirePreview).toHaveBeenCalledWith("2", "svc-2", "pr-2");
    });

    it("does nothing when nothing has expired", async () => {
        provisioning.findExpiredPreviews.mockReturnValue(Effect.succeed([]));

        await Effect.runPromise(service.runCleanup());

        expect(provisioning.expirePreview).not.toHaveBeenCalled();
    });

    it("carries on with the next preview when one fails to expire", async () => {
        provisioning.expirePreview.mockImplementationOnce(() => Effect.fail(new Error("route gone")) as never);

        await Effect.runPromise(service.runCleanup());

        expect(provisioning.expirePreview).toHaveBeenCalledTimes(2);
    });

    it("never fails its caller, even when the lookup of expired previews does", async () => {
        provisioning.findExpiredPreviews.mockReturnValue(Effect.fail(new Error("db down")) as never);

        await expect(Effect.runPromise(service.runCleanup())).resolves.toBeUndefined();
        expect(provisioning.expirePreview).not.toHaveBeenCalled();
    });
});

describe("startPreviewTtlCleanup", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        provisioning.findExpiredPreviews.mockReturnValue(Effect.succeed([expired("1")]));
        provisioning.expirePreview.mockImplementation(() => Effect.succeed({}));
    });

    it("forks one labelled program on the host and stops it when the module is destroyed", async () => {
        const { host, forks, stop } = fakeHost();
        const handle = startPreviewTtlCleanup(host, 1_000);

        expect(forks.map((fork) => fork.label)).toEqual(["fleet/preview-ttl-cleanup"]);

        await handle.onModuleDestroy();
        expect(stop).toHaveBeenCalledTimes(1);
    });

    it("runs the cleanup on every tick until the fiber is interrupted", async () => {
        const { host, forks } = fakeHost();
        startPreviewTtlCleanup(host, 5);

        await runFor(forks[0]?.effect, 40);

        expect(provisioning.findExpiredPreviews.mock.calls.length).toBeGreaterThan(1);
    });

    it("survives a run that fails, and tries again on the next tick", async () => {
        provisioning.findExpiredPreviews.mockReturnValue(Effect.fail(new Error("db down")) as never);
        const { host, forks } = fakeHost();
        startPreviewTtlCleanup(host, 5);

        await runFor(forks[0]?.effect, 40);

        // A loop that died on the first failure would have run exactly once.
        expect(provisioning.findExpiredPreviews.mock.calls.length).toBeGreaterThan(1);
    });
});
