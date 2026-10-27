import { Controller } from "@nestjs/common";
import { Implement } from "@orpc/nest";
import { ORPCError, implement } from "@orpc/server";
import { projectContract } from "@deployer/project-contracts";
import { EffectContextOf } from "@deployer/nest-effect";
import { Effect } from "effect";

import { requireAuth } from "@deployer/shared/core/modules/auth/orpc/middlewares";
import { actorFromContext } from "@project/core/utils/actor.utils";

import { ProjectDomainModule } from "../project.module";
import { ProjectStore } from "../repositories/project.repository";
import { ProjectNetworkService } from "../services/project-network.service";
import { ProjectService } from "../services/project.service";
import { mapProjectFailures } from "./project.error-mapper";

/**
 * The project domain's oRPC surface.
 *
 * Every method binds a contract procedure, takes the actor from the context and
 * delegates to a service resolved from the module's Effect context. Rules live
 * in the service; this class only maps failures.
 */
@Controller()
export class ProjectController {
	// ========================================
	// CORE CRUD
	// ========================================

	@Implement(projectContract.list)
	list() {
		return implement(projectContract.list)
			.use(requireAuth())
			.use(ProjectDomainModule[EffectContextOf])
			.effect(function* ({ input }) {
				const projects = yield* ProjectService;
				return yield* projects.listProjects(input.query).pipe(mapProjectFailures);
			});
	}

	@Implement(projectContract.findById)
	findById() {
		return implement(projectContract.findById)
			.use(requireAuth())
			.use(ProjectDomainModule[EffectContextOf])
			.effect(function* ({ input }) {
				const projects = yield* ProjectService;
				return yield* projects.getProjectById(input.params.id).pipe(mapProjectFailures);
			});
	}

	@Implement(projectContract.create)
	create() {
		return implement(projectContract.create)
			.use(requireAuth())
			.use(ProjectDomainModule[EffectContextOf])
			.effect(function* ({ input, context }) {
				const projects = yield* ProjectService;
				// The create contract is COMPACT input (body-only schema) — `input`
				// IS the create payload, not `input.body`.
				const project = yield* projects
					.createProject({ ...input, ownerId: actorFromContext(context).userId })
					.pipe(mapProjectFailures);
				return { status: 201 as const, headers: {}, body: project };
			});
	}

	@Implement(projectContract.update)
	update() {
		return implement(projectContract.update)
			.use(requireAuth())
			.use(ProjectDomainModule[EffectContextOf])
			.effect(function* ({ input, context }) {
				const projects = yield* ProjectService;
				const { id, ...data } = input;
				return yield* projects
					.updateProject(id, actorFromContext(context).userId, data)
					.pipe(mapProjectFailures);
			});
	}

	@Implement(projectContract.delete)
	delete() {
		return implement(projectContract.delete)
			.use(requireAuth())
			.use(ProjectDomainModule[EffectContextOf])
			.effect(function* ({ input, context }) {
				const projects = yield* ProjectService;
				yield* projects
					.deleteProject(input.params.id, actorFromContext(context).userId)
					.pipe(mapProjectFailures);
				return { success: true };
			});
	}

	// ========================================
	// COLLABORATORS
	// ========================================

	@Implement(projectContract.getCollaborators)
	getCollaborators() {
		return implement(projectContract.getCollaborators)
			.use(requireAuth())
			.use(ProjectDomainModule[EffectContextOf])
			.effect(function* ({ input, context }) {
				const projects = yield* ProjectService;
				const collaborators = yield* projects
					.getCollaborators(input.params.id, actorFromContext(context).userId)
					.pipe(mapProjectFailures);
				return { collaborators };
			});
	}

	@Implement(projectContract.inviteCollaborator)
	inviteCollaborator() {
		return implement(projectContract.inviteCollaborator)
			.use(requireAuth())
			.use(ProjectDomainModule[EffectContextOf])
			.effect(function* ({ input, context }) {
				const projects = yield* ProjectService;
				return yield* projects
					.inviteCollaborator(
						input.params.id,
						actorFromContext(context).userId,
						input.body,
					)
					.pipe(mapProjectFailures);
			});
	}

