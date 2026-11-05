import { Context, Effect } from 'effect'

import { environmentTriggerSchema } from '@deployer/contracts-common'
import { environmentRulesSchema } from '@deployer/contracts-entities'
import type { ProjectListInput } from '@deployer/project-contracts/modules/project/list'
import type {
    ProjectStreamEvent,
    ProjectStreamQueryInput,
} from '@deployer/project-contracts/modules/project/stream'
import { ApprovalGuard } from '@deployer/shared/core/modules/approval/approval.guard'
import { isRecord } from '@deployer/type-guards'

import type { DatabasePort } from '@project/core/database/database.port'
import type { CoreEventSync } from '@project/core/ports/core-event-sync.port'
import { RuntimeConfigurationAccessor } from '@project/core/ports/runtime-configuration-accessor.port'
import { ProjectEventService } from '@project/modules/project/services/project-event.service'

import { projectRules } from '../domain/project.entity'
import {
    ResourceNotFound,
    ProjectConflict,
    ProjectInvalid,
} from '../domain/project.errors'
import { configurationRule, rule } from '../project-effects'
import { ProjectStore } from '../repositories/project.repository'

import {
    assertProjectAccess,
    assertProjectAccessWithRole,
} from './project-access'
import { streamProjectEvents } from './project-stream'

import type {
    EnvironmentCreateInput,
    TemplateCreateInput,
    TemplateUpdateInput,
} from '../repositories/project.repository.types'
import type { Observable } from 'rxjs'

// ---------------------------------------------------------------------------
// Typed settings stored in project.settings JSONB
// ---------------------------------------------------------------------------
// The FLAT storage shape — sourced from the contract package (single source of
// truth) so the DB/API shape and the contract output schema can never drift.

type ProjectSettings = import('@deployer/contracts-entities').ProjectSettings

/** Collaborator permissions — SSOT is the `collaboratorSchema` (contracts-entities). */
type CollaboratorPermissions = import('zod/v4').infer<
    typeof import('@deployer/contracts-entities').collaboratorSchema
>['permissions']

/** The project use cases, composed as Effects over the store. */
export class ProjectServiceImpl {
    // ========================================
    // PROJECT CRUD
    // ========================================

    listProjects(query: ProjectListInput = {} as ProjectListInput) {
        return Effect.gen(function* () {
            const projects = yield* ProjectStore
            return yield* projects.findMany(query)
        })
    }

    getProjectById(id: string) {
        return Effect.gen(function* () {
            const projects = yield* ProjectStore
            const project = yield* projects.findById(id)
            if (!project) {
                return yield* Effect.fail(
                    new ResourceNotFound({ entity: 'Project', id: id })
                )
            }

            const stats = yield* projects.getProjectStats(id)
            return { ...project, ...stats }
        })
    }

    createProject(data: {
        name: string
        description?: string | null
        baseDomain?: string | null
        settings?: Record<string, unknown> | null
        ownerId: string
    }) {
        return Effect.gen(function* () {
            const projects = yield* ProjectStore
            const events = yield* ProjectEventService

            const created = yield* projects.create({
                name: data.name,
                description: data.description ?? null,
                baseDomain: data.baseDomain ?? null,
                ownerId: data.ownerId,
                settings: data.settings,
            })

            yield* events.emitEffect(
                'projectCreated',
                { ownerId: data.ownerId },
                {
                    projectId: created.id,
                    ownerId: created.ownerId,
                    name: created.name,
                    timestamp: new Date().toISOString(),
                }
            )

            return created
        })
    }

    updateProject(
        id: string,
        requesterId: string,
        data: {
            name?: string
            description?: string | null
            baseDomain?: string | null
            settings?: Record<string, unknown> | null
        }
    ) {
        return Effect.gen(function* () {
            yield* assertProjectAccess(id, requesterId, 'admin')

            const projects = yield* ProjectStore
            const events = yield* ProjectEventService

            const updated = yield* projects.update(id, {
                name: data.name,
                description: data.description,
                baseDomain: data.baseDomain,
                settings: data.settings,
            })
            if (!updated) {
                return yield* Effect.fail(
                    new ResourceNotFound({ entity: 'Project', id: id })
                )
            }

            const changedFields = Object.keys(data).filter((key) => {
                const value = (data as Record<string, unknown>)[key]
                return value !== undefined && value !== null
            })
            yield* events.emitEffect(
                'projectUpdated',
                { projectId: id },
                {
                    projectId: id,
                    ownerId: updated.ownerId,
                    changedFields,
                    timestamp: new Date().toISOString(),
                }
            )

            return updated
        })
    }

