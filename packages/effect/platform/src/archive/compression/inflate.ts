import { Data, Effect } from 'effect'

/** The decompressed stream exceeded the byte limit; the transfer was cancelled. */
export class OutputLimitExceeded extends Data.TaggedError(
    'OutputLimitExceeded'
)<{ readonly limit: number }> {}

/** The compressed stream is malformed or truncated. */
export class InflateFailed extends Data.TaggedError('InflateFailed')<{
    readonly reason: string
}> {}

/**
 * Decompresses `data` with a hard cap on the output, using the web-standard `DecompressionStream`
 * (a Bun builtin). `Bun.inflateSync`/`gunzipSync` have no output limit, so a 100 KB bomb would
 * allocate gigabytes before any size check could run; here the stream is cancelled the moment the
 * cap is crossed, and whenever the effect ends, interruption included.
 */
export const inflateBounded = (
    data: Uint8Array,
    format: 'deflate-raw' | 'gzip',
    maxBytes: number
): Effect.Effect<Uint8Array, OutputLimitExceeded | InflateFailed> =>
    Effect.acquireUseRelease(
        Effect.sync(() =>
            new Blob([data as Uint8Array<ArrayBuffer>])
                .stream()
                .pipeThrough(new DecompressionStream(format))
                .getReader()
        ),
        (reader) =>
            Effect.gen(function* () {
                const chunks: Uint8Array[] = []
                let total = 0
                for (;;) {
                    const { done, value } = yield* Effect.tryPromise({
                        try: () => reader.read(),
                        catch: (cause) =>
                            new InflateFailed({
                                reason:
                                    cause instanceof Error
                                        ? cause.message
                                        : String(cause),
                            }),
                    })
                    if (done) break
                    total += value.length
                    if (total > maxBytes)
                        return yield* Effect.fail(
                            new OutputLimitExceeded({ limit: maxBytes })
                        )
                    chunks.push(value)
                }
                const out = new Uint8Array(total)
                let offset = 0
                for (const chunk of chunks) {
                    out.set(chunk, offset)
                    offset += chunk.length
                }
                return out
            }),
        (reader) => Effect.tryPromise(() => reader.cancel()).pipe(Effect.ignore)
    )
