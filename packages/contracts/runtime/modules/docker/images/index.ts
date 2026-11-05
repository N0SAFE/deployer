import { oc } from '@orpc/contract'
import { openapi } from '@orpc/openapi'

import { dockerImageInspectContract } from './inspect'
import { dockerListImagesContract } from './list'
import { dockerImageSecurityContract } from './security'
import { dockerImageStreamsContract } from './streams'

export const dockerImagesContract = oc
    .meta(openapi({ tags: ['Docker Images'], prefix: '/images' }))
    .router({
        list: dockerListImagesContract,
        inspect: dockerImageInspectContract,
        streams: dockerImageStreamsContract,
        security: dockerImageSecurityContract,
    })

export * from './list'
export * from './inspect'
export * from './stream-inspect'
export * from './streams'
export * from './security'