    deleteProject(id: string, requesterId: string) {
        return Effect.gen(function* () {
            const projects = yield* ProjectStore
            const events = yield* ProjectEventService

            const project = yield* projects.findById(id)
            if (!project) {
                return yield* Effect.fail(
                    new ResourceNotFound({ entity: 'Project', id: id })
                )
            }
            // Ownership is not an access level: `maintainer` is defined as management
            // WITHOUT deletion, so this cannot be folded into `assertProjectAccess`.
            yield* rule(() => {
                projectRules.assertCanDelete(project, requesterId)
            })

            // Deleting a project is destructive and irreversible: whoever lacks `project:delete` needs a second person's
            // approval for THIS id, consumed atomically before the delete (`SEC-072`).
            const guard = yield* ApprovalGuard
            yield* guard.require(
                requesterId,
                'project:delete',
                'project.delete',
                [id]
            )

            yield* projects.delete(id)

            yield* events.emitEffect(
                'projectDeleted',
                { projectId: id },
                {
                    projectId: id,
                    ownerId: project.ownerId,
                    timestamp: new Date().toISOString(),
                }
            )
        })
    }

    // ========================================
    // COLLABORATORS
    // ========================================

    getCollaborators(projectId: string, requesterId: string) {
        return Effect.gen(function* () {
            yield* assertProjectAccess(projectId, requesterId, 'read')
            const projects = yield* ProjectStore
            return yield* projects.findCollaboratorsByProject(projectId)
        })
    }

    inviteCollaborator(
        projectId: string,
        requesterId: string,
        data: {
            email: string
            role: string
            permissions?: CollaboratorPermissions | null
        }
    ) {
        return Effect.gen(function* () {
            const { role: actorRole } = yield* assertProjectAccessWithRole(
                projectId,
                requesterId,
                'admin'
            )

            // Guard BEFORE the store call: an unknown role or one at/above the
            // granter's own must never reach the database.
            const role = yield* rule(() =>
                projectRules.assertCanGrant(actorRole, data.role)
            )

            const projects = yield* ProjectStore
            const events = yield* ProjectEventService

            const targetUser = yield* projects.findUserByEmail(data.email)
            if (!targetUser) {
                return yield* Effect.fail(
                    new ResourceNotFound({ entity: 'User', id: data.email })
                )
            }

            const existing = yield* projects.findCollaboratorByUserAndProject(
                targetUser.id,
                projectId
            )
            if (existing) {
                return yield* Effect.fail(
                    new ProjectConflict({
                        reason: 'User is already a collaborator on this project',
                    })
                )
            }

            const collaborator = yield* projects.createCollaborator({
                projectId,
                userId: targetUser.id,
                role,
                permissions: data.permissions,
                invitedBy: requesterId,
            })

            yield* events.emitEffect(
                'projectCollaboratorInvited',
                { projectId },
                {
                    projectId,
                    userId: targetUser.id,
                    role,
                    timestamp: new Date().toISOString(),
                }
            )

            return {
                inviteId: collaborator.id,
                message: `${targetUser.email} has been invited as ${role}`,
            }
        })
    }

    updateCollaborator(
        projectId: string,
        requesterId: string,
        targetUserId: string,
        data: { role?: string; permissions?: CollaboratorPermissions | null }
    ) {
        return Effect.gen(function* () {
            const { role: actorRole } = yield* assertProjectAccessWithRole(
                projectId,
                requesterId,
                'admin'
            )

            const projects = yield* ProjectStore
            const collaborator =
                yield* projects.findCollaboratorByUserAndProject(
                    targetUserId,
                    projectId
                )
            if (!collaborator) {
                return yield* Effect.fail(
                    new ResourceNotFound({
                        entity: 'Collaborator',
                        id: targetUserId,
                    })
                )
            }

            yield* rule(() => {
                projectRules.assertNotOwnerMembership(collaborator, 'modify')
            })

            // A role patch is a grant, so it obeys the same guards as an invite.
            const requestedRole = data.role
            const role =
                requestedRole === undefined
                    ? undefined
                    : yield* rule(() =>
                          projectRules.assertCanGrant(actorRole, requestedRole)
                      )

            const updated = yield* projects.updateCollaborator(
                collaborator.id,
                {
                    role,
                    permissions: data.permissions,
                }
            )
            if (!updated) {
                return yield* Effect.fail(
                    new ResourceNotFound({
                        entity: 'Collaborator',
                        id: targetUserId,
                    })
                )
            }
            return updated
        })
    }

