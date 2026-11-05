import z from 'zod/v4'

import type { DeploymentTriggerInput } from '@deployer/runtime-contracts/modules/deployment/crud'

import type { DeploymentStoragePolicy } from './storage-policy.schema'
import type { RuntimeInvalid } from '../../../../core/runtime.errors'
import type { Effect } from 'effect'

export const deploymentStorageTypeSchema = z.enum([
    'local',
    's3',
    'nfs',
    'volume',
])
export type DeploymentStorageType = z.infer<typeof deploymentStorageTypeSchema>

export const deploymentStorageUpdateStrategySchema = z.enum([
    'auto_redeploy',
    'manual_update_button',
])
export type DeploymentStorageUpdateStrategy = z.infer<
    typeof deploymentStorageUpdateStrategySchema
>

export const deploymentStorageBindingSchema = z.object({
    storageType: deploymentStorageTypeSchema,
    autoRedeployOnUpdate: z.boolean(),
    updateStrategy: deploymentStorageUpdateStrategySchema,
    mountPath: z.string().min(1),
    metadata: z.record(z.string(), z.unknown()).default({}),
})
export type DeploymentStorageBinding = z.infer<
    typeof deploymentStorageBindingSchema
>

/** `null` means "this config is not mine"; a config that names the type but is malformed fails with `RuntimeInvalid`. */
export type DeploymentStorageProvider = {
    readonly storageType: DeploymentStorageType
    resolveStorageBinding(
        input: DeploymentTriggerInput,
        serviceStorageConfig?: DeploymentStoragePolicy
    ): Effect.Effect<DeploymentStorageBinding | null, RuntimeInvalid>
}
