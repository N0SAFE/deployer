import { beforeEach, describe, expect, it, vi } from "vitest";
import { WebhookIdempotencyService } from "./webhook-idempotency.service";

describe("WebhookIdempotencyService (W-P2 durable)", () => {
    let repo: { claimWebhookDelivery: ReturnType<typeof vi.fn> };
    let service: WebhookIdempotencyService;

    beforeEach(() => {
        repo = { claimWebhookDelivery: vi.fn(async () => true) };
        service = new WebhookIdempotencyService(repo as never);
        vi.clearAllMocks();
    });

    it("claims a delivery once and dedupes the same delivery across service instances (restart)", async () => {
        // "Restart": a FRESH service instance hits the DB checkpoint and the
        // same delivery_id is already recorded → duplicate.
        const first = new WebhookIdempotencyService(repo as never);
        await expect(first.claim("delivery-1", "push", { ref: "main" })).resolves.toBe(true);

        repo.claimWebhookDelivery.mockResolvedValueOnce(false);
        const restarted = new WebhookIdempotencyService(repo as never);
        await expect(restarted.claim("delivery-1", "push", { ref: "main" })).resolves.toBe(false);
    });

    it("short-circuits from the in-memory cache without touching the DB", async () => {
        await service.claim("delivery-2", "push", {});
        repo.claimWebhookDelivery.mockClear();

        await expect(service.claim("delivery-2", "push", {})).resolves.toBe(false);
        expect(repo.claimWebhookDelivery).not.toHaveBeenCalled();
    });

    it("falls back to the bounded cache when no repository is available", async () => {
        const isolated = new WebhookIdempotencyService(undefined);
        await expect(isolated.claim("delivery-3", "push", {})).resolves.toBe(true);
        await expect(isolated.claim("delivery-3", "push", {})).resolves.toBe(false);
    });

    it("clears the fast-path cache", async () => {
        await service.claim("delivery-4", "push", {});
        service.clear();
        repo.claimWebhookDelivery.mockResolvedValueOnce(false); // DB says dup
        await expect(service.claim("delivery-4", "push", {})).resolves.toBe(false);
    });
});
