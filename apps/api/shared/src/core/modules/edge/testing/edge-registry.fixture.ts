/**
 * A real registry with the built-in `direct` provider and a stand-in tunnel
 * provider, for specs that need edge decisions without a provider account.
 */

import { Effect } from 'effect'

import type {
    EdgeProviderDescriptor,
    EdgeStatus,
    PublicJoinPath,
} from '@deployer/contracts-entities/entities/ingress/index'

import {
    makeEdgeProviderRegistry,
    type EdgeProviderRegistryShape,
} from '../edge-provider.registry'
import { DirectEdgeProvider } from '../providers/direct.edge-provider'

import type {
    EdgeConnectorSpec,
    EdgeContext,
    EdgeDnsRecord,
    EdgeIngressPlan,
    EdgeProvider,
} from '../edge-provider'

export const TEST_TUNNEL_ID = 'test-tunnel'

export const testTunnelDescriptor: EdgeProviderDescriptor = {
    id: TEST_TUNNEL_ID,
    label: 'Test Tunnel',
    kind: 'tunnel',
    summary: '',
    description: '',
    opensInboundPorts: false,
    usesProviderAccount: true,
    servesHttps: true,
    options: [
        {
            type: 'dns-account',
            key: 'account',
            label: 'Account',
            description: null,
            required: true,
            providerType: 'test',
            requiredFeature: null,
        },
    ],
}

export class TestTunnelEdgeProvider implements EdgeProvider {
    readonly descriptor = testTunnelDescriptor
    provisioned = true
    provisionCalls = 0
    teardownCalls = 0

    provision(_ctx: EdgeContext): Effect.Effect<void, unknown> {
        this.provisionCalls += 1
        return Effect.void
    }

    teardown(): Effect.Effect<void, unknown> {
        this.teardownCalls += 1
        return Effect.void
    }

    ingress(): EdgeIngressPlan {
        return { publishedPorts: [], tls: 'edge' }
    }

    connector(): Effect.Effect<EdgeConnectorSpec | null, unknown> {
        return Effect.succeed(
            this.provisioned
                ? {
                      image: 'tunnel:1',
                      env: ['TOKEN=t'],
                      command: ['tunnel'],
                      args: ['run'],
                      replicas: 2,
                  }
                : null
        )
    }

    dnsRecords(): Effect.Effect<EdgeDnsRecord[], unknown> {
        return Effect.succeed([])
    }

    status(): Effect.Effect<EdgeStatus, unknown> {
        return Effect.succeed({
            provisioned: this.provisioned,
            health: 'healthy',
            detail: null,
            facts: [],
            resources: [],
        })
    }

    joinPath(_ctx: unknown, status: EdgeStatus): PublicJoinPath {
        return {
            via: 'Test Tunnel',
            available: status.provisioned,
            target: 'https://api.x',
            hostHeader: null,
            sources: 1,
            detail: '',
        }
    }
}

export function testEdgeRegistry(): {
    registry: EdgeProviderRegistryShape
    tunnel: TestTunnelEdgeProvider
} {
    const registry = makeEdgeProviderRegistry()
    Effect.runSync(registry.register(DirectEdgeProvider.live))
    const tunnel = new TestTunnelEdgeProvider()
    Effect.runSync(registry.register(tunnel))
    return { registry, tunnel }
}
