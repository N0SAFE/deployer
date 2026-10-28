import { Global, Inject, Injectable, Module, type DynamicModule, type OnApplicationBootstrap, type OnModuleDestroy } from "@nestjs/common";
import { makeSupervisorOrchestrator, SupervisorOrchestrator, type SupervisorOrchestratorShape } from "@deployer/supervision";
import { Effect } from "effect";

import { SupervisorEventBus } from "./supervisor-event.bus";

/** Converges every registered supervisor once the app is up, then keeps correcting drift until shutdown. */
@Injectable()
class SupervisorDriftControl implements OnApplicationBootstrap, OnModuleDestroy {
	private stop: Effect.Effect<void> | undefined;

	constructor(@Inject(SupervisorOrchestrator) private readonly orchestrator: SupervisorOrchestratorShape) {}

	async onApplicationBootstrap(): Promise<void> {
		if (process.env.NODE_ENV === "test" || this.orchestrator.list().length === 0) return;
		const control = await Effect.runPromise(this.orchestrator.startDriftControl);
		this.stop = control.stop;
	}

	async onModuleDestroy(): Promise<void> {
		if (this.stop) await Effect.runPromise(this.stop);
	}
}

/**
 * The global home of the supervision framework: provides the `SupervisorOrchestrator` Effect service
 * (and the RxJS event bus beside it) so supervisors anywhere can register and the health module can
 * aggregate without wiring.
 *
 * A leaf on purpose, so a module (or a unit harness) importing it does not drag in Docker, Env or
 * Platform. The registry is per Nest container, not per process: each application gets its own
 * supervisors, which is what lets an e2e suite boot several nodes in one process.
 */
@Global()
@Module({})
export class SupervisorsModule {
	static forRoot(): DynamicModule {
		return {
			module: SupervisorsModule,
			providers: [
				SupervisorEventBus,
				{
					provide: SupervisorOrchestrator,
					useFactory: (bus: SupervisorEventBus) => makeSupervisorOrchestrator(bus.core),
					inject: [SupervisorEventBus],
				},
				{
					provide: SupervisorDriftControl,
					useFactory: (orchestrator: SupervisorOrchestratorShape) => new SupervisorDriftControl(orchestrator),
					inject: [SupervisorOrchestrator],
				},
			],
			exports: [SupervisorOrchestrator, SupervisorEventBus],
		};
	}
}
