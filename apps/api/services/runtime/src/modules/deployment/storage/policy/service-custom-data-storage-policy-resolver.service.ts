import { isRecord, isObjectLike } from '@deployer/type-guards'

import { deploymentStoragePolicySchema } from '../base/storage-policy.schema'

import type {
    DeploymentStoragePolicyResolver,
    ResolveDeploymentStoragePolicyInput,
} from '../base/storage-policy-resolver.interface'

/**
 * Resolves the deployment storage policy from the service's custom data
 * (when set via the service metadata). Uses runtime type guards from
 * @deployer/type-guards in place of `as Record<string, unknown>` casts to
 * avoid the runtime lie.
 */
export const serviceCustomDataStoragePolicyResolver: DeploymentStoragePolicyResolver =
    {
        name: 'service-custom-data-storage',
        priority: 200,

        resolve(input: ResolveDeploymentStoragePolicyInput) {
            const customData = input.serviceMetadata?.customData
            if (!isRecord(customData)) {
                return undefined
            }

            const storage = customData.storage
            if (!isObjectLike(storage)) {
                return undefined
            }

            const parsedStoragePolicy =
                deploymentStoragePolicySchema.safeParse(storage)
            return parsedStoragePolicy.success
                ? parsedStoragePolicy.data
                : undefined
        },
    }
