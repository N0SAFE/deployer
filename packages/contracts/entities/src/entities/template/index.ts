export {
  templateKindSchema,
  templateScopeSchema,
  templateStatusSchema,
  templateVersionSchema,
  providerIdSchema,
  builderIdSchema,
} from './vocabulary.schema'

export type {
  TemplateKind,
  TemplateScope,
  TemplateStatus,
} from './vocabulary.schema'

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
} from './config.schema'

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
} from './config.schema'

export {
  templateCompatibilityMatrixItemSchema,
  templateCompatibilityMatrixSchema,
  templateCompatibilityValidationInputSchema,
  templateCompatibilityValidationResultSchema,
} from './compatibility.schema'

export type {
  TemplateCompatibilityMatrixItem,
  TemplateCompatibilityMatrix,
  TemplateCompatibilityValidationInput,
  TemplateCompatibilityValidationResult,
} from './compatibility.schema'

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
} from './templates.schema'

export type {
  DeploymentTemplate,
  TemplateCreateInput,
  TemplateUpdateInput,
} from './templates.schema'

export {
  templateValidationIssueSeveritySchema,
  templateValidationIssueSchema,
  templateSemanticValidationContextSchema,
  templateValidationInputSchema,
  templateValidationResultSchema,
  templateSetValidationInputSchema,
  templateSetValidationResultSchema,
} from './validation.schema'

export type {
  TemplateValidationIssueSeverity,
  TemplateValidationIssue,
  TemplateSemanticValidationContext,
  TemplateValidationInput,
  TemplateValidationResult,
  TemplateSetValidationInput,
  TemplateSetValidationResult,
} from './validation.schema'

export {
  templateResolverLayerSchema,
  templateResolverContextSchema,
  templateResolverChainInputSchema,
  templateResolveInputSchema,
  templateResolvedLayerTraceSchema,
  templateResolveResultSchema,
  templateSetResolveInputSchema,
  templateSetResolveResultSchema,
} from './resolver.schema'

export type {
  TemplateResolverLayer,
  TemplateResolverContext,
  TemplateResolverChainInput,
  TemplateResolveInput,
  TemplateResolvedLayerTrace,
  TemplateResolveResult,
  TemplateSetResolveInput,
  TemplateSetResolveResult,
} from './resolver.schema'

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
} from './migration.schema'

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
} from './migration.schema'