    removeCollaborator(
        projectId: string,
        requesterId: string,
        targetUserId: string
    ) {
        return Effect.gen(function* () {
            yield* assertProjectAccess(projectId, requesterId, 'admin')

            const projects = yield* ProjectStore
            const events = yield* ProjectEventService

            const collaborator =
                yield* projects.findCollaboratorByUserAndProject(
                    targetUserId,
                    projectId
                )
            if (!collaborator) {
                return yield* Effect.fail(
                    new ResourceNotFound({
                        entity: 'Collaborator',
                        id: targetUserId,
                    })
                )
            }
            yield* rule(() => {
                projectRules.assertNotOwnerMembership(collaborator, 'remove')
            })

            yield* projects.deleteCollaboratorByUserAndProject(
                targetUserId,
                projectId
            )

            yield* events.emitEffect(
                'projectCollaboratorRemoved',
                { projectId },
                {
                    projectId,
                    userId: targetUserId,
                    timestamp: new Date().toISOString(),
                }
            )
        })
    }

    // ========================================
    // ENVIRONMENTS
    // ========================================

    listEnvironments(projectId: string, requesterId: string, kind?: string) {
        return Effect.gen(function* () {
            yield* assertProjectAccess(projectId, requesterId, 'read')
            const projects = yield* ProjectStore
            return yield* projects.findEnvironmentsByProject(projectId, kind)
        })
    }

    getEnvironment(
        projectId: string,
        requesterId: string,
        environmentId: string
    ) {
        return Effect.gen(function* () {
            yield* assertProjectAccess(projectId, requesterId, 'read')
            const projects = yield* ProjectStore
            const env = yield* projects.findEnvironmentById(environmentId)
            if (env?.projectId !== projectId) {
                return yield* Effect.fail(
                    new ResourceNotFound({
                        entity: 'Environment',
                        id: environmentId,
                    })
                )
            }
            return env
        })
    }

    createEnvironment(
        projectId: string,
        requesterId: string,
        data: {
            name: string
            kind: 'stable' | 'preview' | 'ephemeral'
            description?: string | null
            rules?: Record<string, unknown>
            trigger?: Record<string, unknown> | null
            domainConfig?: unknown
            deploymentConfig?: unknown
            metadata?: unknown
        }
    ) {
        return Effect.gen(function* () {
            yield* assertProjectAccess(projectId, requesterId, 'admin')

            const projects = yield* ProjectStore
            const events = yield* ProjectEventService

            const created = yield* projects.createEnvironment({
                projectId,
                name: data.name,
                kind: data.kind,
                // Parse loose input rules through the SSOT schema so the DB always
                // stores the full canonical EnvironmentRules (defaults filled).
                rules: data.rules
                    ? yield* rule(() =>
                          environmentRulesSchema.parse(data.rules)
                      )
                    : null,
                // Parse trigger the same way (source required by the schema).
                trigger: data.trigger
                    ? yield* rule(() =>
                          environmentTriggerSchema.parse(data.trigger)
                      )
                    : null,
                description: data.description ?? null,
                domainConfig:
                    data.domainConfig as EnvironmentCreateInput['domainConfig'],
                deploymentConfig:
                    data.deploymentConfig as EnvironmentCreateInput['deploymentConfig'],
                metadata: data.metadata as EnvironmentCreateInput['metadata'],
                createdBy: requesterId,
            })

            yield* events.emitEffect(
                'projectEnvironmentCreated',
                { projectId },
                {
                    projectId,
                    environmentId: created.id,
                    environmentName: created.name,
                    timestamp: new Date().toISOString(),
                }
            )

            return created
        })
    }

    updateEnvironment(
        projectId: string,
        requesterId: string,
        environmentId: string,
        data: Record<string, unknown>
    ) {
        return Effect.gen(function* () {
            yield* assertProjectAccess(projectId, requesterId, 'admin')

            const projects = yield* ProjectStore
            const env = yield* projects.findEnvironmentById(environmentId)
            if (env?.projectId !== projectId) {
                return yield* Effect.fail(
                    new ResourceNotFound({
                        entity: 'Environment',
                        id: environmentId,
                    })
                )
            }
            const updated = yield* projects.updateEnvironment(
                environmentId,
                data
            )
            if (!updated) {
                return yield* Effect.fail(
                    new ResourceNotFound({
                        entity: 'Environment',
                        id: environmentId,
                    })
                )
            }
            return updated
        })
    }

