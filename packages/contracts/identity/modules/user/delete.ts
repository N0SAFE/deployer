import { access } from '@deployer/auth/authz/meta'
import { userSchema } from '@deployer/contracts-entities'
import { standard, standardDomainErrorContracts } from '@deployer/orpc-utils'

// Create standard operations builder for users
const userOps = standard.zod(userSchema, 'user')

// Create delete contract using builder
export const userDeleteContract = userOps
    .delete()
    .errors((e) => [
        // 404 for unknown user id.
        ...standardDomainErrorContracts(e),
    ])
    .meta(access({ permission: 'user:delete' }))
    .build()
