import type { Permission, ScopeKind } from '@deployer/auth/authz'

import type { AccessEntry } from './middleware'

/** Only the access machinery holds this, so only it can mint an `Authorized`. Not exported from the package. */
export const mint: unique symbol = Symbol('access/mint')

/**
 * The proof that a decision was made: what `Resource.require(...)` returns and what a mutating service method asks for.
 *
 * It has a `#` field and a constructor that wants the module-private `mint`, so a value cannot be written by hand or
 * produced by a structural look-alike: a caller either went through the access machinery or does not have one. A service
 * method that takes `Authorized<'service:update'>` therefore cannot be called without a check (`AUTHZ-014`).
 */
export class Authorized<
    P extends Permission = Permission,
    K extends ScopeKind = ScopeKind,
> {
    readonly #proof = true
    constructor(
        readonly entry: AccessEntry<P, K>,
        token: typeof mint
    ) {
        if (token !== mint) {
            throw new Error('Authorized is minted by the access machinery only')
        }
    }

    /** Always true: reading it is what keeps the nominal `#proof` field live. */
    get minted(): true {
        return this.#proof
    }
}
