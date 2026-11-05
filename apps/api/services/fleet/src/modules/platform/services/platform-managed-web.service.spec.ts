import { Cause, Effect, Exit } from 'effect'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { provideTo } from '@deployer/effect-core'
import { ServiceUnavailableError } from '@deployer/errors'

import {
    CloudflareAppService,
    type CloudflareAppServiceShape,
} from '@/modules/providers/dns/cloudflare/services/cloudflare-app.service'
import {
    CloudflareTunnelService,
    type CloudflareTunnelServiceShape,
} from '@/modules/providers/dns/cloudflare/services/cloudflare-tunnel.service'

import { FleetInvalid } from '../../../core/fleet.errors'
import {
    PlatformConfigPort,
    PlatformEnvPort,
    PlatformHostnamesPort,
    PlatformRefresherPort,
    SupervisorsPort,
} from '../platform.ports'

import { PlatformManagedWebService } from './platform-managed-web.service'

/** Run an Effect and reject with the ORIGINAL failure. */
async function run<A, E>(effect: Effect.Effect<A, E>): Promise<A> {
    const exit = await Effect.runPromiseExit(effect)
    if (Exit.isSuccess(exit)) return exit.value
    throw Cause.squash(exit.cause)
}

describe('PlatformManagedWebService', () => {
    type Fn = ReturnType<typeof vi.fn>
    let platformConfig: Record<
        | 'isManagedWebAppEnabled'
        | 'setManagedWebAppEnabled'
        | 'getManagedWebOrigin'
        | 'setManagedWebOrigin'
        | 'getManagedWebTunnel'
        | 'setManagedWebTunnel'
        | 'clearManagedWebTunnel',
        Fn
    >
    let tunnel: Record<'createTunnel' | 'configureIngress' | 'deleteTunnel', Fn>
    let apps: { listTunnelCapableApps: ReturnType<typeof vi.fn> }
    let refresher: { refresh: ReturnType<typeof vi.fn> }
    let supervisor: {
        id: string
        getStateSnapshot: unknown
        getHealth: unknown
        ensureDesiredState: unknown
    }
    const ensured = vi.fn()
    let service: ReturnType<
        typeof provideTo<typeof PlatformManagedWebService.live>
    >
    let enabled: boolean

    beforeEach(() => {
        enabled = false
        ensured.mockClear()
        delete process.env.CLOUDFLARE_WEB_TUNNEL_PROVIDER_ID
        platformConfig = {
            isManagedWebAppEnabled: vi.fn(() => Effect.succeed(enabled)),
            setManagedWebAppEnabled: vi.fn((value: boolean) => {
                enabled = value
                return Effect.void
            }),
            getManagedWebOrigin: vi.fn(() => Effect.succeed(null)),
            setManagedWebOrigin: vi.fn(() => Effect.void),
            getManagedWebTunnel: vi.fn(() => Effect.succeed(null)),
            setManagedWebTunnel: vi.fn(() => Effect.void),
            clearManagedWebTunnel: vi.fn(() => Effect.void),
        }
        tunnel = {
            createTunnel: vi.fn(() =>
                Effect.succeed({
                    hostname: 'web.example.com',
                    tunnel: { id: 't1' },
                })
            ),
            configureIngress: vi.fn(() => Effect.void),
            deleteTunnel: vi.fn(() => Effect.void),
        }
        apps = {
            listTunnelCapableApps: vi.fn(() =>
                Effect.succeed([{ id: 'cf-1' }])
            ),
        }
        refresher = { refresh: vi.fn() }
        supervisor = {
            id: 'managed-web',
            getStateSnapshot: Effect.succeed({ state: 'running' }),
            getHealth: Effect.succeed({ healthy: true, detail: 'ok' }),
            ensureDesiredState: Effect.sync(() => {
                ensured()
            }),
        }
        // The fakes need nothing from the context beyond what is provided here, so the leftover
        // requirements of the Cloudflare services are discharged.
        service = provideTo(
            PlatformManagedWebService.live,
            (effect) =>
                effect.pipe(
                    Effect.provideService(PlatformEnvPort, {
                        get: vi.fn(() => false),
                    } as never),
                    Effect.provideService(PlatformHostnamesPort, {
                        webHostname: () => 'web.deployer.localhost',
                    } as never),
                    Effect.provideService(
                        PlatformConfigPort,
                        platformConfig as never
                    ),
                    Effect.provideService(SupervisorsPort, {
                        list: () => [supervisor],
                    } as never),
                    Effect.provideService(
                        CloudflareTunnelService,
                        tunnel as unknown as CloudflareTunnelServiceShape
                    ),
                    Effect.provideService(
                        CloudflareAppService,
                        apps as unknown as CloudflareAppServiceShape
                    ),
                    Effect.provideService(
                        PlatformRefresherPort,
                        refresher as never
                    )
                ) as Effect.Effect<unknown>
        )
    })

    // `getIdentifier()` is read at module load, so rebind the fake supervisor to whatever it returns.
    beforeEach(async () => {
        const { PLATFORM_MANAGED_WEB_SUPERVISOR_ID } =
            await import('@deployer/platform-supervisors')
        supervisor.id = PLATFORM_MANAGED_WEB_SUPERVISOR_ID
    })

    it('reports the console state from the config, the hostname and the supervisor', async () => {
        const state = await run(service.state())
        expect(state).toMatchObject({
            enabled: false,
            external: false,
            webHostname: 'web.deployer.localhost',
            supervisorState: 'running',
            healthy: true,
        })
    })

    it('toggle flips the flag, converges (Traefik + supervisor), and returns the new state', async () => {
        const state = await run(service.toggle())
        expect(platformConfig.setManagedWebAppEnabled).toHaveBeenCalledWith(
            true
        )
        expect(refresher.refresh).toHaveBeenCalledOnce()
        expect(ensured).toHaveBeenCalledOnce()
        expect(state.enabled).toBe(true)
    })

    describe('enableTunnel', () => {
        it('creates the tunnel, points its ingress at Traefik, persists it and converges', async () => {
            await run(service.enableTunnel('web.example.com'))
            expect(tunnel.createTunnel).toHaveBeenCalledWith('cf-1', {
                name: 'deployer-web-web-example-com',
                hostname: 'web.example.com',
            })
            expect(tunnel.configureIngress).toHaveBeenCalledOnce()
            expect(platformConfig.setManagedWebTunnel).toHaveBeenCalledWith({
                tunnelId: 't1',
                hostname: 'web.example.com',
                providerId: 'cf-1',
            })
            expect(ensured).toHaveBeenCalled()
        })

        it('rolls the tunnel back and refuses when no zone owns the hostname', async () => {
            tunnel.createTunnel.mockReturnValue(
                Effect.succeed({ hostname: null, tunnel: { id: 't2' } })
            )
            await expect(
                run(service.enableTunnel('nowhere.test'))
            ).rejects.toBeInstanceOf(FleetInvalid)
            expect(tunnel.deleteTunnel).toHaveBeenCalledWith(
                'cf-1',
                't2',
                undefined
            )
            expect(platformConfig.setManagedWebTunnel).not.toHaveBeenCalled()
        })

        it('rolls the whole tunnel back, and reports unavailable, when the ingress cannot be configured', async () => {
            tunnel.configureIngress.mockReturnValue(
                Effect.fail(new Error('cloudflare said no'))
            )
            const error = await run(
                service.enableTunnel('web.example.com')
            ).catch((e: unknown) => e)
            expect(error).toBeInstanceOf(ServiceUnavailableError)
            expect((error as Error).message).toContain('cloudflare said no')
            expect(tunnel.deleteTunnel).toHaveBeenCalledWith('cf-1', 't1', {
                hostname: 'web.example.com',
            })
            expect(platformConfig.setManagedWebTunnel).not.toHaveBeenCalled()
        })

        it('still reports the original failure when the rollback itself fails', async () => {
            tunnel.configureIngress.mockReturnValue(
                Effect.fail(new Error('ingress down'))
            )
            tunnel.deleteTunnel.mockReturnValue(
                Effect.fail(new Error('delete down'))
            )
            const error = await run(
                service.enableTunnel('web.example.com')
            ).catch((e: unknown) => e)
            expect(error).toBeInstanceOf(ServiceUnavailableError)
            expect((error as Error).message).toContain('ingress down')
        })

        it('asks for a Cloudflare app first when none can create tunnels', async () => {
            apps.listTunnelCapableApps.mockReturnValue(Effect.succeed([]))
            await expect(
                run(service.enableTunnel('web.example.com'))
            ).rejects.toBeInstanceOf(FleetInvalid)
            expect(tunnel.createTunnel).not.toHaveBeenCalled()
        })
    })

    describe('disableTunnel', () => {
        it('does nothing when there is no tunnel', async () => {
            await run(service.disableTunnel())
            expect(tunnel.deleteTunnel).not.toHaveBeenCalled()
            expect(platformConfig.clearManagedWebTunnel).not.toHaveBeenCalled()
        })

        it('clears the tunnel and converges even when removing it at the provider fails', async () => {
            platformConfig.getManagedWebTunnel.mockReturnValue(
                Effect.succeed({
                    tunnelId: 't1',
                    hostname: 'web.example.com',
                    providerId: 'cf-1',
                })
            )
            tunnel.deleteTunnel.mockReturnValue(
                Effect.fail(new Error('provider down'))
            )
            await run(service.disableTunnel())
            expect(platformConfig.clearManagedWebTunnel).toHaveBeenCalledOnce()
            expect(ensured).toHaveBeenCalled()
        })
    })
})
