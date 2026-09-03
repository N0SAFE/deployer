import { describe, it, expect, vi, beforeEach } from "vitest";
import { GithubWebhooksController } from "./github.webhooks.controller";
import { githubWebhookAuth } from "@/modules/providers/middleware/github-webhook-auth.middleware";
import { ORPCError } from "@orpc/server";
import type { GithubWebhookDispatchService } from "../services/github-webhook-dispatch.service";
import type { WebhookIdempotencyService } from "../services/webhook-idempotency.service";
import type { GithubAppsRepository } from "../repositories/github-apps.repository";
import type { GithubWebhookInput } from "@repo/api-contracts";

// ─── Mocks ────────────────────────────────────────────────────────────────

const makeMockDispatch = (): GithubWebhookDispatchService =>
    ({
        dispatchPrEvent: vi.fn().mockResolvedValue({ action: "created", reason: "pr_opened", previewName: "pr-1", resolvedUrl: "pr-1.preview.local" }),
    }) as unknown as GithubWebhookDispatchService;

const makeMockIdempotency = (): WebhookIdempotencyService =>
    ({
        isDuplicate: vi.fn().mockReturnValue(false),
        markSeen: vi.fn(),
    }) as unknown as WebhookIdempotencyService;

const makeMockRepo = (): GithubAppsRepository =>
    ({
        setInstallation: vi.fn().mockResolvedValue(true),
        getWebhookSecret: vi.fn().mockResolvedValue(null),
    }) as unknown as GithubAppsRepository;

const prPayload = {
    action: "opened",
    pull_request: {
        number: 1,
        head: { ref: "feat/preview", sha: "abc1234" },
        merged: false,
    },
    repository: { full_name: "org/repo" },
};

// The DETAILED webhook input the contract produces:
//   { body: WebhookEvent, headers: { "x-github-event"?, ... } }
const makeInput = (body: unknown, headers?: GithubWebhookInput["headers"]): GithubWebhookInput =>
    ({ body, headers }) as GithubWebhookInput;

// Handler execution helper — the controller registers its handler via
// `implement(contract).use(mw).handler(fn)`; a singleton chainable mock
// captures the latest registered fn so tests can invoke it directly.
type HandlerFn = (opts: { context: { webhook: { eventType: string; deliveryId: string; skippedReason?: string } }; input: GithubWebhookInput; errors: Record<string, (options?: { message?: string }) => ORPCError<string, unknown>> }) => Promise<{ received: true; deliveryId: string; action?: string; reason?: string }>;

const implementChainable = {
    use: vi.fn().mockReturnThis(),
    handler: vi.fn((fn: unknown) => ({ handler: fn })),
};

vi.mock("@orpc/nest", () => ({
    implement: vi.fn(() => implementChainable),
    Implement: vi.fn(() => () => {}),
}));

/** Test double for the ORPC typed-errors parameter (mirrors runtime factory map). */
function makeErrorsParam(): Record<string, (options?: { message?: string }) => ORPCError<string, unknown>> {
    return new Proxy({}, {
        get: (_target, code: string) =>
            (options?: { message?: string }) => new ORPCError(code, options ?? {}),
    });
}

async function runHandler(controller: GithubWebhooksController, opts: { eventType: string; deliveryId: string; skippedReason?: string; input: GithubWebhookInput }) {
    void controller;
    controller.receive();
    const handler = implementChainable.handler.mock.calls.at(-1)?.[0] as HandlerFn;
    return handler({
        context: {
            webhook: {
                eventType: opts.eventType,
                deliveryId: opts.deliveryId,
                skippedReason: opts.skippedReason,
            },
        },
        input: opts.input,
        errors: makeErrorsParam(),
    });
}

