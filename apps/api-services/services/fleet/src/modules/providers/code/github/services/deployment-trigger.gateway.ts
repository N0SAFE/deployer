import { Injectable } from "@nestjs/common";
import { deploymentContract } from "@deployer/runtime-contracts";
import { EnvService } from "@deployer/shared/config/env/env.module";
import { ServiceClient } from "@deployer/shared/server";
import { signSystemActorClaim } from "@deployer/shared/core/modules/auth/system-actor/system-actor";

export type TriggerRelayResult = {
    dispatched: boolean;
    sourceId: string | null;
    deploymentId: string | null;
    reason: string | null;
}

/**
 * Hands a verified provider event to `svc-runtime`, which owns deployments.
 *
 * Fleet receives the webhook and has authenticated it (signature + idempotency), but it does
 * not decide what to deploy: the runtime's trigger registry does. A webhook has no user, so
 * the call is made AS THE SYSTEM, with a signed claim naming the source and the delivery
 * (`auth/system-actor`). Runtime verifies it; a peer that merely reaches the port cannot.
 *
 * Fleet depends on runtime's CONTRACT only — never on its internals.
 */
@Injectable()
export class DeploymentTriggerGateway {
    constructor(
        private readonly clients: ServiceClient,
        private readonly env: EnvService,
    ) {}

    async relay(event: {
        provider: string;
        eventName: string;
        deliveryId: string;
        payload: unknown;
    }): Promise<TriggerRelayResult> {
        const secret = (this.env.get("BETTER_AUTH_SECRET") ?? this.env.get("AUTH_SECRET"))?.toString().trim();
        if (!secret) {
            throw new Error("Cannot sign a system-actor claim: BETTER_AUTH_SECRET is not configured");
        }

        const token = signSystemActorClaim(
            { source: `${event.provider}-${event.eventName}`, deliveryId: event.deliveryId, aud: "runtime" },
            secret,
        );
        const client = this.clients.systemActorClientFor("runtime", deploymentContract, token);
        return client.triggerFromEvent({
            provider: event.provider,
            eventName: event.eventName,
            deliveryId: event.deliveryId,
            payload: event.payload,
        });
    }
}