	@Implement(projectContract.updateCollaborator)
	updateCollaborator() {
		return implement(projectContract.updateCollaborator)
			.use(requireAuth())
			.use(ProjectDomainModule[EffectContextOf])
			.effect(function* ({ input, context }) {
				const projects = yield* ProjectService;
				// body is optional (all fields optional) — coalesce to {}.
				return yield* projects
					.updateCollaborator(
						input.params.id,
						actorFromContext(context).userId,
						input.params.userId,
						input.body ?? {},
					)
					.pipe(mapProjectFailures);
			});
	}

	@Implement(projectContract.removeCollaborator)
	removeCollaborator() {
		return implement(projectContract.removeCollaborator)
			.use(requireAuth())
			.use(ProjectDomainModule[EffectContextOf])
			.effect(function* ({ input, context }) {
				const projects = yield* ProjectService;
				yield* projects
					.removeCollaborator(
						input.params.id,
						actorFromContext(context).userId,
						input.params.userId,
					)
					.pipe(mapProjectFailures);
				return { success: true, message: "Collaborator removed successfully" };
			});
	}

	// ========================================
	// ENVIRONMENTS
	// ========================================

	@Implement(projectContract.listEnvironments)
	listEnvironments() {
		return implement(projectContract.listEnvironments)
			.use(requireAuth())
			.use(ProjectDomainModule[EffectContextOf])
			.effect(function* ({ input, context }) {
				const projects = yield* ProjectService;
				const envs = yield* projects
					.listEnvironments(
						input.params.id,
						actorFromContext(context).userId,
						input.query?.kind,
					)
					.pipe(mapProjectFailures);
				return { environments: envs };
			});
	}

	@Implement(projectContract.getEnvironment)
	getEnvironment() {
		return implement(projectContract.getEnvironment)
			.use(requireAuth())
			.use(ProjectDomainModule[EffectContextOf])
			.effect(function* ({ input, context }) {
				const projects = yield* ProjectService;
				return yield* projects
					.getEnvironment(
						input.params.id,
						actorFromContext(context).userId,
						input.params.environmentId,
					)
					.pipe(mapProjectFailures);
			});
	}

	@Implement(projectContract.createEnvironment)
	createEnvironment() {
		return implement(projectContract.createEnvironment)
			.use(requireAuth())
			.use(ProjectDomainModule[EffectContextOf])
			.effect(function* ({ input, context }) {
				const projects = yield* ProjectService;
				return yield* projects
					.createEnvironment(
						input.params.id,
						actorFromContext(context).userId,
						input.body,
					)
					.pipe(mapProjectFailures);
			});
	}

	@Implement(projectContract.updateEnvironment)
	updateEnvironment() {
		return implement(projectContract.updateEnvironment)
			.use(requireAuth())
			.use(ProjectDomainModule[EffectContextOf])
			.effect(function* ({ input, context }) {
				const projects = yield* ProjectService;
				return yield* projects
					.updateEnvironment(
						input.params.id,
						actorFromContext(context).userId,
						input.params.environmentId,
						input.body ?? {},
					)
					.pipe(mapProjectFailures);
			});
	}

	@Implement(projectContract.deleteEnvironment)
	deleteEnvironment() {
		return implement(projectContract.deleteEnvironment)
			.use(requireAuth())
			.use(ProjectDomainModule[EffectContextOf])
			.effect(function* ({ input, context }) {
				const projects = yield* ProjectService;
				yield* projects
					.deleteEnvironment(
						input.params.id,
						actorFromContext(context).userId,
						input.params.environmentId,
					)
					.pipe(mapProjectFailures);
				return { success: true, message: "Environment deleted successfully" };
			});
	}

	@Implement(projectContract.cloneEnvironment)
	cloneEnvironment() {
		return implement(projectContract.cloneEnvironment)
			.use(requireAuth())
			.use(ProjectDomainModule[EffectContextOf])
			.effect(function* ({ input, context }) {
				const projects = yield* ProjectService;
				return yield* projects
					.cloneEnvironment(
						input.params.id,
						actorFromContext(context).userId,
						input.params.environmentId,
						input.body,
					)
					.pipe(mapProjectFailures);
			});
	}

	// ========================================
	// SERVICE × ENVIRONMENT LINKS
	// ========================================

