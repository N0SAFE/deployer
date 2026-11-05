import z from 'zod/v4'

import { access } from '@deployer/auth/authz/meta'
import { projectEnvironmentConfigSchema } from '@deployer/contracts-entities'
import { standard, standardDomainErrorContracts } from '@deployer/orpc-utils'

const projectEnvironmentConfigOps = standard.zod(
    projectEnvironmentConfigSchema,
    'projectEnvironmentConfig'
)

export const projectGetEnvironmentConfigContract = projectEnvironmentConfigOps
    .read({ idFieldName: 'id', idSchema: z.uuid() })
    .input((b) => b.params((p) => p`/${p('id', z.uuid())}/config/environment`))
    .errors((e) => [...standardDomainErrorContracts(e)])
    .meta(
        access({
            permission: 'env.var:read',
            scope: { by: 'input', path: 'params.id', kind: 'project' },
        })
    )
    .build()
