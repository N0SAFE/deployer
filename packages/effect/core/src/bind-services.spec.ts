import { Context, Effect } from 'effect'
import { describe, expect, it } from 'vitest'

import { bindServices } from './bind-services'

class Greeting extends Context.Service<Greeting, { readonly text: string }>()(
    'test/Greeting'
) {}

class Impl {
    label = 'plain'
    greet(name: string) {
        return Effect.gen(function* () {
            const { text } = yield* Greeting
            return `${text}, ${name}`
        })
    }
    twice(name: string) {
        return Effect.all([this.greet(name), this.greet(name)]).pipe(
            Effect.map(([first, second]) => `${first} / ${second}`)
        )
    }
    sync(n: number) {
        return n + 1
    }
}

const bound = bindServices(
    new Impl(),
    Context.make(Greeting, { text: 'hello' })
)

describe('bindServices', () => {
    it("discharges the dependency from every method's requirements", async () => {
        // Type-level: `R` is `never`, so this runs without providing Greeting.
        await expect(Effect.runPromise(bound.greet('ada'))).resolves.toBe(
            'hello, ada'
        )
    })

    it('keeps `this` working, so methods can call each other', async () => {
        await expect(Effect.runPromise(bound.twice('ada'))).resolves.toBe(
            'hello, ada / hello, ada'
        )
    })

    it('passes non-Effect members through', () => {
        expect(bound.sync(1)).toBe(2)
        expect(bound.label).toBe('plain')
    })
})
