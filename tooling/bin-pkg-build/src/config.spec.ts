import { describe, expect, it } from 'vitest'

import { build } from './config'

describe('build', () => {
    /**
     * The config file's `export default build({ … })` has to keep handing the
     * declaration back: the variant child and the tests read a config for its
     * data, and a `build()` that returned nothing would break both.
     */
    it('returns the declaration it was given', () => {
        const config = { root: 'src', include: ['components'] }
        expect(build(config)).toBe(config)
    })

    /**
     * The guard is what makes a config safe to import from anywhere. Under the
     * test runner the process entry point is vitest, not a config file, so
     * `build()` must declare and stop — if it started a build here, every import
     * of every config would spawn a bundler.
     */
    it('does not start a build when the entry point is not a config', () => {
        expect(Bun.main.endsWith('pkg-build.config.ts')).toBe(false)
        expect(() => build({ root: 'src' })).not.toThrow()
    })
})
