import { Global, Module, type DynamicModule } from "@nestjs/common";
import { DiscoveryModule } from "@nestjs/core";
import { EffectRuntime } from "./effect-runtime";
import {
	EFFECT_RUNTIME_LAYERS,
	type EffectRuntimeModuleOptions,
} from "./effect-runtime.token";

export { EFFECT_RUNTIME_LAYERS, type EffectRuntimeModuleOptions } from "./effect-runtime.token";

/**
 * Zero-configuration Effect runtime for NestJS.
 *
 * Import once in the root module. Every provider registered under a
 * `Context.Service` token is automatically available inside Effect programs;
 * `forRoot({ layers })` adds services that are Layers instead.
 */
@Global()
@Module({
	imports: [DiscoveryModule],
	providers: [
		EffectRuntime,
		{ provide: EFFECT_RUNTIME_LAYERS, useValue: [] },
	],
	exports: [EffectRuntime],
})
export class EffectRuntimeModule {
	static forRoot(options: EffectRuntimeModuleOptions = {}): DynamicModule {
		return {
			module: EffectRuntimeModule,
			global: true,
			imports: [DiscoveryModule],
			providers: [
				EffectRuntime,
				{ provide: EFFECT_RUNTIME_LAYERS, useValue: options.layers ?? [] },
			],
			exports: [EffectRuntime],
		};
	}
}
