import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EffectRuntime } from "@deployer/nest-effect";
import { provideTo } from "@deployer/effect-core";

import { PreviewProvisioningService, type PreviewProvisioningServiceShape } from "./preview-provisioning.service";
import { PreviewTtlCleanupService, startPreviewTtlCleanup } from "./preview-ttl-cleanup.service";

const expired = (id: string) => ({ id, serviceId: `svc-${id}`, previewName: `pr-${id}`, fullDomain: `pr-${id}.example.com` });

describe("PreviewTtlCleanupService", () => {
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
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it("runs the cleanup on every interval until the application stops", async () => {
        const runPromise = vi.fn(() => Promise.resolve());
        const handle = startPreviewTtlCleanup({ runPromise } as unknown as EffectRuntime, 1_000);

        await vi.advanceTimersByTimeAsync(3_000);
        expect(runPromise).toHaveBeenCalledTimes(3);

        handle.onModuleDestroy();
        await vi.advanceTimersByTimeAsync(3_000);
        expect(runPromise).toHaveBeenCalledTimes(3);
    });

    it("survives a run that rejects", async () => {
        const runPromise = vi.fn(() => Promise.reject(new Error("runtime not ready")));
        const handle = startPreviewTtlCleanup({ runPromise } as unknown as EffectRuntime, 1_000);

        await vi.advanceTimersByTimeAsync(2_000);
        expect(runPromise).toHaveBeenCalledTimes(2);

        handle.onModuleDestroy();
    });
});
