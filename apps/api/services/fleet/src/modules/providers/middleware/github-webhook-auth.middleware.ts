/**
 * GitHub Webhook Auth — the route guard for the GitHub webhook endpoint.
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
 * The guard is an Effect the handler runs first, over the module's Effect context:
 *   1. Reads the event type / delivery id / signature from `input.headers`.
 *   2. Runs the idempotency guard (T036) — duplicate deliveries short-circuit.
 *   3. Verifies the HMAC signature with the official Octokit SDK
 *      (`verify` from `@octokit/webhooks-methods`) when a webhook secret is
 *      configured, failing `FleetUnauthorized` (401) when missing/mismatched (the challenge).
 *   4. Marks the delivery as seen so concurrent duplicates are ignored.
 *   5. Answers `{ eventType, deliveryId, skippedReason? }` so the handler can dispatch
 *      without re-reading the input.
 *
 * Usage (controllers):
 * ```ts
 * .effect(function* ({ input, context }) {
 *   const webhook = yield* serveAnonymous(context)(guardGithubWebhook(input));
 *   ...
 * });
 * ```
 *
 * The guard is NOT authentication — it is the webhook's route guard.
 * Each webhook route must compose its own guard (github challenge, gitlab
 * token, ...) from this folder.
 */
import { verify } from "@octokit/webhooks-methods";
import { Effect } from "effect";
import type { GithubWebhookInput } from "@deployer/fleet-contracts";

import { attempt } from "@/core/effects";
import { FleetUnauthorized } from "@/core/fleet.errors";
import { GithubAppsStore } from "@/modules/providers/code/github/repositories/github-apps.repository";
import { WebhookIdempotencyService } from "@/modules/providers/code/github/services/webhook-idempotency.service";

export type GithubWebhookContext = {
    eventType: string;
    deliveryId: string;
    /** Set when the delivery was skipped (duplicate) before reaching the handler. */
    skippedReason?: string;
}

/**
 * Verify the `X-Hub-Signature-256` HMAC over the request body using the
 * official `@octokit/webhooks-methods` SDK (timing-safe).
 * Fails `FleetUnauthorized` when the signature is missing or mismatched.
 */
const verifySignature = Effect.fn("githubWebhookAuth.verifySignature")(function* (
    input: GithubWebhookInput,
    signature: string | undefined,
    secret: string,
    deliveryId: string,
) {
    if (!signature) {
        yield* Effect.logWarning(`Webhook delivery ${deliveryId} has no signature; rejecting`);
        return yield* new FleetUnauthorized({ reason: "Missing X-Hub-Signature-256 header" });
    }

    // GitHub signs the RAW body string. The ORPC codec parsed the body into
    // `input.body`; re-serializing it reproduces the canonical compact JSON
    // GitHub sends, which is what the HMAC was computed over.
    const payload = JSON.stringify(input.body);

    const valid = yield* attempt(() => verify(secret, payload, signature));
    if (!valid) {
        yield* Effect.logWarning(`Webhook delivery ${deliveryId} has invalid signature`);
        return yield* new FleetUnauthorized({ reason: "Invalid webhook signature" });
    }
});

/**
 * Guard one GitHub webhook delivery:
 *  - duplicate deliveries short-circuit (T036 idempotency),
 *  - the GitHub challenge (HMAC-SHA256) is verified with the configured
 *    webhook secret, FAILING CLOSED when no secret is available,
 *  - valid deliveries are marked seen and allowed through.
 * Fails `FleetUnauthorized` on a missing/invalid signature or a missing secret.
 */
export const guardGithubWebhook = Effect.fn("githubWebhookAuth")(function* (input: GithubWebhookInput) {
    const idempotency = yield* WebhookIdempotencyService;
    const apps = yield* GithubAppsStore;

    // Everything comes from the (detailed) input — the ORPC codec decoded the
    // raw request headers + body into `input`. `headers` is optional (the
    // contract schema is `.optional()`), so guard with optional chaining.
    const eventType = input.headers?.["x-github-event"] ?? "";
    const deliveryId = input.headers?.["x-github-delivery"] ?? "";
    const signature = input.headers?.["x-hub-signature-256"];

    // T036: idempotency guard — reject already-seen deliveries
    if (deliveryId && (yield* idempotency.isDuplicate(deliveryId))) {
        yield* Effect.logWarning(`Duplicate webhook delivery ignored: ${deliveryId}`);
        return { eventType, deliveryId, skippedReason: "duplicate_delivery" } satisfies GithubWebhookContext;
    }

    // Verify the GitHub challenge (HMAC-SHA256 over the raw body) with the
    // official Octokit SDK. FAIL CLOSED: when no webhook secret is available
    // (missing config OR any DB error), the delivery is REJECTED — never
    // silently accepted without a signature check.
    const secret = yield* apps.getWebhookSecret();
    if (!secret) {
        yield* Effect.logWarning(
            `Webhook delivery ${deliveryId || "<unknown>"} rejected: no webhook secret configured (fail closed)`,
        );
        return yield* new FleetUnauthorized({ reason: "Webhook secret is not configured" });
    }
    yield* verifySignature(input, signature, secret, deliveryId);

    if (deliveryId) {
        yield* idempotency.markSeen(deliveryId);
    }

    return { eventType, deliveryId } satisfies GithubWebhookContext;
});
