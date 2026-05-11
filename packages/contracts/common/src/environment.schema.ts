import z from 'zod'

export const envNameSchema = z.enum(['production', 'staging', 'preview', 'development'])
export type EnvName = z.infer<typeof envNameSchema>
export const ENV_NAMES = [...envNameSchema.options] as readonly EnvName[]
export const ENV_NAME_VALUES = envNameSchema.options
export const REQUIRED_ENV_NAMES = ['production'] as const
export const SPECIAL_ENV_NAMES = ['preview', 'development'] as const

export const withRequiredEnvironments = <T extends z.ZodTypeAny>(valueSchema: T) =>
	z
		.object({
			production: valueSchema,
			staging: valueSchema.optional(),
			preview: valueSchema.optional(),
			development: valueSchema.optional(),
		})
		.catchall(valueSchema)

export const projectEnvironmentDeploymentStrategySchema = z.enum(['rolling', 'canary', 'blue-green', 'manual'])
export type ProjectEnvironmentDeploymentStrategy = z.infer<typeof projectEnvironmentDeploymentStrategySchema>

export const projectEnvironmentHealthGateSchema = z.enum(['strict', 'warn', 'ignore'])
export type ProjectEnvironmentHealthGate = z.infer<typeof projectEnvironmentHealthGateSchema>

export const projectEnvironmentStartupModeSchema = z.enum(['before', 'parallel', 'after'])
export type ProjectEnvironmentStartupMode = z.infer<typeof projectEnvironmentStartupModeSchema>

export const serviceHealthProtocolSchema = z.enum(['http', 'tcp', 'grpc', 'command'])
export type ServiceHealthProtocol = z.infer<typeof serviceHealthProtocolSchema>

export const serviceLifecycleSchema = z.enum(['running', 'degraded', 'starting', 'stopped', 'maintenance'])
export type ServiceLifecycle = z.infer<typeof serviceLifecycleSchema>

export const serviceHealthStateSchema = z.enum(['passing', 'warning', 'failing', 'unknown'])
export type ServiceHealthState = z.infer<typeof serviceHealthStateSchema>
