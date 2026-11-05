import { PassThrough } from 'node:stream'

import { Cause, Effect, Exit, Stream } from 'effect'
import { describe, expect, it, vi } from 'vitest'

import {
    DockerConflict,
    DockerNotFound,
    DockerUnavailable,
} from '../errors/errors'

import { makeDockerEngine } from './docker-engine'

async function run<A, E>(effect: Effect.Effect<A, E>): Promise<A> {
    const exit = await Effect.runPromiseExit(effect)
    if (Exit.isSuccess(exit)) return exit.value
    throw Cause.squash(exit.cause)
}

const statusError = (statusCode: number, message: string) =>
    Object.assign(new Error(message), { statusCode })

describe('engine.events.stream', () => {
    it('decodes newline-delimited events, skips garbage, and ends with the connection', async () => {
        const source = new PassThrough()
        const getEvents = vi.fn().mockResolvedValue(source)
        const engine = makeDockerEngine({ getEvents } as never)

        const collected = run(
            Stream.runCollect(
                engine.events.stream({ filters: { type: ['container'] } })
            )
        )
        source.write('{"Type":"container","Action":"start"}\n{"Type":"net')
        source.write('work","Action":"connect"}\nnot json\n')
        source.end()

        const events = Array.from(await collected)
        expect(events.map((event) => event.Type)).toEqual([
            'container',
            'network',
        ])
        expect(getEvents).toHaveBeenCalledWith(
            expect.objectContaining({ filters: { type: ['container'] } })
        )
    })

    it('destroys the connection when the consumer stops early', async () => {
        const source = new PassThrough()
        const engine = makeDockerEngine({
            getEvents: vi.fn().mockResolvedValue(source),
        } as never)

        const first = run(Stream.runHead(engine.events.stream()))
        source.write('{"Type":"container"}\n')
        await first

        expect(source.destroyed).toBe(true)
    })

    it('fails with DockerUnavailable when the engine refuses the subscription', async () => {
        const engine = makeDockerEngine({
            getEvents: vi.fn().mockRejectedValue(new Error('daemon down')),
        } as never)
        await expect(
            run(Stream.runCollect(engine.events.stream()))
        ).rejects.toBeInstanceOf(DockerUnavailable)
    })
})

describe('engine.networks.attachContainer', () => {
    const engineWith = (connect: () => Promise<unknown>) =>
        makeDockerEngine({ getNetwork: vi.fn(() => ({ connect })) } as never)

    it('passes the aliases to the endpoint config', async () => {
        const connect = vi.fn().mockResolvedValue(undefined)
        await run(
            engineWith(connect).networks.attachContainer('overlay', 'c1', [
                'web',
                'web-dev',
            ])
        )
        expect(connect).toHaveBeenCalledWith(
            expect.objectContaining({
                Container: 'c1',
                EndpointConfig: { Aliases: ['web', 'web-dev'] },
            })
        )
    })

    it.each([
        [403, 'endpoint already exists'],
        [409, 'c1 is already attached to network overlay'],
    ])(
        'maps an already-attached answer (%s) to DockerConflict',
        async (status, message) => {
            const engine = engineWith(() =>
                Promise.reject(statusError(status, message))
            )
            await expect(
                run(engine.networks.attachContainer('overlay', 'c1'))
            ).rejects.toBeInstanceOf(DockerConflict)
        }
    )

    it('maps a missing container to DockerNotFound and anything else to DockerUnavailable', async () => {
        await expect(
            run(
                engineWith(() =>
                    Promise.reject(statusError(404, 'no such container'))
                ).networks.attachContainer('overlay', 'c1')
            )
        ).rejects.toBeInstanceOf(DockerNotFound)
        await expect(
            run(
                engineWith(() =>
                    Promise.reject(new Error('vxlan: file exists'))
                ).networks.attachContainer('overlay', 'c1')
            )
        ).rejects.toBeInstanceOf(DockerUnavailable)
    })

    it('detaches best effort', async () => {
        const disconnect = vi
            .fn()
            .mockRejectedValue(statusError(404, 'not attached'))
        const engine = makeDockerEngine({
            getNetwork: vi.fn(() => ({ disconnect })),
        } as never)
        await run(engine.networks.detachContainer('overlay', 'c1'))
        expect(disconnect).toHaveBeenCalledWith(
            expect.objectContaining({ Container: 'c1', Force: true })
        )
    })
})

