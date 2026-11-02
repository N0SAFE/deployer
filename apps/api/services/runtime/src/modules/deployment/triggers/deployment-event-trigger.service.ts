import { Context, Effect } from "effect";

import { CurrentActor } from "@deployer/effect-core";
import type { DeploymentTriggerFromEventInput } from "@deployer/runtime-contracts/modules/deployment/crud";

import { attempt } from "../../../core/effects";

import { SystemDeploymentsPort, TriggerRegistryPort } from "./deployment-trigger.ports";

export type DeploymentEventTriggerResult =
    | { dispatched: true; sourceId: string; deploymentId: string; reason: null }
    | { dispatched: false; sourceId: string | null; deploymentId: null; reason: string };

/**
 * Turns a provider event into a deployment, acting as the SYSTEM.
 *
 * Asks the registry which source owns the event and what input it produces, then queues it
 * through `DeploymentService.triggerDeploymentAsSystem` — the same path the API uses, minus
 * the user-membership check a webhook cannot satisfy. The acting system component is read from
 * `CurrentActor`, which the request boundary fills from the verified system-actor claim.
 *
 * "Nothing to deploy" is a normal answer, not an error: a webhook endpoint receives every
 * event the provider sends, so the caller gets `dispatched: false` with a reason rather than
 * a failure it would have to tell apart from a real one. A failure of the queueing itself is a
 * failure, with whatever the deployment service refused with.
 */
export type DeploymentEventTriggerServiceShape = {
    readonly trigger: (
        event: DeploymentTriggerFromEventInput,
        deliveryId: string | null,
    ) => Effect.Effect<DeploymentEventTriggerResult, unknown, CurrentActor | TriggerRegistryPort | SystemDeploymentsPort>;
};

/**
 * Tag and implementation together: the tag is the contract, `live` the one implementation. Its ports
 * (the registry and the deployment service) are yielded when `trigger` runs, so it is a constant the
 * deployment module provides with `useValue`.
 */
export class DeploymentEventTriggerService extends Context.Service<
    DeploymentEventTriggerService,
    DeploymentEventTriggerServiceShape
>()("runtime/DeploymentEventTriggerService") {
    static readonly live = class DeploymentEventTriggerServiceImpl implements DeploymentEventTriggerServiceShape {
        trigger(event, deliveryId) {
          return Effect.gen(function* () {
              const registry = yield* TriggerRegistryPort;
              const deploymentService = yield* SystemDeploymentsPort;
              const actor = yield* CurrentActor;
              const resolution = yield* attempt(() =>
                  registry.toTriggerInput({
                      provider: event.provider,
                      eventName: event.eventName,
                      payload: event.payload,
                  }),
              );

              if (!resolution) {
                  return {
                      dispatched: false as const,
                      sourceId: null,
                      deploymentId: null,
                      reason: `no_trigger_source:${event.provider}/${event.eventName}`,
                  };
              }
              if (resolution.input === null) {
                  return {
                      dispatched: false as const,
                      sourceId: resolution.sourceId,
                      deploymentId: null,
                      reason: `not_deployable:${resolution.sourceId}`,
                  };
              }

              const input = resolution.input;
              const deployment = yield* attempt(() => deploymentService.triggerDeploymentAsSystem(input));
              yield* Effect.logInfo(
                  `Deployment ${deployment.id} queued by system actor '${actor.id}' ` +
                      `(delivery=${deliveryId ?? "none"}, trigger=${resolution.sourceId}, service=${input.serviceId})`,
              );
              return {
                  dispatched: true as const,
                  sourceId: resolution.sourceId,
                  deploymentId: deployment.id,
                  reason: null,
              };
          });
        }
    };
}