    deleteEnvironment(
        projectId: string,
        requesterId: string,
        environmentId: string
    ) {
        return Effect.gen(function* () {
            yield* assertProjectAccess(projectId, requesterId, 'admin')

            const projects = yield* ProjectStore
            const events = yield* ProjectEventService

            const env = yield* projects.findEnvironmentById(environmentId)
            if (env?.projectId !== projectId) {
                return yield* Effect.fail(
                    new ResourceNotFound({
                        entity: 'Environment',
                        id: environmentId,
                    })
                )
            }
            yield* projects.deleteEnvironment(environmentId)

            yield* events.emitEffect(
                'projectEnvironmentDeleted',
                { projectId },
                {
                    projectId,
                    environmentId,
                    timestamp: new Date().toISOString(),
                }
            )
        })
    }

    cloneEnvironment(
        projectId: string,
        requesterId: string,
        sourceEnvironmentId: string,
        data: { name: string; kind?: 'stable' | 'preview' | 'ephemeral' }
    ) {
        return Effect.gen(function* () {
            yield* assertProjectAccess(projectId, requesterId, 'admin')

            const projects = yield* ProjectStore
            const source =
                yield* projects.findEnvironmentById(sourceEnvironmentId)
            if (source?.projectId !== projectId) {
                return yield* Effect.fail(
                    new ResourceNotFound({
                        entity: 'Environment',
                        id: sourceEnvironmentId,
                    })
                )
            }

            return yield* projects.createEnvironment({
                projectId,
                name: data.name,
                kind: data.kind ?? source.kind,
                type: source.type,
                rules: source.rules,
                trigger: source.trigger,
                description: source.description,
                domainConfig: source.domainConfig,
                deploymentConfig: source.deploymentConfig,
                metadata: null, // do not copy runtime metadata
                createdBy: requesterId,
            })
        })
    }

    // ========================================
    // SERVICE × ENVIRONMENT LINKS
    // ========================================

    listServiceEnvironmentLinks(projectId: string, requesterId: string) {
        return Effect.gen(function* () {
            yield* assertProjectAccess(projectId, requesterId, 'read')
            const projects = yield* ProjectStore
            return yield* projects.findServiceEnvironmentLinksByProject(
                projectId
            )
        })
    }

    upsertServiceEnvironmentLink(
        projectId: string,
        requesterId: string,
        data: {
            serviceId: string
            environmentId: string
            isEnabled: boolean
            overrides?: Record<string, unknown> | null
        }
    ) {
        return Effect.gen(function* () {
            yield* assertProjectAccess(projectId, requesterId, 'admin')

            const projects = yield* ProjectStore
            const serviceProject = yield* projects.findServiceProjectId(
                data.serviceId
            )
            if (serviceProject !== projectId) {
                return yield* Effect.fail(
                    new ResourceNotFound({
                        entity: 'Service',
                        id: `${data.serviceId} in project`,
                    })
                )
            }
            const env = yield* projects.findEnvironmentById(data.environmentId)
            if (env?.projectId !== projectId) {
                return yield* Effect.fail(
                    new ResourceNotFound({
                        entity: 'Environment',
                        id: `${data.environmentId} in project`,
                    })
                )
            }
            return yield* projects.upsertServiceEnvironmentLink(data)
        })
    }

    // ========================================
    // VARIABLE TEMPLATES
    // ========================================

    listVariableTemplates(projectId: string, requesterId: string) {
        return Effect.gen(function* () {
            yield* assertProjectAccess(projectId, requesterId, 'read')
            const projects = yield* ProjectStore
            return yield* projects.findTemplatesByProject(projectId)
        })
    }

    getVariableTemplate(
        projectId: string,
        requesterId: string,
        templateId: string
    ) {
        return Effect.gen(function* () {
            yield* assertProjectAccess(projectId, requesterId, 'read')
            const projects = yield* ProjectStore
            const template = yield* projects.findTemplateById(templateId)
            if (!template) {
                return yield* Effect.fail(
                    new ResourceNotFound({ entity: 'Template', id: templateId })
                )
            }
            return template
        })
    }

