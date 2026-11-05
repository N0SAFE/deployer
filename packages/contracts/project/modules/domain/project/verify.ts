import z from 'zod/v4'

import { verifyDomainResponseSchema } from '../schemas'

import { projectDomainOps } from './shared'

export const verifyProjectDomainInput = z.object({
    projectId: z.uuid(),
    domainId: z.uuid(),
})

export const verifyProjectDomainContract = projectDomainOps
    .update({ idFieldName: 'domainId' })
    .path('/projects/{projectId}/domains/{domainId}/verify')
    .input((b) =>
        b.params(
            (p) =>
                p`/${p('projectId', z.uuid())}/domains/${p('domainId', z.uuid())}/verify`
        )
    )
    .output(verifyDomainResponseSchema)
    .errors((e) => [...standardDomainErrorContracts(e)])
    .meta(
        access({
            permission: 'domain:verify',
            scope: { by: 'input', path: 'params.projectId', kind: 'project' },
        })
    )
    .build()

import { access } from '@deployer/auth/authz/meta'
import { standardDomainErrorContracts } from '@deployer/orpc-utils'
