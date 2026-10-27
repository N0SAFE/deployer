import { beforeEach, describe, expect, it, vi } from "vitest";
import { Effect } from "effect";
import { ForbiddenError, NotFoundError } from "@deployer/errors";
import type { ProjectStoreShape } from "../repositories/project.repository";
import { ProjectStore } from "../repositories/project.repository";
import type { WebhookStoreShape } from "../repositories/webhook.repository";
import { WebhookStore } from "../repositories/webhook.repository";
import { DatabasePort } from "@project/core/database/database.port";
import { WebhookServiceImpl } from "./webhook.service";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const mockProject = { id: "proj-1", ownerId: "user-1", name: "Test" };
const mockWebhook = {
	id: "wh-1",
	projectId: "proj-1",
	sourceType: "github",
	webhookUrl: "https://example.com/hook",
	secret: "encrypted-secret",
	isActive: true,
	triggerCount: 0,
	lastTriggered: null,
	serviceId: null,
	externalWebhookId: null,
	settings: null,
	createdAt: new Date(),
	updatedAt: new Date(),
};

type Fn = ReturnType<typeof vi.fn>;
type Fakes<T> = { [K in keyof T]: Fn };

describe("WebhookService", () => {
	let service: WebhookServiceImpl;
	let webhooks: Fakes<WebhookStoreShape>;
	let projects: Pick<Fakes<ProjectStoreShape>, "findById" | "findCollaboratorByUserAndProject">;

	type Deps = WebhookStore | ProjectStore | DatabasePort;

	/** Run a use case against the fakes, as the module's Effect context would. */
	const run = <A, E>(effect: Effect.Effect<A, E, Deps>) =>
		Effect.runPromise(
			effect.pipe(
				Effect.provideService(WebhookStore, webhooks as unknown as WebhookStoreShape),
				Effect.provideService(ProjectStore, projects as unknown as ProjectStoreShape),
				Effect.provideService(DatabasePort, { db: {} as never }),
			),
		);

	beforeEach(() => {
		webhooks = {
			findById: vi.fn(() => Effect.succeed(null)),
			findByProject: vi.fn(() => Effect.succeed([])),
			create: vi.fn(() => Effect.succeed(mockWebhook)),
			update: vi.fn(() => Effect.succeed(mockWebhook)),
			updateSecret: vi.fn(() => Effect.succeed(mockWebhook)),
			incrementTriggerCount: vi.fn(() => Effect.void),
			delete: vi.fn(() => Effect.void),
		};

		projects = {
			findById: vi.fn(() => Effect.succeed(null)),
			findCollaboratorByUserAndProject: vi.fn(() => Effect.succeed(null)),
		};

		service = new WebhookServiceImpl();
		vi.clearAllMocks();
	});

	it("should be defined", () => {
		expect(service).toBeDefined();
	});

	// -----------------------------------------------------------------------
	// createWebhook
	// -----------------------------------------------------------------------

	describe("createWebhook", () => {
		it("should create webhook and return rawSecret for project owner", async () => {
			projects.findById.mockReturnValue(Effect.succeed(mockProject));

			const result = await run(
				service.createWebhook({
					projectId: "proj-1",
					requesterId: "user-1",
					sourceType: "github",
					webhookUrl: "https://example.com/hook",
				}),
			);

			expect(result.webhook).toBeDefined();
			expect(result.rawSecret).toBeDefined();
			// Raw secret must be a 64-char hex string (32 bytes)
			expect(result.rawSecret).toMatch(/^[0-9a-f]{64}$/);
			expect(webhooks.create).toHaveBeenCalledOnce();
		});

		it("should throw ForbiddenError for non-admin collaborator", async () => {
			projects.findById.mockReturnValue(Effect.succeed(mockProject));
			projects.findCollaboratorByUserAndProject.mockReturnValue(
				Effect.succeed({ role: "developer" }),
			);

			await expect(
				run(
					service.createWebhook({
						projectId: "proj-1",
						requesterId: "user-nobody",
						sourceType: "github",
						webhookUrl: "https://example.com/hook",
					}),
				),
			).rejects.toThrow(ForbiddenError);
		});

		it("should throw NotFoundError for unknown project", async () => {
			await expect(
				run(
					service.createWebhook({
						projectId: "unknown",
						requesterId: "user-1",
						sourceType: "github",
						webhookUrl: "https://example.com/hook",
					}),
				),
			).rejects.toThrow(NotFoundError);
		});

		it("should allow maintainer collaborator to create webhook", async () => {
			// `maintainer`, not the legacy `admin`: the role list named a role the
			// permission builder does not define, so it only ever matched the owner.
			projects.findById.mockReturnValue(Effect.succeed(mockProject));
			projects.findCollaboratorByUserAndProject.mockReturnValue(
				Effect.succeed({ role: "maintainer" }),
			);

			const result = await run(
				service.createWebhook({
					projectId: "proj-1",
					requesterId: "admin-collab",
					sourceType: "github",
					webhookUrl: "https://example.com/hook",
				}),
			);

			expect(result.webhook).toBeDefined();
			expect(result.rawSecret).toMatch(/^[0-9a-f]{64}$/);
		});
	});

	// -----------------------------------------------------------------------
	// rotateWebhookSecret
	// -----------------------------------------------------------------------

	describe("rotateWebhookSecret", () => {
		it("should generate a new secret and return it once for project owner", async () => {
			webhooks.findById.mockReturnValue(Effect.succeed(mockWebhook));
			projects.findById.mockReturnValue(Effect.succeed(mockProject));
			webhooks.updateSecret.mockReturnValue(
				Effect.succeed({ ...mockWebhook, secret: "new-encrypted" }),
			);

			const result = await run(service.rotateWebhookSecret("wh-1", "user-1"));

			expect(result.webhookId).toBe("wh-1");
			expect(result.rawSecret).toMatch(/^[0-9a-f]{64}$/);
			expect(webhooks.updateSecret).toHaveBeenCalledWith("wh-1", result.rawSecret);
		});

		it("should throw NotFoundError when webhook not found", async () => {
			await expect(run(service.rotateWebhookSecret("bad-id", "user-1"))).rejects.toThrow(
				NotFoundError,
			);
		});

		it("should throw ForbiddenError for unauthorized user", async () => {
			webhooks.findById.mockReturnValue(Effect.succeed(mockWebhook));
			projects.findById.mockReturnValue(Effect.succeed(mockProject));
			projects.findCollaboratorByUserAndProject.mockReturnValue(Effect.succeed(null));

			await expect(run(service.rotateWebhookSecret("wh-1", "outsider"))).rejects.toThrow(
				ForbiddenError,
			);
		});
	});

	// -----------------------------------------------------------------------
	// disableWebhook / enableWebhook
	// -----------------------------------------------------------------------

	describe("disableWebhook", () => {
		it("should set isActive to false for project owner", async () => {
			webhooks.findById.mockReturnValue(Effect.succeed(mockWebhook));
			projects.findById.mockReturnValue(Effect.succeed(mockProject));
			webhooks.update.mockReturnValue(Effect.succeed({ ...mockWebhook, isActive: false }));

			const result = await run(service.disableWebhook("wh-1", "user-1"));

			expect(webhooks.update).toHaveBeenCalledWith("wh-1", { isActive: false });
			expect(result?.isActive).toBe(false);
		});

		it("should throw NotFoundError when webhook not found", async () => {
			await expect(run(service.disableWebhook("bad-id", "user-1"))).rejects.toThrow(
				NotFoundError,
			);
		});
	});

	// -----------------------------------------------------------------------
	// deleteWebhook
	// -----------------------------------------------------------------------

	describe("deleteWebhook", () => {
		it("should delete webhook for project owner", async () => {
			webhooks.findById.mockReturnValue(Effect.succeed(mockWebhook));
			projects.findById.mockReturnValue(Effect.succeed(mockProject));

			await expect(run(service.deleteWebhook("wh-1", "user-1"))).resolves.toBeUndefined();
			expect(webhooks.delete).toHaveBeenCalledWith("wh-1");
		});

		it("should throw ForbiddenError for developer collaborator", async () => {
			webhooks.findById.mockReturnValue(Effect.succeed(mockWebhook));
			projects.findById.mockReturnValue(Effect.succeed(mockProject));
			projects.findCollaboratorByUserAndProject.mockReturnValue(
				Effect.succeed({ role: "developer" }),
			);

			await expect(run(service.deleteWebhook("wh-1", "dev-user"))).rejects.toThrow(
				ForbiddenError,
			);
		});
	});
});