    createVariableTemplate(
        projectId: string,
        requesterId: string,
        data: {
            name: string
            description?: string | null
            variables?: unknown[]
        }
    ) {
        return Effect.gen(function* () {
            yield* assertProjectAccess(projectId, requesterId, 'admin')
            const projects = yield* ProjectStore
            return yield* projects.createTemplate({
                name: data.name,
                description: data.description ?? null,
                variables: data.variables as TemplateCreateInput['variables'],
                createdBy: requesterId,
            })
        })
    }

    updateVariableTemplate(
        projectId: string,
        requesterId: string,
        templateId: string,
        data: {
            name?: string
            description?: string | null
            variables?: unknown[]
        }
    ) {
        return Effect.gen(function* () {
            yield* assertProjectAccess(projectId, requesterId, 'admin')
            const projects = yield* ProjectStore

            const template = yield* projects.findTemplateById(templateId)
            if (!template) {
                return yield* Effect.fail(
                    new ResourceNotFound({ entity: 'Template', id: templateId })
                )
            }

            const updated = yield* projects.updateTemplate(templateId, {
                name: data.name,
                description: data.description,
                variables: data.variables as TemplateUpdateInput['variables'],
            })
            if (!updated) {
                return yield* Effect.fail(
                    new ResourceNotFound({ entity: 'Template', id: templateId })
                )
            }
            return updated
        })
    }

    deleteVariableTemplate(
        projectId: string,
        requesterId: string,
        templateId: string
    ) {
        return Effect.gen(function* () {
            yield* assertProjectAccess(projectId, requesterId, 'admin')
            const projects = yield* ProjectStore

            const template = yield* projects.findTemplateById(templateId)
            if (!template) {
                return yield* Effect.fail(
                    new ResourceNotFound({ entity: 'Template', id: templateId })
                )
            }
            if (template.isSystem) {
                return yield* Effect.fail(
                    new ProjectInvalid({
                        reason: 'Cannot delete a system template',
                    })
                )
            }
            yield* projects.deleteTemplate(templateId)
        })
    }

    // ========================================
    // CONFIGURATION (stored in project.settings)
    // ========================================

    getGeneralConfig(projectId: string, requesterId: string) {
        return Effect.gen(function* () {
            const project = yield* assertProjectAccess(
                projectId,
                requesterId,
                'read'
            )
            const s = (project.settings ?? {}) as ProjectSettings
            return {
                name: project.name,
                description: project.description ?? undefined,
                baseDomain: project.baseDomain ?? undefined,
                defaultBranch: s.defaultBranch ?? 'main',
                autoDeployEnabled: s.autoDeployEnabled ?? true,
                enablePreviewEnvironments: s.enablePreviewEnvironments ?? true,
            }
        })
    }

    updateGeneralConfig(
        projectId: string,
        requesterId: string,
        patch: {
            name?: string
            description?: string | null
            baseDomain?: string | null
            defaultBranch?: string
            autoDeployEnabled?: boolean
            enablePreviewEnvironments?: boolean
        }
    ) {
        return Effect.gen(function* () {
            const project = yield* assertProjectAccess(
                projectId,
                requesterId,
                'admin'
            )
            const projects = yield* ProjectStore

            const currentSettings = (project.settings ?? {}) as ProjectSettings
            const settingsPatch: ProjectSettings = {}
            if (patch.defaultBranch !== undefined)
                settingsPatch.defaultBranch = patch.defaultBranch
            if (patch.autoDeployEnabled !== undefined)
                settingsPatch.autoDeployEnabled = patch.autoDeployEnabled
            if (patch.enablePreviewEnvironments !== undefined)
                settingsPatch.enablePreviewEnvironments =
                    patch.enablePreviewEnvironments

            const updateData: Parameters<typeof projects.update>[1] = {
                settings: { ...currentSettings, ...settingsPatch },
            }
            if (patch.name !== undefined) updateData.name = patch.name
            if (patch.description !== undefined)
                updateData.description = patch.description
            if (patch.baseDomain !== undefined)
                updateData.baseDomain = patch.baseDomain

            const updated = yield* projects.update(projectId, updateData)
            if (!updated) {
                return yield* Effect.fail(
                    new ResourceNotFound({ entity: 'Project', id: projectId })
                )
            }
            const s = (updated.settings ?? {}) as ProjectSettings
            return {
                name: updated.name,
                description: updated.description ?? undefined,
                baseDomain: updated.baseDomain ?? undefined,
                defaultBranch: s.defaultBranch ?? 'main',
                autoDeployEnabled: s.autoDeployEnabled ?? true,
                enablePreviewEnvironments: s.enablePreviewEnvironments ?? true,
            }
        })
    }

