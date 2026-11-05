import {
    type AnyNestedClient,
    type ClientLink,
    type InferClientContext,
    createORPCClient,
} from '@orpc/client'
import { createEffectClient } from '@orpc/effect'

/**
 * Every server-side mesh client is built here: an oRPC client over a mesh link, wrapped with `createEffectClient` so a
 * call is an Effect and gets retry, timeout, tracing, interruption and typed errors from Effect itself.
 */
export function createMeshClient<T extends AnyNestedClient>(
    link: ClientLink<InferClientContext<T>>
) {
    return createEffectClient(createORPCClient<T>(link))
}
