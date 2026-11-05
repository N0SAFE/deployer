import { Controller } from '@nestjs/common'
import { Implement } from '@orpc/nest'
import { ORPCError } from '@orpc/server'
import { Effect } from 'effect'

import { procedure } from '@deployer/nest-effect'
import { projectContract } from '@deployer/project-contracts'
import { requireAuth } from '@deployer/shared/core/modules/auth/orpc/middlewares'

import { actorFromContext } from '@project/core/utils/actor.utils'

import { ProjectStore } from '../repositories/project.repository'
import { ProjectNetworkService } from '../services/project-network.service'
import { ProjectService } from '../services/project.service'

/**
 * The project domain's oRPC surface.
 *
 * Every method binds a contract procedure, takes the actor from the context and
 * delegates to a service resolved from the module's Effect context. Rules live
 * in the service; the `.effect()` boundary is the request boundary that maps failures.
 */
@Controller()
export class ProjectController {
    // ========================================
    // CORE CRUD
    // ========================================

    @Implement(projectContract.list)
    list() {
        return procedure(projectContract.list)
            .use(requireAuth())
            .effect(function* ({ input }) {
                const projects = yield* ProjectService
                return yield* projects.listProjects(input.query)
            })
    }

    @Implement(projectContract.findById)
    findById() {
        return procedure(projectContract.findById)
            .use(requireAuth())
            .effect(function* ({ input }) {
                const projects = yield* ProjectService
                return yield* projects.getProjectById(input.params.id)
            })
    }

    @Implement(projectContract.create)
    create() {
        return procedure(projectContract.create)
            .use(requireAuth())
            .effect(function* ({ input, context }) {
                const projects = yield* ProjectService
                // The create contract is COMPACT input (body-only schema) — `input`
                // IS the create payload, not `input.body`.
                const project = yield* projects.createProject({
                    ...input,
                    ownerId: actorFromContext(context).userId,
                })
                return { status: 201 as const, headers: {}, body: project }
            })
    }

    @Implement(projectContract.update)
    update() {
        return procedure(projectContract.update)
            .use(requireAuth())
            .effect(function* ({ input, context }) {
                const projects = yield* ProjectService
                const { id, ...data } = input
                return yield* projects.updateProject(
                    id,
                    actorFromContext(context).userId,
                    data
                )
            })
    }

    @Implement(projectContract.delete)
    delete() {
        return procedure(projectContract.delete)
            .use(requireAuth())
            .effect(function* ({ input, context }) {
                const projects = yield* ProjectService
                yield* projects.deleteProject(
                    input.params.id,
                    actorFromContext(context).userId
                )
                return { success: true }
            })
    }

    // ========================================
    // COLLABORATORS
    // ========================================

    @Implement(projectContract.getCollaborators)
    getCollaborators() {
        return procedure(projectContract.getCollaborators)
            .use(requireAuth())
            .effect(function* ({ input, context }) {
                const projects = yield* ProjectService
                const collaborators = yield* projects.getCollaborators(
                    input.params.id,
                    actorFromContext(context).userId
                )
                return { collaborators }
            })
    }

    @Implement(projectContract.inviteCollaborator)
    inviteCollaborator() {
        return procedure(projectContract.inviteCollaborator)
            .use(requireAuth())
            .effect(function* ({ input, context }) {
                const projects = yield* ProjectService
                return yield* projects.inviteCollaborator(
                    input.params.id,
                    actorFromContext(context).userId,
                    input.body
                )
            })
    }

    @Implement(projectContract.updateCollaborator)
    updateCollaborator() {
        return procedure(projectContract.updateCollaborator)
            .use(requireAuth())
            .effect(function* ({ input, context }) {
                const projects = yield* ProjectService
                // body is optional (all fields optional) — coalesce to {}.
                return yield* projects.updateCollaborator(
                    input.params.id,
                    actorFromContext(context).userId,
                    input.params.userId,
                    input.body ?? {}
                )
            })
    }

    @Implement(projectContract.removeCollaborator)
    removeCollaborator() {
        return procedure(projectContract.removeCollaborator)
            .use(requireAuth())
            .effect(function* ({ input, context }) {
                const projects = yield* ProjectService
                yield* projects.removeCollaborator(
                    input.params.id,
                    actorFromContext(context).userId,
                    input.params.userId
                )
                return {
                    success: true,
                    message: 'Collaborator removed successfully',
                }
            })
    }

    // ========================================
    // ENVIRONMENTS
    // ========================================