    getEnvironmentConfig(projectId: string, requesterId: string) {
        return Effect.gen(function* () {
            const project = yield* assertProjectAccess(
                projectId,
                requesterId,
                'read'
            )
            const s = (project.settings ?? {}) as ProjectSettings
            return {
                defaultEnvironmentVariables: s.defaultEnvironmentVariables,
                productionEnvironmentVariables:
                    s.productionEnvironmentVariables,
                stagingEnvironmentVariables: s.stagingEnvironmentVariables,
                developmentEnvironmentVariables:
                    s.developmentEnvironmentVariables,
            }
        })
    }

    updateEnvironmentConfig(
        projectId: string,
        requesterId: string,
        patch: {
            defaultEnvironmentVariables?: Record<string, string>
            productionEnvironmentVariables?: Record<string, string>
            stagingEnvironmentVariables?: Record<string, string>
            developmentEnvironmentVariables?: Record<string, string>
        }
    ) {
        return Effect.gen(function* () {
            const project = yield* assertProjectAccess(
                projectId,
                requesterId,
                'admin'
            )
            const projects = yield* ProjectStore

            const current = (project.settings ?? {}) as ProjectSettings
            const merged = { ...current, ...patch }
            const updated = yield* projects.update(projectId, {
                settings: merged,
            })
            if (!updated) {
                return yield* Effect.fail(
                    new ResourceNotFound({ entity: 'Project', id: projectId })
                )
            }
            const s = (updated.settings ?? {}) as ProjectSettings
            return {
                defaultEnvironmentVariables: s.defaultEnvironmentVariables,
                productionEnvironmentVariables:
                    s.productionEnvironmentVariables,
                stagingEnvironmentVariables: s.stagingEnvironmentVariables,
                developmentEnvironmentVariables:
                    s.developmentEnvironmentVariables,
            }
        })
    }

    getDeploymentConfig(projectId: string, requesterId: string) {
        return Effect.gen(function* () {
            const project = yield* assertProjectAccess(
                projectId,
                requesterId,
                'read'
            )
            const configuration = yield* RuntimeConfigurationAccessor
            const s = (project.settings ?? {}) as ProjectSettings

            const projectConfig = configuration.projectConfigFromSettings(
                project.settings ?? null
            )
            const resolved = yield* configurationRule(
                configuration.resolveStrict({
                    scope: 'project',
                    context: {
                        projectId,
                    },
                    project: projectConfig,
                })
            )

            return {
                autoCleanupDays: s.autoCleanupDays ?? 30,
                maxPreviewEnvironments: s.maxPreviewEnvironments ?? 10,
                deploymentStrategy: resolved.effective.deployment.strategy,
                healthCheckTimeout: s.healthCheckTimeout ?? 60,
                deploymentTimeout: s.deploymentTimeout ?? 600,
                enableRollback: s.enableRollback ?? true,
                requireApprovalForProduction:
                    resolved.effective.deployment.requireApprovalForProduction,
            }
        })
    }

    updateDeploymentConfig(
        projectId: string,
        requesterId: string,
        patch: Partial<
            Pick<
                ProjectSettings,
                | 'autoCleanupDays'
                | 'maxPreviewEnvironments'
                | 'deploymentStrategy'
                | 'healthCheckTimeout'
                | 'deploymentTimeout'
                | 'enableRollback'
                | 'requireApprovalForProduction'
            >
        >
    ) {
        return Effect.gen(function* () {
            const project = yield* assertProjectAccess(
                projectId,
                requesterId,
                'admin'
            )
            const projects = yield* ProjectStore

            const current = (project.settings ?? {}) as ProjectSettings
            const merged = { ...current, ...patch }
            const updated = yield* projects.update(projectId, {
                settings: merged,
            })
            if (!updated) {
                return yield* Effect.fail(
                    new ResourceNotFound({ entity: 'Project', id: projectId })
                )
            }
            const s = (updated.settings ?? {}) as ProjectSettings
            return {
                autoCleanupDays: s.autoCleanupDays ?? 30,
                maxPreviewEnvironments: s.maxPreviewEnvironments ?? 10,
                deploymentStrategy: s.deploymentStrategy ?? 'rolling',
                healthCheckTimeout: s.healthCheckTimeout ?? 60,
                deploymentTimeout: s.deploymentTimeout ?? 600,
                enableRollback: s.enableRollback ?? true,
                requireApprovalForProduction:
                    s.requireApprovalForProduction ?? false,
            }
        })
    }

