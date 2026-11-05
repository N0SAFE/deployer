import { Context, Effect } from 'effect'
import { nanoid } from 'nanoid'

import {
    type ProviderTraefikTemplate,
    type ServiceTraefikTemplate,
    type CreateProviderTraefikTemplate,
    type CreateServiceTraefikTemplate,
} from '@deployer/nest-schema/global'

import {
    TraefikTemplateCreateFailure,
    TraefikTemplateNotFound,
    TraefikTemplateVariablesMissing,
} from '../errors'

import type { StorageFailure } from '../../database/storage'
import type { TemplateVariable, TemplateVariables } from '../interfaces'
import type { TraefikTemplateRepositoryShape } from '../repositories/traefik-template.repository'

type TemplateVariableValue = string | number | boolean | null | undefined

// ── pure template helpers ─────────────────────────────────────────────────────────────────────────────────────────────

/** Replace `~##variable##~` with the provided values; unreplaced placeholders are left in place. */
export function parseTemplate(
    template: string,
    variables: Record<string, TemplateVariableValue>
): string {
    let result = template
    for (const [key, value] of Object.entries(variables)) {
        result = result.replace(
            new RegExp(`~##\\s*${key}\\s*##~`, 'g'),
            String(value ?? '')
        )
    }
    return result
}

