import { Effect } from 'effect'

import { FsError } from './errors'
import { dirname, normalize } from './helpers'
import type { FileSystemShape } from './types'

/**
 * An in-memory tree with the same errors and create-only semantics as the live filesystem, for
 * specs. `realpath` is the identity: this tree has no symlinks.
 */
export const makeMemoryFileSystem = (): {
    readonly shape: FileSystemShape
    readonly files: Map<string, { bytes: Uint8Array; mode: number }>
    readonly dirs: Set<string>
} => {
    const files = new Map<string, { bytes: Uint8Array; mode: number }>()
    const dirs = new Set<string>(['/'])
    const err = (op: string, path: string, kind: FsError['kind']) =>
        new FsError({ op, path, kind, message: `${op} ${path}: ${kind}` })
    const ensureParents = (path: string) => {
        let current = ''
        for (const part of dirname(path).split('/').filter(Boolean)) {
            current += `/${part}`
            dirs.add(current)
        }
    }
    let counter = 0
    const shape: FileSystemShape = {
        readFile: (path, options) => {
            const file = files.get(normalize(path))
            if (file === undefined)
                return Effect.fail(err('readFile', path, 'NotFound'))
            if (
                options?.maxBytes !== undefined &&
                file.bytes.length > options.maxBytes
            ) {
                return Effect.fail(err('readFile', path, 'TooLarge'))
            }
            return Effect.succeed(file.bytes)
        },
        kindOf: (path) => {
            const p = normalize(path)
            return Effect.succeed(
                files.has(p) ? 'file' : dirs.has(p) ? 'directory' : undefined
            )
        },
        size: (path) => {
            const file = files.get(normalize(path))
            return file === undefined
                ? Effect.fail(err('size', path, 'NotFound'))
                : Effect.succeed(file.bytes.length)
        },
        mkdirp: (path) =>
            Effect.sync(() => {
                const p = normalize(path)
                ensureParents(`${p}/x`)
                dirs.add(p)
            }),
        writeFileExclusive: (path, bytes, options) =>
            Effect.suspend(() => {
                const p = normalize(path)
                if (files.has(p) || dirs.has(p))
                    return Effect.fail(
                        err('writeFileExclusive', path, 'AlreadyExists')
                    )
                if (!dirs.has(dirname(p)))
                    return Effect.fail(
                        err('writeFileExclusive', path, 'NotFound')
                    )
                files.set(p, {
                    bytes: new Uint8Array(bytes),
                    mode: options?.mode ?? 0o644,
                })
                return Effect.void
            }),
        realpath: (path) => {
            const p = normalize(path)
            return files.has(p) || dirs.has(p)
                ? Effect.succeed(p)
                : Effect.fail(err('realpath', path, 'NotFound'))
        },
        readdir: (path) => {
            const p = normalize(path)
            if (!dirs.has(p))
                return Effect.fail(err('readdir', path, 'NotFound'))
            const prefix = p === '/' ? '/' : `${p}/`
            const names = new Set<string>()
            for (const entry of [...files.keys(), ...dirs]) {
                if (entry === p || !entry.startsWith(prefix)) continue
                const name = entry.slice(prefix.length).split('/')[0]
                if (name !== undefined) names.add(name)
            }
            return Effect.succeed([...names].sort())
        },
        remove: (path, options) =>
            Effect.suspend(() => {
                const p = normalize(path)
                const prefix = `${p}/`
                const children = [...files.keys(), ...dirs].filter((e) =>
                    e.startsWith(prefix)
                )
                if (children.length > 0 && options?.recursive !== true)
                    return Effect.fail(err('remove', path, 'NotEmpty'))
                for (const child of children) {
                    files.delete(child)
                    dirs.delete(child)
                }
                if (!files.delete(p) && !dirs.delete(p))
                    return Effect.fail(err('remove', path, 'NotFound'))
                return Effect.void
            }),
        makeTempDirectory: (prefix) =>
            Effect.acquireRelease(
                Effect.sync(() => {
                    const dir = `/tmp/${prefix}${String(++counter)}`
                    ensureParents(`${dir}/x`)
                    dirs.add(dir)
                    return dir
                }),
                (dir) =>
                    Effect.sync(() => {
                        for (const entry of [...files.keys(), ...dirs]) {
                            if (entry === dir || entry.startsWith(`${dir}/`)) {
                                files.delete(entry)
                                dirs.delete(entry)
                            }
                        }
                    })
            ),
    }
    return { shape, files, dirs }
}
