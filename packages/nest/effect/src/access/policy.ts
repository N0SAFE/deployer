import { Context } from 'effect'

import type { AuthzOptions } from '../authz'

/**
 * How access is decided in this process: where capabilities come from, the rollout mode, and where decisions are reported.
 *
 * A service, so the access middlewares and `Resource.require(...)` DEPEND on it: an app that does not provide one does not
 * compile, instead of silently running unprotected because a global was never configured. `mode: 'off'` is a policy too, and
 * is what an app that has not opted in provides.
 */
export class AccessPolicy extends Context.Service<AccessPolicy, AuthzOptions>()(
    'access/AccessPolicy'
) {}
