import { Context, Effect } from "effect";

import { ConfigNotFoundError } from "../errors";

import type { StorageFailure } from "../../database/storage";
import type { CreateServiceConfigInput, CreateSSLCertificateInput, SyncResult, ValidationError, ValidationResult } from "../interfaces";
import type { TraefikRepositoryShape } from "../repositories/traefik.repository";
import type { TraefikSyncShape } from "./traefik-sync.service";

/**
 * The Traefik facade the rest of the platform uses: create a service's config, sync it to disk, read health, register a
 * certificate, validate a stored configuration. (The other ~34 facade methods had no caller and were removed with the migration.)
 */
export type TraefikServiceShape = {
  readonly createServiceConfiguration: (
    serviceId: string,
    config: Omit<CreateServiceConfigInput, "serviceId">,
  ) => ReturnType<TraefikRepositoryShape["createServiceConfig"]>;
  /** `ConfigNotFoundError` when the service has no Traefik config yet; a failed write is a `success: false` result. */
  readonly syncServiceConfiguration: (serviceId: string) => Effect.Effect<SyncResult, StorageFailure | ConfigNotFoundError>;
  /** Check a stored configuration (domain, port, targets, SSL provider). `ConfigNotFoundError` when it does not exist. */
  readonly validateConfiguration: (configId: string) => Effect.Effect<ValidationResult, StorageFailure | ConfigNotFoundError>;
  readonly getHealthStatus: () => ReturnType<TraefikRepositoryShape["getHealthCheckSummary"]>;
  readonly addSSLCertificate: (
    configId: string,
    certConfig: Omit<CreateSSLCertificateInput, "configId">,
  ) => ReturnType<TraefikRepositoryShape["createSSLCertificate"]>;
};

type Ports = { readonly repository: TraefikRepositoryShape; readonly sync: TraefikSyncShape };

export function makeTraefikService({ repository, sync }: Ports): TraefikServiceShape {
  return {
    createServiceConfiguration: (serviceId, config) =>
      Effect.logDebug(`Creating service configuration for service ${serviceId}`).pipe(
        Effect.andThen(repository.createServiceConfig({ serviceId, ...config })),
      ),
    syncServiceConfiguration: (serviceId) =>
      Effect.gen(function* () {
        const config = yield* repository.getServiceConfigByServiceId(serviceId);
        if (!config) return yield* new ConfigNotFoundError({ configId: serviceId, configType: "service" });
        return yield* sync.syncServiceConfiguration(config.id);
      }),
    validateConfiguration: (configId) =>
      Effect.gen(function* () {
        const config = yield* repository.getCompleteServiceConfig(configId);
        if (!config) return yield* new ConfigNotFoundError({ configId, configType: "configuration" });

        const errors: ValidationError[] = [];
        const warnings: { path: string; message: string }[] = [];

        if (!config.domain) errors.push({ path: "domain", message: "Domain is required", code: "MISSING_DOMAIN" });
        if (!config.port || config.port < 1 || config.port > 65535) {
          errors.push({ path: "port", message: "Valid port number is required (1-65535)", code: "INVALID_PORT" });
        }
        const serviceTargets = config.serviceTargets as unknown[] | undefined;
        if (!serviceTargets || serviceTargets.length === 0) {
          warnings.push({ path: "serviceTargets", message: "No service targets configured - will use default localhost target" });
        }
        const validSslProviders = ["letsencrypt", "selfsigned", "custom"];
        if (config.sslEnabled && (!config.sslProvider || !validSslProviders.includes(config.sslProvider))) {
          errors.push({ path: "sslProvider", message: "Valid SSL provider is required when SSL is enabled", code: "INVALID_SSL_PROVIDER" });
        }

        if (errors.length > 0) {
          yield* Effect.logWarning(`Configuration ${configId} validation failed with ${String(errors.length)} error(s)`);
        }
        return { isValid: errors.length === 0, errors, warnings } satisfies ValidationResult;
      }),
    getHealthStatus: () => repository.getHealthCheckSummary(),
    addSSLCertificate: (configId, certConfig) => repository.createSSLCertificate({ configId, ...certConfig }),
  };
}

export class TraefikService extends Context.Service<TraefikService, TraefikServiceShape>()("shared/TraefikService") {}
