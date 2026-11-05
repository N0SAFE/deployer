import type { InferSchemaOutput } from '@orpc/contract'
import type { ProcedureContract } from '@orpc/server'

/** The caller is authenticated: what `requireAuth()` guarantees and the access middlewares require before them. */
export type AuthenticatedContext = {
    readonly auth: {
        readonly isLoggedIn: true
        readonly user: { readonly id: string }
    }
}

/** What a mapping function receives: the validated input, and the request context the earlier middlewares built. */
export type AccessArgs<I> = {
    readonly input: I
    readonly context: AuthenticatedContext
}

/**
 * The validated input of a contract procedure: what a mapping receives as `input`.
 *
 * `User.can('get').on<ContractInput<typeof userContract.findById>>(({ input }) => input.params.id)` states the shape once,
 * from the contract, and `.use(...)` then checks it against the procedure it is used on. TypeScript cannot infer it for
 * you: the requirement is built before the procedure it ends up on.
 */
export type ContractInput<C> =
    C extends ProcedureContract<infer I, infer _O, infer _E>
        ? InferSchemaOutput<I>
        : never