	@Implement(projectContract.listServiceEnvironmentLinks)
	listServiceEnvironmentLinks() {
		return implement(projectContract.listServiceEnvironmentLinks)
			.use(requireAuth())
			.use(ProjectDomainModule[EffectContextOf])
			.effect(function* ({ input, context }) {
				const projects = yield* ProjectService;
				const links = yield* projects
					.listServiceEnvironmentLinks(
						input.params.id,
						actorFromContext(context).userId,
					)
					.pipe(mapProjectFailures);
				return { links };
			});
	}

	@Implement(projectContract.upsertServiceEnvironmentLink)
	upsertServiceEnvironmentLink() {
		return implement(projectContract.upsertServiceEnvironmentLink)
			.use(requireAuth())
			.use(ProjectDomainModule[EffectContextOf])
			.effect(function* ({ input, context }) {
				const projects = yield* ProjectService;
				return yield* projects
					.upsertServiceEnvironmentLink(
						input.params.id,
						actorFromContext(context).userId,
						input.body,
					)
					.pipe(mapProjectFailures);
			});
	}

	// ========================================
	// NETWORK CONFIGURATION (DNS provider + zone + records)
	// ========================================

	@Implement(projectContract.getNetwork)
	getNetwork() {
		return implement(projectContract.getNetwork)
			.use(requireAuth())
			.use(ProjectDomainModule[EffectContextOf])
			.effect(function* ({ input }) {
				const network = yield* ProjectNetworkService;
				return yield* network.getNetwork(input.params.id).pipe(mapProjectFailures);
			});
	}

	@Implement(projectContract.updateNetwork)
	updateNetwork() {
		return implement(projectContract.updateNetwork)
			.use(requireAuth())
			.use(ProjectDomainModule[EffectContextOf])
			.effect(function* ({ input }) {
				const network = yield* ProjectNetworkService;
				return yield* network
					.updateNetwork(input.params.id, input.body ?? {})
					.pipe(mapProjectFailures);
			});
	}

	// ========================================
	// VARIABLE TEMPLATES
	// ========================================

	@Implement(projectContract.listVariableTemplates)
	listVariableTemplates() {
		return implement(projectContract.listVariableTemplates)
			.use(requireAuth())
			.use(ProjectDomainModule[EffectContextOf])
			.effect(function* ({ input, context }) {
				const projects = yield* ProjectService;
				const templates = yield* projects
					.listVariableTemplates(input.params.id, actorFromContext(context).userId)
					.pipe(mapProjectFailures);
				return { templates };
			});
	}

	@Implement(projectContract.getVariableTemplate)
	getVariableTemplate() {
		return implement(projectContract.getVariableTemplate)
			.use(requireAuth())
			.use(ProjectDomainModule[EffectContextOf])
			.effect(function* ({ input, context }) {
				const projects = yield* ProjectService;
				return yield* projects
					.getVariableTemplate(
						input.params.id,
						actorFromContext(context).userId,
						input.params.templateId,
					)
					.pipe(mapProjectFailures);
			});
	}

	@Implement(projectContract.createVariableTemplate)
	createVariableTemplate() {
		return implement(projectContract.createVariableTemplate)
			.use(requireAuth())
			.use(ProjectDomainModule[EffectContextOf])
			.effect(function* ({ input, context }) {
				const projects = yield* ProjectService;
				return yield* projects
					.createVariableTemplate(
						input.params.id,
						actorFromContext(context).userId,
						input.body,
					)
					.pipe(mapProjectFailures);
			});
	}

	@Implement(projectContract.updateVariableTemplate)
	updateVariableTemplate() {
		return implement(projectContract.updateVariableTemplate)
			.use(requireAuth())
			.use(ProjectDomainModule[EffectContextOf])
			.effect(function* ({ input, context }) {
				const projects = yield* ProjectService;
				return yield* projects
					.updateVariableTemplate(
						input.params.id,
						actorFromContext(context).userId,
						input.params.templateId,
						input.body ?? {},
					)
					.pipe(mapProjectFailures);
			});
	}

	@Implement(projectContract.deleteVariableTemplate)
	deleteVariableTemplate() {
		return implement(projectContract.deleteVariableTemplate)
			.use(requireAuth())
			.use(ProjectDomainModule[EffectContextOf])
			.effect(function* ({ input, context }) {
				const projects = yield* ProjectService;
				yield* projects
					.deleteVariableTemplate(
						input.params.id,
						actorFromContext(context).userId,
						input.params.templateId,
					)
					.pipe(mapProjectFailures);
				return { success: true, message: "Template deleted successfully" };
			});
	}

