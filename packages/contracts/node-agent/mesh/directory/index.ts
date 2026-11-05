import { oc } from '@orpc/contract'
import { openapi } from '@orpc/openapi'

import { meshRegisterContract } from './register'
import { meshResolveContract } from './resolve'
import { meshSnapshotContract } from './snapshot'
import { meshUnregisterContract } from './unregister'

/** The service directory, as the agent serves it to the services on its node. */
export const meshDirectoryContract = oc
    .meta(openapi({ tags: ['Mesh directory'], prefix: '/mesh/directory' }))
    .router({
        register: meshRegisterContract,
        unregister: meshUnregisterContract,
        resolve: meshResolveContract,
        snapshot: meshSnapshotContract,
    })

export type MeshDirectoryContract = typeof meshDirectoryContract

export * from './replica'
export * from './register'
export * from './unregister'
export * from './resolve'
export * from './snapshot'
