import { describe, it, expect, vi, beforeEach } from "vitest";
import { GithubWebhookController } from "./github-webhook.controller";
import type { GithubWebhookDispatchService } from "../services/github-webhook-dispatch.service";
import type { WebhookIdempotencyService } from "../services/webhook-idempotency.service";

const makeMockDispatch = (): GithubWebhookDispatchService =>
    ({
        dispatchPrEvent: vi.fn().mockResolvedValue({ action: "created", reason: "pr_opened", previewName: "pr-1", resolvedUrl: "pr-1.preview.local" }),
    }) as unknown as GithubWebhookDispatchService;

const makeMockIdempotency = (): WebhookIdempotencyService =>
    ({
        isDuplicate: vi.fn().mockReturnValue(false),
        markSeen: vi.fn(),
    }) as unknown as WebhookIdempotencyService;

const prPayload = {
    action: "opened",
    pull_request: {
        number: 1,
        head: { ref: "feat/preview", sha: "abc1234" },
        merged: false,
    },
    repository: { full_name: "org/repo" },
};

describe("GithubWebhookController", () => {
    let controller: GithubWebhookController;
    let dispatch: GithubWebhookDispatchService;
    let idempotency: WebhookIdempotencyService;

    beforeEach(() => {
        dispatch = makeMockDispatch();
        idempotency = makeMockIdempotency();
        controller = new GithubWebhookController(idempotency, dispatch);
    });

    it("returns received=true for a valid pull_request event", async () => {
        const result = await controller.receive("pull_request", "delivery-1", undefined, prPayload);
        expect(result.received).toBe(true);
        expect(result.deliveryId).toBe("delivery-1");
        expect(result.action).toBe("created");
    });

    it("skips duplicate deliveries without re-dispatching", async () => {
        vi.mocked(idempotency.isDuplicate).mockReturnValue(true);
        const result = await controller.receive("pull_request", "delivery-dupe", undefined, prPayload);
        expect(result.action).toBe("skipped");
        expect(result.reason).toBe("duplicate_delivery");
        expect(dispatch.dispatchPrEvent).not.toHaveBeenCalled();
    });

    it("marks deliveryId as seen after processing", async () => {
        await controller.receive("pull_request", "delivery-2", undefined, prPayload);
        expect(idempotency.markSeen).toHaveBeenCalledWith("delivery-2");
    });

    it("returns skipped for unhandled event types", async () => {
        const result = await controller.receive("push", "delivery-3", undefined, {});
        expect(result.action).toBe("skipped");
        expect(result.reason).toContain("push");
    });

    it("throws BadRequestException for malformed pull_request payload", async () => {
        await expect(
            controller.receive("pull_request", "delivery-4", undefined, { action: "opened" }),
        ).rejects.toThrow("Malformed");
    });

    it("throws BadRequestException when PR is missing head.sha", async () => {
        await expect(
            controller.receive("pull_request", "delivery-5", undefined, {
                action: "opened",
                pull_request: { number: 2, head: { ref: "feat/x" }, merged: false },
            }),
        ).rejects.toThrow("missing required fields");
    });

    it("rejects webhook when signature verification fails", async () => {
        process.env.GITHUB_WEBHOOK_SECRET = "my-secret";
        try {
            await expect(
                controller.receive("pull_request", "delivery-6", "sha256=invalid", prPayload),
            ).rejects.toThrow("Invalid webhook signature");
        } finally {
            delete process.env.GITHUB_WEBHOOK_SECRET;
        }
    });

    it("rejects webhook when signature is missing but secret is configured", async () => {
        process.env.GITHUB_WEBHOOK_SECRET = "my-secret";
        try {
            await expect(
                controller.receive("pull_request", "delivery-7", undefined, prPayload),
            ).rejects.toThrow("Missing X-Hub-Signature-256");
        } finally {
            delete process.env.GITHUB_WEBHOOK_SECRET;
        }
    });
});
