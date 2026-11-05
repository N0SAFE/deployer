import * as z from 'zod'

import { access } from '@deployer/auth/authz/meta'
import { serviceObjectShape } from '@deployer/contracts-entities'
import { standard, standardDomainErrorContracts } from '@deployer/orpc-utils'

const serviceToggleActiveParamsSchema = z.object({
    id: z.uuid(),
})

const serviceToggleActiveBodySchema = z.object({
    isActive: z.boolean(),
})

const serviceToggleActiveOps = standard.zod(
    serviceObjectShape,
    'serviceToggleActive'
)

export const serviceToggleActiveContract = serviceToggleActiveOps
    .patch({ idFieldName: 'id', idSchema: z.uuid() })
    .summary('Toggle service active state')
    .path('/:id/toggle-active')
    .input((input) =>
        input
            .params(serviceToggleActiveParamsSchema)
            .body(serviceToggleActiveBodySchema)
    )
    .output(serviceObjectShape)
    .errors((e) => [
        // 404 for unknown service id.
        ...standardDomainErrorContracts(e),
    ])
    .meta(
        access({
            permission: 'service:update',
            scope: { by: 'input', path: 'params.id', kind: 'service' },
        })
    )
    .build()
