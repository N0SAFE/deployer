import { Context, Effect } from 'effect'
import { describe, expect, it } from 'vitest'

import { serviceOver } from './service-over'

class Greeting extends Context.Service<Greeting, { readonly word: string }>()(
    'test/Greeting'
) {}

const make = (greeting: { readonly word: string }) => ({
    greet: (name: string) => Effect.succeed(`${greeting.word} ${name}`),
    fail: () => Effect.fail('nope' as const),
})

describe('serviceOver', () => {
    const service = serviceOver(Greeting, make)

    it('resolves the collaborator from the context on each call', async () => {
        const run = (word: string) =>
            Effect.runPromise(
                service
                    .greet('ada')
                    .pipe(Effect.provideService(Greeting, { word }))
            )

        expect(await run('hello')).toBe('hello ada')
        expect(await run('hi')).toBe('hi ada')
    })

    it("keeps the method's own failure type", async () => {
        const exit = await Effect.runPromiseExit(
            service.fail().pipe(Effect.provideService(Greeting, { word: 'x' }))
        )
        expect(exit._tag).toBe('Failure')
    })

    it('is not a thenable: awaiting it (Nest awaits what a provider factory returns) resolves to the service itself', async () => {
        const service = serviceOver(Effect.succeed({ word: 'hi' }), make)

        expect((service as unknown as { then?: unknown }).then).toBeUndefined()
        await expect(Promise.resolve(service)).resolves.toBe(service)
    })
})
