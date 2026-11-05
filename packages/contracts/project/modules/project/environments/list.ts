import z from 'zod/v4'

import { access } from '@deployer/auth/authz/meta'
import { environmentKindSchema } from '@deployer/contracts-entities'

import { projectEnvironmentOps } from './shared'

export const projectListEnvironmentsContract = projectEnvironmentOps
    .list()
    .input((b) =>
        b
            .params(
                (p) =>
                    p`/${p('id', b.entitySchema.shape.projectId)}/environments`
            )
            .query(z.object({ kind: environmentKindSchema.optional() }))
    )
    .output((b) => z.object({ environments: z.array(b.entitySchema) }))
    .errors((e) => [...standardDomainErrorContracts(e)])
    .meta(
        access({
            permission: 'project:read',
            scope: { by: 'input', path: 'params.id', kind: 'project' },
        })
    )
    .build()

import { standardDomainErrorContracts } from '@deployer/orpc-utils'