    @Implement(projectContract.listEnvironments)
    listEnvironments() {
        return procedure(projectContract.listEnvironments)
            .use(requireAuth())
            .effect(function* ({ input, context }) {
                const projects = yield* ProjectService
                const envs = yield* projects.listEnvironments(
                    input.params.id,
                    actorFromContext(context).userId,
                    input.query?.kind
                )
                return { environments: envs }
            })
    }

    @Implement(projectContract.getEnvironment)
    getEnvironment() {
        return procedure(projectContract.getEnvironment)
            .use(requireAuth())
            .effect(function* ({ input, context }) {
                const projects = yield* ProjectService
                return yield* projects.getEnvironment(
                    input.params.id,
                    actorFromContext(context).userId,
                    input.params.environmentId
                )
            })
    }

    @Implement(projectContract.createEnvironment)
    createEnvironment() {
        return procedure(projectContract.createEnvironment)
            .use(requireAuth())
            .effect(function* ({ input, context }) {
                const projects = yield* ProjectService
                return yield* projects.createEnvironment(
                    input.params.id,
                    actorFromContext(context).userId,
                    input.body
                )
            })
    }

    @Implement(projectContract.updateEnvironment)
    updateEnvironment() {
        return procedure(projectContract.updateEnvironment)
            .use(requireAuth())
            .effect(function* ({ input, context }) {
                const projects = yield* ProjectService
                return yield* projects.updateEnvironment(
                    input.params.id,
                    actorFromContext(context).userId,
                    input.params.environmentId,
                    input.body ?? {}
                )
            })
    }

    @Implement(projectContract.deleteEnvironment)
    deleteEnvironment() {
        return procedure(projectContract.deleteEnvironment)
            .use(requireAuth())
            .effect(function* ({ input, context }) {
                const projects = yield* ProjectService
                yield* projects.deleteEnvironment(
                    input.params.id,
                    actorFromContext(context).userId,
                    input.params.environmentId
                )
                return {
                    success: true,
                    message: 'Environment deleted successfully',
                }
            })
    }

    @Implement(projectContract.cloneEnvironment)
    cloneEnvironment() {
        return procedure(projectContract.cloneEnvironment)
            .use(requireAuth())
            .effect(function* ({ input, context }) {
                const projects = yield* ProjectService
                return yield* projects.cloneEnvironment(
                    input.params.id,
                    actorFromContext(context).userId,
                    input.params.environmentId,
                    input.body
                )
            })
    }

    // ========================================
    // SERVICE × ENVIRONMENT LINKS
    // ========================================

    @Implement(projectContract.listServiceEnvironmentLinks)
    listServiceEnvironmentLinks() {
        return procedure(projectContract.listServiceEnvironmentLinks)
            .use(requireAuth())
            .effect(function* ({ input, context }) {
                const projects = yield* ProjectService
                const links = yield* projects.listServiceEnvironmentLinks(
                    input.params.id,
                    actorFromContext(context).userId
                )
                return { links }
            })
    }

    @Implement(projectContract.upsertServiceEnvironmentLink)
    upsertServiceEnvironmentLink() {
        return procedure(projectContract.upsertServiceEnvironmentLink)
            .use(requireAuth())
            .effect(function* ({ input, context }) {
                const projects = yield* ProjectService
                return yield* projects.upsertServiceEnvironmentLink(
                    input.params.id,
                    actorFromContext(context).userId,
                    input.body
                )
            })
    }

    // ========================================
    // NETWORK CONFIGURATION (DNS provider + zone + records)
    // ========================================

    @Implement(projectContract.getNetwork)
    getNetwork() {
        return procedure(projectContract.getNetwork)
            .use(requireAuth())
            .effect(function* ({ input }) {
                const network = yield* ProjectNetworkService
                return yield* network.getNetwork(input.params.id)
            })
    }

    @Implement(projectContract.updateNetwork)
    updateNetwork() {
        return procedure(projectContract.updateNetwork)
            .use(requireAuth())
            .effect(function* ({ input }) {
                const network = yield* ProjectNetworkService
                return yield* network.updateNetwork(
                    input.params.id,
                    input.body ?? {}
                )
            })
    }

    // ========================================
    // VARIABLE TEMPLATES
    // ========================================

    @Implement(projectContract.listVariableTemplates)
    listVariableTemplates() {
        return procedure(projectContract.listVariableTemplates)
            .use(requireAuth())
            .effect(function* ({ input, context }) {
                const projects = yield* ProjectService
                const templates = yield* projects.listVariableTemplates(
                    input.params.id,
                    actorFromContext(context).userId
                )
                return { templates }
            })
    }

