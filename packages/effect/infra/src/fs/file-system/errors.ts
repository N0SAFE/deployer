import { Data } from 'effect'

export class FsError extends Data.TaggedError('FsError')<{
    readonly op: string
    readonly path: string
    /** `NotFound`, `AlreadyExists`, `NotEmpty`, `NotDirectory`, `TooLarge` (a `maxBytes` bound was hit) or `Other`. */
    readonly kind:
        | 'NotFound'
        | 'AlreadyExists'
        | 'NotEmpty'
        | 'NotDirectory'
        | 'TooLarge'
        | 'Other'
    readonly message: string
}> {}
