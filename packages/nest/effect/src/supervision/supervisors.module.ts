import { Global, Module, type DynamicModule } from "@nestjs/common";

import { SupervisorEventBus } from "./supervisor-event.bus";
import { SupervisorOrchestratorService } from "./supervisor-orchestrator.service";

/**
 * The global home of the supervision framework: exports the orchestrator so supervisors anywhere
 * can register through constructor injection and the health module can aggregate without wiring.
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
			providers: [SupervisorEventBus, SupervisorOrchestratorService],
			exports: [SupervisorOrchestratorService, SupervisorEventBus],
		};
	}
}
