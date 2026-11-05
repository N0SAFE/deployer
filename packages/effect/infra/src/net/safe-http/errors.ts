import { Data } from 'effect'

/** The target (or a redirect hop, or a DNS answer) violates the egress policy. */
export class EgressDenied extends Data.TaggedError('EgressDenied')<{
    readonly url: string
    readonly reason: string
}> {}
export class HttpTimeout extends Data.TaggedError('HttpTimeout')<{
    readonly url: string
    readonly afterMs: number
}> {}
export class ResponseTooLarge extends Data.TaggedError('ResponseTooLarge')<{
    readonly url: string
    readonly limitBytes: number
}> {}
export class TooManyRedirects extends Data.TaggedError('TooManyRedirects')<{
    readonly url: string
    readonly limit: number
}> {}
/** Transport-level failure (connection refused, TLS error, reset, DNS failure, ...). */
export class HttpFailed extends Data.TaggedError('HttpFailed')<{
    readonly url: string
    readonly message: string
}> {}

export type SafeHttpError =
    | EgressDenied
    | HttpTimeout
    | ResponseTooLarge
    | TooManyRedirects
    | HttpFailed
