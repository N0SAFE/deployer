import { Effect } from 'effect'

import { HttpFailed, ResponseTooLarge } from './errors'

const readFailed = (url: string) => (cause: unknown) =>
    new HttpFailed({
        url,
        message: cause instanceof Error ? cause.message : String(cause),
    })

/**
 * Reads a response body with a hard byte cap. The transfer is cancelled the moment the cap is
 * exceeded, and the reader is released however the read ends, including interruption.
 */
export const readCapped = (
    response: Response,
    url: string,
    maxBytes: number
): Effect.Effect<Uint8Array, ResponseTooLarge | HttpFailed> => {
    const body = response.body
    if (body === null) return Effect.succeed(new Uint8Array(0))

    return Effect.acquireUseRelease(
        Effect.sync(() => body.getReader()),
        (reader) =>
            Effect.gen(function* () {
                const chunks: Uint8Array[] = []
                let total = 0
                for (;;) {
                    const { done, value } = (yield* Effect.tryPromise({
                        try: () => reader.read(),
                        catch: readFailed(url),
                    })) as {
                        done: boolean
                        value: Uint8Array
                    }
                    if (done) break
                    total += value.length
                    if (total > maxBytes) {
                        yield* Effect.tryPromise({
                            try: () => reader.cancel(),
                            catch: readFailed(url),
                        }).pipe(Effect.ignore)
                        return yield* Effect.fail(
                            new ResponseTooLarge({ url, limitBytes: maxBytes })
                        )
                    }
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
        (reader) =>
            Effect.sync(() => {
                reader.releaseLock()
            })
    )
}
