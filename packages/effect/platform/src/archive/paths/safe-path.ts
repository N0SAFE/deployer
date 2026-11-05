import { Effect } from 'effect'

import { NestingTooDeep, UnsafePath } from '../errors'

import type { ExtractLimits } from '../limits'

const MAX_SEGMENT = 255

const unsafe = (entry: string, reason: string) =>
    Effect.fail(new UnsafePath({ entry: entry.slice(0, 200), reason }))

/**
 * Turns an archive entry name into path segments under the destination, or fails.
 *
 * Rejected: NUL, backslash (a Windows separator that tools disagree on), absolute paths, drive
 * prefixes (`C:`), any `..` segment, over-long names, and excessive depth. `.` and empty segments
 * are dropped, so `./a//b/` is `["a", "b"]`; an entry that reduces to nothing is the archive root (`[]`).
 */
export const entrySegments = (
    entry: string,
    limits: Pick<ExtractLimits, 'maxPathLength' | 'maxDepth'>
): Effect.Effect<string[], UnsafePath | NestingTooDeep> =>
    Effect.gen(function* () {
        if (entry.includes('\0')) return yield* unsafe(entry, 'NUL byte')
        if (entry.includes('\\')) return yield* unsafe(entry, 'backslash')
        if (entry.startsWith('/')) return yield* unsafe(entry, 'absolute path')
        if (/^[a-zA-Z]:/.test(entry))
            return yield* unsafe(entry, 'drive prefix')
        if (entry.length > limits.maxPathLength)
            return yield* unsafe(entry, 'path too long')

        const segments: string[] = []
        for (const segment of entry.split('/')) {
            if (segment === '' || segment === '.') continue
            if (segment === '..')
                return yield* unsafe(entry, 'parent directory segment')
            if (segment.length > MAX_SEGMENT)
                return yield* unsafe(entry, 'path segment too long')
            segments.push(segment)
        }
        if (segments.length > limits.maxDepth) {
            return yield* Effect.fail(
                new NestingTooDeep({
                    entry: entry.slice(0, 200),
                    limit: limits.maxDepth,
                })
            )
        }
        return segments
    })

/** Joins under `root` and re-checks containment lexically (defence in depth over `entrySegments`). */
export const joinUnder = (
    root: string,
    segments: readonly string[],
    entry: string
): Effect.Effect<string, UnsafePath> => {
    const full = `${root.replace(/\/+$/, '')}/${segments.join('/')}`
    return full !== root &&
        !full.startsWith(root.endsWith('/') ? root : `${root}/`)
        ? unsafe(entry, 'resolves outside the destination')
        : Effect.succeed(full)
}
