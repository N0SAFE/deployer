import { oc } from '@orpc/contract'
import { openapi } from '@orpc/openapi'

import {
    serviceListContract,
    serviceListConfigSchemas,
    type ServiceListInput,
} from '../list'

import { serviceChildrenContract, serviceSubtreeContract } from './children'
import {
    serviceCreateContract,
    serviceCreateInputSchema,
    type ServiceCreateInput,
} from './create'
import { serviceDeleteContract } from './delete'
import { serviceFindByIdContract } from './find-by-id'
import {
    serviceUpdateContract,
    serviceUpdateInputSchema,
    type ServiceUpdateInput,
} from './update'

export const serviceCrudContract = oc
    .meta(openapi({ tags: ['Service CRUD'] }))
    .router({
        list: serviceListContract,
        findById: serviceFindByIdContract,
        create: serviceCreateContract,
        update: serviceUpdateContract,
        delete: serviceDeleteContract,
        children: serviceChildrenContract,
        subtree: serviceSubtreeContract,
    })

export {
    serviceListContract,
    serviceListConfigSchemas,
    serviceFindByIdContract,
    serviceCreateInputSchema,
    serviceCreateContract,
    serviceUpdateInputSchema,
    serviceUpdateContract,
    serviceDeleteContract,
    serviceChildrenContract,
    serviceSubtreeContract,
}

export type { ServiceListInput, ServiceCreateInput, ServiceUpdateInput }
