import { Effect, Stream } from "effect";
import { EMPTY } from "rxjs";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApprovalGuard } from "@deployer/shared/core/modules/approval/approval.guard";

import { DatabasePort } from "@project/core/database/database.port";
import { ProjectDb } from "@project/core/database/project-db";
import type { CoreEventSyncShape } from "@project/core/ports/core-event-sync.port";
import { CoreEventSync } from "@project/core/ports/core-event-sync.port";
import type { RuntimeConfigurationAccessorShape } from "@project/core/ports/runtime-configuration-accessor.port";
import { RuntimeConfigurationAccessor } from "@project/core/ports/runtime-configuration-accessor.port";
import type { ProjectEventServiceShape } from "@project/modules/project/services/project-event.service";
import { ProjectEventService } from "@project/modules/project/services/project-event.service";

import { ProjectConflict, ProjectForbidden, ProjectInvalid, ResourceNotFound } from "../domain/project.errors";
import { ProjectStore } from "../repositories/project.repository";

import { ProjectServiceImpl } from "./project.service";

import type { ProjectStoreShape } from "../repositories/project.repository";



type Fn = ReturnType<typeof vi.fn>;
type Fakes<T> = { [K in keyof T]: Fn };

const now = "2024-01-01T00:00:00.000Z";

const mockProject = {
	id: "proj-1",
	name: "Test Project",
	description: "A test project",
	baseDomain: null,
	ownerId: "user-1",
	settings: null,
	status: "active",
	createdAt: now,
	updatedAt: now,
};

const mockCollaborator = {
	id: "collab-1",
	projectId: "proj-1",
	userId: "user-2",
	role: "developer",
	permissions: null,
	invitedBy: "user-1",
	invitedAt: now,
	acceptedAt: null,
	createdAt: now,
	updatedAt: now,
};

const mockEnvironment = {
	id: "env-1",
	projectId: "proj-1",
	name: "production",
	slug: "production",
	kind: "stable",
	type: "production",
	status: "pending",
	description: null,
	isActive: true,
	domainConfig: null,
	deploymentConfig: null,
	metadata: null,
	createdBy: "user-1",
	createdAt: now,
	updatedAt: now,
};

const mockTemplate = {
	id: "tmpl-1",
	name: "Default Template",
	description: null,
	variables: [],
	isSystem: false,
	usageCount: 0,
	createdBy: "user-1",
	lastUsed: null,
	createdAt: now,
	updatedAt: now,
};

const mockUser = {
	id: "user-2",
	email: "other@example.com",
	name: "Other User",
};

