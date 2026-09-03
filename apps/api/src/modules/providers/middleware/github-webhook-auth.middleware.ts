/**
 * GitHub Webhook Auth — ORPC middleware guarding webhook routes.
 *
 * GitHub POSTs deliveries to `/webhooks/github` with:
 *   - `x-github-event`    — the event type (pull_request, installation, ...)
 *   - `x-github-delivery` — a unique delivery id (idempotency key)
 *   - `x-hub-signature-256` — HMAC-SHA256 of the RAW body, signed with the
 *     configured webhook secret (the "GitHub challenge").
 *
 * The webhook contract uses the DETAILED input structure, so the ORPC codec
 * decodes these headers + the parsed body into `input`:
 *   input = { body: WebhookEvent, headers: { "x-github-event"?, "x-github-delivery"?, "x-hub-signature-256"? } }
 *
 * This middleware:
 *   1. Reads the event type / delivery id / signature from `input.headers`.
 *   2. Runs the idempotency guard (T036) — duplicate deliveries short-circuit.
 *   3. Verifies the HMAC signature with the official Octokit SDK
 *      (`verify` from `@octokit/webhooks-methods`) when a webhook secret is
 *      configured, throwing a 401 when missing/mismatched (the challenge).
 *   4. Marks the delivery as seen so concurrent duplicates are ignored.
 *   5. Attaches `webhook: { eventType, deliveryId, skippedReason? }` to the
 *      context so the handler can dispatch without re-reading the input.
 *
 * Usage (controllers):
 * ```ts
 * @Implement(appContract.providers.code.github.webhook)
 * receive() {
 *   return implement(appContract.providers.code.github.webhook)
 *     .use(githubWebhookAuth({ idempotencyService, githubAppsRepository }))
 *     .handler(async ({ context, input }) => {
 *       const payload = input.body; // WebhookEvent
 *       ...
 *     });
 * }
 * ```
 *
 * The middleware is NOT authentication — it is the webhook's route guard.
 * Each webhook route must compose its own guard (github challenge, gitlab
 * token, ...) from this folder.
 */
import { os } from "@orpc/server";
import type { ORPCError } from "@orpc/server";
import { verify } from "@octokit/webhooks-methods";
import { Logger } from "@nestjs/common";
import { standardErrorOptions, STANDARD_DOMAIN_ERROR_DEFS } from "@repo/orpc-utils";
import type { GithubAppsRepository } from "@/modules/providers/code/github/repositories/github-apps.repository";
import type { WebhookIdempotencyService } from "@/modules/providers/code/github/services/webhook-idempotency.service";
import type { ORPCGlobalContext } from "@orpc/nest";
import { type GithubWebhookInput } from "@repo/api-contracts";

export interface GithubWebhookContext {
    webhook: {
        eventType: string;
        deliveryId: string;
        /** Set when the delivery was skipped (duplicate) before reaching the handler. */
        skippedReason?: string;
    };
}

export interface GithubWebhookAuthDeps {
    idempotencyService: WebhookIdempotencyService;
    githubAppsRepository: GithubAppsRepository;
}

const logger = new Logger("GithubWebhookAuth");

/** Outcome of a webhook auth resolution — pure + directly testable. */
export type GithubWebhookAuthOutcome =
    | { kind: "proceed"; webhook: GithubWebhookContext["webhook"] }
    | { kind: "duplicate"; webhook: GithubWebhookContext["webhook"] };

/**
 * Contract-defined UNAUTHORIZED thrower for the helpers. The middleware
 * passes its `errors` prop so the thrown error is ALWAYS the one declared
 * on the webhook contract (never a hand-built ORPCError).
 */
export type GithubWebhookUnauthorized = (
    message: string,
) => ORPCError<string, unknown>;

/**
 * Resolve the GitHub webhook guard for one delivery (pure, no ORPC runtime):
 *  - duplicate deliveries short-circuit (T036 idempotency),
 *  - the GitHub challenge (HMAC-SHA256) is verified with the configured
 *    webhook secret, FAILING CLOSED when no secret is available,
 *  - valid deliveries are marked seen and allowed through.
 * Throws the contract-defined UNAUTHORIZED on missing/invalid signature or
 * missing secret.
 */
