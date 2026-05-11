import z from 'zod'
import { envNameSchema } from './environment.schema'

export const deploymentStatusSchema = z.enum(['pending', 'queued', 'building', 'deploying', 'success', 'failed', 'cancelled'])
export type DeploymentStatus = z.infer<typeof deploymentStatusSchema>
export const DEPLOYMENT_STATUS_VALUES = deploymentStatusSchema.options

export const deploymentPhaseSchema = z.enum([
  'queued',
  'pulling_source',
  'building',
  'copying_files',
  'creating_symlinks',
  'updating_routes',
  'health_check',
  'active',
  'failed',
])
export type DeploymentPhase = z.infer<typeof deploymentPhaseSchema>
export const DEPLOYMENT_PHASE_VALUES = deploymentPhaseSchema.options

export const rollbackStatusSchema = z.enum(['pending', 'in_progress', 'completed', 'failed', 'cancelled'])
export type RollbackStatus = z.infer<typeof rollbackStatusSchema>
export const ROLLBACK_STATUS_VALUES = rollbackStatusSchema.options

export const deploymentEnvironmentSchema = envNameSchema
export type DeploymentEnvironment = z.infer<typeof deploymentEnvironmentSchema>
export const DEPLOYMENT_ENVIRONMENT_VALUES = deploymentEnvironmentSchema.options

export const sourceTypeSchema = z.enum(['github', 'gitlab', 'git', 'upload', 'custom'])
export type SourceType = z.infer<typeof sourceTypeSchema>
export const SOURCE_TYPE_VALUES = sourceTypeSchema.options

export const logLevelSchema = z.enum(['info', 'warn', 'error', 'debug'])
export type LogLevel = z.infer<typeof logLevelSchema>
export const LOG_LEVEL_VALUES = logLevelSchema.options

export const environmentStatusSchema = z.enum(['healthy', 'updating', 'error', 'pending', 'inactive'])
export type EnvironmentStatus = z.infer<typeof environmentStatusSchema>
export const ENVIRONMENT_STATUS_VALUES = environmentStatusSchema.options

export const variableResolutionStatusSchema = z.enum(['pending', 'resolved', 'failed'])
export type VariableResolutionStatus = z.infer<typeof variableResolutionStatusSchema>
export const VARIABLE_RESOLUTION_STATUS_VALUES = variableResolutionStatusSchema.options

export const verificationStatusSchema = z.enum(['pending', 'verified', 'failed'])
export type VerificationStatus = z.infer<typeof verificationStatusSchema>
export const VERIFICATION_STATUS_VALUES = verificationStatusSchema.options

export const verificationMethodSchema = z.enum(['txt_record', 'cname_record'])
export type VerificationMethod = z.infer<typeof verificationMethodSchema>
export const VERIFICATION_METHOD_VALUES = verificationMethodSchema.options

export const sslProviderSchema = z.enum(['letsencrypt', 'custom', 'none'])
export type SslProvider = z.infer<typeof sslProviderSchema>
export const SSL_PROVIDER_VALUES = sslProviderSchema.options

export const projectDeploymentStrategySchema = z.enum(['rolling', 'blue_green', 'canary'])
export type ProjectDeploymentStrategy = z.infer<typeof projectDeploymentStrategySchema>
export const PROJECT_DEPLOYMENT_STRATEGY_VALUES = projectDeploymentStrategySchema.options

export const githubDeploymentStrategySchema = z.enum(['standard', 'blue-green', 'canary', 'rolling', 'custom'])
export type GithubDeploymentStrategy = z.infer<typeof githubDeploymentStrategySchema>
export const GITHUB_DEPLOYMENT_STRATEGY_VALUES = githubDeploymentStrategySchema.options

export const cacheStrategySchema = z.enum(['strict', 'loose'])
export type CacheStrategy = z.infer<typeof cacheStrategySchema>
export const CACHE_STRATEGY_VALUES = cacheStrategySchema.options

export const previewDeploymentStatusSchema = z.enum(['pending', 'building', 'deploying', 'active', 'failed', 'deleted'])
export type PreviewDeploymentStatus = z.infer<typeof previewDeploymentStatusSchema>
export const PREVIEW_DEPLOYMENT_STATUS_VALUES = previewDeploymentStatusSchema.options