describe("ProjectService", () => {
	let service: ProjectServiceImpl;
	let repository: Fakes<ProjectStoreShape>;
	let events: Fakes<ProjectEventServiceShape>;
	let core: Fakes<CoreEventSyncShape>;
	let configuration: Fakes<RuntimeConfigurationAccessorShape>;

	type Deps =
		| ProjectDb
		| ProjectStore
		| ProjectEventService
		| CoreEventSync
		| RuntimeConfigurationAccessor
		| DatabasePort
		| ApprovalGuard;

	/** Run a use case against the fakes, as the module's Effect context would. */
	const run = <A, E>(effect: Effect.Effect<A, E, Deps>) =>
		Effect.runPromise(
			effect.pipe(
				Effect.provideService(ProjectStore, repository as unknown as ProjectStoreShape),
				Effect.provideService(ProjectEventService, events as unknown as ProjectEventServiceShape),
				Effect.provideService(CoreEventSync, core as unknown as CoreEventSyncShape),
				Effect.provideService(
					RuntimeConfigurationAccessor,
					configuration as unknown as RuntimeConfigurationAccessorShape,
				),
				Effect.provideService(DatabasePort, { db: {} as never }),
				// The store is faked, so nothing reads the database; the type still names it.
				Effect.provideService(ProjectDb, {} as never),
				// Approval enforcement has its own spec; these use cases run as a caller who holds the capability.
				Effect.provideService(ApprovalGuard, {
					require: () => Effect.void,
				} as unknown as ApprovalGuard["Service"]),
			),
		);

	beforeEach(() => {
		repository = {
			findMany: vi.fn(() => Effect.succeed({ data: [], meta: {} })),
			findById: vi.fn(() => Effect.succeed(null)),
			create: vi.fn(() => Effect.succeed(mockProject)),
			update: vi.fn(() => Effect.succeed(null)),
			delete: vi.fn(() => Effect.void),
			getProjectStats: vi.fn(() => Effect.succeed({ _count: {}, latestDeployment: null })),
			findCollaboratorsByProject: vi.fn(() => Effect.succeed([])),
			findCollaboratorByUserAndProject: vi.fn(() => Effect.succeed(null)),
			createCollaborator: vi.fn(() => Effect.succeed(mockCollaborator)),
			updateCollaborator: vi.fn(() => Effect.succeed(null)),
			deleteCollaboratorByUserAndProject: vi.fn(() => Effect.void),
			findEnvironmentsByProject: vi.fn(() => Effect.succeed([])),
			findEnvironmentById: vi.fn(() => Effect.succeed(null)),
			countEnabledServicesForEnvironment: vi.fn(() => Effect.succeed(0)),
			createEnvironment: vi.fn(() => Effect.succeed(mockEnvironment)),
			updateEnvironment: vi.fn(() => Effect.succeed(null)),
			deleteEnvironment: vi.fn(() => Effect.void),
			findServiceProjectId: vi.fn(() => Effect.succeed(null)),
			findServiceEnvironmentLinksByProject: vi.fn(() => Effect.succeed([])),
			upsertServiceEnvironmentLink: vi.fn(() => Effect.succeed({})),
			findTemplatesByProject: vi.fn(() => Effect.succeed([])),
			findTemplateById: vi.fn(() => Effect.succeed(null)),
			createTemplate: vi.fn(() => Effect.succeed(mockTemplate)),
			updateTemplate: vi.fn(() => Effect.succeed(null)),
			deleteTemplate: vi.fn(() => Effect.void),
			findUserByEmail: vi.fn(() => Effect.succeed(null)),
		};

		events = {
			emitEffect: vi.fn(() => Effect.void),
			subscribeEffect: vi.fn(() => Stream.empty),
		};

		core = { registerNamespaceAdapter: vi.fn(), selectMany: vi.fn() };

		configuration = {
			resolveStrict: vi.fn(),
			projectConfigFromSettings: vi.fn(),
			serviceConfigFromRecord: vi.fn(),
		};

		service = new ProjectServiceImpl();
		vi.clearAllMocks();
	});

	it("should be defined", () => {
		expect(service).toBeDefined();
	});

	// ========================================
	// listProjects
	// ========================================

	describe("listProjects", () => {
		it("should delegate to repository findMany", async () => {
			const input = { limit: 10, offset: 0 };
			const mockResponse = {
				data: [mockProject],
				meta: { total: 1, limit: 10, offset: 0, hasMore: false },
			};
			repository.findMany.mockReturnValue(Effect.succeed(mockResponse));

			const result = await run(service.listProjects(input));

			expect(result).toEqual(mockResponse);
			expect(repository.findMany).toHaveBeenCalledWith(input);
		});
	});

	// ========================================
	// getProjectById
	// ========================================

	describe("getProjectById", () => {
		it("should return project with stats when found", async () => {
			const stats = {
				_count: { services: 2, deployments: 5, collaborators: 1 },
				latestDeployment: null,
			};
			repository.findById.mockReturnValue(Effect.succeed(mockProject));
			repository.getProjectStats.mockReturnValue(Effect.succeed(stats));

			const result = await run(service.getProjectById("proj-1"));

			expect(result).toEqual({ ...mockProject, ...stats });
			expect(repository.findById).toHaveBeenCalledWith("proj-1");
		});

		it("should fail with ResourceNotFound when project not found", async () => {
			await expect(run(service.getProjectById("missing"))).rejects.toThrow(ResourceNotFound);
		});
	});

	// ========================================
	// createProject
	// ========================================

	describe("createProject", () => {
		it("should create a project and emit projectCreated", async () => {
			const result = await run(service.createProject({ name: "Test", ownerId: "user-1" }));

			expect(result).toEqual(mockProject);
			expect(repository.create).toHaveBeenCalledWith(
				expect.objectContaining({ name: "Test", ownerId: "user-1" }),
			);
			expect(events.emitEffect).toHaveBeenCalledWith(
				"projectCreated",
				{ ownerId: "user-1" },
				expect.objectContaining({
					projectId: mockProject.id,
					ownerId: mockProject.ownerId,
					name: mockProject.name,
				}),
			);
		});
	});

	// ========================================
	// updateProject
	// ========================================

	describe("updateProject", () => {
		it("should update when requester is owner", async () => {
			const updated = { ...mockProject, name: "Renamed" };
			repository.findById.mockReturnValue(Effect.succeed(mockProject));
			repository.findCollaboratorByUserAndProject.mockReturnValue(Effect.succeed(null));
			repository.update.mockReturnValue(Effect.succeed(updated));

			const result = await run(
				service.updateProject("proj-1", "user-1", { name: "Renamed" }),
			);

			expect(result).toEqual(updated);
			expect(events.emitEffect).toHaveBeenCalledWith(
				"projectUpdated",
				{ projectId: "proj-1" },
				expect.objectContaining({
					projectId: "proj-1",
					ownerId: updated.ownerId,
					changedFields: expect.arrayContaining(["name"]),
				}),
			);
		});

		it("should update when requester is a maintainer collaborator", async () => {
			const updated = { ...mockProject, name: "Renamed" };
			// `maintainer`, not `admin`: `admin` is not a project role, and the
			// service used to gate on it — which denied every real collaborator.
			const maintainerCollab = { ...mockCollaborator, role: "maintainer", userId: "user-3" };
			repository.findById.mockReturnValue(
				Effect.succeed({ ...mockProject, ownerId: "owner-x" }),
			);
			repository.findCollaboratorByUserAndProject.mockReturnValue(
				Effect.succeed(maintainerCollab),
			);
			repository.update.mockReturnValue(Effect.succeed(updated));

			const result = await run(
				service.updateProject("proj-1", "user-3", { name: "Renamed" }),
			);

			expect(result).toEqual(updated);
		});

		it("should fail with ProjectForbidden when requester lacks permission", async () => {
			// A viewer may read but not reconfigure the project.
			const viewerCollab = { ...mockCollaborator, role: "member" };
			repository.findById.mockReturnValue(
				Effect.succeed({ ...mockProject, ownerId: "owner-x" }),
			);
			repository.findCollaboratorByUserAndProject.mockReturnValue(
				Effect.succeed(viewerCollab),
			);

			await expect(
				run(service.updateProject("proj-1", "user-2", { name: "Fail" })),
			).rejects.toThrow(ProjectForbidden);
		});

		it("should fail with ResourceNotFound when update returns null", async () => {
			repository.findById.mockReturnValue(Effect.succeed(mockProject)); // owner access
			repository.update.mockReturnValue(Effect.succeed(null));

			await expect(
				run(service.updateProject("proj-1", "user-1", { name: "X" })),
			).rejects.toThrow(ResourceNotFound);
		});
	});

	// ========================================
	// deleteProject
	// ========================================

	describe("deleteProject", () => {
		it("should delete when requester is owner", async () => {
			repository.findById.mockReturnValue(Effect.succeed(mockProject));

			await expect(run(service.deleteProject("proj-1", "user-1"))).resolves.toBeUndefined();
			expect(repository.delete).toHaveBeenCalledWith("proj-1");
		});

		it("should fail with ResourceNotFound when project not found", async () => {
			await expect(run(service.deleteProject("missing", "user-1"))).rejects.toThrow(
				ResourceNotFound,
			);
		});

		it("should fail with ProjectForbidden when requester is not owner", async () => {
			repository.findById.mockReturnValue(Effect.succeed(mockProject)); // ownerId: 'user-1'

			await expect(run(service.deleteProject("proj-1", "user-99"))).rejects.toThrow(
				ProjectForbidden,
			);
		});
	});

	// ========================================
	// getCollaborators
	// ========================================

	describe("getCollaborators", () => {
		it("should return collaborators for a project member", async () => {
			repository.findById.mockReturnValue(Effect.succeed(mockProject));
			repository.findCollaboratorsByProject.mockReturnValue(
				Effect.succeed([mockCollaborator]),
			);

			const result = await run(service.getCollaborators("proj-1", "user-1"));

			expect(result).toEqual([mockCollaborator]);
		});
	});

	// ========================================
	// inviteCollaborator
	// ========================================

	describe("inviteCollaborator", () => {
		it("should invite a new collaborator", async () => {
			repository.findById.mockReturnValue(Effect.succeed(mockProject)); // owner
			repository.findUserByEmail.mockReturnValue(Effect.succeed(mockUser));
			repository.createCollaborator.mockReturnValue(Effect.succeed(mockCollaborator));

			const result = await run(
				service.inviteCollaborator("proj-1", "user-1", {
					email: "other@example.com",
					role: "deployer",
				}),
			);

			expect(result.inviteId).toBe("collab-1");
		});

		/**
		 * ── WHY THESE EXIST ─────────────────────────────────────────────────
		 * `data.role` used to be cast (`as ProjectRole`) straight into the
		 * insert, so the role a caller asked for was never checked against the
		 * role they held. A maintainer — who has `admin` access, the same as the
		 * owner — could invite a second maintainer or an owner and thereby
		 * escalate.
		 */
		it("refuses to grant ownership, even from the owner", async () => {
			repository.findById.mockReturnValue(Effect.succeed(mockProject));
			repository.findUserByEmail.mockReturnValue(Effect.succeed(mockUser));

			await expect(
				run(
					service.inviteCollaborator("proj-1", "user-1", {
						email: "other@example.com",
						role: "owner",
					}),
				),
			).rejects.toThrow(ProjectForbidden);
			expect(repository.createCollaborator).not.toHaveBeenCalled();
		});

		it("refuses a non-owner granting a role at or above their own", async () => {
			repository.findById.mockReturnValue(Effect.succeed(mockProject));
			repository.findCollaboratorByUserAndProject.mockImplementation((userId: string) =>
				Effect.succeed(userId === "user-2" ? { ...mockCollaborator, role: "maintainer" } : null),
			);

			await expect(
				run(
					service.inviteCollaborator("proj-1", "user-2", {
						email: "other@example.com",
						role: "maintainer",
					}),
				),
			).rejects.toThrow(ProjectForbidden);
			expect(repository.createCollaborator).not.toHaveBeenCalled();
		});

		it("lets a maintainer grant a role below their own", async () => {
			repository.findById.mockReturnValue(Effect.succeed(mockProject));
			repository.findCollaboratorByUserAndProject.mockImplementation((userId: string) =>
				Effect.succeed(userId === "user-2" ? { ...mockCollaborator, role: "maintainer" } : null),
			);
			// The invitee is a DIFFERENT user from the caller.
			repository.findUserByEmail.mockReturnValue(
				Effect.succeed({ ...mockUser, id: "user-3", email: "new@example.com" }),
			);
			repository.createCollaborator.mockReturnValue(Effect.succeed(mockCollaborator));

			await run(
				service.inviteCollaborator("proj-1", "user-2", {
					email: "new@example.com",
					role: "deployer",
				}),
			);

			expect(repository.createCollaborator).toHaveBeenCalledWith(
				expect.objectContaining({ role: "deployer" }),
			);
		});

		it("should fail with ResourceNotFound when invited user does not exist", async () => {
			repository.findById.mockReturnValue(Effect.succeed(mockProject));
			repository.findUserByEmail.mockReturnValue(Effect.succeed(null));

			await expect(
				run(
					service.inviteCollaborator("proj-1", "user-1", {
						email: "nobody@example.com",
						role: "deployer",
					}),
				),
			).rejects.toThrow(ResourceNotFound);
		});

		it("should fail with ProjectConflict when user is already a collaborator", async () => {
			repository.findById.mockReturnValue(Effect.succeed(mockProject));
			repository.findUserByEmail.mockReturnValue(Effect.succeed(mockUser));
			repository.findCollaboratorByUserAndProject.mockReturnValue(
				Effect.succeed(mockCollaborator),
			);

			await expect(
				run(
					service.inviteCollaborator("proj-1", "user-1", {
						email: "other@example.com",
						role: "deployer",
					}),
				),
			).rejects.toThrow(ProjectConflict);
		});
	});

	// ========================================
	// removeCollaborator
	// ========================================

	describe("removeCollaborator", () => {
		it("should remove a collaborator and emit the event", async () => {
			repository.findById.mockReturnValue(Effect.succeed(mockProject)); // owner
			repository.findCollaboratorByUserAndProject.mockReturnValue(
				Effect.succeed(mockCollaborator),
			);

			await expect(
				run(service.removeCollaborator("proj-1", "user-1", "user-2")),
			).resolves.toBeUndefined();
			expect(events.emitEffect).toHaveBeenCalledWith(
				"projectCollaboratorRemoved",
				{ projectId: "proj-1" },
				expect.objectContaining({
					projectId: "proj-1",
					userId: "user-2",
				}),
			);
		});

		it("should fail with ResourceNotFound when collaborator not found", async () => {
			repository.findById.mockReturnValue(Effect.succeed(mockProject));
			repository.findCollaboratorByUserAndProject.mockReturnValue(Effect.succeed(null));

			await expect(
				run(service.removeCollaborator("proj-1", "user-1", "user-99")),
			).rejects.toThrow(ResourceNotFound);
		});

		it("should fail with ProjectForbidden when trying to remove owner", async () => {
			const ownerCollab = { ...mockCollaborator, role: "owner" };
			repository.findById.mockReturnValue(Effect.succeed(mockProject));
			repository.findCollaboratorByUserAndProject.mockReturnValue(
				Effect.succeed(ownerCollab),
			);

			await expect(
				run(service.removeCollaborator("proj-1", "user-1", "user-2")),
			).rejects.toThrow(ProjectForbidden);
		});
	});

	// ========================================
	// listEnvironments / getEnvironment
	// ========================================

	describe("listEnvironments", () => {
		it("should return environments for a project member", async () => {
			repository.findById.mockReturnValue(Effect.succeed(mockProject));
			repository.findEnvironmentsByProject.mockReturnValue(
				Effect.succeed([mockEnvironment]),
			);

			const result = await run(service.listEnvironments("proj-1", "user-1"));

			expect(result).toEqual([mockEnvironment]);
		});
	});

	describe("getEnvironment", () => {
		it("should return environment when found in project", async () => {
			repository.findById.mockReturnValue(Effect.succeed(mockProject));
			repository.findEnvironmentById.mockReturnValue(Effect.succeed(mockEnvironment));

			const result = await run(service.getEnvironment("proj-1", "user-1", "env-1"));

			expect(result).toEqual(mockEnvironment);
		});

		it("should fail with ResourceNotFound when environment belongs to different project", async () => {
			repository.findById.mockReturnValue(Effect.succeed(mockProject));
			repository.findEnvironmentById.mockReturnValue(
				Effect.succeed({ ...mockEnvironment, projectId: "other-proj" }),
			);

			await expect(
				run(service.getEnvironment("proj-1", "user-1", "env-1")),
			).rejects.toThrow(ResourceNotFound);
		});

		it("should fail with ResourceNotFound when environment not found", async () => {
			repository.findById.mockReturnValue(Effect.succeed(mockProject));
			repository.findEnvironmentById.mockReturnValue(Effect.succeed(null));

			await expect(
				run(service.getEnvironment("proj-1", "user-1", "env-1")),
			).rejects.toThrow(ResourceNotFound);
		});
	});

	// ========================================
	// createEnvironment / deleteEnvironment
	// ========================================

	describe("createEnvironment", () => {
		it("should create an environment", async () => {
			repository.findById.mockReturnValue(Effect.succeed(mockProject));

			const result = await run(
				service.createEnvironment("proj-1", "user-1", {
					name: "production",
					kind: "stable",
				}),
			);

			expect(result).toEqual(mockEnvironment);
		});
	});

	describe("deleteEnvironment", () => {
		it("should delete an environment", async () => {
			repository.findById.mockReturnValue(Effect.succeed(mockProject));
			repository.findEnvironmentById.mockReturnValue(Effect.succeed(mockEnvironment));

			await expect(
				run(service.deleteEnvironment("proj-1", "user-1", "env-1")),
			).resolves.toBeUndefined();
		});
	});

	// ========================================
	// Variable templates
	// ========================================

	describe("listVariableTemplates", () => {
		it("should return templates", async () => {
			repository.findById.mockReturnValue(Effect.succeed(mockProject));
			repository.findTemplatesByProject.mockReturnValue(Effect.succeed([mockTemplate]));

			const result = await run(service.listVariableTemplates("proj-1", "user-1"));

			expect(result).toEqual([mockTemplate]);
		});
	});

	describe("deleteVariableTemplate", () => {
		it("should delete a non-system template", async () => {
			repository.findById.mockReturnValue(Effect.succeed(mockProject));
			repository.findTemplateById.mockReturnValue(Effect.succeed(mockTemplate));

			await expect(
				run(service.deleteVariableTemplate("proj-1", "user-1", "tmpl-1")),
			).resolves.toBeUndefined();
			expect(repository.deleteTemplate).toHaveBeenCalledWith("tmpl-1");
		});

		it("should fail with ProjectInvalid for system template", async () => {
			repository.findById.mockReturnValue(Effect.succeed(mockProject));
			repository.findTemplateById.mockReturnValue(
				Effect.succeed({ ...mockTemplate, isSystem: true }),
			);

			await expect(
				run(service.deleteVariableTemplate("proj-1", "user-1", "tmpl-1")),
			).rejects.toThrow(ProjectInvalid);
		});

		it("should fail with ResourceNotFound when template not found", async () => {
			repository.findById.mockReturnValue(Effect.succeed(mockProject));
			repository.findTemplateById.mockReturnValue(Effect.succeed(null));

			await expect(
				run(service.deleteVariableTemplate("proj-1", "user-1", "tmpl-1")),
			).rejects.toThrow(ResourceNotFound);
		});
	});

	describe("updateCollaborator", () => {
		it("refuses a role patch at or above the caller's own", async () => {
			repository.findById.mockReturnValue(Effect.succeed(mockProject));
			repository.findCollaboratorByUserAndProject.mockImplementation((userId: string) =>
				Effect.succeed(
					userId === "user-2"
						? { ...mockCollaborator, role: "maintainer" }
						: { ...mockCollaborator, userId: "user-3", role: "member" },
				),
			);

			await expect(
				run(service.updateCollaborator("proj-1", "user-2", "user-3", { role: "owner" })),
			).rejects.toThrow(ProjectForbidden);
			expect(repository.updateCollaborator).not.toHaveBeenCalled();
		});
	});

	// ========================================
	// security config — the secret is write-only
	// ========================================

	describe("security config", () => {
		const projectWithSecrets = {
			...mockProject,
			settings: {
				webhookSecret: "whsec_live_do_not_echo",
				basicAuthUsername: "staging",
				basicAuthPassword: "hunter2",
				enableBasicAuth: true,
				allowedDomains: [],
				ipWhitelist: [],
			},
		};

		beforeEach(() => {
			repository.findById.mockReturnValue(Effect.succeed(projectWithSecrets));
			configuration.projectConfigFromSettings.mockReturnValue(undefined);
			configuration.resolveStrict.mockReturnValue(
				Effect.succeed({
					effective: { routing: { forceHttps: true } },
				}),
			);
		});

		/**
		 * The read used to return the stored values verbatim, so every role with
		 * `read` — including `viewer` — could read the webhook HMAC key and the
		 * basic-auth password.
		 */
		it("masks the stored secrets on read and says only whether they are set", async () => {
			const result = await run(service.getSecurityConfig("proj-1", "user-1"));

			expect(result.webhookSecret).toBeNull();
			expect(result.basicAuthPassword).toBeNull();
			expect(result.hasWebhookSecret).toBe(true);
			expect(result.hasBasicAuthPassword).toBe(true);
			// The non-secret half still reads normally.
			expect(result.basicAuthUsername).toBe("staging");
			expect(result.enableHttpsRedirect).toBe(true);
			expect(JSON.stringify(result)).not.toContain("whsec_live_do_not_echo");
			expect(JSON.stringify(result)).not.toContain("hunter2");
		});

		it("accepts a new secret on write and still never echoes it", async () => {
			repository.update.mockReturnValue(
				Effect.succeed({
					...projectWithSecrets,
					settings: { ...projectWithSecrets.settings, basicAuthPassword: "rotated" },
				}),
			);

			const result = await run(
				service.updateSecurityConfig("proj-1", "user-1", { basicAuthPassword: "rotated" }),
			);

			expect(repository.update).toHaveBeenCalledWith(
				"proj-1",
				expect.objectContaining({
					settings: expect.objectContaining({ basicAuthPassword: "rotated" }),
				}),
			);
			expect(result.basicAuthPassword).toBeNull();
			expect(result.hasBasicAuthPassword).toBe(true);
		});
	});

	describe("streamQueryEvents", () => {
		it("should apply fluent filters and fuzzy search when provided", async () => {
			const queryBuilder = {
				whereEventName: vi.fn().mockReturnThis(),
				wherePayload: vi.fn().mockReturnThis(),
				whereFuzzy: vi.fn().mockReturnThis(),
				execute: vi.fn().mockReturnValue(EMPTY),
			};
			core.selectMany.mockReturnValue(queryBuilder);

			const iterable = await run(
				service.streamQueryEvents({
					projectId: "proj-1",
					ownerId: "user-1",
					eventTypes: ["projectUpdated"],
					fuzzy: "rename",
					replay: false,
					replayLimit: 20,
				}),
			);

			expect(iterable).toBeDefined();
			expect(core.selectMany).toHaveBeenCalledTimes(1);
			expect(queryBuilder.whereEventName).toHaveBeenCalledTimes(1);
			expect(queryBuilder.wherePayload).toHaveBeenCalledTimes(2);
			expect(queryBuilder.whereFuzzy).toHaveBeenCalledWith("rename");
			expect(queryBuilder.execute).toHaveBeenCalledTimes(1);
		});
	});
});
