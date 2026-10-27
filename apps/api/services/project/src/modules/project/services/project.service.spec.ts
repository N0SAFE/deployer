import { beforeEach, describe, expect, it, vi } from "vitest";
import { Effect, Stream } from "effect";
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from "@deployer/errors";
import { EMPTY } from "rxjs";
import type { CoreEventSyncShape } from "@project/core/ports/core-event-sync.port";
import { CoreEventSync } from "@project/core/ports/core-event-sync.port";
import type { ProjectEventServiceShape } from "@project/modules/project/services/project-event.service";
import { ProjectEventService } from "@project/modules/project/services/project-event.service";
import type { RuntimeConfigurationAccessorShape } from "@project/core/ports/runtime-configuration-accessor.port";
import { RuntimeConfigurationAccessor } from "@project/core/ports/runtime-configuration-accessor.port";
import { DatabasePort } from "@project/core/database/database.port";
import type { ProjectStoreShape } from "../repositories/project.repository";
import { ProjectStore } from "../repositories/project.repository";
import { ProjectServiceImpl } from "./project.service";

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
		| ProjectStore
		| ProjectEventService
		| CoreEventSync
		| RuntimeConfigurationAccessor
		| DatabasePort;

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

		it("should fail with NotFoundError when project not found", async () => {
			await expect(run(service.getProjectById("missing"))).rejects.toThrow(NotFoundError);
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

		it("should fail with ForbiddenError when requester lacks permission", async () => {
			// A viewer may read but not reconfigure the project.
			const viewerCollab = { ...mockCollaborator, role: "viewer" };
			repository.findById.mockReturnValue(
				Effect.succeed({ ...mockProject, ownerId: "owner-x" }),
			);
			repository.findCollaboratorByUserAndProject.mockReturnValue(
				Effect.succeed(viewerCollab),
			);

			await expect(
				run(service.updateProject("proj-1", "user-2", { name: "Fail" })),
			).rejects.toThrow(ForbiddenError);
		});

		it("should fail with NotFoundError when update returns null", async () => {
			repository.findById.mockReturnValue(Effect.succeed(mockProject)); // owner access
			repository.update.mockReturnValue(Effect.succeed(null));

			await expect(
				run(service.updateProject("proj-1", "user-1", { name: "X" })),
			).rejects.toThrow(NotFoundError);
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

		it("should fail with NotFoundError when project not found", async () => {
			await expect(run(service.deleteProject("missing", "user-1"))).rejects.toThrow(
				NotFoundError,
			);
		});

		it("should fail with ForbiddenError when requester is not owner", async () => {
			repository.findById.mockReturnValue(Effect.succeed(mockProject)); // ownerId: 'user-1'

			await expect(run(service.deleteProject("proj-1", "user-99"))).rejects.toThrow(
				ForbiddenError,
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
					role: "developer",
				}),
			);

			expect(result.inviteId).toBe("collab-1");
		});

		it("should fail with NotFoundError when invited user does not exist", async () => {
			repository.findById.mockReturnValue(Effect.succeed(mockProject));
			repository.findUserByEmail.mockReturnValue(Effect.succeed(null));

			await expect(
				run(
					service.inviteCollaborator("proj-1", "user-1", {
						email: "nobody@example.com",
						role: "developer",
					}),
				),
			).rejects.toThrow(NotFoundError);
		});

		it("should fail with ConflictError when user is already a collaborator", async () => {
			repository.findById.mockReturnValue(Effect.succeed(mockProject));
			repository.findUserByEmail.mockReturnValue(Effect.succeed(mockUser));
			repository.findCollaboratorByUserAndProject.mockReturnValue(
				Effect.succeed(mockCollaborator),
			);

			await expect(
				run(
					service.inviteCollaborator("proj-1", "user-1", {
						email: "other@example.com",
						role: "developer",
					}),
				),
			).rejects.toThrow(ConflictError);
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

		it("should fail with NotFoundError when collaborator not found", async () => {
			repository.findById.mockReturnValue(Effect.succeed(mockProject));
			repository.findCollaboratorByUserAndProject.mockReturnValue(Effect.succeed(null));

			await expect(
				run(service.removeCollaborator("proj-1", "user-1", "user-99")),
			).rejects.toThrow(NotFoundError);
		});

		it("should fail with ForbiddenError when trying to remove owner", async () => {
			const ownerCollab = { ...mockCollaborator, role: "owner" };
			repository.findById.mockReturnValue(Effect.succeed(mockProject));
			repository.findCollaboratorByUserAndProject.mockReturnValue(
				Effect.succeed(ownerCollab),
			);

			await expect(
				run(service.removeCollaborator("proj-1", "user-1", "user-2")),
			).rejects.toThrow(ForbiddenError);
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

		it("should fail with NotFoundError when environment belongs to different project", async () => {
			repository.findById.mockReturnValue(Effect.succeed(mockProject));
			repository.findEnvironmentById.mockReturnValue(
				Effect.succeed({ ...mockEnvironment, projectId: "other-proj" }),
			);

			await expect(
				run(service.getEnvironment("proj-1", "user-1", "env-1")),
			).rejects.toThrow(NotFoundError);
		});

		it("should fail with NotFoundError when environment not found", async () => {
			repository.findById.mockReturnValue(Effect.succeed(mockProject));
			repository.findEnvironmentById.mockReturnValue(Effect.succeed(null));

			await expect(
				run(service.getEnvironment("proj-1", "user-1", "env-1")),
			).rejects.toThrow(NotFoundError);
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

		it("should fail with BadRequestError for system template", async () => {
			repository.findById.mockReturnValue(Effect.succeed(mockProject));
			repository.findTemplateById.mockReturnValue(
				Effect.succeed({ ...mockTemplate, isSystem: true }),
			);

			await expect(
				run(service.deleteVariableTemplate("proj-1", "user-1", "tmpl-1")),
			).rejects.toThrow(BadRequestError);
		});

		it("should fail with NotFoundError when template not found", async () => {
			repository.findById.mockReturnValue(Effect.succeed(mockProject));
			repository.findTemplateById.mockReturnValue(Effect.succeed(null));

			await expect(
				run(service.deleteVariableTemplate("proj-1", "user-1", "tmpl-1")),
			).rejects.toThrow(NotFoundError);
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
