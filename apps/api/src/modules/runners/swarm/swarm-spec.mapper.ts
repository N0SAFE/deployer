/**
 * Swarm spec mapper — pure, side-effect-free translations between the
 * platform's canonical `SwarmServiceSpecInput` (Zod-owned, see
 * `packages/contracts/entities/src/entities/swarm/service.spec.schema.ts`)
 * and dockerode's native `ServiceSpec` shape.
 *
 * Boundary rule: this file is the ONLY place that builds dockerode service
 * specs. Business code (queue, workflow, reconciliation) imports only the
 * Zod types; dockerode types never leak past `DockerService` + this mapper.
 */

import type Docker from "dockerode";
import type { SwarmHealthcheckConfig, SwarmServiceSpecInput, SwarmUpdateConfig } from "@repo/contracts-entities";
/** dockerode health/update/rollback intervals are expressed in nanoseconds. */
const NANOS_PER_MS = 1_000_000;

export function toDockerServiceSpec(input: SwarmServiceSpecInput): Docker.ServiceSpec {
    const containerSpec: Docker.ContainerSpec = {
        Image: input.image,
        ...(input.env.length > 0 ? { Env: input.env } : {}),
        ...(input.command.length > 0 ? { Command: input.command } : {}),
        ...(input.args.length > 0 ? { Args: input.args } : {}),
        ...(Object.keys(input.containerLabels).length > 0 ? { Labels: input.containerLabels } : {}),
        ...(input.mounts.length > 0
            ? {
                  Mounts: input.mounts.map((m) => ({
                      Type: m.type,
                      Source: m.source,
                      Target: m.target,
                      ReadOnly: m.readOnly,
                  })),
              }
            : {}),
        ...(input.healthcheck ? { HealthCheck: toHealthConfig(input.healthcheck) } : {}),
    };

    const resources: Docker.ResourceRequirements = {};
    if (input.resourcesLimits.nanoCpus !== undefined || input.resourcesLimits.memoryBytes !== undefined) {
        resources.Limits = {
            ...(input.resourcesLimits.nanoCpus !== undefined ? { NanoCPUs: input.resourcesLimits.nanoCpus } : {}),
            ...(input.resourcesLimits.memoryBytes !== undefined ? { MemoryBytes: input.resourcesLimits.memoryBytes } : {}),
        };
    }
    if (input.resourcesReservations.nanoCpus !== undefined || input.resourcesReservations.memoryBytes !== undefined) {
        resources.Reservations = {
            ...(input.resourcesReservations.nanoCpus !== undefined
                ? { NanoCPUs: input.resourcesReservations.nanoCpus }
                : {}),
            ...(input.resourcesReservations.memoryBytes !== undefined
                ? { MemoryBytes: input.resourcesReservations.memoryBytes }
                : {}),
        };
    }

    const taskTemplate: Docker.ContainerTaskSpec = {
        ContainerSpec: containerSpec,
        ...(resources.Limits !== undefined || resources.Reservations !== undefined ? { Resources: resources } : {}),
        ...(input.placementPreferences.length > 0 || input.placementConstraints.length > 0
            ? {
                  Placement: {
                      ...(input.placementPreferences.length > 0
                          ? { Preferences: input.placementPreferences.map((p) => ({ Spread: { SpreadDescriptor: p.spreadDescriptor } })) }
                          : {}),
                      ...(input.placementConstraints.length > 0 ? { Constraints: input.placementConstraints } : {}),
                  },
              }
            : {}),
        ...(input.networks.length > 0 ? { Networks: input.networks.map((name) => ({ Target: name })) } : {}),
    };

    return {
        Name: input.name,
        Labels: input.labels,
        TaskTemplate: taskTemplate,
        // Global mode = one task on every node (platform node-local infra);
        // replicated = the requested replica count (user workloads).
        Mode:
            input.mode === "global"
                ? { Global: {} }
                : { Replicated: { Replicas: input.replicas } },
        UpdateConfig: toUpdateConfig(input.updateConfig),
        ...(input.rollbackConfig ? { RollbackConfig: toUpdateConfig(input.rollbackConfig) } : {}),
        ...(input.endpointPorts.length > 0
            ? {
                  EndpointSpec: {
                      Ports: input.endpointPorts.map((port) => ({
                          TargetPort: port.targetPort,
                          ...(port.publishedPort !== undefined
                              ? { PublishedPort: port.publishedPort }
                              : {}),
                          Protocol: port.protocol,
                      })),
                  },
              }
            : {}),
    };
}

function toHealthConfig(config: NonNullable<SwarmHealthcheckConfig>): Docker.HealthConfig {
    return {
        ...(config.test && config.test.length > 0 ? { Test: config.test } : {}),
        ...(config.intervalMs !== undefined ? { Interval: config.intervalMs * NANOS_PER_MS } : {}),
        ...(config.timeoutMs !== undefined ? { Timeout: config.timeoutMs * NANOS_PER_MS } : {}),
        ...(config.retries !== undefined ? { Retries: config.retries } : {}),
        ...(config.startPeriodMs !== undefined ? { StartPeriod: config.startPeriodMs * NANOS_PER_MS } : {}),
    };
}

function toUpdateConfig(config: SwarmUpdateConfig): Docker.UpdateConfig {
    return {
        Parallelism: config.parallelism,
        Delay: config.delayMs * NANOS_PER_MS,
        Order: config.order,
        FailureAction: config.failureAction,
    };
}