describe('engine.containers.wait / top / removeIfExists', () => {
    const containerEngine = (container: Record<string, unknown>) =>
        makeDockerEngine({ getContainer: vi.fn(() => container) } as never)

    it('reads the exit code from either shape and defaults to 1', async () => {
        expect(
            await run(
                containerEngine({
                    wait: vi.fn().mockResolvedValue({ StatusCode: 3 }),
                }).containers.wait('c')
            )
        ).toBe(3)
        expect(
            await run(
                containerEngine({
                    wait: vi.fn().mockResolvedValue(0),
                }).containers.wait('c')
            )
        ).toBe(0)
        expect(
            await run(
                containerEngine({
                    wait: vi.fn().mockResolvedValue({}),
                }).containers.wait('c')
            )
        ).toBe(1)
    })

    it('lists processes with the requested ps arguments', async () => {
        const top = vi
            .fn()
            .mockResolvedValue({ Titles: ['PID'], Processes: [['1']] })
        const result = await run(
            containerEngine({ top }).containers.top('c', 'aux')
        )
        expect(result.Processes).toEqual([['1']])
        expect(top).toHaveBeenCalledWith(
            expect.objectContaining({ ps_args: 'aux' })
        )
    })

    it('removes volumes only when asked', async () => {
        const remove = vi.fn().mockResolvedValue(undefined)
        const engine = containerEngine({ remove })
        await run(engine.containers.removeIfExists('c'))
        await run(
            engine.containers.removeIfExists('c', { removeVolumes: true })
        )
        expect(remove).toHaveBeenNthCalledWith(
            1,
            expect.objectContaining({ force: true, v: false })
        )
        expect(remove).toHaveBeenNthCalledWith(
            2,
            expect.objectContaining({ force: true, v: true })
        )
    })
})

describe('engine.exec.interactive', () => {
    it('returns the duplex stream and falls back to the callback form', async () => {
        const stream = new PassThrough()
        const start = vi.fn(
            (
                _options: unknown,
                callback?: (error: Error | null, stream: unknown) => void
            ) => {
                if (callback === undefined)
                    return Promise.reject(
                        new Error('(HTTP code 101) switching protocols')
                    )
                callback(null, stream)
                return undefined
            }
        )
        const engine = makeDockerEngine({
            getContainer: vi.fn(() => ({
                exec: vi.fn().mockResolvedValue({ start }),
            })),
        } as never)

        const result = await run(
            engine.exec.interactive('c', {
                cmd: ['sh'],
                hijack: true,
                timeoutMs: 1000,
            })
        )
        expect(result).toBe(stream)
        expect(start).toHaveBeenCalledTimes(2)
    })

    it('times out with a DockerUnavailable that says so', async () => {
        const engine = makeDockerEngine({
            getContainer: vi.fn(() => ({
                exec: vi.fn(() => new Promise(() => undefined)),
            })),
        } as never)
        await expect(
            run(
                engine.exec.interactive('c', {
                    cmd: ['sh'],
                    hijack: true,
                    timeoutMs: 20,
                })
            )
        ).rejects.toThrow(/Timed out/)
    })
})

describe('engine.volumes.inspect / images.inspect / info', () => {
    it('names the missing object on a 404', async () => {
        const engine = makeDockerEngine({
            getVolume: vi.fn(() => ({
                inspect: vi
                    .fn()
                    .mockRejectedValue(statusError(404, 'no such volume')),
            })),
            getImage: vi.fn(() => ({
                inspect: vi
                    .fn()
                    .mockRejectedValue(statusError(404, 'no such image')),
            })),
        } as never)
        await expect(
            run(engine.volumes.inspect('data'))
        ).rejects.toBeInstanceOf(DockerNotFound)
        await expect(
            run(engine.images.inspect('img:1'))
        ).rejects.toBeInstanceOf(DockerNotFound)
    })

    it('reads the daemon info', async () => {
        const engine = makeDockerEngine({
            info: vi.fn().mockResolvedValue({ ID: 'daemon-1' }),
        } as never)
        expect((await run(engine.info())).ID).toBe('daemon-1')
    })
})
