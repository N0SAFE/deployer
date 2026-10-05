import {
	Global,
	Module,
	type DynamicModule,
	type InjectionToken,
	type ModuleMetadata,
	type OptionalFactoryDependency,
	type Provider,
} from "@nestjs/common";

import {
	SWARM_ELECTION_CONFIG,
	SWARM_JOIN_CONFIG,
	SWARM_METRICS_PROVIDER,
	SWARM_PARTICIPATION_DEFAULTS,
	SWARM_BOOT_CONVERGENCE,
	SWARM_LEADERSHIP_EVENT_SINK,
	type SwarmElectionConfig,
	type SwarmJoinConfig,
	type SwarmParticipationDefaults,
} from "./swarm-config";
import type { ClusterMetricsProvider, LeadershipEventSink } from "./election/swarm-leadership.service";
import { SwarmBootstrapService } from "./services/swarm-bootstrap.service";
import { SwarmClusterService } from "./services/swarm-cluster.service";
import { SwarmFleetService } from "./services/swarm-fleet.service";
import { SwarmJoinGrantService } from "./services/swarm-join-grant.service";
import { SwarmParticipationService } from "./services/swarm-participation.service";
import { SwarmLeadershipService } from "./election/swarm-leadership.service";

/**
 * Everything the swarm primitives need, supplied by the APP.
 *
 * Each field is the DATA a primitive reads — not a variable name. Which
 * environment variable carries an election cadence is an app convention, so the
 * app resolves it and hands over the value. That is what lets a second Nest app
 * run the same swarm code from its own environment instead of inheriting the
 * first app's variable names.
 */
export interface SwarmModuleOptions {
	/** Timings + thresholds for the election loop. */
	election: SwarmElectionConfig;
	/** Where a joiner can reach this cluster, plus the quorum cap. */
	join: SwarmJoinConfig;
	/** First-run participation defaults, consulted only until setup persists a choice. */
	participation?: SwarmParticipationDefaults;
	/**
	 * Whether the engine may be converged during BOOT. Defaults to `true`.
	 *
	 * `false` is for an app that founds the cluster inside an OPERATOR-DRIVEN
	 * flow (setup): its own boot must not touch the engine, because the swarm is
	 * created when the operator triggers setup, not when the process starts. The
	 * boot pass would otherwise run on every restart against a node that is
	 * already `setup_done` — and then converge AGAIN from the trigger.
	 */
	convergeOnBoot?: boolean;
	/** Optional metrics source for the master election. */
	metricsProvider?: ClusterMetricsProvider;
	/** Optional sink for leadership-change events. */
	eventSink?: LeadershipEventSink;
}

/**
 * Async variant: build the options from injected dependencies.
 *
 * The `never[]` on `useFactory` is deliberate. The module cannot know which
 * dependencies the app will inject, and a concrete parameter list would force
 * the app to match a signature the package invented. `never` is assignable to
 * every parameter type, so any factory shape type-checks here and the app keeps
 * its own parameter types (validated against its own `inject` list).
 */
export interface SwarmModuleAsyncOptions {
	/** Modules whose exports the factory injects. */
	imports?: NonNullable<ModuleMetadata["imports"]>;
	/** Tokens the factory's parameters are injected from, in order. */
	inject?: (InjectionToken | OptionalFactoryDependency)[];
	/** Build the options from the injected dependencies. */
	useFactory: (...deps: never[]) => SwarmModuleOptions | Promise<SwarmModuleOptions>;
}

/**
 * SwarmModule — registers the swarm primitives and their CONFIGURATION.
 *
 * HOW TO USE IT
 *
 *   SwarmModule.forRoot({                       // values already resolved
 *     election: { evalStableMs: 30_000, ... },
 *     join:     { controlPlaneCandidates: [...], quorumMax: 3 },
 *   })
 *
 *   SwarmModule.forRootAsync({                  // values from the DI container
 *     imports: [EnvModule],
 *     inject: [EnvService],
 *     useFactory: (env: EnvService) => ({
 *       election: { ... },
 *       join:     { ... },
 *     }),
 *   })
 *
 * WHY THE APP PASSES CONFIG INSTEAD OF BINDING TOKENS ITSELF
 * The package declares the tokens (see `swarm-config`) because it declares the
 * SHAPE it needs. Assembling them by hand in every consuming app meant
 * duplicating the provider list — and getting it wrong silently: a missing
 * provider is a runtime DI failure, not a compile error. `forRoot` keeps the
 * wiring — which provider, in which order, with which collaborators — inside
 * the package that owns the services, while the VALUES still come from the app.
 *
 * DEPENDENCIES THE APP REGISTERS FIRST
 * `DockerService` (`@repo/nest-docker`'s `DockerModule`) and the node-state
 * repositories (`@repo/nest-nodes`' `NodesModule`). Both are `@Global()`, so
 * this module resolves them without importing them — and without inheriting
 * either one's configuration, which the app supplies separately.
 *
 * The module is `@Global()` for the same reason as its siblings: swarm state is
 * process-wide infrastructure that most modules read, and threading an import
 * through each of them would be noise.
 */