/** Variable names in a template, in first-seen order. */
export function extractVariables(template: string): string[] {
    const variables: string[] = []
    for (const match of template.matchAll(/~##\s*([^#\s]+)\s*##~/g)) {
        const name = match[1]
        if (name && !variables.includes(name)) variables.push(name)
    }
    return variables
}

/** Which required variables are missing from the provided ones. */
export function validateVariables(
    requiredVariables: TemplateVariables,
    providedVariables: Record<string, TemplateVariableValue>
): { valid: boolean; missing: string[] } {
    const missing = Object.entries(requiredVariables)
        .filter(
            ([key, definition]) =>
                definition.required && !providedVariables[key]
        )
        .map(([key]) => key)
    return { valid: missing.length === 0, missing }
}

const KNOWN_VARIABLES: Record<string, Partial<TemplateVariable>> = {
    domain: {
        description: 'Full domain name',
        required: true,
        example: 'example.com',
    },
    subdomain: {
        description: 'Subdomain (optional)',
        required: false,
        example: 'api',
    },
    host: {
        description: 'Complete host (subdomain.domain or just domain)',
        required: true,
        example: 'api.example.com',
    },
    projectId: { description: 'Project UUID', required: true },
    serviceId: { description: 'Service ID', required: true },
    serviceName: {
        description: 'Service name',
        required: true,
        example: 'api-service',
    },
    containerName: {
        description: 'Container name',
        required: true,
        example: 'project-http-abc123',
    },
    containerPort: {
        description: 'Container port',
        required: true,
        defaultValue: '80',
        example: '80',
    },
    routerName: { description: 'Traefik router name', required: true },
    middlewareName: { description: 'Traefik middleware name', required: false },
    pathPrefix: {
        description: 'Path prefix for the service',
        required: false,
        example: '/api',
    },
}

/** Variable metadata for the names found in a template. */
export function buildVariablesMetadata(
    variableNames: string[]
): TemplateVariables {
    const metadata: TemplateVariables = {}
    for (const name of variableNames) {
        const known = KNOWN_VARIABLES[name]
        metadata[name] = {
            name,
            description: known?.description ?? `Variable ${name}`,
            required: known?.required ?? false,
            defaultValue: known?.defaultValue,
            example: known?.example,
        }
    }
    return metadata
}

// ── the service ───────────────────────────────────────────────────────────────────────────────────────────────────────

export type TraefikTemplateServiceShape = {
    readonly getProviderTemplate: (
        providerType: string
    ) => Effect.Effect<ProviderTraefikTemplate | null, StorageFailure>
    readonly getServiceTemplate: (
        serviceId: string
    ) => Effect.Effect<ServiceTraefikTemplate | null, StorageFailure>
    readonly createProviderTemplate: (
        data: CreateProviderTraefikTemplate
    ) => Effect.Effect<
        ProviderTraefikTemplate,
        StorageFailure | TraefikTemplateCreateFailure
    >
    readonly createServiceTemplate: (
        data: CreateServiceTraefikTemplate
    ) => Effect.Effect<
        ServiceTraefikTemplate,
        StorageFailure | TraefikTemplateCreateFailure
    >
    readonly updateServiceTemplate: (
        id: string,
        updates: Partial<CreateServiceTraefikTemplate>
    ) => Effect.Effect<
        ServiceTraefikTemplate,
        StorageFailure | TraefikTemplateNotFound
    >
    /** The service's own template, else the provider's default; `null` when neither exists. */
    readonly getTemplateForDeployment: (
        serviceId: string,
        providerType: string
    ) => Effect.Effect<
        { template: string; variables: TemplateVariables } | null,
        StorageFailure
    >
    /** The rendered template, `null` when there is none, or `TraefikTemplateVariablesMissing`. */
    readonly renderTemplateForDeployment: (
        serviceId: string,
        providerType: string,
        variables: Record<string, TemplateVariableValue>
    ) => Effect.Effect<
        string | null,
        StorageFailure | TraefikTemplateVariablesMissing
    >
}

export function makeTraefikTemplateService(
    repository: TraefikTemplateRepositoryShape
): TraefikTemplateServiceShape {
    const getTemplateForDeployment: TraefikTemplateServiceShape['getTemplateForDeployment'] =
        (serviceId, providerType) =>
            Effect.gen(function* () {
                const serviceTemplate =
                    yield* repository.findActiveByServiceId(serviceId)
                if (serviceTemplate) {
                    return {
                        template: serviceTemplate.templateContent,
                        variables:
                            serviceTemplate.variables as TemplateVariables,
                    }
                }
                const providerTemplate =
                    yield* repository.findProviderByType(providerType)
                if (providerTemplate) {
                    return {
                        template: providerTemplate.templateContent,
                        variables:
                            providerTemplate.variables as TemplateVariables,
                    }
                }
                yield* Effect.logWarning(
                    `No template found for service ${serviceId} or provider ${providerType}`
                )
                return null
            })

    return {
        getProviderTemplate: (providerType) =>
            repository.findProviderByType(providerType),
        getServiceTemplate: (serviceId) =>
            repository.findActiveByServiceId(serviceId),

        createProviderTemplate: (data) =>
            Effect.gen(function* () {
                const variables =
                    data.variables ??
                    buildVariablesMetadata(
                        extractVariables(data.templateContent)
                    )
                const template = yield* repository.createProviderTemplate({
                    id: data.id ?? nanoid(),
                    providerType: data.providerType,
                    templateName: data.templateName,
                    templateContent: data.templateContent,
                    description: data.description ?? null,
                    variables,
                    isDefault: data.isDefault ?? true,
                })
                if (!template)
                    return yield* new TraefikTemplateCreateFailure({
                        subject: `provider ${data.providerType}`,
                    })
                yield* Effect.logInfo(
                    `Created provider template for ${data.providerType}`
                )
                return template
            }),

        createServiceTemplate: (data) =>
            Effect.gen(function* () {
                const variables =
                    data.variables ??
                    buildVariablesMetadata(
                        extractVariables(data.templateContent)
                    )
                const template = yield* repository.createServiceTemplate({
                    id: data.id ?? nanoid(),
                    serviceId: data.serviceId,
                    templateContent: data.templateContent,
                    variables,
                    isActive: data.isActive ?? true,
                })
                if (!template)
                    return yield* new TraefikTemplateCreateFailure({
                        subject: `service ${data.serviceId}`,
                    })
                yield* Effect.logInfo(
                    `Created service template for service ${data.serviceId}`
                )
                return template
            }),

        updateServiceTemplate: (id, updates) =>
            Effect.gen(function* () {
                const updateData: {
                    updatedAt: Date
                    templateContent?: string
                    variables?: TemplateVariables
                    isActive?: boolean
                } = {
                    updatedAt: new Date(),
                }
                if (updates.templateContent) {
                    updateData.templateContent = updates.templateContent
                    updateData.variables = buildVariablesMetadata(
                        extractVariables(updates.templateContent)
                    )
                }
                if (updates.isActive !== undefined && updates.isActive !== null)
                    updateData.isActive = updates.isActive

                const template = yield* repository.updateServiceTemplate(
                    id,
                    updateData
                )
                if (!template)
                    return yield* new TraefikTemplateNotFound({
                        templateId: id,
                    })
                yield* Effect.logInfo(`Updated service template ${id}`)
                return template
            }),

        getTemplateForDeployment,

        renderTemplateForDeployment: (serviceId, providerType, variables) =>
            Effect.gen(function* () {
                const templateData = yield* getTemplateForDeployment(
                    serviceId,
                    providerType
                )
                if (!templateData) return null
                const validation = validateVariables(
                    templateData.variables,
                    variables
                )
                if (!validation.valid) {
                    yield* Effect.logError(
                        `Missing required variables for template: ${validation.missing.join(', ')}`
                    )
                    return yield* new TraefikTemplateVariablesMissing({
                        missing: validation.missing,
                    })
                }
                return parseTemplate(templateData.template, variables)
            }),
    }
}

export class TraefikTemplateService extends Context.Service<
    TraefikTemplateService,
    TraefikTemplateServiceShape
>()('shared/TraefikTemplateService') {}
