import { afterEach, describe, expect, it, vi } from 'vitest'

import { CommandFactory } from 'nest-commander'

import { cliOptions, run } from './cli-runtime'

vi.mock('nest-commander', () => ({
    CommandFactory: { run: vi.fn().mockResolvedValue(undefined) },
}))

const runMock = vi.mocked(CommandFactory.run)

afterEach(() => {
    vi.restoreAllMocks()
    runMock.mockClear()
})

describe('cliOptions', () => {
    it('names the CLI and stays quiet, so the builder output is the UX', () => {
        const options = cliOptions()
        expect(options.cliName).toBe('pkg-build')
        expect(options.logger).toBe(false)
    })

    it('treats commander help as success rather than an error', () => {
        const exit = vi.spyOn(process, 'exit').mockImplementation((() => {
            throw new Error('exit')
        }) as never)
        const error = Object.assign(new Error('help'), {
            code: 'commander.helpDisplayed',
        })

        expect(() => cliOptions().errorHandler?.(error)).toThrow('exit')
        expect(exit).toHaveBeenCalledWith(0)
    })
})

describe('run', () => {
    /**
     * `CommandFactory` reads `process.argv` directly, so the arguments must be
     * installed before it is called. If they are not, commander parses the test
     * runner's own argv and every flag silently goes missing.
     */
    it('installs the arguments where commander reads them', async () => {
        vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never)
        const module = { module: class {} }

        await run(module, ['--types', '--watch'])

        expect(process.argv.slice(2)).toEqual(['--types', '--watch'])
        expect(runMock).toHaveBeenCalledWith(
            module,
            expect.objectContaining({ cliName: 'pkg-build' })
        )
    })
})
