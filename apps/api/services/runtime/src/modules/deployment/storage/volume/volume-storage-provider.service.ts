import { Effect } from 'effect'
import z from 'zod/v4'

import type { DeploymentTriggerInput } from '@deployer/runtime-contracts/modules/deployment/crud'

import { RuntimeInvalid } from '../../../../core/runtime.errors'
import {
    deploymentStorageBindingSchema,
    type DeploymentStorageBinding,
    type DeploymentStorageProvider,
} from '../base/storage-provider.interface'
import {
    extractStorageConfig,
    resolveAutoRedeployOnUpdate,
    resolveMountPath,
    resolveUpdateStrategy,
} from '../base/storage-provider.utils'

import type { DeploymentStoragePolicy } from '../base/storage-policy.schema'

const volumeStorageConfigSchema = z
    .object({
        type: z.literal('volume'),
        volume: z.object({
            volumeName: z.string().min(1),
            driver: z.string().min(1).optional(),
        }),
    })
    .loose()

export const volumeStorageProvider: DeploymentStorageProvider = {
    storageType: 'volume',

    resolveStorageBinding(
        input: DeploymentTriggerInput,
        serviceStorageConfig?: DeploymentStoragePolicy
    ): Effect.Effect<DeploymentStorageBinding | null, RuntimeInvalid> {
        const storageConfig = extractStorageConfig(input, serviceStorageConfig)
        const parsed = volumeStorageConfigSchema.safeParse(storageConfig)

        if (!parsed.success) {
            if (storageConfig?.type === 'volume') {
                return Effect.fail(
                    new RuntimeInvalid({
                        reason: 'Volume storage requires storage.volume.volumeName in sourceConfig.customData',
                    })
                )
            }
            return Effect.succeed(null)
        }

        const autoRedeployOnUpdate = resolveAutoRedeployOnUpdate(storageConfig)

        return Effect.sync(() =>
            deploymentStorageBindingSchema.parse({
                storageType: 'volume',
                autoRedeployOnUpdate,
                updateStrategy: resolveUpdateStrategy(autoRedeployOnUpdate),
                mountPath: resolveMountPath(storageConfig),
                metadata: {
                    volumeName: parsed.data.volume.volumeName,
                    driver: parsed.data.volume.driver ?? 'local',
                },
            })
        )
    },
}