	// ========================================
	// CONFIGURATION
	// ========================================

	@Implement(projectContract.getGeneralConfig)
	getGeneralConfig() {
		return implement(projectContract.getGeneralConfig)
			.use(requireAuth())
			.use(ProjectDomainModule[EffectContextOf])
			.effect(function* ({ input, context }) {
				const projects = yield* ProjectService;
				return yield* projects
					.getGeneralConfig(input.params.id, actorFromContext(context).userId)
					.pipe(mapProjectFailures);
			});
	}

	@Implement(projectContract.updateGeneralConfig)
	updateGeneralConfig() {
		return implement(projectContract.updateGeneralConfig)
			.use(requireAuth())
			.use(ProjectDomainModule[EffectContextOf])
			.effect(function* ({ input, context }) {
				const projects = yield* ProjectService;
				return yield* projects
					.updateGeneralConfig(
						input.params.id,
						actorFromContext(context).userId,
						input.body ?? {},
					)
					.pipe(mapProjectFailures);
			});
	}

	@Implement(projectContract.getEnvironmentConfig)
	getEnvironmentConfig() {
		return implement(projectContract.getEnvironmentConfig)
			.use(requireAuth())
			.use(ProjectDomainModule[EffectContextOf])
			.effect(function* ({ input, context }) {
				const projects = yield* ProjectService;
				return yield* projects
					.getEnvironmentConfig(input.params.id, actorFromContext(context).userId)
					.pipe(mapProjectFailures);
			});
	}

	@Implement(projectContract.updateEnvironmentConfig)
	updateEnvironmentConfig() {
		return implement(projectContract.updateEnvironmentConfig)
			.use(requireAuth())
			.use(ProjectDomainModule[EffectContextOf])
			.effect(function* ({ input, context }) {
				const projects = yield* ProjectService;
				return yield* projects
					.updateEnvironmentConfig(
						input.params.id,
						actorFromContext(context).userId,
						input.body ?? {},
					)
					.pipe(mapProjectFailures);
			});
	}

	@Implement(projectContract.getDeploymentConfig)
	getDeploymentConfig() {
		return implement(projectContract.getDeploymentConfig)
			.use(requireAuth())
			.use(ProjectDomainModule[EffectContextOf])
			.effect(function* ({ input, context }) {
				const projects = yield* ProjectService;
				return yield* projects
					.getDeploymentConfig(input.params.id, actorFromContext(context).userId)
					.pipe(mapProjectFailures);
			});
	}

	@Implement(projectContract.updateDeploymentConfig)
	updateDeploymentConfig() {
		return implement(projectContract.updateDeploymentConfig)
			.use(requireAuth())
			.use(ProjectDomainModule[EffectContextOf])
			.effect(function* ({ input, context }) {
				const projects = yield* ProjectService;
				return yield* projects
					.updateDeploymentConfig(
						input.params.id,
						actorFromContext(context).userId,
						input.body ?? {},
					)
					.pipe(mapProjectFailures);
			});
	}

	@Implement(projectContract.getSecurityConfig)
	getSecurityConfig() {
		return implement(projectContract.getSecurityConfig)
			.use(requireAuth())
			.use(ProjectDomainModule[EffectContextOf])
			.effect(function* ({ input, context }) {
				const projects = yield* ProjectService;
				return yield* projects
					.getSecurityConfig(input.params.id, actorFromContext(context).userId)
					.pipe(mapProjectFailures);
			});
	}

	@Implement(projectContract.updateSecurityConfig)
	updateSecurityConfig() {
		return implement(projectContract.updateSecurityConfig)
			.use(requireAuth())
			.use(ProjectDomainModule[EffectContextOf])
			.effect(function* ({ input, context }) {
				const projects = yield* ProjectService;
				return yield* projects
					.updateSecurityConfig(
						input.params.id,
						actorFromContext(context).userId,
						input.body ?? {},
					)
					.pipe(mapProjectFailures);
			});
	}

	@Implement(projectContract.getResourceConfig)
	getResourceConfig() {
		return implement(projectContract.getResourceConfig)
			.use(requireAuth())
			.use(ProjectDomainModule[EffectContextOf])
			.effect(function* ({ input, context }) {
				const projects = yield* ProjectService;
				return yield* projects
					.getResourceConfig(input.params.id, actorFromContext(context).userId)
					.pipe(mapProjectFailures);
			});
	}

