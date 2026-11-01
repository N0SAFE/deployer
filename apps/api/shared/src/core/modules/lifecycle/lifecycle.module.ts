import { Global, Module, type DynamicModule } from "@nestjs/common";
import { declareModule } from "@deployer/nest-effect";
import { AppLifecycle, makeAppLifecycle } from "@deployer/lifecycle";

/**
 * Provides the application lifecycle Effect service under its own tag, once per process, for every
 * module. Register it with `forRoot()`: it takes no options (the lifecycle is per process), but every
 * shared module here is registered the same way, which makes a wiring mistake visible. Callers inject
 * the `AppLifecycle` tag and use its shape directly.
 */
@Global()
@Module({})
class AppLifecycleNestModule {
	static forRoot(): DynamicModule {
		return declareModule(
			{
				module: AppLifecycleNestModule,
				providers: [{ provide: AppLifecycle, useFactory: makeAppLifecycle }],
				exports: [AppLifecycle],
			},
			{ global: true },
		);
	}
}

export const AppLifecycleModule = declareModule(AppLifecycleNestModule, { global: true });
