import { Global, Module, type DynamicModule } from "@nestjs/common";
import { Context } from "effect";

export class AppLifecycle extends Context.Service<
	AppLifecycle,
	{ readonly phaseNow: () => string }
>()("lifecycle/AppLifecycle") {}

/**
 * An ordinary Nest module with a `forRoot()` factory.
 *
 * `forRoot()` returns a `DynamicModule`, so nothing about `AppLifecycle` reaches
 * the compiler through the class. It is imported through `effectModule(...)`,
 * which claims the token and verifies the claim against the factory's provider
 * list at definition time.
 */
@Global()
@Module({})
export class AppLifecycleModule {
	static forRoot(): DynamicModule {
		return {
			module: AppLifecycleModule,
			global: true,
			providers: [{ provide: AppLifecycle, useValue: { phaseNow: () => "running" } }],
			exports: [AppLifecycle],
		};
	}
}

/** The same surface, declared with a plain `@Module` class. */
@Module({
	providers: [{ provide: AppLifecycle, useValue: { phaseNow: () => "running" } }],
	exports: [AppLifecycle],
})
export class PlainLifecycleModule {}
