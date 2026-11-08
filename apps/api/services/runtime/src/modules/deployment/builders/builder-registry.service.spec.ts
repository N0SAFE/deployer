import { Effect } from 'effect'
import { describe, expect, it, vi } from 'vitest'

import { RuntimeInvalid } from '../../../core/runtime.errors'

import { makeBuilderRegistry } from './builder-registry.service'
import { makeBuildpackFamilyBuilderStrategy } from './strategies/buildpack-family-builder.strategy'
import { makeDockerComposeBuilderStrategy } from './strategies/docker-compose-builder.strategy'
import { makeDockerfileBuilderStrategy } from './strategies/dockerfile-builder.strategy'

import type { BuilderStrategy } from './base/builder-strategy.interface'

const strategy = (builderType: string, available = true): BuilderStrategy => ({
    builderType,
    isAvailable: () => available,
    unavailableReason: () =>
        available ? '' : `${builderType} is not installed`,
    build: vi.fn(() => Effect.succeed({ image: null })),
})

describe('BuilderRegistry', () => {
    it('resolves a registered, available builder case-insensitively', async () => {
        const registry = makeBuilderRegistry([strategy('dockerfile')])
        expect(
            (await Effect.runPromise(registry.resolve('Dockerfile')))
                .builderType
        ).toBe('dockerfile')
        expect(
            await Effect.runPromise(registry.isSupported('DOCKERFILE'))
        ).toBe(true)
    })

    it('rejects an unknown builder naming the supported ones', async () => {
        const registry = makeBuilderRegistry([
            strategy('dockerfile'),
            strategy('docker_compose'),
        ])
        const failure = await Effect.runPromise(
            Effect.flip(registry.resolve('nope'))
        )
        expect(failure).toBeInstanceOf(RuntimeInvalid)
        expect(failure.reason).toMatch(/Supported: dockerfile, docker_compose/)
        expect(await Effect.runPromise(registry.isSupported('nope'))).toBe(
            false
        )
    })

    it("separates 'registered but unavailable' from 'unknown', with the reason", async () => {
        const registry = makeBuilderRegistry([strategy('remote', false)])
        const failure = await Effect.runPromise(
            Effect.flip(registry.resolve('remote'))
        )
        expect(failure).toBeInstanceOf(RuntimeInvalid)
        expect(failure.reason).toMatch(
            /registered but unavailable: remote is not installed/
        )
        expect(await Effect.runPromise(registry.isSupported('remote'))).toBe(
            false
        )
        expect(await Effect.runPromise(registry.supportedBuilders())).toEqual([
            {
                builderType: 'remote',
                available: false,
                reason: 'remote is not installed',
            },
        ])
    })

    it('the later strategy wins when a type is registered twice', async () => {
        const first = strategy('dockerfile')
        const second = strategy('dockerfile')
        expect(
            await Effect.runPromise(
                makeBuilderRegistry([first, second]).resolve('dockerfile')
            )
        ).toBe(second)
    })

    it('starts cleanly, reporting a duplicate and the available builders', async () => {
        await expect(
            Effect.runPromise(
                makeBuilderRegistry([
                    strategy('dockerfile'),
                    strategy('dockerfile'),
                ]).onModuleInit()
            )
        ).resolves.toBeUndefined()
    })
})

/**
 * The strategies reach Docker through `getEngine().build`; the specs keep their `buildImage` /
 * `buildCompose` mocks (so the assertions read as before) and expose them as the engine's Effects.
 */
const withEngine = <T extends { buildImage: unknown; buildCompose?: unknown }>(
    mocks: T
): T =>
    Object.assign(mocks, {
        build: {
            image: (...args: unknown[]) =>
                Effect.promise(async () =>
                    (mocks.buildImage as (...a: unknown[]) => unknown)(...args)
                ),
            compose: (...args: unknown[]) =>
                Effect.promise(async () =>
                    (mocks.buildCompose as (...a: unknown[]) => unknown)(
                        ...args
                    )
                ),
        },
    })

describe('builder strategies', () => {
    const docker = () =>
        withEngine({
            buildImage: vi.fn().mockResolvedValue(undefined),
            buildCompose: vi.fn().mockResolvedValue({ projectName: 'p' }),
        })
    const context = {
        buildContextPath: '/ctx',
        deploymentId: '0123456789abcdef',
        serviceId: 's',
        dockerfileName: null,
        imageTag: 'deployer/s:d-x',
    }

    it('dockerfile builds one image, passing the custom Dockerfile when there is one', async () => {
        const d = docker()
        const s = makeDockerfileBuilderStrategy(d as never)
        await expect(Effect.runPromise(s.build(context))).resolves.toEqual({
            image: 'deployer/s:d-x',
        })
        expect(d.buildImage).toHaveBeenCalledWith('/ctx', 'deployer/s:d-x', {})
        await Effect.runPromise(
            s.build({
                ...context,
                dockerfileName: 'Dockerfile.deployer.custom',
            })
        )
        expect(d.buildImage).toHaveBeenLastCalledWith(
            '/ctx',
            'deployer/s:d-x',
            { dockerfileName: 'Dockerfile.deployer.custom' }
        )
    })

    it.each(['nixpacks', 'buildpack', 'railpack'] as const)(
        "%s without custom commands fails with an actionable message, not 'Dockerfile not found'",
        async (kind) => {
            const d = docker()
            const s = makeBuildpackFamilyBuilderStrategy(kind, d as never)
            const failure = await Effect.runPromise(
                Effect.flip(s.build(context))
            )
            expect(failure).toBeInstanceOf(RuntimeInvalid)
            expect(failure).toMatchObject({
                reason: expect.stringMatching(
                    /requires custom build and run commands/
                ),
            })
            expect(d.buildImage).not.toHaveBeenCalled()
        }
    )

    it('a buildpack-family builder with custom commands builds the generated Dockerfile', async () => {
        const d = docker()
        await Effect.runPromise(
            makeBuildpackFamilyBuilderStrategy('nixpacks', d as never).build({
                ...context,
                dockerfileName: 'Dockerfile.deployer.custom',
            })
        )
        expect(d.buildImage).toHaveBeenCalledWith('/ctx', 'deployer/s:d-x', {
            dockerfileName: 'Dockerfile.deployer.custom',
        })
    })

    it('docker_compose refuses custom commands and a missing compose file, and never returns an image', async () => {
        const d = docker()
        const s = makeDockerComposeBuilderStrategy(d as never)
        const combined = await Effect.runPromise(
            Effect.flip(s.build({ ...context, dockerfileName: 'x' }))
        )
        expect(combined).toBeInstanceOf(RuntimeInvalid)
        expect(combined).toMatchObject({
            reason: expect.stringMatching(/cannot be combined/),
        })
        const missing = await Effect.runPromise(Effect.flip(s.build(context)))
        expect(missing).toBeInstanceOf(RuntimeInvalid)
        expect(missing).toMatchObject({
            reason: expect.stringMatching(/requires a compose file/),
        })
        expect(d.buildCompose).not.toHaveBeenCalled()
    })
})
