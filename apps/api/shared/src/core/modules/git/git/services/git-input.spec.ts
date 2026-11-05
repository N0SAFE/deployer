import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Effect } from 'effect'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { BadRequestError } from '@deployer/errors'

import { GitInputInvalid } from '../errors'

import { assertGitRef, assertRepositoryUrl } from './git-input'

const { raw, simpleGit } = vi.hoisted(() => {
    const raw = vi.fn(() => Promise.resolve(''))
    return { raw, simpleGit: vi.fn(() => ({ raw })) }
})

vi.mock('simple-git', () => ({ simpleGit }))

const { makeGitService } = await import('./git.service')

/**
 * DEPLOY-030: branch/commit and repository URL reach a `git` argv. A value starting with `-`
 * becomes an OPTION (`--upload-pack=<program>` runs it), so both are rejected at the module
 * boundary, and the surviving argv carries `--` before the positional arguments.
 */
describe('git input validation', () => {
    let root: string
    let service: ReturnType<typeof makeGitService>

    beforeEach(() => {
        vi.clearAllMocks()
        root = mkdtempSync(join(tmpdir(), 'git-input-'))
        service = makeGitService({ workspaceDir: join(root, 'workspace') })
    })

    afterEach(() => {
        vi.unstubAllEnvs()
        rmSync(root, { recursive: true, force: true })
    })

    const rejection = (run: () => unknown): BadRequestError => {
        try {
            run()
        } catch (error) {
            expect(error).toBeInstanceOf(BadRequestError)
            expect((error as BadRequestError).code).toBe('BAD_REQUEST')
            return error as BadRequestError
        }
        throw new Error('expected a rejection')
    }

    it.each([
        ['--upload-pack=evil', 'option injection'],
        ['-c core.sshCommand=evil', 'option injection with a config override'],
        ['HEAD; rm -rf /', 'shell metacharacters'],
        ['feature/../../etc', 'path traversal'],
        ['feature/x.lock', 'reserved .lock suffix'],
        ['feature/x/', 'trailing slash'],
    ])('rejects the ref %j (%s)', (ref) => {
        const error = rejection(() => assertGitRef(ref, 'branch'))
        expect(error.message).toContain('branch')
        expect(error.context).toEqual({ field: 'branch' })
    })

    it.each([
        'feature/x',
        'v1.2.3',
        'release-1.0',
        'main',
        'f8fa83f',
        'abc1234def',
    ])('accepts the ref %j', (ref) => {
        expect(assertGitRef(ref, 'branch')).toBe(ref)
    })

    it.each([
        ['http://github.com/org/repo.git', 'plaintext scheme'],
        ['https://github.com/org/repo.git ', 'trailing whitespace'],
        ['https://github.com/ org/repo.git', 'embedded whitespace'],
        ['-https://github.com/org/repo.git', 'leading dash'],
        ['ext::sh -c touch% /tmp/pwned', 'transport helper'],
        ['file:///etc/passwd', 'local file'],
    ])('rejects the repository URL %j (%s)', (url) => {
        const error = rejection(() => assertRepositoryUrl(url))
        expect(error.message).toContain('repository URL')
        // The URL is never echoed: a remote may legitimately carry credentials.
        expect(error.message).not.toContain(url.trim())
    })

    it.each([
        'https://github.com/org/repo.git',
        'https://gitlab.example.com:8443/group/sub/repo',
        'git@github.com:org/repo.git',
        'ssh://git@github.com:22/org/repo.git',
    ])('accepts the repository URL %j', (url) => {
        expect(assertRepositoryUrl(url)).toBe(url)
    })

    it('rejects before spawning git and passes `--` before the positionals', async () => {
        await Effect.runPromise(
            service.cloneRepository({
                url: 'https://github.com/org/repo.git',
                branch: 'feature/x',
                commit: 'v1.2.3',
                deploymentId: 'd1',
            })
        )
        expect(raw.mock.calls[0]).toEqual([
            [
                'clone',
                '--depth',
                '1',
                '--branch',
                'feature/x',
                '--',
                'https://github.com/org/repo.git',
                expect.stringContaining('deployment-d1'),
            ],
        ])
        expect(raw.mock.calls[1]).toEqual([
            ['checkout', '--detach', 'v1.2.3', '--'],
        ])

        raw.mockClear()
        await expect(
            Effect.runPromise(
                Effect.flip(
                    service.cloneRepository({
                        url: 'https://github.com/org/repo.git',
                        branch: '--upload-pack=evil',
                        deploymentId: 'd2',
                    })
                )
            )
        ).resolves.toBeInstanceOf(GitInputInvalid)
        expect(raw).not.toHaveBeenCalled()
    })

    it('reports an unsupported URL as "not reachable" from validateRepository', async () => {
        await expect(
            Effect.runPromise(
                service.validateRepository('http://github.com/org/repo.git')
            )
        ).resolves.toBe(false)
        expect(raw).not.toHaveBeenCalled()

        await expect(
            Effect.runPromise(
                service.validateRepository('https://github.com/org/repo.git')
            )
        ).resolves.toBe(true)
        expect(raw.mock.calls[0]).toEqual([
            ['ls-remote', '--', 'https://github.com/org/repo.git'],
        ])
    })
})
