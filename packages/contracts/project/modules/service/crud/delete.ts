import { access } from '@deployer/auth/authz/meta'
import { standardDomainErrorContracts } from '@deployer/orpc-utils'

import { serviceOps } from './shared'

export const serviceDeleteContract = serviceOps
    .delete()
    .errors((e) => [
        // 404 for unknown service id; 409 when the service has running deployments.
        ...standardDomainErrorContracts(e),
    ])
    .meta(
        access({
            permission: 'service:delete',
            scope: { by: 'input', path: 'params.id', kind: 'service' },
        })
    )
    .build()
