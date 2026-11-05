import { Global, Module } from "@nestjs/common";
import { Effect } from "effect";

import { declareModule, effectHostProvider, EffectHost, ServiceLifecycleRunner, type EffectHostShape, type ServiceLifecycleShape } from "@deployer/nest-effect";
import { makeSupervisorOrchestrator, SupervisorOrchestrator, type SupervisorOrchestratorShape } from "@deployer/supervision";

import { makeSupervisorEventBusFacade, SupervisorEventBus, type SupervisorEventBusFacade } from "./supervisor-event.bus";

/**
 * Converges every registered supervisor once the app is up, then keeps correcting drift until shutdown.
 *
 * `onReady` (not `onStart`): it must run after EVERY module's registrar has registered its supervisors, so it waits for the
 * application to finish bootstrapping.
 */
export function makeSupervisorDriftControl(orchestrator: SupervisorOrchestratorShape): ServiceLifecycleShape {
	let stop: Effect.Effect<void> | undefined;
	return {
		onReady: () =>
			Effect.gen(function* () {
				if (process.env.NODE_ENV === "test" || orchestrator.list().length === 0) return;
				const control = yield* orchestrator.startDriftControl;
				stop = control.stop;
			}),
		onStop: () => (stop ?? Effect.void),
	};
}

/**
 * The global home of the supervision framework: provides the `SupervisorOrchestrator` Effect service (and the RxJS event bus
 * beside it) so supervisors anywhere can register and the health module can aggregate without wiring.
 *
 * A leaf on purpose, so a module (or a unit harness) importing it does not drag in Docker, Env or Platform. The registry is
 * per Nest container, not per process: each application gets its own supervisors, which is what lets an e2e suite boot
 * several nodes in one process.
 */
@Global()
@Module({})
class SupervisorsNestModule {
	static forRoot() {
		return declareModule(
			{
				module: SupervisorsNestModule,
				providers: [
					effectHostProvider(),
					{ provide: SupervisorEventBus, useFactory: makeSupervisorEventBusFacade },
					{
						provide: SupervisorOrchestrator,
						useFactory: (bus: SupervisorEventBusFacade) => makeSupervisorOrchestrator(bus.core),
						inject: [SupervisorEventBus],
					},
					{
						provide: Symbol.for("shared/SupervisorDriftControl"),
						useFactory: (orchestrator: SupervisorOrchestratorShape, host: EffectHostShape) =>
							new ServiceLifecycleRunner("shared/SupervisorDriftControl", makeSupervisorDriftControl(orchestrator), host),
						inject: [SupervisorOrchestrator, EffectHost],
					},
				],
				exports: [SupervisorOrchestrator, SupervisorEventBus],
			},
			{ provides: [SupervisorOrchestrator, SupervisorEventBus], exports: [SupervisorOrchestrator, SupervisorEventBus], global: true },
		);
	}
}

export const SupervisorsModule = declareModule(SupervisorsNestModule, {
	exports: [SupervisorOrchestrator, SupervisorEventBus],
	global: true,
});
