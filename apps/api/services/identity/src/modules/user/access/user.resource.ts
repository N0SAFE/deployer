import { defineResource } from '@deployer/nest-effect'

/**
 * The user domain's vocabulary for access: what a requirement on an account or on its sessions is called.
 *
 * Both are platform resources: a user is not inside a project, so there is no lineage to walk and the permission is
 * granted on the platform. `id` is the subject (the account acted on), which `.orSelf()` compares with the caller.
 */
export const User = defineResource('user', { scope: 'platform', idKey: 'id' })
export const Session = defineResource('session', { scope: 'platform' })
