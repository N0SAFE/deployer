import * as z from 'zod'

import { access } from '@deployer/auth/authz/meta'
import { serviceObjectShape } from '@deployer/contracts-entities'
import { standardDomainErrorContracts } from '@deployer/orpc-utils'

import { serviceOps, serviceObjectSchema } from './shared'

export const serviceUpdateInputSchema = serviceObjectSchema
    .omit({ id: true, projectId: true, createdAt: true, updatedAt: true })
    .partial()
    .extend({
        id: serviceObjectShape.shape.id,
        parentId: z.uuid().nullable().optional(),
    })

export type ServiceUpdateInput = z.infer<typeof serviceUpdateInputSchema>

export const serviceUpdateContract = serviceOps
    .update()
    .input(serviceUpdateInputSchema)
    .errors((e) => [
        // 404 for unknown service id; 400/409 for invalid or conflicting updates.
        ...standardDomainErrorContracts(e),
    ])
    .meta(
        access({
            permission: 'service:update',
            scope: { by: 'input', path: 'id', kind: 'service' },
        })
    )
    .build()