@Global()
@Module({})
export class SwarmModule {
	/** Register the swarm primitives with values the app already resolved. */
	static forRoot(options: SwarmModuleOptions): DynamicModule {
		return {
			module: SwarmModule,
			providers: [
				...SwarmModule.configProviders(options),
				...SwarmModule.serviceProviders(),
			],
			exports: SwarmModule.exports(),
		};
	}

	/** Register the swarm primitives with values built from injected dependencies. */
	static forRootAsync(options: SwarmModuleAsyncOptions): DynamicModule {
		const optionsToken = Symbol("SWARM_MODULE_OPTIONS");

		return {
			module: SwarmModule,
			imports: options.imports ?? [],
			providers: [
				{
					provide: optionsToken,
					useFactory: options.useFactory,
					inject: options.inject ?? [],
				},
				...SwarmModule.configFromToken(optionsToken),
				...SwarmModule.serviceProviders(),
			],
			exports: SwarmModule.exports(),
		};
	}

	/**
	 * Bind each config token to its slice of the resolved options.
	 *
	 * The primitives inject their OWN token (`SWARM_ELECTION_CONFIG`, …) rather
	 * than the whole options object, so adding a fourth config contract later
	 * does not widen what the existing three constructors receive.
	 */
	private static configFromToken(optionsToken: symbol): Provider[] {
		return [
			{
				provide: SWARM_ELECTION_CONFIG,
				useFactory: (options: SwarmModuleOptions) => options.election,
				inject: [optionsToken],
			},
			{
				provide: SWARM_JOIN_CONFIG,
				useFactory: (options: SwarmModuleOptions) => options.join,
				inject: [optionsToken],
			},
			{
				provide: SWARM_PARTICIPATION_DEFAULTS,
				useFactory: (options: SwarmModuleOptions) => options.participation ?? {},
				inject: [optionsToken],
			},
			{
				provide: SWARM_BOOT_CONVERGENCE,
				useFactory: (options: SwarmModuleOptions) => options.convergeOnBoot ?? true,
				inject: [optionsToken],
			},
			{
				provide: SWARM_METRICS_PROVIDER,
				useFactory: (options: SwarmModuleOptions) => options.metricsProvider ?? null,
				inject: [optionsToken],
			},
			{
				provide: SWARM_LEADERSHIP_EVENT_SINK,
				useFactory: (options: SwarmModuleOptions) => options.eventSink ?? null,
				inject: [optionsToken],
			},
		];
	}

	/** Bind each config token directly to the value the app passed. */
	private static configProviders(options: SwarmModuleOptions): Provider[] {
		return [
			{ provide: SWARM_ELECTION_CONFIG, useValue: options.election },
			{ provide: SWARM_JOIN_CONFIG, useValue: options.join },
			{ provide: SWARM_PARTICIPATION_DEFAULTS, useValue: options.participation ?? {} },
			{ provide: SWARM_BOOT_CONVERGENCE, useValue: options.convergeOnBoot ?? true },
			{ provide: SWARM_METRICS_PROVIDER, useValue: options.metricsProvider ?? null },
			{ provide: SWARM_LEADERSHIP_EVENT_SINK, useValue: options.eventSink ?? null },
		];
	}

	/** The primitives themselves, resolved from the tokens above. */
	private static serviceProviders(): Provider[] {
		return [
			SwarmClusterService,
			SwarmFleetService,
			SwarmParticipationService,
			SwarmJoinGrantService,
			SwarmLeadershipService,
			SwarmBootstrapService,
		];
	}

	private static exports(): DynamicModule["exports"] {
		return [
			SwarmClusterService,
			SwarmBootstrapService,
			SwarmParticipationService,
			SwarmJoinGrantService,
			SwarmFleetService,
			SwarmLeadershipService,
		];
	}
}
