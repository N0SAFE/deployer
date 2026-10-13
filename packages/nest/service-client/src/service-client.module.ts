import { Global, Module, type DynamicModule } from "@nestjs/common";

import {
	ServiceClientRegistry,
	type ServiceClientModuleOptions,
} from "./service-client.registry";

export type { ServiceClientModuleOptions };

/** The token a subclass or consumer can inject the registry under. */
export const SERVICE_CLIENT_REGISTRY = "SERVICE_CLIENT_REGISTRY";

/** The token the resolved module options are provided under. */
export const SERVICE_CLIENT_OPTIONS = "SERVICE_CLIENT_OPTIONS";

/**
 * Provides the service-client registry to the whole application.
 *
 * ── WHY `@Global()` ─────────────────────────────────────────────────────────
 * Every feature module that reaches another service needs the registry, and the
 * alternative is importing this module in each of them — a line that adds nothing
 * and is easy to forget. A global module still has to be imported ONCE, by the root
 * module, which is where the options are decided.
 *
 * ── WHY `forRoot` AND NOT A BARE IMPORT ─────────────────────────────────────
 * The registry cannot address anything without two facts only the application
 * knows: where a service answers, and which credentials to attach. Taking them as
 * module options is what keeps this package free of environment knowledge — it
 * knows HOW to call a service, never WHICH one or WHERE.
 *
 * Registering it bare would compile and then fail at the first call, so `forRoot`
 * is the only public entry point on purpose.
 */
@Global()
@Module({})
export class ServiceClientModule {
	static forRoot(options: ServiceClientModuleOptions): DynamicModule {
		return {
			module: ServiceClientModule,
			providers: [
				{ provide: SERVICE_CLIENT_OPTIONS, useValue: options },
				{
					provide: SERVICE_CLIENT_REGISTRY,
					useFactory: () => new ServiceClientRegistry(options),
				},
				// Also bound to its own class so a client can inject it directly — the
				// token above exists for consumers that prefer to be explicit.
				{ provide: ServiceClientRegistry, useExisting: SERVICE_CLIENT_REGISTRY },
			],
			exports: [SERVICE_CLIENT_REGISTRY, ServiceClientRegistry],
		};
	}
}
