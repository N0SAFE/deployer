import type { Service, ServiceEffectiveConfig } from "@repo/contracts-entities";

/**
 * Effective-config resolution for the sub-services (hierarchy) system.
 *
 * A service "is a namespace for everything below it": every sub-service
 * INHERITS the configuration of its ancestors and only overrides what it
 * explicitly sets. The inheritance follows the Docker-Compose merge model:
 *  - single values replace (child wins),
 *  - maps merge key-by-key (child wins per key),
 *  - null / absent means "inherit from the parent",
 *  - lists are replaced (not concatenated) when set.
 *
 * The DB bakes in creation defaults for health-check fields ("/health", 30s,
 * 10s, 3 retries), so a health-check value EQUAL to that template is treated
 * as "not explicitly set" — otherwise a sub-service that never touched its
 * health check would clobber the parent's custom health check with the
 * defaults.
 */

/** Health-check defaults applied at creation (mirror of the repository). */
export const DEFAULT_HEALTH_CHECK = {
    path: "/health",
    interval: 30,
    timeout: 10,
    retries: 3,
} as const;

/** Empty effective-config base — nothing inherited yet. */
export function emptyEffectiveConfig(): ServiceEffectiveConfig {
    return {
        port: null,
        resourceLimits: {},
        environmentVariables: {},
        healthCheck: { path: null, interval: null, timeout: null, retries: null },
        deploymentRetention: {},
        providerConfig: null,
        customDomains: null,
        network: null,
        implementsContract: null,
    };
}

function isDefaultHealthCheckValue(
    field: keyof typeof DEFAULT_HEALTH_CHECK,
    value: number | string | null,
): boolean {
    return value === null || value === DEFAULT_HEALTH_CHECK[field];
}

/**
 * Merge one service's OWN configuration on top of an inherited base.
 * `own` is the flat service DTO (or any subset with the participating fields).
 */
export function mergeServiceConfig(
    base: ServiceEffectiveConfig,
    own: Pick<
        Service,
        | "port"
        | "resourceLimits"
        | "environmentVariables"
        | "healthCheckPath"
        | "healthCheckInterval"
        | "healthCheckTimeout"
        | "healthCheckRetries"
        | "deploymentRetention"
        | "providerConfig"
        | "customDomains"
        | "network"
        | "implementsContract"
    >,
): ServiceEffectiveConfig {
    return {
        port: own.port ?? base.port,

        resourceLimits: {
            memory: own.resourceLimits?.memory ?? base.resourceLimits?.memory,
            cpu: own.resourceLimits?.cpu ?? base.resourceLimits?.cpu,
            storage: own.resourceLimits?.storage ?? base.resourceLimits?.storage,
        },

        environmentVariables: {
            ...(base.environmentVariables ?? {}),
            ...(own.environmentVariables ?? {}),
        },

        healthCheck: {
            path: pickHealth("path", own.healthCheckPath, base.healthCheck?.path ?? null),
            interval: pickHealth("interval", own.healthCheckInterval, base.healthCheck?.interval ?? null),
            timeout: pickHealth("timeout", own.healthCheckTimeout, base.healthCheck?.timeout ?? null),
            retries: pickHealth("retries", own.healthCheckRetries, base.healthCheck?.retries ?? null),
        },

        deploymentRetention: {
            maxSuccessfulDeployments:
                own.deploymentRetention?.maxSuccessfulDeployments ??
                base.deploymentRetention?.maxSuccessfulDeployments,
            keepArtifacts: own.deploymentRetention?.keepArtifacts ?? base.deploymentRetention?.keepArtifacts,
            autoCleanup: own.deploymentRetention?.autoCleanup ?? base.deploymentRetention?.autoCleanup,
            cleanupSchedule: own.deploymentRetention?.cleanupSchedule ?? base.deploymentRetention?.cleanupSchedule,
        },

        providerConfig: own.providerConfig ?? base.providerConfig,
        customDomains: own.customDomains ?? base.customDomains,

        // Network config: inherit the parent chain's DNS-provider/zone/record
        // policy unless the sub-service explicitly sets its own (a sub-service
        // with NO network config inherits the first-class service's network).
        network: own.network ?? base.network,

        // Contract identity flows down the chain too — a sub-service that
        // implements a contract inherits it unless it declares its own.
        implementsContract: own.implementsContract ?? base.implementsContract,
    };
}

function pickHealth<T extends number | string | null>(
    field: keyof typeof DEFAULT_HEALTH_CHECK,
    ownValue: T,
    inherited: T,
): T {
    // Own value is null or the baked-in default → "not explicitly set". Prefer
    // the inherited value, but KEEP the default when there is nothing to
    // inherit — a root service (no parent) must still show its actual defaults.
    if (isDefaultHealthCheckValue(field, ownValue)) {
        return inherited !== null ? inherited : ownValue;
    }
    return ownValue;
}

/**
 * Fold a chain of services (root-first) into a single effective config.
 * `chain` must NOT include `self` — it is merged last.
 */
export function foldServiceChain(chain: Service[], self: Service): ServiceEffectiveConfig {
    let effective = emptyEffectiveConfig();
    for (const ancestor of chain) {
        effective = mergeServiceConfig(effective, ancestor);
    }
    return mergeServiceConfig(effective, self);
}
