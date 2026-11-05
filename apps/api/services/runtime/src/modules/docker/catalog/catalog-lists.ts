/**
 * The network and volume lists a runtime catalog answers: filter by the contract's field filters, sort, page.
 * Pure projections over an already resolved catalog.
 */
import type {
    DockerNetwork,
    DockerRuntimeCatalog,
    DockerVolume,
} from '@deployer/contracts-entities'
import type { DockerNetworkListInput } from '@deployer/runtime-contracts/modules/docker/networks/list'
import type { DockerVolumeListInput } from '@deployer/runtime-contracts/modules/docker/volumes/list'

import {
    getFilterEntry,
    matchEq,
    matchString,
    paginateList,
    sortItems,
} from '../domains/containers/orchestration/mesh-universe-merge'

export function listNetworksOf(
    catalog: DockerRuntimeCatalog,
    input: DockerNetworkListInput
) {
    const filtered = catalog.networks.filter(
        (item) =>
            matchString(item.name, getFilterEntry(input, 'name')) &&
            matchEq(item.driver, getFilterEntry(input, 'driver')) &&
            matchEq(item.scope, getFilterEntry(input, 'scope'))
    )

    const sorted = sortItems(
        filtered,
        input.sortBy,
        input.sortDirection,
        (item: DockerNetwork, sortBy) => {
            switch (sortBy) {
                case 'name':
                    return item.name
                case 'createdAt':
                    return item.createdAt
                case 'updatedAt':
                default:
                    return item.updatedAt
            }
        }
    )

    return paginateList(sorted, input.limit, input.offset)
}

export function listVolumesOf(
    catalog: DockerRuntimeCatalog,
    input: DockerVolumeListInput
) {
    const filtered = catalog.volumes.filter(
        (item) =>
            matchString(item.name, getFilterEntry(input, 'name')) &&
            matchEq(item.driver, getFilterEntry(input, 'driver'))
    )

    const sorted = sortItems(
        filtered,
        input.sortBy,
        input.sortDirection,
        (item: DockerVolume, sortBy) => {
            switch (sortBy) {
                case 'name':
                    return item.name
                case 'createdAt':
                    return item.createdAt
                case 'updatedAt':
                default:
                    return item.updatedAt
            }
        }
    )

    return paginateList(sorted, input.limit, input.offset)
}
