import { createModuleContext, type UnmetOf } from "@deployer/nest-effect";
import { HealthModule, HealthRegistry } from "@deployer/shared/server";

import { HealthController } from "./controllers/health.controller";
import { HealthRegistryRepository, UptimeSource } from "./services/health.service";
import { HealthService } from "./services/health.service";

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
 * - `UptimeSource` is the process clock (seconds), a plain constant;
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
    // The process clock, as a value: the service reports uptime in seconds and never converts.
    { provide: UptimeSource, useValue: () => process.uptime() },
    { provide: HealthService, useValue: HealthService.live },
  ],
  // The domain's public surface: what a module that imports this one may yield. Nothing imports it today, and that is
  // why the list is explicit — an export that is not written is a service no other module can reach.
  exports: [HealthRegistryRepository, HealthService],
}) {}

/**
 * What this module forwards upward: empty, because it provides both services its controller yields. `main.ts` asserts
 * this on the composition root, so a provider removed here fails there — `Missing<[HealthController, HealthService]>`.
 */
export type HealthRequirements = UnmetOf<typeof HealthDomainModule>;
