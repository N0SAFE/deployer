import z from 'zod/v4'

import { access } from '@deployer/auth/authz/meta'
import { projectEnvironmentConfigSchema } from '@deployer/contracts-entities'
import { standard, standardDomainErrorContracts } from '@deployer/orpc-utils'

const projectEnvironmentConfigOps = standard.zod(
    projectEnvironmentConfigSchema,
    'projectEnvironmentConfig'
)

const projectEnvironmentConfigUpdateInputSchema = z
    .object(projectEnvironmentConfigSchema.shape)
    .partial()

export const projectUpdateEnvironmentConfigContract =
    projectEnvironmentConfigOps
        .update({ idFieldName: 'id', idSchema: z.uuid() })
        .input((b) =>
            b
                .params((p) => p`/${p('id', z.uuid())}/config/environment`)
                .body(projectEnvironmentConfigUpdateInputSchema)
        )
        .output(projectEnvironmentConfigSchema)
        .errors((e) => [...standardDomainErrorContracts(e)])
        .meta(
            access({
                permission: 'env.var:write',
                scope: { by: 'input', path: 'params.id', kind: 'project' },
            })
        )
        .build()
