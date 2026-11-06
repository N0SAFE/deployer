import { describe, expectTypeOf, it } from 'vitest'

import { nodeAgentContract } from '@deployer/node-agent-contracts'

import type { InferClientError } from '@orpc/client'
import type { ContractRouterClient } from '@orpc/contract'

type Client = ContractRouterClient<typeof nodeAgentContract>
type CodeOf<T> = T extends { readonly code: infer C } ? C : never

/**
 * Compile-time guarantee: the directory procedures expose exactly the standard domain errors, so the mapping in
 * the directory procedures cannot drift from what a client can catch. Asserted on the `list` operation: the shared
 * builder types the error union of a `create` operation as a plain string code, for every service alike.
 */
describe('mesh directory contract errors', () => {
    it('exposes the typed domain error union to the client', () => {
        expectTypeOf<
            CodeOf<InferClientError<Client['directory']['snapshot']>>
        >().toEqualTypeOf<
            | 'NOT_FOUND'
            | 'BAD_REQUEST'
            | 'CONFLICT'
            | 'UNAUTHORIZED'
            | 'FORBIDDEN'
            | 'FAILED_DEPENDENCY'
            | 'BAD_GATEWAY'
        >()
    })
})
