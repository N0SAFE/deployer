import z from 'zod/v4'

import { access } from '@deployer/auth/authz/meta'
import { environmentKindSchema } from '@deployer/contracts-entities'
import { standardDomainErrorContracts } from '@deployer/orpc-utils'

import { projectEnvironmentOps } from './shared'

export const projectCloneEnvironmentContract = projectEnvironmentOps
    .create()
    .input((b) =>
        b
            .params(
                (p) =>
                    p`/${p('id', b.entitySchema.shape.projectId)}/environments/${p('environmentId', b.entitySchema.shape.id)}/clone`
            )
            .body(
                z.object({
                    name: z.string().min(1).max(100),
                    kind: environmentKindSchema.optional(),
                })
            )
    )
    .output((b) => b.entitySchema)
    .errors((e) => [
        // 404 for unknown source env; 409 duplicate target name.
        ...standardDomainErrorContracts(e),
    ])
    .meta(
        access({
            permission: 'project:write',
            scope: { by: 'input', path: 'params.id', kind: 'project' },
        })
    )
    .build()