    @Implement(projectContract.getVariableTemplate)
    getVariableTemplate() {
        return procedure(projectContract.getVariableTemplate)
            .use(requireAuth())
            .effect(function* ({ input, context }) {
                const projects = yield* ProjectService
                return yield* projects.getVariableTemplate(
                    input.params.id,
                    actorFromContext(context).userId,
                    input.params.templateId
                )
            })
    }

    @Implement(projectContract.createVariableTemplate)
    createVariableTemplate() {
        return procedure(projectContract.createVariableTemplate)
            .use(requireAuth())
            .effect(function* ({ input, context }) {
                const projects = yield* ProjectService
                return yield* projects.createVariableTemplate(
                    input.params.id,
                    actorFromContext(context).userId,
                    input.body
                )
            })
    }

    @Implement(projectContract.updateVariableTemplate)
    updateVariableTemplate() {
        return procedure(projectContract.updateVariableTemplate)
            .use(requireAuth())
            .effect(function* ({ input, context }) {
                const projects = yield* ProjectService
                return yield* projects.updateVariableTemplate(
                    input.params.id,
                    actorFromContext(context).userId,
                    input.params.templateId,
                    input.body ?? {}
                )
            })
    }

    @Implement(projectContract.deleteVariableTemplate)
    deleteVariableTemplate() {
        return procedure(projectContract.deleteVariableTemplate)
            .use(requireAuth())
            .effect(function* ({ input, context }) {
                const projects = yield* ProjectService
                yield* projects.deleteVariableTemplate(
                    input.params.id,
                    actorFromContext(context).userId,
                    input.params.templateId
                )
                return {
                    success: true,
                    message: 'Template deleted successfully',
                }
            })
    }

    // ========================================
    // CONFIGURATION
    // ========================================

    @Implement(projectContract.getGeneralConfig)
    getGeneralConfig() {
        return procedure(projectContract.getGeneralConfig)
            .use(requireAuth())
            .effect(function* ({ input, context }) {
                const projects = yield* ProjectService
                return yield* projects.getGeneralConfig(
                    input.params.id,
                    actorFromContext(context).userId
                )
            })
    }

    @Implement(projectContract.updateGeneralConfig)
    updateGeneralConfig() {
        return procedure(projectContract.updateGeneralConfig)
            .use(requireAuth())
            .effect(function* ({ input, context }) {
                const projects = yield* ProjectService
                return yield* projects.updateGeneralConfig(
                    input.params.id,
                    actorFromContext(context).userId,
                    input.body ?? {}
                )
            })
    }

    @Implement(projectContract.getEnvironmentConfig)
    getEnvironmentConfig() {
        return procedure(projectContract.getEnvironmentConfig)
            .use(requireAuth())
            .effect(function* ({ input, context }) {
                const projects = yield* ProjectService
                return yield* projects.getEnvironmentConfig(
                    input.params.id,
                    actorFromContext(context).userId
                )
            })
    }

    @Implement(projectContract.updateEnvironmentConfig)
    updateEnvironmentConfig() {
        return procedure(projectContract.updateEnvironmentConfig)
            .use(requireAuth())
            .effect(function* ({ input, context }) {
                const projects = yield* ProjectService
                return yield* projects.updateEnvironmentConfig(
                    input.params.id,
                    actorFromContext(context).userId,
                    input.body ?? {}
                )
            })
    }

    @Implement(projectContract.getDeploymentConfig)
    getDeploymentConfig() {
        return procedure(projectContract.getDeploymentConfig)
            .use(requireAuth())
            .effect(function* ({ input, context }) {
                const projects = yield* ProjectService
                return yield* projects.getDeploymentConfig(
                    input.params.id,
                    actorFromContext(context).userId
                )
            })
    }

    @Implement(projectContract.updateDeploymentConfig)
    updateDeploymentConfig() {
        return procedure(projectContract.updateDeploymentConfig)
            .use(requireAuth())
            .effect(function* ({ input, context }) {
                const projects = yield* ProjectService
                return yield* projects.updateDeploymentConfig(
                    input.params.id,
                    actorFromContext(context).userId,
                    input.body ?? {}
                )
            })
    }

    @Implement(projectContract.getSecurityConfig)
    getSecurityConfig() {
        return procedure(projectContract.getSecurityConfig)
            .use(requireAuth())
            .effect(function* ({ input, context }) {
                const projects = yield* ProjectService
                return yield* projects.getSecurityConfig(
                    input.params.id,
                    actorFromContext(context).userId
                )
            })
    }