describe("GithubWebhooksController", () => {
    let controller: GithubWebhooksController;
    let dispatch: GithubWebhookDispatchService;
    let idempotency: WebhookIdempotencyService;

    beforeEach(() => {
        dispatch = makeMockDispatch();
        idempotency = makeMockIdempotency();
        controller = new GithubWebhooksController(idempotency, dispatch, makeMockRepo());
    });

    it("returns received=true for a valid pull_request event", async () => {
        const result = await runHandler(controller, {
            eventType: "pull_request",
            deliveryId: "delivery-1",
            input: makeInput(prPayload),
        });
        expect(result.received).toBe(true);
        expect(result.deliveryId).toBe("delivery-1");
        expect(result.action).toBe("created");
    });

    it("skips duplicate deliveries (middleware short-circuit) without re-dispatching", async () => {
        const result = await runHandler(controller, {
            eventType: "pull_request",
            deliveryId: "delivery-dupe",
            skippedReason: "duplicate_delivery",
            input: makeInput(prPayload),
        });
        expect(result.action).toBe("skipped");
        expect(result.reason).toBe("duplicate_delivery");
        expect(dispatch.dispatchPrEvent).not.toHaveBeenCalled();
    });

    it("returns skipped for unhandled event types", async () => {
        const result = await runHandler(controller, {
            eventType: "push",
            deliveryId: "delivery-3",
            input: makeInput({}),
        });
        expect(result.action).toBe("skipped");
        expect(result.reason).toContain("push");
    });

    it("throws ORPCError BAD_REQUEST for malformed pull_request payload", async () => {
        await expect(
            runHandler(controller, {
                eventType: "pull_request",
                deliveryId: "delivery-4",
                input: makeInput({ action: "opened" }),
            }),
        ).rejects.toThrow("Malformed");
    });

    it("throws ORPCError BAD_REQUEST when PR is missing head.sha (guard rejects)", async () => {
        await expect(
            runHandler(controller, {
                eventType: "pull_request",
                deliveryId: "delivery-5",
                input: makeInput({ action: "opened", pull_request: { number: 2, head: { ref: "feat/x" }, merged: false } }),
            }),
        ).rejects.toThrow("Malformed pull_request webhook payload");
    });

    it("acknowledges non-dispatchable pull_request actions without dispatching", async () => {
        const result = await runHandler(controller, {
            eventType: "pull_request",
            deliveryId: "delivery-6",
            input: makeInput({
                action: "edited",
                pull_request: { number: 2, head: { ref: "feat/x", sha: "abc" }, merged: false },
            }),
        });
        expect(result.action).toBe("edited");
        expect(result.reason).toBe("pull_request:edited");
        expect(dispatch.dispatchPrEvent).not.toHaveBeenCalled();
    });

    it("throws ORPCError BAD_REQUEST for malformed installation payload", async () => {
        await expect(
            runHandler(controller, {
                eventType: "installation",
                deliveryId: "delivery-7",
                input: makeInput({ action: "created", installation: { id: 1 } }),
            }),
        ).rejects.toThrow("Malformed installation webhook payload");
    });
});

// ─── Middleware tests (githubWebhookAuth) ────────────────────────────────

