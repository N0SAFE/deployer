import { Injectable, Logger } from "@nestjs/common";
import type { SystemActorClaim } from "@deployer/shared/core/modules/auth/system-actor/system-actor";
import type { DeploymentTriggerFromEventInput } from "@deployer/runtime-contracts/modules/deployment/crud";
import { DeploymentService } from "../services/deployment.service";
import { DeploymentTriggerRegistryService } from "./deployment-trigger-registry.service";

export type DeploymentEventTriggerResult =
    | { dispatched: true; sourceId: string; deploymentId: string; reason: null }
    | { dispatched: false; sourceId: string | null; deploymentId: null; reason: string };

/**
 * Turns a provider event into a deployment, acting as the SYSTEM.
 *
 * Asks the registry which source owns the event and what input it produces, then queues it
 * through `DeploymentService.triggerDeploymentAsSystem` — the same path the API uses, minus
 * the user-membership check a webhook cannot satisfy.
 *
 * "Nothing to deploy" is a normal answer, not an error: a webhook endpoint receives every
 * event the provider sends, so the caller gets `dispatched: false` with a reason rather than
 * a failure it would have to tell apart from a real one.
 */
@Injectable()
export class DeploymentEventTriggerService {
    private readonly logger = new Logger(DeploymentEventTriggerService.name);

    constructor(
        private readonly registry: DeploymentTriggerRegistryService,
        private readonly deploymentService: DeploymentService,
    ) {}

    async trigger(
        event: DeploymentTriggerFromEventInput,
        actor: SystemActorClaim,
    ): Promise<DeploymentEventTriggerResult> {
        const resolution = await this.registry.toTriggerInput({
            provider: event.provider,
            eventName: event.eventName,
            payload: event.payload,
        });

        if (!resolution) {
            return {
                dispatched: false,
                sourceId: null,
                deploymentId: null,
                reason: `no_trigger_source:${event.provider}/${event.eventName}`,
            };
        }
        if (resolution.input === null) {
            return {
                dispatched: false,
                sourceId: resolution.sourceId,
                deploymentId: null,
                reason: `not_deployable:${resolution.sourceId}`,
            };
        }

        const deployment = await this.deploymentService.triggerDeploymentAsSystem(resolution.input);
        this.logger.log(
            `Deployment ${deployment.id} queued by system actor '${actor.source}' ` +
                `(delivery=${actor.deliveryId ?? "none"}, trigger=${resolution.sourceId}, service=${resolution.input.serviceId})`,
        );
        return {
            dispatched: true,
            sourceId: resolution.sourceId,
            deploymentId: deployment.id,
            reason: null,
        };
    }
}
