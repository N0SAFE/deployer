import { Effect } from 'effect'
import z from 'zod/v4'

import type { DeploymentTriggerInput } from '@deployer/runtime-contracts/modules/deployment/crud'

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

import type { RuntimeInvalid } from '../../../../core/runtime.errors'
import type { DeploymentStoragePolicy } from '../base/storage-policy.schema'

const localStorageConfigSchema = z
    .object({
        type: z.literal('local').optional(),
        local: z
            .object({
                rootPath: z.string().min(1).optional(),
                watchPath: z.string().min(1).optional(),
            })
            .optional(),
    })
    .loose()

function resolveLocalPath(
    candidate: string | undefined,
    fallback: string
): string {
    if (!candidate) {
        return fallback
    }

    const normalized = candidate.trim()
    if (!normalized || normalized.includes('\u0000')) {
        return fallback
    }

    return normalized
}

export const localStorageProvider: DeploymentStorageProvider = {
    storageType: 'local',

    resolveStorageBinding(
        input: DeploymentTriggerInput,
        serviceStorageConfig?: DeploymentStoragePolicy
    ): Effect.Effect<DeploymentStorageBinding | null, RuntimeInvalid> {
        const storageConfig = extractStorageConfig(input, serviceStorageConfig)
        const parsed = localStorageConfigSchema.safeParse(storageConfig ?? {})

        if (!parsed.success) {
            return Effect.succeed(null)
        }

        const autoRedeployOnUpdate = resolveAutoRedeployOnUpdate(storageConfig)
        const rootPath = resolveLocalPath(
            parsed.data.local?.rootPath,
            './storage/local'
        )
        const watchPath = resolveLocalPath(
            parsed.data.local?.watchPath,
            rootPath
        )

        return Effect.sync(() =>
            deploymentStorageBindingSchema.parse({
                storageType: 'local',
                autoRedeployOnUpdate,
                updateStrategy: resolveUpdateStrategy(autoRedeployOnUpdate),
                mountPath: resolveMountPath(storageConfig),
                metadata: {
                    rootPath,
                    watchPath,
                },
            })
        )
    },
}
