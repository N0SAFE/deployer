import { Global, Module, type DynamicModule } from "@nestjs/common";

import { AppLifecycleService } from "./app-lifecycle.service";

/**
 * Registers `AppLifecycleService` for the whole app. Register it with `forRoot()`, not a bare import:
 * it takes no options (the lifecycle is per process) but every shared module here is registered the
 * same way, which makes a wiring mistake visible. `@Global()` lets any module inject the service.
 */
@Global()
@Module({})
export class AppLifecycleModule {
	static forRoot(): DynamicModule {
		return {
			module: AppLifecycleModule,
			providers: [AppLifecycleService],
			exports: [AppLifecycleService],
		};
	}
}
