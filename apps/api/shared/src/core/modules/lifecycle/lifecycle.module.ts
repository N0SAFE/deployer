import { Global, Module } from "@nestjs/common";
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
	static forRoot() {
		return declareModule(
			{
				module: AppLifecycleNestModule,
				providers: [{ provide: AppLifecycle, useFactory: makeAppLifecycle }],
				exports: [AppLifecycle],
			},
			// The claims ARE the type: `provides` is what this module's own Effects may yield, `exports` what its
			// importers get. Omitting them leaves the import contributing nothing, silently.
			{ provides: [AppLifecycle], exports: [AppLifecycle], global: true },
		);
	}
}

// The class itself declares no providers (they come from `forRoot`), so only its exports can be claimed.
export const AppLifecycleModule = declareModule(AppLifecycleNestModule, {
	exports: [AppLifecycle],
	global: true,
});
