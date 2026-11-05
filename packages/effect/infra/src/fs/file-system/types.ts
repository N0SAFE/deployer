import { Effect, type Scope } from 'effect'

import { FsError } from './errors'

export type FileKind = 'file' | 'directory' | 'symlink' | 'other'

export type FileSystemShape = {
    /** Reads at most `maxBytes` (default unlimited); a larger file fails with `kind: "TooLarge"`. */
    readonly readFile: (
        path: string,
        options?: { readonly maxBytes?: number }
    ) => Effect.Effect<Uint8Array, FsError>
    /** `lstat`: does not follow symlinks. `undefined` when the path does not exist. */
    readonly kindOf: (
        path: string
    ) => Effect.Effect<FileKind | undefined, FsError>
    readonly size: (path: string) => Effect.Effect<number, FsError>
    readonly mkdirp: (path: string) => Effect.Effect<void, FsError>
    /** Create-only (`O_EXCL`): fails `AlreadyExists` instead of overwriting or following a planted link. */
    readonly writeFileExclusive: (
        path: string,
        bytes: Uint8Array,
        options?: { readonly mode?: number }
    ) => Effect.Effect<void, FsError>
    readonly realpath: (path: string) => Effect.Effect<string, FsError>
    readonly readdir: (
        path: string
    ) => Effect.Effect<readonly string[], FsError>
    readonly remove: (
        path: string,
        options?: { readonly recursive?: boolean }
    ) => Effect.Effect<void, FsError>
    /** A fresh directory that is removed (recursively) when the scope closes. */
    readonly makeTempDirectory: (
        prefix: string
    ) => Effect.Effect<string, FsError, Scope.Scope>
}
