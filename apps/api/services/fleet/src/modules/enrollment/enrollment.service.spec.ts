import { Cause, Effect, Exit } from 'effect'
import { describe, expect, it, vi } from 'vitest'

import { provideTo } from '@deployer/effect-core'

import {
    FleetConfig,
    JoinTokenVoucher,
    NodeRegistry,
    SwarmGrants,
    type FleetConfigShape,
    type JoinTokenVoucherShape,
    type NodeRegistryShape,
    type SwarmGrantsShape,
} from './enrollment.ports'
import { Enrollment, FleetNotSetUp, JoinTokenInvalid } from './enrollment.service'

const grant = {
    managerToken: null,
    workerToken: 'w',
    controlPlaneAddrs: ['10.0.0.1:2377'],
    role: 'worker' as const,
    reason: 'capacity',
}

const ring = {
    generation: 2,
    value: 'fleet-platform-secret',
    previous: [{ generation: 1, value: 'older' }],
}

type World = {
    voucher: JoinTokenVoucherShape
    grants: SwarmGrantsShape
    config: FleetConfigShape
    registry: NodeRegistryShape
}

/** The service with every collaborator replaced, and the spies a case asserts on. */
function enrollmentOver(over: Partial<World> = {}) {
    const check = vi.fn((_token: string) => Effect.succeed<boolean | null>(true))
    const grantFor = vi.fn((_policy: unknown) => Effect.succeed<typeof grant | null>(grant))
    const register = vi.fn((input: { nodeId: string }) =>
        Effect.succeed({ nodeId: input.nodeId, enrolledAt: '2026-10-29T00:00:00.000Z' })
    )
    const world: World = {
        voucher: { check },
        grants: { grantFor },
        config: {
            databaseUrl: () => Effect.succeed<string | null>('postgres://db/deployer'),
            platformSecretRing: () => Effect.succeed<typeof ring | null>(ring),
        },
        registry: { register },
        ...over,
    }
    const service = provideTo(
        Enrollment.live,
        (effect) =>
            effect.pipe(
                Effect.provideService(JoinTokenVoucher, world.voucher),
                Effect.provideService(SwarmGrants, world.grants),
                Effect.provideService(FleetConfig, world.config),
                Effect.provideService(NodeRegistry, world.registry)
            ) as Effect.Effect<unknown>
    )
    return { service, check, grantFor, register }
}

const enrollInput = {
    token: 't',
    nodeId: 'node-b',
    serverUrl: 'https://b.example.test',
}

const failureOf = async (effect: Effect.Effect<unknown, unknown>) => {
    const exit = await Effect.runPromiseExit(effect)
    if (Exit.isSuccess(exit)) throw new Error('expected a failure')
    return Cause.squash(exit.cause)
}

describe('Enrollment', () => {
    it('describes the fleet to a holder of a valid token', async () => {
        const { service, check } = enrollmentOver()

        const described = await Effect.runPromise(service.describe('t'))

        expect(described).toMatchObject({ meshNetwork: null })
        expect(described.version).not.toBe('')
        expect(check).toHaveBeenCalledWith('t')
    })

    it('enrolls a node: registers it and answers the swarm role the fleet decides', async () => {
        const { service, register, grantFor } = enrollmentOver()

        const result = await Effect.runPromise(
            service.enroll({ ...enrollInput, requestedSwarmPolicy: 'auto' })
        )

        expect(register).toHaveBeenCalledWith({
            nodeId: 'node-b',
            serverUrl: 'https://b.example.test',
            displayName: null,
        })
        expect(grantFor).toHaveBeenCalledWith('auto')
        expect(result).toEqual({
            nodeId: 'node-b',
            enrolledAt: '2026-10-29T00:00:00.000Z',
            databaseUrl: 'postgres://db/deployer',
            platformSecret: 'fleet-platform-secret',
            platformSecretGeneration: 2,
            platformSecretPrevious: [{ generation: 1, value: 'older' }],
            swarmGrant: grant,
            meshJoinToken: 't',
        })
    })

    it('refuses a token its agent does not vouch for, and registers nothing', async () => {
        const { service, register } = enrollmentOver({
            voucher: { check: () => Effect.succeed(false) },
        })

        expect(await failureOf(service.enroll(enrollInput))).toBeInstanceOf(JoinTokenInvalid)
        expect(await failureOf(service.describe('t'))).toBeInstanceOf(JoinTokenInvalid)
        expect(register).not.toHaveBeenCalled()
    })

    it('enrolls no one when it has no agent to vouch for the token', async () => {
        const { service } = enrollmentOver({ voucher: { check: () => Effect.succeed(null) } })

        expect(await failureOf(service.enroll(enrollInput))).toBeInstanceOf(JoinTokenInvalid)
    })

    it('refuses to enroll before it has a platform secret to hand over, and registers nothing', async () => {
        const { service, register } = enrollmentOver({
            config: {
                databaseUrl: () => Effect.succeed('postgres://db/deployer'),
                platformSecretRing: () => Effect.succeed(null),
            },
        })

        const error = await failureOf(service.enroll(enrollInput))

        expect(error).toBeInstanceOf(FleetNotSetUp)
        expect((error as FleetNotSetUp).publicMessage()).toContain('platform secret')
        expect(register).not.toHaveBeenCalled()
    })

    it('refuses to enroll before it has a database to hand over, and registers nothing', async () => {
        const { service, register } = enrollmentOver({
            config: {
                databaseUrl: () => Effect.succeed(null),
                platformSecretRing: () => Effect.succeed(ring),
            },
        })

        const error = await failureOf(service.enroll(enrollInput))

        expect(error).toBeInstanceOf(FleetNotSetUp)
        expect((error as FleetNotSetUp).publicMessage()).toContain('database')
        expect(register).not.toHaveBeenCalled()
    })

    it('hands the agent join token back to the joiner it admitted with it', async () => {
        const { service } = enrollmentOver()

        expect((await Effect.runPromise(service.enroll(enrollInput))).meshJoinToken).toBe('t')
    })

    it("lets a collaborator's own failure through untouched, instead of turning it into a refusal", async () => {
        const boom = new Error('registry down')
        const { service } = enrollmentOver({ registry: { register: () => Effect.fail(boom) } })

        expect(await failureOf(service.enroll(enrollInput))).toBe(boom)
    })
})