	@Implement(projectContract.updateResourceConfig)
	updateResourceConfig() {
		return implement(projectContract.updateResourceConfig)
			.use(requireAuth())
			.use(ProjectDomainModule[EffectContextOf])
			.effect(function* ({ input, context }) {
				const projects = yield* ProjectService;
				return yield* projects
					.updateResourceConfig(
						input.params.id,
						actorFromContext(context).userId,
						input.body ?? {},
					)
					.pipe(mapProjectFailures);
			});
	}

	@Implement(projectContract.getNotificationConfig)
	getNotificationConfig() {
		return implement(projectContract.getNotificationConfig)
			.use(requireAuth())
			.use(ProjectDomainModule[EffectContextOf])
			.effect(function* ({ input, context }) {
				const projects = yield* ProjectService;
				return yield* projects
					.getNotificationConfig(input.params.id, actorFromContext(context).userId)
					.pipe(mapProjectFailures);
			});
	}

	@Implement(projectContract.updateNotificationConfig)
	updateNotificationConfig() {
		return implement(projectContract.updateNotificationConfig)
			.use(requireAuth())
			.use(ProjectDomainModule[EffectContextOf])
			.effect(function* ({ input, context }) {
				const projects = yield* ProjectService;
				return yield* projects
					.updateNotificationConfig(
						input.params.id,
						actorFromContext(context).userId,
						input.body ?? {},
					)
					.pipe(mapProjectFailures);
			});
	}

	// ========================================
	// UTILITIES
	// ========================================

	@Implement(projectContract.getEnvironmentStatus)
	getEnvironmentStatus() {
		return implement(projectContract.getEnvironmentStatus)
			.use(requireAuth())
			.use(ProjectDomainModule[EffectContextOf])
			.effect(function* ({ input, context }) {
				const projects = yield* ProjectService;
				const store = yield* ProjectStore;

				const env = yield* projects
					.getEnvironment(
						input.params.id,
						actorFromContext(context).userId,
						input.params.environmentId,
					)
					.pipe(mapProjectFailures);
				const servicesCount = yield* store
					.countEnabledServicesForEnvironment(env.id)
					.pipe(mapProjectFailures);

				return {
					environmentId: env.id,
					status: env.status,
					servicesCount,
					healthyServicesCount: env.status === "healthy" ? servicesCount : 0,
					lastChecked: new Date().toISOString(),
				};
			});
	}

	@Implement(projectContract.getAllEnvironmentStatuses)
	getAllEnvironmentStatuses() {
		return implement(projectContract.getAllEnvironmentStatuses)
			.use(requireAuth())
			.use(ProjectDomainModule[EffectContextOf])
			.effect(function* ({ input, context }) {
				const projects = yield* ProjectService;
				const store = yield* ProjectStore;

				const envs = yield* projects
					.listEnvironments(input.params.id, actorFromContext(context).userId)
					.pipe(mapProjectFailures);

				const statuses = yield* Effect.all(
					envs.map((env) =>
						Effect.gen(function* () {
							const servicesCount = yield* store
								.countEnabledServicesForEnvironment(env.id)
								.pipe(mapProjectFailures);
							return {
								environmentId: env.id,
								environmentName: env.name,
								status: env.status,
								servicesCount,
								healthyServicesCount: env.status === "healthy" ? servicesCount : 0,
								lastChecked: new Date().toISOString(),
							};
						}),
					),
				);

				return {
					statuses,
				};
			});
	}

	@Implement(projectContract.refreshEnvironmentStatus)
	refreshEnvironmentStatus() {
		return implement(projectContract.refreshEnvironmentStatus)
			.use(requireAuth())
			.use(ProjectDomainModule[EffectContextOf])
			.effect(function* () {
				return yield* Effect.fail(
					new ORPCError("NOT_IMPLEMENTED", {
						message:
							"Environment health checks are not available yet; no refresh was performed",
					}),
				);
			});
	}

	@Implement(projectContract.streamQuery)
	streamQuery() {
		return implement(projectContract.streamQuery)
			.use(requireAuth())
			.use(ProjectDomainModule[EffectContextOf])
			.effect(function* ({ input }) {
				const projects = yield* ProjectService;
				return yield* projects.streamQueryEvents(input.query).pipe(mapProjectFailures);
			});
	}
}
