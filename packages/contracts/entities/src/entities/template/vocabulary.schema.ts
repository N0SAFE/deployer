import z from 'zod/v4'
import { providersCatalog } from '@repo/provider-schema/catalog'
import { buildersCatalog } from '@repo/provider-schema/catalog'

export const templateKindSchema = z.enum([
  'provider',
  'build',
  'deploy',
  'route',
  'preview',
  'dependency',
])
export type TemplateKind = z.infer<typeof templateKindSchema>

export const templateScopeSchema = z.enum(['global', 'provider', 'project', 'environment', 'run'])
export type TemplateScope = z.infer<typeof templateScopeSchema>

export const templateStatusSchema = z.enum(['draft', 'active', 'deprecated', 'archived'])
export type TemplateStatus = z.infer<typeof templateStatusSchema>

export const templateVersionSchema = z.string().regex(/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/, {
  message: 'Template version must follow semver (e.g. 1.0.0)',
})

export const nonEmptyString = z.string().min(1)

const providerIds = providersCatalog.map((provider: { id: string }) => provider.id)
const builderIds = buildersCatalog.map((builder: { id: string }) => builder.id)

if (providerIds.length === 0) {
  throw new Error('Provider catalog must not be empty when building template contracts.')
}

export const providerIdSchema = z.enum(providerIds as [string, ...string[]])

if (builderIds.length === 0) {
  throw new Error('Builder catalog must not be empty when building template contracts.')
}

export const builderIdSchema = z.enum(builderIds as [string, ...string[]])
