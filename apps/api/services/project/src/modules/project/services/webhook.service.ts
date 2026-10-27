import { randomBytes } from "crypto";
import { NotFoundError } from "@deployer/errors";
import { Context, Effect } from "effect";
import { WebhookStore, type WebhookCreateInput } from "../repositories/webhook.repository";
import { assertProjectAccess } from "./project-access";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CreateWebhookInput = {
	projectId: string;
	requesterId: string;
	sourceType: "github" | "gitlab" | "git" | "upload" | "custom";
	webhookUrl: string;
	serviceId?: string;
	externalWebhookId?: string;
	settings?: {
		events?: string[];
		branches?: string[];
		skipCi?: boolean;
		autoPreview?: boolean;
	};
};

export type RotateWebhookSecretResult = {
	webhookId: string;
	/** Raw secret — returned only once; store it securely. Encrypted in the DB. */
	rawSecret: string;
};

/** The webhook use cases, composed as Effects. */
export class WebhookServiceImpl {
	// -----------------------------------------------------------------------
	// CRUD
	// -----------------------------------------------------------------------

	createWebhook(input: CreateWebhookInput) {
		return Effect.gen(function* () {
			yield* assertProjectAccess(input.projectId, input.requesterId, "admin");

			const webhooks = yield* WebhookStore;

			// Generate a cryptographically random HMAC signing secret (32 bytes = 64 hex chars)
			const rawSecret = randomBytes(32).toString("hex");

			const dao: WebhookCreateInput = {
				projectId: input.projectId,
				sourceType: input.sourceType,
				webhookUrl: input.webhookUrl,
				secret: rawSecret, // encryptedText column auto-encrypts on insert
				serviceId: input.serviceId ?? null,
				externalWebhookId: input.externalWebhookId ?? null,
				settings: input.settings,
			};

			const webhook = yield* webhooks.create(dao);

			return {
				webhook,
				/** Raw secret — returned only once at creation. */
				rawSecret,
			};
		});
	}

	getWebhook(id: string, requesterId: string) {
		return Effect.gen(function* () {
			const webhooks = yield* WebhookStore;
			const webhook = yield* webhooks.findById(id);
			if (!webhook) {
				return yield* Effect.fail(new NotFoundError("Webhook", id));
			}
			yield* assertProjectAccess(webhook.projectId, requesterId, "admin");
			return webhook;
		});
	}

	listWebhooks(projectId: string, requesterId: string) {
		return Effect.gen(function* () {
			yield* assertProjectAccess(projectId, requesterId, "admin");
			const webhooks = yield* WebhookStore;
			return yield* webhooks.findByProject(projectId);
		});
	}

	disableWebhook(id: string, requesterId: string) {
		return Effect.gen(function* () {
			const webhooks = yield* WebhookStore;
			const webhook = yield* webhooks.findById(id);
			if (!webhook) {
				return yield* Effect.fail(new NotFoundError("Webhook", id));
			}
			yield* assertProjectAccess(webhook.projectId, requesterId, "admin");
			return yield* webhooks.update(id, { isActive: false });
		});
	}

	enableWebhook(id: string, requesterId: string) {
		return Effect.gen(function* () {
			const webhooks = yield* WebhookStore;
			const webhook = yield* webhooks.findById(id);
			if (!webhook) {
				return yield* Effect.fail(new NotFoundError("Webhook", id));
			}
			yield* assertProjectAccess(webhook.projectId, requesterId, "admin");
			return yield* webhooks.update(id, { isActive: true });
		});
	}

	deleteWebhook(id: string, requesterId: string) {
		return Effect.gen(function* () {
			const webhooks = yield* WebhookStore;
			const webhook = yield* webhooks.findById(id);
			if (!webhook) {
				return yield* Effect.fail(new NotFoundError("Webhook", id));
			}
			yield* assertProjectAccess(webhook.projectId, requesterId, "admin");
			yield* webhooks.delete(id);
		});
	}

	// -----------------------------------------------------------------------
	// Secret lifecycle
	// -----------------------------------------------------------------------

	/**
	 * Rotate the HMAC signing secret for a webhook.
	 * A new cryptographically random secret is generated, encrypted in the DB,
	 * and returned **once** in plaintext. The caller must relay it to the
	 * upstream platform (e.g. GitHub) immediately.
	 */
	rotateWebhookSecret(id: string, requesterId: string) {
		return Effect.gen(function* () {
			const webhooks = yield* WebhookStore;
			const webhook = yield* webhooks.findById(id);
			if (!webhook) {
				return yield* Effect.fail(new NotFoundError("Webhook", id));
			}
			yield* assertProjectAccess(webhook.projectId, requesterId, "admin");

			const rawSecret = randomBytes(32).toString("hex");
			yield* webhooks.updateSecret(id, rawSecret);

			return { webhookId: id, rawSecret } satisfies RotateWebhookSecretResult;
		});
	}
}

/** The service's public surface is exactly the implementation's methods. */
export type WebhookServiceShape = WebhookServiceImpl;

/** Effect key = NestJS token. */
export class WebhookService extends Context.Service<WebhookService, WebhookServiceShape>()(
	"project/WebhookService",
) {}
