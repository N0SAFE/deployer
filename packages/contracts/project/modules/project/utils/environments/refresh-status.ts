import z from 'zod/v4'

import { access } from '@deployer/auth/authz/meta'
import { environmentStatusSchema } from '@deployer/contracts-entities'

import { projectEnvironmentStatusOps } from '../shared'

export const projectRefreshEnvironmentStatusContract =
    projectEnvironmentStatusOps
        .read({ idFieldName: 'environmentId', idSchema: z.uuid() })
        .input((b) =>
            b.params(
                (p) =>
                    p`/${p('id', z.uuid())}/environments/${p('environmentId', z.uuid())}/status/refresh`
            )
        )
        .output(
            z.object({
                success: z.boolean(),
                status: environmentStatusSchema,
                lastChecked: z.string(),
            })
        )
        .errors((e) => [...standardDomainErrorContracts(e)])
        .meta(
            access({
                permission: 'project:read',
                scope: { by: 'input', path: 'params.id', kind: 'project' },
            })
        )
        .build()

import { standardDomainErrorContracts } from '@deployer/orpc-utils'