export async function resolveGithubWebhookAuth(
    input: GithubWebhookInput,
    deps: GithubWebhookAuthDeps,
    unauthorized: GithubWebhookUnauthorized,
): Promise<GithubWebhookAuthOutcome> {
    // Everything comes from the (detailed) input — the ORPC codec decoded the
    // raw request headers + body into `input`. `headers` is optional (the
    // contract schema is `.optional()`), so guard with optional chaining.
    const eventType = input.headers?.["x-github-event"] ?? "";
    const deliveryId = input.headers?.["x-github-delivery"] ?? "";
    const signature = input.headers?.["x-hub-signature-256"];

    // T036: idempotency guard — reject already-seen deliveries
    if (deliveryId && deps.idempotencyService.isDuplicate(deliveryId)) {
        logger.warn(`Duplicate webhook delivery ignored: ${deliveryId}`);
        return {
            kind: "duplicate",
            webhook: {
                eventType,
                deliveryId,
                skippedReason: "duplicate_delivery",
            },
        };
    }

    // Verify the GitHub challenge (HMAC-SHA256 over the raw body) with the
    // official Octokit SDK. FAIL CLOSED: when no webhook secret is available
    // (missing config OR any DB error), the delivery is REJECTED — never
    // silently accepted without a signature check.
    const secret = await deps.githubAppsRepository.getWebhookSecret();
    if (!secret) {
        logger.warn(
            `Webhook delivery ${deliveryId || "<unknown>"} rejected: no webhook secret configured (fail closed)`,
        );
        throw unauthorized("Webhook secret is not configured");
    }
    await verifySignature(input, signature, secret, deliveryId, unauthorized);

    if (deliveryId) {
        deps.idempotencyService.markSeen(deliveryId);
    }

    return {
        kind: "proceed",
        webhook: {
            eventType,
            deliveryId,
            skippedReason: undefined,
        },
    };
}

/**
 * Create the ORPC middleware guarding GitHub webhook routes.
 * Deps are injected explicitly (NOT via DI container) so the middleware can
 * be created inside a NestJS controller method and composed per-route.
 */
export function githubWebhookAuth(deps: GithubWebhookAuthDeps) {
    return os
        .$context<ORPCGlobalContext>()
        .errors(STANDARD_DOMAIN_ERROR_DEFS)
        .middleware(async ({ context, next, errors }, input: GithubWebhookInput) => {
            // Bind the contract-defined UNAUTHORIZED thrower for the pure
            // helpers — the only error code they may ever raise.
            const unauthorized: GithubWebhookUnauthorized = (message) =>
                errors.UNAUTHORIZED(standardErrorOptions("unauthorized", message));

            const outcome = await resolveGithubWebhookAuth(input, deps, unauthorized);
            return next({
                context: {
                    ...context,
                    webhook: outcome.webhook,
                },
            });
        });
}

/**
 * Verify the `X-Hub-Signature-256` HMAC over the request body using the
 * official `@octokit/webhooks-methods` SDK (timing-safe).
 * Throws the contract-defined UNAUTHORIZED when the signature is missing
 * or mismatched.
 */
async function verifySignature(
    input: GithubWebhookInput,
    signature: string | undefined,
    secret: string,
    deliveryId: string,
    unauthorized: GithubWebhookUnauthorized,
): Promise<void> {
    if (!signature) {
        logger.warn(`Webhook delivery ${deliveryId} has no signature; rejecting`);
        throw unauthorized("Missing X-Hub-Signature-256 header");
    }

    // GitHub signs the RAW body string. The ORPC codec parsed the body into
    // `input.body`; re-serializing it reproduces the canonical compact JSON
    // GitHub sends, which is what the HMAC was computed over.
    const payload = JSON.stringify(input.body);

    const valid = await verify(secret, payload, signature);
    if (!valid) {
        logger.warn(`Webhook delivery ${deliveryId} has invalid signature`);
        throw unauthorized("Invalid webhook signature");
    }
}
