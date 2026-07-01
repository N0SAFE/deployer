import {
    Controller,
    Post,
    Headers,
    Body,
    HttpCode,
    HttpStatus,
    BadRequestException,
    Logger,
} from "@nestjs/common";
import { createHmac, timingSafeEqual } from "node:crypto";
import { GithubWebhookDispatchService } from "../services/github-webhook-dispatch.service";
import { WebhookIdempotencyService } from "../services/webhook-idempotency.service";
import { isRecord, isObjectLike } from "@repo/type-guards"


/**
 * Type guard that narrows `unknown` to a record-like object so we can
 * index it with string keys.
 */
// T032: Webhook-driven preview create/update orchestration.
// T036: Webhook idempotency keys and duplicate-delivery handling.
@Controller("webhooks/github")
export class GithubWebhookController {
    private readonly logger = new Logger(GithubWebhookController.name);

    constructor(
        private readonly idempotencyService: WebhookIdempotencyService,
        private readonly dispatchService: GithubWebhookDispatchService,
    ) {}

    @Post()
    @HttpCode(HttpStatus.OK)
    async receive(
        @Headers("x-github-event") eventType: string,
        @Headers("x-github-delivery") deliveryId: string,
        @Headers("x-hub-signature-256") signature: string | undefined,
        @Body() rawBody: unknown,
    ): Promise<{ received: true; deliveryId: string; action?: string; reason?: string }> {
        // T036: idempotency guard — reject already-seen deliveries
        if (deliveryId && this.idempotencyService.isDuplicate(deliveryId)) {
            this.logger.warn(`Duplicate webhook delivery ignored: ${deliveryId}`);
            return { received: true, deliveryId, action: "skipped", reason: "duplicate_delivery" };
        }

        // Verify HMAC-SHA256 signature when a webhook secret is configured
        const secret = this.getWebhookSecret();
        if (secret) {
            this.verifySignature(rawBody, signature, secret, deliveryId);
        }

        if (deliveryId) {
            this.idempotencyService.markSeen(deliveryId);
        }

        if (eventType === "pull_request") {
            return this.handlePullRequest(rawBody, deliveryId);
        }

        // Other event types (push, create, etc.) are acknowledged but not acted on in Phase 4
        this.logger.log(`Received unhandled GitHub event type=${eventType} delivery=${deliveryId}`);
        return { received: true, deliveryId, action: "skipped", reason: `unhandled_event:${eventType}` };
    }

    private async handlePullRequest(
        payload: unknown,
        deliveryId: string,
    ): Promise<{ received: true; deliveryId: string; action?: string; reason?: string }> {
        const pr = isRecord(payload) ? payload : {};
        const action = pr.action as string | undefined;
        const prData = isRecord(pr.pull_request) ? pr.pull_request : undefined;

        if (!action || !prData) {
            throw new BadRequestException("Malformed pull_request webhook payload");
        }

        const prNumber = prData.number as number | undefined;
        const head = isRecord(prData.head) ? prData.head : undefined;
        const branchName = head?.ref as string | undefined;
        const commitSha = head?.sha as string | undefined;
        const merged = Boolean(prData.merged);

        if (!prNumber || !branchName || !commitSha) {
            throw new BadRequestException("pull_request payload missing required fields (number, head.ref, head.sha)");
        }

        // TODO(T032): resolve actual serviceId from repository identifier once
        // the github provider registry is wired. Using repository full_name as placeholder.
        const repo = isRecord(pr.repository) ? pr.repository : undefined;
        const serviceId = (repo?.full_name as string | undefined) ?? "unknown";

        const result = await this.dispatchService.dispatchPrEvent({
            action: action as "opened" | "synchronize" | "reopened" | "closed",
            prNumber,
            branchName,
            commitSha,
            merged,
            serviceId,
            deliveryId,
        });

        return { received: true, deliveryId, action: result.action, reason: result.reason };
    }

    private verifySignature(
        rawBody: unknown,
        signature: string | undefined,
        secret: string,
        deliveryId: string,
    ): void {
        if (!signature) {
            this.logger.warn(`Webhook delivery ${deliveryId} has no signature; rejecting`);
            throw new BadRequestException("Missing X-Hub-Signature-256 header");
        }

        const body = typeof rawBody === "string" ? rawBody : JSON.stringify(rawBody);
        const expected = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;

        // Use timingSafeEqual to prevent timing-based secret oracle attacks
        let match = false;
        try {
            match = timingSafeEqual(Buffer.from(expected, "utf8"), Buffer.from(signature, "utf8"));
        } catch {
            match = false;
        }

        if (!match) {
            this.logger.warn(`Webhook delivery ${deliveryId} has invalid signature`);
            throw new BadRequestException("Invalid webhook signature");
        }
    }

    private getWebhookSecret(): string | null {
        return process.env.GITHUB_WEBHOOK_SECRET ?? null;
    }
}
