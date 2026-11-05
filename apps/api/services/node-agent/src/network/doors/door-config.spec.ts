import { describe, expect, it } from 'vitest'

import {
    type DoorPlan,
    doorContainerSpec,
    planDoors,
    renderDoorNginxConfig,
} from './door-config'
import {
    DOOR_HASH_LABEL,
    DOOR_LABEL,
    LOOPBACK_DOOR_ADDRESS,
    type NodeDoorsSetting,
} from './doors.types'

const setting: NodeDoorsSetting = {
    image: 'nginx:alpine',
    network: 'deployer-platform-overlay',
    namePrefix: 'deployer',
    entryPort: 80,
    upstream: 'deployer-traefik',
    lanes: {
        local: { upstreamPort: 8000 },
        private: { upstreamPort: 8001 },
        lan: null,
    },
    rescue: [
        { host: 'api.deployer.localhost', target: 'deployer-api', port: 3005 },
        {
            host: 'web.deployer.localhost',
            target: 'deployer-managed-web',
            port: 3000,
        },
    ],
}

const withLan: NodeDoorsSetting = {
    ...setting,
    lanes: { ...setting.lanes, lan: { upstreamPort: 8001 } },
}

describe('renderDoorNginxConfig', () => {
    it('resolves the upstream per request and listens on the entry port on every address', () => {
        const config = renderDoorNginxConfig('local', setting)

        expect(config).toContain('resolver 127.0.0.11 valid=10s ipv6=off;')
        expect(config).toContain('listen 80 default_server;')
        // The host-side scope comes from HostIp, never from nginx's own listen.
        expect(config).not.toMatch(/listen 127\.0\.0\.1/)
        expect(config).toContain(
            'set $deployer_upstream deployer-traefik:8000;'
        )
    })

    it('maps the rescue hosts on the local lane and falls back to them', () => {
        const config = renderDoorNginxConfig('local', setting)

        expect(config).toContain('map $host $deployer_rescue_upstream {')
        expect(config).toContain('api.deployer.localhost deployer-api:3005;')
        expect(config).toContain(
            'web.deployer.localhost deployer-managed-web:3000;'
        )
        expect(config).toContain('error_page 502 503 504 = @deployer_rescue;')
    })

    it('gives the private lane its own entrypoint and no rescue hosts', () => {
        const config = renderDoorNginxConfig('private', setting)

        expect(config).toContain(
            'set $deployer_upstream deployer-traefik:8001;'
        )
        expect(config).not.toContain('deployer-api:3005')
    })

    it('refuses to render a disabled lane', () => {
        expect(() => renderDoorNginxConfig('lan', setting)).toThrow(/disabled/)
    })
})

describe('planDoors', () => {
    it('always plans the local lane on loopback', () => {
        const { desired } = planDoors(setting, null, null)

        expect(desired.map((door) => [door.lane, door.bindAddress])).toEqual([
            ['local', LOOPBACK_DOOR_ADDRESS],
        ])
        expect(desired[0]?.name).toBe('deployer-door-local')
    })

    it('adds the private lane only with a mesh address and the LAN lane only with a LAN address', () => {
        expect(
            planDoors(withLan, '100.88.4.2', '192.168.1.10').desired.map(
                (door) => [door.lane, door.bindAddress]
            )
        ).toEqual([
            ['local', '127.0.0.1'],
            ['private', '100.88.4.2'],
            ['lan', '192.168.1.10'],
        ])
    })

    it('never falls back to 0.0.0.0: an unknown address leaves its lane absent', () => {
        const { desired, absent } = planDoors(withLan, null, null)

        expect(desired.map((door) => door.lane)).toEqual(['local'])
        expect(absent).toEqual(['private', 'lan'])
    })

    it('plans no private or LAN door when the lanes are disabled', () => {
        const { absent } = planDoors(
            { ...setting, lanes: { ...setting.lanes, private: null } },
            '100.88.4.2',
            '192.168.1.10'
        )

        expect(absent).toEqual(['private', 'lan'])
    })

    it('hashes what the door was built from, so a changed plan recreates it', () => {
        const [local] = planDoors(setting, null, null).desired
        const [renamed] = planDoors(
            { ...setting, upstream: 'other-traefik' },
            null,
            null
        ).desired

        expect(local?.hash).toMatch(/^[0-9a-f]{16}$/)
        expect(renamed?.hash).not.toBe(local?.hash)
    })
})

describe('doorContainerSpec', () => {
    const plan = (bindAddress: string): DoorPlan => ({
        lane: 'private',
        name: 'deployer-door-private',
        image: setting.image,
        network: setting.network,
        bindAddress,
        port: setting.entryPort,
        nginxConfig: renderDoorNginxConfig('private', setting),
        hash: '0123456789abcdef',
    })

    it('binds the host port to the lane address and sets both labels', () => {
        const spec = doorContainerSpec(plan('100.88.4.2')) as {
            Labels: Record<string, string>
            HostConfig: {
                PortBindings: Record<string, unknown>
                NetworkMode: string
            }
        }

        expect(spec.HostConfig.PortBindings['80/tcp']).toEqual([
            { HostIp: '100.88.4.2', HostPort: '80' },
        ])
        expect(spec.HostConfig.NetworkMode).toBe(setting.network)
        expect(spec.Labels[DOOR_LABEL]).toBe('private')
        expect(spec.Labels[DOOR_HASH_LABEL]).toBe('0123456789abcdef')
    })
})
