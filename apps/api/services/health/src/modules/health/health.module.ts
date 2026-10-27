import { createModuleContext } from "@deployer/nest-effect";
import { HealthModule, HealthRegistry } from "@deployer/shared/server";

import { HealthController } from "./controllers/health.controller";
import { HealthRegistryRepository } from "./services/health.service";
import { HealthService, HealthServiceImpl } from "./services/health.service";

/**
 * The health domain.
 *
 * The module owns the transport and the Effect service that adapts the shared
 * `HealthRegistry`.
 *
 * Both providers are normal NestJS registrations whose tokens are Effect
 * service keys, so `EffectRuntime` discovers them:
 * - `HealthRegistryRepository` aliases the SHARED registry instance (created
 *   and lifecycle-managed by `HealthModule`) into Effect DI;
 * - `HealthService` is the domain use case.
 *
 * No constructor injection crosses the domain boundary: `HealthService` asks
 * Effect for the registry. `createModuleContext` turns those providers into
 * this module's typed `effect/context`, so the controller can only yield what
 * the module declares.
 */
export class HealthDomainModule extends createModuleContext({
  imports: [HealthModule.forRoot({ indicators: "platform" })],
  controllers: [HealthController],
  providers: [
    { provide: HealthRegistryRepository, useExisting: HealthRegistry },
    { provide: HealthService, useClass: HealthServiceImpl },
  ],
}) {}
