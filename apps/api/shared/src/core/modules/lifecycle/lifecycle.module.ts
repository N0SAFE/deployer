import { Global, Module, type DynamicModule } from "@nestjs/common";
import { AppLifecycle, makeAppLifecycle } from "@deployer/lifecycle";

/**
 * Provides the application lifecycle Effect service under its own tag, once per process, for every
 * module. Register it with `forRoot()`: it takes no options (the lifecycle is per process), but every
 * shared module here is registered the same way, which makes a wiring mistake visible. Callers inject
 * the `AppLifecycle` tag and use its shape directly.
 */
@Global()
@Module({})
export class AppLifecycleModule {
	static forRoot(): DynamicModule {
		return {
			module: AppLifecycleModule,
			providers: [{ provide: AppLifecycle, useFactory: makeAppLifecycle }],
			exports: [AppLifecycle],
		};
	}
}
