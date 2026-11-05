import { access } from '@deployer/auth/authz/meta'
import { projectSchema } from '@deployer/contracts-entities'
import { standard, standardDomainErrorContracts } from '@deployer/orpc-utils'

const projectOps = standard.zod(projectSchema, 'project')

export const projectDeleteContract = projectOps
    .delete()
    .errors((e) => [
        // 404 when the project id doesn't exist; 409 when non-empty (services exist).
        ...standardDomainErrorContracts(e),
    ])
    .meta(
        access({
            permission: 'project:delete',
            scope: { by: 'input', path: 'params.id', kind: 'project' },
        })
    )
    .build()
