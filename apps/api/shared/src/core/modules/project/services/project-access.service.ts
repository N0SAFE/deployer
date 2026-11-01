import { Context, Effect } from "effect";

import { domainError } from "@deployer/effect-core";

import { ProjectAccessRepository, type ProjectAccessProject, type ProjectAccessQueryFailed } from "../repositories/project-access.repository";

import type { ProjectRole } from "@deployer/auth";

/** The project exists but the caller may not act on it at the requested level. */
export class ProjectAccessDenied extends domainError("ProjectAccessDenied", "forbidden")<{
	readonly message: string;
	readonly projectId: string;
}>() {
	override publicMessage() {
		return this.message;
	}

	override publicData() {
		return { projectId: this.projectId };
	}
}

/** The project named by the caller does not exist. */
export class ProjectNotFound extends domainError("ProjectNotFound", "not_found")<{
	readonly projectId: string;
}>() {
	override publicMessage() {
		return `Project ${this.projectId} not found`;
	}

	override publicData() {
		return { projectId: this.projectId };
	}
}

export type ProjectAccessShape = {
	readonly findProjectById: (
		projectId: string,
	) => Effect.Effect<ProjectAccessProject | null, ProjectAccessQueryFailed, ProjectAccessRepository>;
	readonly findCollaboratorByUserAndProject: (
		userId: string,
		projectId: string,
	) => Effect.Effect<{ readonly role: ProjectRole } | null, ProjectAccessQueryFailed, ProjectAccessRepository>;
	/**
	 * Proves the caller may act on the project at one of `allowedRoles`, and returns the project on success.
	 *
	 * The owner passes without a collaborator row — ownership is a column on the project, so a missing membership must
	 * not read as "no access" for the owner.
	 */
	readonly assertProjectAccess: (
		projectId: string,
		requesterId: string,
		allowedRoles: readonly ProjectRole[],
		forbiddenMessage?: string,
	) => Effect.Effect<ProjectAccessProject, ProjectAccessQueryFailed | ProjectNotFound | ProjectAccessDenied, ProjectAccessRepository>;
};

/**
 * Who may act on a project: the shared ownership and collaborator rule.
 *
 * Every method yields the repository from the Effect context, so the class carries no constructor dependency and the
 * module provides it as a constant (`{ provide: ProjectAccessService, useClass: ProjectAccessService.live }`).
 */
export class ProjectAccessService extends Context.Service<ProjectAccessService, ProjectAccessShape>()(
	"shared/ProjectAccessService",
) {
	static readonly live = class ProjectAccessServiceImpl implements ProjectAccessShape {
		findProjectById(
			projectId: string,
		): Effect.Effect<ProjectAccessProject | null, ProjectAccessQueryFailed, ProjectAccessRepository> {
			return Effect.gen(function* () {
				const repository = yield* ProjectAccessRepository;
				return yield* repository.findProjectById(projectId);
			});
		}

		findCollaboratorByUserAndProject(
			userId: string,
			projectId: string,
		): Effect.Effect<{ readonly role: ProjectRole } | null, ProjectAccessQueryFailed, ProjectAccessRepository> {
			return Effect.gen(function* () {
				const repository = yield* ProjectAccessRepository;
				return yield* repository.findCollaboratorByUserAndProject(userId, projectId);
			});
		}

		assertProjectAccess(
			projectId: string,
			requesterId: string,
			allowedRoles: readonly ProjectRole[],
			forbiddenMessage = "You do not have permission to perform this action",
		): Effect.Effect<
			ProjectAccessProject,
			ProjectAccessQueryFailed | ProjectNotFound | ProjectAccessDenied,
			ProjectAccessRepository
		> {
			return Effect.gen(function* () {
				const repository = yield* ProjectAccessRepository;

				const project = yield* repository.findProjectById(projectId);
				if (!project) {
					return yield* new ProjectNotFound({ projectId });
				}

				if (project.ownerId === requesterId) {
					return project;
				}

				const collaborator = yield* repository.findCollaboratorByUserAndProject(requesterId, projectId);
				if (!collaborator || !allowedRoles.includes(collaborator.role)) {
					return yield* new ProjectAccessDenied({ message: forbiddenMessage, projectId });
				}

				return project;
			});
		}
	};
}
