import { oc } from '@orpc/contract'
import { openapi } from '@orpc/openapi'

import { meshRosterBlockContract, meshRosterUnblockContract } from './block'
import { meshCheckContract } from './check'
import { meshCredentialContract } from './credential'
import { meshRosterExchangeContract } from './exchange'
import { meshJoinContract } from './join'
import { meshRevokeContract } from './revoke'
import { meshRotateContract } from './rotate'
import { meshRosterSecretsContract } from './secrets'
import { meshSettingContract } from './setting'
import { meshTokenContract } from './token'
import { meshViewContract } from './view'

/** The gossip between agents. Internal to the mesh. */
export const meshRosterContract = oc
    .meta(openapi({ tags: ['Mesh roster'], prefix: '/mesh/roster' }))
    .router({
        block: meshRosterBlockContract,
        check: meshCheckContract,
        credential: meshCredentialContract,
        exchange: meshRosterExchangeContract,
        join: meshJoinContract,
        revoke: meshRevokeContract,
        rotate: meshRotateContract,
        secrets: meshRosterSecretsContract,
        setting: meshSettingContract,
        token: meshTokenContract,
        unblock: meshRosterUnblockContract,
        view: meshViewContract,
    })

export type MeshRosterContract = typeof meshRosterContract

export * from './block'
export * from './check'
export * from './credential'
export * from './exchange'
export * from './join'
export * from './revoke'
export * from './rotate'
export * from './secrets'
export * from './setting'
export * from './token'
export * from './view'