describe("githubWebhookAuth middleware", () => {
    let idempotency: WebhookIdempotencyService;
    let repo: GithubAppsRepository;

    beforeEach(() => {
        idempotency = makeMockIdempotency();
        repo = makeMockRepo();
    });

    const callMiddleware = async (middleware: ReturnType<typeof githubWebhookAuth>, input: GithubWebhookInput) => {
        // oRPC invokes a middleware as (options, input, outputFn) — the
        // options carry { context, next, errors, ... }. Mirror that shape,
        // supplying a UNAUTHORIZED factory from the contract error map so the
        // middleware's `errors.UNAUTHORIZED(...)` throws are real ORPCErrors
        // (what the resolver asserts).
        const errorsMap = {
            UNAUTHORIZED: (options?: { message?: string }) => new ORPCError("UNAUTHORIZED", options ?? {}),
        };
        const next = async ({ context }: { context: Record<string, unknown> }) =>
            ({ context, output: undefined });
        const outputFn = (output: unknown) => ({ context: {}, output });

        const fn = middleware as unknown as (
            options: {
                context: Record<string, unknown>;
                next: typeof next;
                errors: typeof errorsMap;
                path: readonly string[];
                signal?: AbortSignal;
                lastEventId: string | undefined;
            },
            input: GithubWebhookInput,
            output: typeof outputFn,
        ) => Promise<{ context: { webhook: unknown }; output: unknown }>;

        return fn(
            {
                context: {},
                next,
                errors: errorsMap,
                path: ["/webhooks/github"],
                signal: undefined,
                lastEventId: undefined,
            },
            input,
            outputFn,
        );
    };

    it("attaches webhook context with eventType + deliveryId", async () => {
        vi.mocked(repo.getWebhookSecret).mockResolvedValue("my-secret");
        const { createHmac } = await import("node:crypto");
        const signature = `sha256=${createHmac("sha256", "my-secret").update(JSON.stringify(prPayload)).digest("hex")}`;

        const middleware = githubWebhookAuth({ idempotencyService: idempotency, githubAppsRepository: repo });
        const result = await callMiddleware(
            middleware,
            makeInput(prPayload, {
                "x-github-event": "pull_request",
                "x-github-delivery": "d-1",
                "x-hub-signature-256": signature,
            }),
        );
        expect(result.context.webhook).toEqual({ eventType: "pull_request", deliveryId: "d-1" });
        expect(idempotency.markSeen).toHaveBeenCalledWith("d-1");
    });

    it("short-circuits duplicate deliveries with skippedReason", async () => {
        vi.mocked(idempotency.isDuplicate).mockReturnValue(true);
        const middleware = githubWebhookAuth({ idempotencyService: idempotency, githubAppsRepository: repo });
        const result = await callMiddleware(middleware, makeInput(prPayload, { "x-github-event": "pull_request", "x-github-delivery": "d-2" }));
        expect(result.context.webhook).toEqual({
            eventType: "pull_request",
            deliveryId: "d-2",
            skippedReason: "duplicate_delivery",
        });
        expect(idempotency.markSeen).not.toHaveBeenCalled();
    });

    it("rejects when signature is missing but a secret is configured", async () => {
        vi.mocked(repo.getWebhookSecret).mockResolvedValue("my-secret");
        const middleware = githubWebhookAuth({ idempotencyService: idempotency, githubAppsRepository: repo });
        await expect(
            callMiddleware(middleware, makeInput(prPayload, { "x-github-event": "pull_request", "x-github-delivery": "d-3" })),
        ).rejects.toThrow(ORPCError);
    });

    it("rejects when signature verification fails", async () => {
        vi.mocked(repo.getWebhookSecret).mockResolvedValue("my-secret");
        const middleware = githubWebhookAuth({ idempotencyService: idempotency, githubAppsRepository: repo });
        await expect(
            callMiddleware(middleware, makeInput(prPayload, {
                "x-github-event": "pull_request",
                "x-github-delivery": "d-4",
                "x-hub-signature-256": "sha256=invalid",
            })),
        ).rejects.toThrow(ORPCError);
    });

    it("accepts a valid signature", async () => {
        vi.mocked(repo.getWebhookSecret).mockResolvedValue("my-secret");
        // Compute the expected HMAC over JSON.stringify(body) — matches the
        // middleware's SDK-based verification.
        const { createHmac } = await import("node:crypto");
        const body = JSON.stringify(prPayload);
        const signature = `sha256=${createHmac("sha256", "my-secret").update(body).digest("hex")}`;

        const middleware = githubWebhookAuth({ idempotencyService: idempotency, githubAppsRepository: repo });
        const result = await callMiddleware(middleware, makeInput(prPayload, {
            "x-github-event": "pull_request",
            "x-github-delivery": "d-5",
            "x-hub-signature-256": signature,
        }));
        expect(result.context.webhook).toEqual({ eventType: "pull_request", deliveryId: "d-5" });
    });
});