    getSecurityConfig(projectId: string, requesterId: string) {
        return Effect.gen(function* () {
            const project = yield* assertProjectAccess(
                projectId,
                requesterId,
                'read'
            )
            const configuration = yield* RuntimeConfigurationAccessor
            const s = (project.settings ?? {}) as ProjectSettings

            const projectConfig = configuration.projectConfigFromSettings(
                project.settings ?? null
            )
            const resolved = yield* configurationRule(
                configuration.resolveStrict({
                    scope: 'project',
                    context: {
                        projectId,
                    },
                    project: projectConfig,
                })
            )

            return {
                webhookSecret: null,
                enableHttpsRedirect: resolved.effective.routing.forceHttps,
                allowedDomains: s.allowedDomains,
                ipWhitelist: s.ipWhitelist,
                enableBasicAuth: s.enableBasicAuth ?? false,
                basicAuthUsername: s.basicAuthUsername,
                basicAuthPassword: null,
                hasWebhookSecret: Boolean(s.webhookSecret),
                hasBasicAuthPassword: Boolean(s.basicAuthPassword),
            }
        })
    }

    updateSecurityConfig(
        projectId: string,
        requesterId: string,
        patch: Partial<
            Pick<
                ProjectSettings,
                | 'webhookSecret'
                | 'enableHttpsRedirect'
                | 'allowedDomains'
                | 'ipWhitelist'
                | 'enableBasicAuth'
                | 'basicAuthUsername'
                | 'basicAuthPassword'
            >
        >
    ) {
        return Effect.gen(function* () {
            const project = yield* assertProjectAccess(
                projectId,
                requesterId,
                'admin'
            )
            const projects = yield* ProjectStore

            const current = (project.settings ?? {}) as ProjectSettings
            const merged = { ...current, ...patch }
            const updated = yield* projects.update(projectId, {
                settings: merged,
            })
            if (!updated) {
                return yield* Effect.fail(
                    new ResourceNotFound({ entity: 'Project', id: projectId })
                )
            }
            const s = (updated.settings ?? {}) as ProjectSettings
            return {
                webhookSecret: null,
                enableHttpsRedirect: s.enableHttpsRedirect ?? true,
                allowedDomains: s.allowedDomains,
                ipWhitelist: s.ipWhitelist,
                enableBasicAuth: s.enableBasicAuth ?? false,
                basicAuthUsername: s.basicAuthUsername,
                basicAuthPassword: null,
                hasWebhookSecret: Boolean(s.webhookSecret),
                hasBasicAuthPassword: Boolean(s.basicAuthPassword),
            }
        })
    }

    getResourceConfig(projectId: string, requesterId: string) {
        return Effect.gen(function* () {
            const project = yield* assertProjectAccess(
                projectId,
                requesterId,
                'read'
            )
            const s = (project.settings ?? {}) as ProjectSettings
            return {
                defaultCpuLimit: s.defaultCpuLimit ?? '0.5',
                defaultMemoryLimit: s.defaultMemoryLimit ?? '512MB',
                defaultStorageLimit: s.defaultStorageLimit ?? '10GB',
                maxServicesPerProject: s.maxServicesPerProject ?? 20,
            }
        })
    }

    updateResourceConfig(
        projectId: string,
        requesterId: string,
        patch: Partial<
            Pick<
                ProjectSettings,
                | 'defaultCpuLimit'
                | 'defaultMemoryLimit'
                | 'defaultStorageLimit'
                | 'maxServicesPerProject'
            >
        >
    ) {
        return Effect.gen(function* () {
            const project = yield* assertProjectAccess(
                projectId,
                requesterId,
                'admin'
            )
            const projects = yield* ProjectStore

            const current = (project.settings ?? {}) as ProjectSettings
            const merged = { ...current, ...patch }
            const updated = yield* projects.update(projectId, {
                settings: merged,
            })
            if (!updated) {
                return yield* Effect.fail(
                    new ResourceNotFound({ entity: 'Project', id: projectId })
                )
            }
            const s = (updated.settings ?? {}) as ProjectSettings
            return {
                defaultCpuLimit: s.defaultCpuLimit ?? '0.5',
                defaultMemoryLimit: s.defaultMemoryLimit ?? '512MB',
                defaultStorageLimit: s.defaultStorageLimit ?? '10GB',
                maxServicesPerProject: s.maxServicesPerProject ?? 20,
            }
        })
    }

