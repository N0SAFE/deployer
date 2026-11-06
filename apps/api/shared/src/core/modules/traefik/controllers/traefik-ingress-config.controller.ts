/**
 * The endpoint every ingress task polls for its routes (Traefik HTTP provider).
 *
 * Not an oRPC contract: the consumer is Traefik, which expects its own dynamic configuration JSON at a URL. There is no
 * session, so the request is authenticated by the derived ingress token instead. A wrong token is the typed
 * `IngressTokenInvalid` (kind `unauthorized`), answered here as the plain 401 the HTTP provider expects.
 */

import { Controller, Get, Headers, Inject, Res } from '@nestjs/common'
import { ApiOkResponse, ApiUnauthorizedResponse } from '@nestjs/swagger'
import { Effect } from 'effect'

import { domainError } from '@deployer/effect-core'
import { EffectHost, type EffectHostShape } from '@deployer/nest-effect'

import { PlatformSecret, type PlatformSecretShape } from '../../auth/orpc/secrets'
import {
    INGRESS_TOKEN_HEADER,
    ingressTokenMatches,
    requireIngressSecret,
    TRAEFIK_CONFIG_PATH,
} from '../../platform-ingress/services/ingress-provider-token'
import {
    TraefikIngressConfigService,
    type TraefikIngressConfigServiceShape,
} from '../services/traefik-ingress-config.service'

import type { IngressLanesUnavailable } from '../../platform-ingress/platform-ingress.errors'
import type { LaneTraefikConfig } from '../../platform-ingress/services/lane-traefik-config'
import type { Response } from 'express'

/** The ingress token is missing or wrong. */
export class IngressTokenInvalid extends domainError(
    'IngressTokenInvalid',
    'unauthorized'
)() {
    override publicMessage() {
        return 'invalid ingress token'
    }
}

@Controller()
export class TraefikIngressConfigController {
    constructor(
        @Inject(TraefikIngressConfigService)
        private readonly config: TraefikIngressConfigServiceShape,
        @Inject(PlatformSecret) private readonly secrets: PlatformSecretShape,
        @Inject(EffectHost) private readonly host: EffectHostShape
    ) {}

    @Get(TRAEFIK_CONFIG_PATH)
    @ApiOkResponse({
        description:
            "Traefik dynamic configuration, in the HTTP provider's format",
    })
    @ApiUnauthorizedResponse({ description: 'Missing or wrong ingress token' })
    async dynamicConfig(
        @Headers(INGRESS_TOKEN_HEADER.toLowerCase()) token: string | undefined,
        @Res({ passthrough: true }) response: Pick<Response, 'status'>
    ): Promise<LaneTraefikConfig | { error: string }> {
        const { config, secrets } = this
        const program: Effect.Effect<
            LaneTraefikConfig,
            IngressTokenInvalid | IngressLanesUnavailable
        > = Effect.gen(function* () {
            // A node with no platform secret fails loudly: an ingress poll must never be accepted against an empty key.
            const accepted = (yield* secrets.accepted()).map((secret) =>
                requireIngressSecret(secret)
            )
            if (accepted.length === 0) requireIngressSecret(null)
            // Traefik sends the token of the generation it was last configured with: any accepted one is good.
            return yield* accepted.some((secret) => ingressTokenMatches(token, secret))
                ? config.buildDynamicConfig()
                : Effect.fail(new IngressTokenInvalid({}))
        })
        return this.host.runUnwrapped(
            program.pipe(
                Effect.catchTag('IngressTokenInvalid', (error) =>
                    Effect.sync(() => {
                        response.status(401)
                        return { error: error.publicMessage() }
                    })
                )
            )
        )
    }
}
