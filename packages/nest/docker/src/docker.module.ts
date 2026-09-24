import {
	Global,
	Module,
	type DynamicModule,
	type InjectionToken,
	type ModuleMetadata,
	type OptionalFactoryDependency,
	type Provider,
} from "@nestjs/common";

import { DockerService } from "./services/docker.service";
import { ScannerContainerManagerService } from "./services/scanner-container-manager.service";
import { PostgresServiceProvisioner } from "./containers/postgres/postgres-service.provisioner";
import type { DockerConnectionConfig, ScannerConfig } from "./docker-config";

/**
 * Everything the docker primitives need, supplied by the APP.
 *
 * Every field is DATA, not a variable name. Which environment variable carries
 * the scanner image is an app convention, so the app resolves it (and applies
 * its own default) and hands over the value. That is what lets a second Nest
 * app drive the same primitives from its own configuration.
 */
export interface DockerModuleOptions {
	/** How to reach the Docker engine. */
	connection: DockerConnectionConfig;
	/** The scanner container's settings, including the app's chosen defaults. */
	scanner: ScannerConfig;
}

export interface DockerModuleAsyncOptions {
	/** Modules whose exports the factory injects. */
	imports?: NonNullable<ModuleMetadata["imports"]>;
	/** Tokens the factory's parameters are injected from, in order. */
	inject?: (InjectionToken | OptionalFactoryDependency)[];
	/** Build the options from the injected dependencies. */
	useFactory: (...deps: never[]) => DockerModuleOptions | Promise<DockerModuleOptions>;
}

/**
 * DockerModule — the engine client and the container primitives built on it.
 *
 * HOW TO USE IT
 *
 *   DockerModule.forRoot({ connection: { host, port }, scanner: { image, … } })
 *
 *   DockerModule.forRootAsync({
 *     imports: [EnvModule],
 *     inject: [EnvService],
 *     useFactory: (env: EnvService) => ({
 *       connection: { host: env.get("DOCKER_HOST"), port: env.get("DOCKER_PORT") },
 *       scanner: { image: env.get("SCANNER_RUNNER_IMAGE") ?? DEFAULT_IMAGE, … },
 *     }),
 *   })
 *
 * WHY THE APP PASSES CONFIG INSTEAD OF WIRING PROVIDERS ITSELF
 * The package owns the wiring — which primitive takes which collaborator, in
 * which order. An app that assembled the providers by hand had to know that
 * `ScannerContainerManagerService` takes the engine plus a config object, and a
 * mistake there is a RUNTIME DI failure rather than a compile error. `forRoot`
 * keeps that knowledge in the package and takes only the VALUES from the app.
 *
 * `PostgresServiceProvisioner` takes no config: the Postgres IDENTITY is
 * resolved per call by the caller (it depends on the deployment prefix, decided
 * at runtime), so the provisioner needs only the engine.
 *
 * `@Global()` because the engine client is process-wide infrastructure that
 * most modules read, and threading an import through each would be noise.
 */
@Global()
@Module({})
export class DockerModule {
	/** Register the docker primitives with values the app already resolved. */
	static forRoot(options: DockerModuleOptions): DynamicModule {
		return {
			module: DockerModule,
			providers: [
				...DockerModule.configProviders(options),
				...DockerModule.providers(),
			],
			exports: DockerModule.exports(),
		};
	}

	/** Register the docker primitives with values built from injected dependencies. */
	static forRootAsync(options: DockerModuleAsyncOptions): DynamicModule {
		const optionsToken = Symbol("DOCKER_MODULE_OPTIONS");

		return {
			module: DockerModule,
			imports: options.imports ?? [],
			providers: [
				{
					provide: optionsToken,
					useFactory: options.useFactory,
					inject: options.inject ?? [],
				},
				...DockerModule.configFromToken(optionsToken),
				...DockerModule.providers(),
			],
			exports: DockerModule.exports(),
		};
	}

	/**
	 * Bind each narrow contract to its slice of the resolved options.
	 *
	 * The primitives inject their OWN token rather than the whole options
	 * object, so adding a third contract later does not widen what the existing
	 * two receive.
	 */
	private static configFromToken(optionsToken: symbol): Provider[] {
		return [
			{
				provide: DOCKER_CONNECTION_CONFIG,
				useFactory: (options: DockerModuleOptions) => options.connection,
				inject: [optionsToken],
			},
			{
				provide: DOCKER_SCANNER_CONFIG,
				useFactory: (options: DockerModuleOptions) => options.scanner,
				inject: [optionsToken],
			},
		];
	}

	/** Bind each narrow contract directly to the value the app passed. */
	private static configProviders(options: DockerModuleOptions): Provider[] {
		return [
			{ provide: DOCKER_CONNECTION_CONFIG, useValue: options.connection },
			{ provide: DOCKER_SCANNER_CONFIG, useValue: options.scanner },
		];
	}

	/** The primitives, each resolved from the config token it declares. */
	private static providers(): Provider[] {
		return [
			{
				provide: DockerService,
				useFactory: (config: DockerConnectionConfig) => new DockerService(config),
				inject: [DOCKER_CONNECTION_CONFIG],
			},
			{
				provide: ScannerContainerManagerService,
				useFactory: (docker: DockerService, config: ScannerConfig) =>
					new ScannerContainerManagerService(docker, config),
				inject: [DockerService, DOCKER_SCANNER_CONFIG],
			},
			{
				provide: PostgresServiceProvisioner,
				useFactory: (docker: DockerService) => new PostgresServiceProvisioner(docker),
				inject: [DockerService],
			},
		];
	}

	private static exports(): DynamicModule["exports"] {
		return [DockerService, ScannerContainerManagerService, PostgresServiceProvisioner];
	}
}

/**
 * DI tokens for the two config contracts.
 *
 * Declared HERE rather than in `docker-config.ts` (where the types live) so the
 * config module stays free of framework imports — it is a plain type module
 * that even non-Nest consumers can read.
 */
export const DOCKER_CONNECTION_CONFIG = "DOCKER_CONNECTION_CONFIG" as const;
export const DOCKER_SCANNER_CONFIG = "DOCKER_SCANNER_CONFIG" as const;
