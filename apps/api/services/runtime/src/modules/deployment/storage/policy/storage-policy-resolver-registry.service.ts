import { Context, Effect } from 'effect'

import { runtimeConfigurationStoragePolicyResolver } from './runtime-configuration-storage-policy-resolver.service'
import { serviceCustomDataStoragePolicyResolver } from './service-custom-data-storage-policy-resolver.service'
import { serviceTopLevelStoragePolicyResolver } from './service-top-level-storage-policy-resolver.service'

import type { DeploymentStoragePolicyResolver } from '../base/storage-policy-resolver.interface'
import type { ResolveDeploymentStoragePolicyInput } from '../base/storage-policy-resolver.interface'
import type { DeploymentStoragePolicy } from '../base/storage-policy.schema'

/** Asks the resolvers, highest priority first, and answers with the first policy one of them finds. It never fails. */
export type StoragePolicyResolverRegistryShape = {
    readonly resolveServiceStorageConfig: (
        input: ResolveDeploymentStoragePolicyInput
    ) => Effect.Effect<DeploymentStoragePolicy | undefined>
}

export function makeStoragePolicyResolverRegistry(
    resolvers: readonly DeploymentStoragePolicyResolver[]
): StoragePolicyResolverRegistryShape {
    const ordered = [...resolvers].sort(
        (left, right) => (right.priority ?? 0) - (left.priority ?? 0)
    )
    return {
        resolveServiceStorageConfig: (input) =>
            Effect.sync(() => {
                for (const resolver of ordered) {
                    const resolved = resolver.resolve(input)
                    if (resolved) {
                        return resolved
                    }
                }
                return undefined
            }),
    }
}

/** The resolver set is fixed, so `live` is a constant the module provides with `useValue`. */
export class StoragePolicyResolverRegistry extends Context.Service<
    StoragePolicyResolverRegistry,
    StoragePolicyResolverRegistryShape
>()('runtime/StoragePolicyResolverRegistry') {
    static readonly live = makeStoragePolicyResolverRegistry([
        runtimeConfigurationStoragePolicyResolver,
        serviceCustomDataStoragePolicyResolver,
        serviceTopLevelStoragePolicyResolver,
    ])
}
