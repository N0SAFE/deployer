export {
  templateKindSchema,
  templateScopeSchema,
  templateStatusSchema,
  templateVersionSchema,
  providerIdSchema,
  builderIdSchema,
} from '@repo/contracts-entities/entities/template/vocabulary.schema'

export type {
  TemplateKind,
  TemplateScope,
  TemplateStatus,
} from '@repo/contracts-entities/entities/template/vocabulary.schema'

export {
  providerTemplateConfigSchema,
  buildTemplateConfigSchema,
  deployTemplateConfigSchema,
  deployStrategySchema,
  templateEnvironmentSchema,
  routeTemplateConfigSchema,
  previewTemplateConfigSchema,
  dependencyTemplateConfigSchema,
  templateConfigSchema,
} from '@repo/contracts-entities/entities/template/config.schema'

export type {
  ProviderTemplateConfig,
  BuildTemplateConfig,
  DeployTemplateConfig,
  DeployStrategy,
  TemplateEnvironment,
  RouteTemplateConfig,
  PreviewTemplateConfig,
  DependencyTemplateConfig,
  TemplateConfig,
} from '@repo/contracts-entities/entities/template/config.schema'

export {
  templateCompatibilityMatrixItemSchema,
  templateCompatibilityMatrixSchema,
  templateCompatibilityValidationInputSchema,
  templateCompatibilityValidationResultSchema,
} from '@repo/contracts-entities/entities/template/compatibility.schema'

export type {
  TemplateCompatibilityMatrixItem,
  TemplateCompatibilityMatrix,
  TemplateCompatibilityValidationInput,
  TemplateCompatibilityValidationResult,
} from '@repo/contracts-entities/entities/template/compatibility.schema'

export {
  deploymentTemplateSchema,
  providerTemplateCreateSchema,
  buildTemplateCreateSchema,
  deployTemplateCreateSchema,
  routeTemplateCreateSchema,
  previewTemplateCreateSchema,
  dependencyTemplateCreateSchema,
  templateCreateInputSchema,
  templateUpdateInputSchema,
} from '@repo/contracts-entities/entities/template/templates.schema'

export type {
  DeploymentTemplate,
  TemplateCreateInput,
  TemplateUpdateInput,
} from '@repo/contracts-entities/entities/template/templates.schema'

export {
  templateValidationIssueSeveritySchema,
  templateValidationIssueSchema,
  templateSemanticValidationContextSchema,
  templateValidationInputSchema,
  templateValidationResultSchema,
  templateSetValidationInputSchema,
  templateSetValidationResultSchema,
} from '@repo/contracts-entities/entities/template/validation.schema'

export type {
  TemplateValidationIssueSeverity,
  TemplateValidationIssue,
  TemplateSemanticValidationContext,
  TemplateValidationInput,
  TemplateValidationResult,
  TemplateSetValidationInput,
  TemplateSetValidationResult,
} from '@repo/contracts-entities/entities/template/validation.schema'

export {
  templateResolverLayerSchema,
  templateResolverContextSchema,
  templateResolverChainInputSchema,
  templateResolveInputSchema,
  templateResolvedLayerTraceSchema,
  templateResolveResultSchema,
  templateSetResolveInputSchema,
  templateSetResolveResultSchema,
} from '@repo/contracts-entities/entities/template/resolver.schema'

export type {
  TemplateResolverLayer,
  TemplateResolverContext,
  TemplateResolverChainInput,
  TemplateResolveInput,
  TemplateResolvedLayerTrace,
  TemplateResolveResult,
  TemplateSetResolveInput,
  TemplateSetResolveResult,
} from '@repo/contracts-entities/entities/template/resolver.schema'

export {
  templateMigrationDirectionSchema,
  templateMigrationOperationSchema,
  templateVersionTransformSchema,
  templateMigrationSafetyCheckSchema,
  templateVersionMigrationPreviewInputSchema,
  templateVersionMigrationPreviewResultSchema,
  templateVersionMigrationApplyInputSchema,
  templateVersionMigrationApplyResultSchema,
  templateVersionMigrationListInputSchema,
  templateVersionMigrationListResultSchema,
} from '@repo/contracts-entities/entities/template/migration.schema'

export type {
  TemplateMigrationDirection,
  TemplateMigrationOperation,
  TemplateVersionTransform,
  TemplateMigrationSafetyCheck,
  TemplateVersionMigrationPreviewInput,
  TemplateVersionMigrationPreviewResult,
  TemplateVersionMigrationApplyInput,
  TemplateVersionMigrationApplyResult,
  TemplateVersionMigrationListInput,
  TemplateVersionMigrationListResult,
} from '@repo/contracts-entities/entities/template/migration.schema'
