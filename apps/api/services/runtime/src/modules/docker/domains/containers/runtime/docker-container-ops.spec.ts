import { Effect } from 'effect'
import { describe, expect, it, vi } from 'vitest'

import { DockerEngine } from '@deployer/docker'

import { DockerContainerOps } from './docker-container-ops'
import { DockerTerminalSessions } from './docker-terminal-sessions'

const engineWith = (overrides: Record<string, unknown>) => overrides as never
const run = <A>(
    effect: Effect.Effect<A, unknown, DockerEngine>,
    engine: unknown
) =>
    Effect.runPromise(
        effect.pipe(Effect.provideService(DockerEngine, engine as never))
    )

describe('DockerContainerOps', () => {
    it('lists a directory through one quoted shell command', async () => {
        const execRun = vi.fn(() =>
            Effect.succeed({
                output: 'total 0\ndrwxr-xr-x 2 root root 4096 Oct 1 10:00 .\n-rw-r--r-- 1 app app 5 Oct 1 10:00 a b.txt\n',
                exitCode: 0,
            })
        )
        const listing = await run(
            new DockerContainerOps.live().listFiles({
                containerId: 'c1',
                path: '/app dir',
            }),
            engineWith({ exec: { run: execRun } })
        )
        expect(execRun).toHaveBeenCalledWith('c1', [
            'sh',
            '-lc',
            "ls -la '/app dir'",
        ])
        expect(listing.entries.map((entry) => entry.path)).toEqual([
            '/app dir/a b.txt',
        ])
    })

    it('writes a file as base64, creating parents when asked, and acknowledges', async () => {
        const execRun = vi.fn(() => Effect.succeed({ output: '', exitCode: 0 }))
        const ack = await run(
            new DockerContainerOps.live().writeFile({
                containerId: 'c1',
                path: '/x/y.txt',
                content: 'hi',
                createParents: true,
            }),
            engineWith({ exec: { run: execRun } })
        )
        expect(ack.ok).toBe(true)
        const script = (
            execRun.mock.calls[0] as unknown as [string, string[]]
        )[1][2]!
        expect(script).toBe(
            `mkdir -p '/x' && printf %s '${Buffer.from('hi').toString('base64')}' | base64 -d > '/x/y.txt'`
        )
    })

    it('renames and deletes with each path quoted', async () => {
        const execRun = vi.fn(() => Effect.succeed({ output: '', exitCode: 0 }))
        const engine = engineWith({ exec: { run: execRun } })
        await run(
            new DockerContainerOps.live().renamePath({
                containerId: 'c1',
                path: '/a',
                nextPath: '/b c',
            }),
            engine
        )
        await run(
            new DockerContainerOps.live().deletePath({
                containerId: 'c1',
                path: '/a',
            }),
            engine
        )
        expect(
            execRun.mock.calls.map(
                (call) => (call as unknown as [string, string[]])[1][2]
            )
        ).toEqual(["mv '/a' '/b c'", "rm -rf '/a'"])
    })

    it('reads the logs the engine returns as entries', async () => {
        const read = vi.fn(() =>
            Effect.succeed('2026-10-01T10:00:00.000Z hello\n')
        )
        const snapshot = await run(
            new DockerContainerOps.live().logsSnapshot({ containerId: 'c1' }),
            engineWith({ logs: { read } })
        )
        expect(read).toHaveBeenCalledWith(
            'c1',
            expect.objectContaining({ tail: 300, timestamps: true })
        )
        expect(snapshot.entries.map((entry) => entry.message)).toEqual([
            'hello',
        ])
    })
})

describe('DockerTerminalSessions', () => {
    it('fails with NotFound for a session that does not exist', async () => {
        await expect(
            Effect.runPromise(
                DockerTerminalSessions.live.events({ sessionId: 'nope' })
            )
        ).rejects.toThrow(/not found/i)
        await expect(
            Effect.runPromise(
                DockerTerminalSessions.live.stream({ sessionId: 'nope' })
            )
        ).rejects.toThrow(/not found/i)
    })

    it('opens a session on the engine in the context and can close it', async () => {
        const exec = {
            run: vi.fn(),
            start: vi.fn(() => Effect.fail(new Error('no tty'))),
            create: vi.fn(),
        }
        const opened = await run(
            DockerTerminalSessions.live.open({
                containerId: 'c1',
                shell: 'sh',
            } as never),
            engineWith({ exec })
        )
        expect(opened).toMatchObject({ containerId: 'c1', shell: 'sh' })
        const closed = await Effect.runPromise(
            DockerTerminalSessions.live.close({ sessionId: opened.sessionId })
        )
        expect(closed.ok).toBe(true)
        await Effect.runPromise(DockerTerminalSessions.live.shutdown)
    })
})