    @Implement(projectContract.updateSecurityConfig)
    updateSecurityConfig() {
        return procedure(projectContract.updateSecurityConfig)
            .use(requireAuth())
            .effect(function* ({ input, context }) {
                const projects = yield* ProjectService
                return yield* projects.updateSecurityConfig(
                    input.params.id,
                    actorFromContext(context).userId,
                    input.body ?? {}
                )
            })
    }

    @Implement(projectContract.getResourceConfig)
    getResourceConfig() {
        return procedure(projectContract.getResourceConfig)
            .use(requireAuth())
            .effect(function* ({ input, context }) {
                const projects = yield* ProjectService
                return yield* projects.getResourceConfig(
                    input.params.id,
                    actorFromContext(context).userId
                )
            })
    }

    @Implement(projectContract.updateResourceConfig)
    updateResourceConfig() {
        return procedure(projectContract.updateResourceConfig)
            .use(requireAuth())
            .effect(function* ({ input, context }) {
                const projects = yield* ProjectService
                return yield* projects.updateResourceConfig(
                    input.params.id,
                    actorFromContext(context).userId,
                    input.body ?? {}
                )
            })
    }

    @Implement(projectContract.getNotificationConfig)
    getNotificationConfig() {
        return procedure(projectContract.getNotificationConfig)
            .use(requireAuth())
            .effect(function* ({ input, context }) {
                const projects = yield* ProjectService
                return yield* projects.getNotificationConfig(
                    input.params.id,
                    actorFromContext(context).userId
                )
            })
    }

    @Implement(projectContract.updateNotificationConfig)
    updateNotificationConfig() {
        return procedure(projectContract.updateNotificationConfig)
            .use(requireAuth())
            .effect(function* ({ input, context }) {
                const projects = yield* ProjectService
                return yield* projects.updateNotificationConfig(
                    input.params.id,
                    actorFromContext(context).userId,
                    input.body ?? {}
                )
            })
    }

    // ========================================
    // UTILITIES
    // ========================================

    @Implement(projectContract.getEnvironmentStatus)
    getEnvironmentStatus() {
        return procedure(projectContract.getEnvironmentStatus)
            .use(requireAuth())
            .effect(function* ({ input, context }) {
                const projects = yield* ProjectService
                const store = yield* ProjectStore

                const env = yield* projects.getEnvironment(
                    input.params.id,
                    actorFromContext(context).userId,
                    input.params.environmentId
                )
                const servicesCount =
                    yield* store.countEnabledServicesForEnvironment(env.id)

                return {
                    environmentId: env.id,
                    status: env.status,
                    servicesCount,
                    healthyServicesCount:
                        env.status === 'healthy' ? servicesCount : 0,
                    lastChecked: new Date().toISOString(),
                }
            })
    }

    @Implement(projectContract.getAllEnvironmentStatuses)
    getAllEnvironmentStatuses() {
        return procedure(projectContract.getAllEnvironmentStatuses)
            .use(requireAuth())
            .effect(function* ({ input, context }) {
                const projects = yield* ProjectService
                const store = yield* ProjectStore

                const envs = yield* projects.listEnvironments(
                    input.params.id,
                    actorFromContext(context).userId
                )

                const statuses = yield* Effect.all(
                    envs.map((env) =>
                        Effect.gen(function* () {
                            const servicesCount =
                                yield* store.countEnabledServicesForEnvironment(
                                    env.id
                                )
                            return {
                                environmentId: env.id,
                                environmentName: env.name,
                                status: env.status,
                                servicesCount,
                                healthyServicesCount:
                                    env.status === 'healthy'
                                        ? servicesCount
                                        : 0,
                                lastChecked: new Date().toISOString(),
                            }
                        })
                    )
                )

                return {
                    statuses,
                }
            })
    }

    @Implement(projectContract.refreshEnvironmentStatus)
    refreshEnvironmentStatus() {
        return procedure(projectContract.refreshEnvironmentStatus)
            .use(requireAuth())
            .effect(function* () {
                return yield* Effect.fail(
                    new ORPCError('NOT_IMPLEMENTED', {
                        message:
                            'Environment health checks are not available yet; no refresh was performed',
                    })
                )
            })
    }

    @Implement(projectContract.streamQuery)
    streamQuery() {
        return procedure(projectContract.streamQuery)
            .use(requireAuth())
            .effect(function* ({ input }) {
                const projects = yield* ProjectService
                return yield* projects.streamQueryEvents(input.query)
            })
    }
}
