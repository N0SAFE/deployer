import z from 'zod/v4'

import { access } from '@deployer/auth/authz/meta'
import { projectDeploymentConfigSchema } from '@deployer/contracts-entities'
import { standard, standardDomainErrorContracts } from '@deployer/orpc-utils'

const projectDeploymentConfigOps = standard.zod(
    projectDeploymentConfigSchema,
    'projectDeploymentConfig'
)

const projectDeploymentConfigUpdateInputSchema = z
    .object(projectDeploymentConfigSchema.shape)
    .partial()

export const projectUpdateDeploymentConfigContract = projectDeploymentConfigOps
    .update({ idFieldName: 'id', idSchema: z.uuid() })
    .input((b) =>
        b
            .params((p) => p`/${p('id', z.uuid())}/config/deployment`)
            .body(projectDeploymentConfigUpdateInputSchema)
    )
    .output(projectDeploymentConfigSchema)
    .errors((e) => [...standardDomainErrorContracts(e)])
    .meta(
        access({
            permission: 'project:write',
            scope: { by: 'input', path: 'params.id', kind: 'project' },
        })
    )
    .build()