    getNotificationConfig(projectId: string, requesterId: string) {
        return Effect.gen(function* () {
            const project = yield* assertProjectAccess(
                projectId,
                requesterId,
                'read'
            )
            const s = (project.settings ?? {}) as ProjectSettings
            return {
                enableEmailNotifications: s.enableEmailNotifications ?? true,
                enableSlackNotifications: s.enableSlackNotifications ?? false,
                slackWebhookUrl: s.slackWebhookUrl,
                emailRecipients: s.emailRecipients,
                notifyOnDeploymentSuccess: s.notifyOnDeploymentSuccess ?? false,
                notifyOnDeploymentFailure: s.notifyOnDeploymentFailure ?? true,
                notifyOnServiceDown: s.notifyOnServiceDown ?? true,
            }
        })
    }

    updateNotificationConfig(
        projectId: string,
        requesterId: string,
        patch: Partial<
            Pick<
                ProjectSettings,
                | 'enableEmailNotifications'
                | 'enableSlackNotifications'
                | 'slackWebhookUrl'
                | 'emailRecipients'
                | 'notifyOnDeploymentSuccess'
                | 'notifyOnDeploymentFailure'
                | 'notifyOnServiceDown'
            >
        >
    ) {
        return Effect.gen(function* () {
            const project = yield* assertProjectAccess(
                projectId,
                requesterId,
                'admin'
            )
            const projects = yield* ProjectStore

            const current = (project.settings ?? {}) as ProjectSettings
            const merged = { ...current, ...patch }
            const updated = yield* projects.update(projectId, {
                settings: merged,
            })
            if (!updated) {
                return yield* Effect.fail(
                    new ResourceNotFound({ entity: 'Project', id: projectId })
                )
            }
            const s = (updated.settings ?? {}) as ProjectSettings
            return {
                enableEmailNotifications: s.enableEmailNotifications ?? true,
                enableSlackNotifications: s.enableSlackNotifications ?? false,
                slackWebhookUrl: s.slackWebhookUrl,
                emailRecipients: s.emailRecipients,
                notifyOnDeploymentSuccess: s.notifyOnDeploymentSuccess ?? false,
                notifyOnDeploymentFailure: s.notifyOnDeploymentFailure ?? true,
                notifyOnServiceDown: s.notifyOnServiceDown ?? true,
            }
        })
    }

    /** @deprecated Use typed config methods instead */
    getProjectSettings(projectId: string, requesterId: string) {
        return Effect.gen(function* () {
            yield* assertProjectAccess(projectId, requesterId, 'read')
            const projects = yield* ProjectStore
            const project = yield* projects.findById(projectId)
            if (!project) {
                return yield* Effect.fail(
                    new ResourceNotFound({ entity: 'Project', id: projectId })
                )
            }
            return project.settings ?? {}
        })
    }

    /** @deprecated Use typed config methods instead */
    updateProjectSettings(
        projectId: string,
        requesterId: string,
        patch: Record<string, unknown>
    ) {
        return Effect.gen(function* () {
            yield* assertProjectAccess(projectId, requesterId, 'admin')
            const projects = yield* ProjectStore

            const project = yield* projects.findById(projectId)
            if (!project) {
                return yield* Effect.fail(
                    new ResourceNotFound({ entity: 'Project', id: projectId })
                )
            }

            const current = isRecord(project.settings ?? {})
                ? (project.settings ?? {})
                : {}
            const merged = { ...current, ...patch }

            const updated = yield* projects.update(projectId, {
                settings: merged,
            })
            return updated?.settings ?? merged
        })
    }

    // ========================================
    // UTILITIES
    // ========================================

    /** The event stream. RxJS on the outside, Effect services on the inside. */
    streamQueryEvents(input: ProjectStreamQueryInput): Effect.Effect<
        Observable<
            ProjectStreamEvent & {
                sequence: number
                replayed: boolean
                emittedAt: string
            }
        >,
        Error,
        ProjectStore | ProjectEventService | CoreEventSync | DatabasePort
    > {
        return streamProjectEvents(input)
    }
}

/** The service's public surface is exactly the implementation's methods. */
export type ProjectServiceShape = ProjectServiceImpl

/** Effect key = NestJS token. */
export class ProjectService extends Context.Service<
    ProjectService,
    ProjectServiceShape
>()('project/ProjectService') {
    /** Resolves the requirements the methods name when the layer is built. */
    static readonly live: ProjectServiceShape = new ProjectServiceImpl()
}
