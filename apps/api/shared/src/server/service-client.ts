import { Module } from '@nestjs/common'
import { createORPCClient } from '@orpc/client'
import { OpenAPILink } from '@orpc/openapi/fetch'
import { Context } from 'effect'

import { apiServiceUrl, type ApiServiceName } from '@deployer/env'
import { nodeAgentLink, serviceLink } from '@deployer/mesh-client'
import { declareModule } from '@deployer/nest-effect'

import {
    ApprovalGuard,
    makeApprovalGuard,
} from '../core/modules/approval/approval.guard'
import { SYSTEM_ACTOR_HEADER } from '../core/modules/auth/system-actor/system-actor'

import type { ContractRouterClient, RouterContract } from '@orpc/contract'

/** The link to this node's agent, when it has one. Lazy: nothing connects until the first call. */
const nodeAgent = nodeAgentLink()

/**
 * Reaching another SERVICE over its contract.
 *
 * ── WHY THIS EXISTS AT ALL ──────────────────────────────────────────────────
 * A service must not import another service's internals: that is what made the monolith a
 * monolith, and it is the coupling the split removes. But a service sometimes genuinely
 * needs a fact another owns — the project domain wants the DNS zones fleet holds, the
 * deployment workflow wants the source checkout fleet resolves. The sanctioned route is the
 * owner's CONTRACT, and this is the client for it.
 *
 * ── THE TRANSPORT ───────────────────────────────────────────────────────────
 * On a node that has an agent, every call goes through it: the agent picks the replica, answers redirects itself and
 * carries the answer back, and the service serves the call over its mesh websocket, which is a persistent RPC link. On a
 * node with no agent the call goes straight to the service's HTTP surface (`OpenAPILink`, because services implement their
 * contracts with `@Implement`, which serves each procedure at the OpenAPI route its contract declares), which is how a node
 * works alone before it is part of anything. The BFF's client makes the same choice for the same reason.
 */
export type ServiceClientShape = {
    /**
     * A client for `name`, typed to the contract the caller passes.
     *
     * Generic in the contract rather than fixed per service: a caller that imports `providersContract` gets inference on
     * that call, while this service never has to know about any contract — the coupling that would otherwise make it a
     * routing table. One client per (service, contract) pair.
     */
    readonly clientFor: <TContract extends RouterContract>(
        name: ApiServiceName,
        contract: TContract
    ) => ContractRouterClient<TContract>
    /**
     * A client that calls `name` AS THE SYSTEM: every request carries `token`, a signed system-actor claim (see
     * `auth/system-actor`), for procedures no user session may reach. Not cached: a claim is short-lived and per event,
     * so a cached link would keep presenting an expired one. Building a link is a handful of allocations.
     */
    readonly systemActorClientFor: <TContract extends RouterContract>(
        name: ApiServiceName,
        contract: TContract,
        token: string
    ) => ContractRouterClient<TContract>
}

/**
 * What it returns are oRPC clients (Promise-based by nature), and building one is synchronous: the shape is plain
 * functions, not Effects.
 */
export function makeServiceClient(): ServiceClientShape {
    /**
     * Keyed by the CONTRACT OBJECT rather than by name: two callers reaching the same service through different
     * sub-contracts must not receive each other's client — a link built for one shape answers the other with a 404 rather
     * than something actionable. A WeakMap makes that identity exact and lets a contract be collected with its client.
     */
    const clients = new WeakMap<object, Map<ApiServiceName, unknown>>()

    return {
        clientFor: (name, contract) => {
            const perContract =
                clients.get(contract) ?? new Map<ApiServiceName, unknown>()
            clients.set(contract, perContract)

            const existing = perContract.get(name)
            if (existing !== undefined)
                return existing as ContractRouterClient<typeof contract>

            const client = createORPCClient<
                ContractRouterClient<typeof contract>
            >(
                nodeAgent === undefined
                    ? new OpenAPILink(contract, { origin: apiServiceUrl(name) })
                    : serviceLink({ agent: nodeAgent, service: name, contract })
            )
            perContract.set(name, client)
            return client
        },

        systemActorClientFor: (name, contract, token) => {
            const headers = { [SYSTEM_ACTOR_HEADER]: token }
            return createORPCClient<ContractRouterClient<typeof contract>>(
                nodeAgent === undefined
                    ? new OpenAPILink(contract, {
                          origin: apiServiceUrl(name),
                          headers,
                      })
                    : serviceLink({
                          agent: nodeAgent,
                          service: name,
                          contract,
                          headers: () => headers,
                      })
            )
        },
    }
}

export class ServiceClient extends Context.Service<
    ServiceClient,
    ServiceClientShape
>()('shared/ServiceClient') {}

/**
 * Provides `ServiceClient`.
 *
 * Global because the dependency is a TRANSPORT, not a domain: a module that needs to reach
 * a peer should import it once rather than thread a provider through every domain module,
 * and there is nothing per-module to configure.
 */
@Module({})
export class ServiceClientModule {
    static forRoot() {
        return declareModule(
            {
                module: ServiceClientModule,
                global: true,
                providers: [
                    {
                        provide: ServiceClient,
                        useFactory: () => makeServiceClient(),
                    },
                    {
                        provide: ApprovalGuard,
                        useFactory: makeApprovalGuard,
                        inject: [ServiceClient],
                    },
                ],
                exports: [ServiceClient, ApprovalGuard],
            },
            // `ServiceClient` is an ordinary Nest class: nothing Effect-shaped crosses this boundary.
            {
                provides: [ApprovalGuard],
                exports: [ApprovalGuard],
                global: true,
            }
        )
    }
}
