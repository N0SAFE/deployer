import { runPromiseUnwrapped, runSyncUnwrapped } from "@deployer/effect-core";
import type { SupervisorOrchestratorShape } from "@deployer/supervision";
import { Effect } from "effect";

import { SupervisorEventBus, type SupervisorRegistration } from "../supervision/index";

/** A bus for a spec: the registrations publish on it, nothing else listens. */
export const testBus = (): SupervisorEventBus => new SupervisorEventBus();

/**
 * Drives a `SupervisorRegistration` the way the module does, with Promise-returning helpers so a spec reads
 * as "converge it, look at its health".
 */
export function harness(registration: SupervisorRegistration) {
	const { supervisor } = registration;
	return {
		supervisor,
		supervisorId: supervisor.id,
		ensureDesiredState: () => runPromiseUnwrapped(supervisor.ensureDesiredState),
		// A registration erases the payload types (the registry holds them all); a spec asserts on its own shape.
		getHealth: (): Promise<any> => runPromiseUnwrapped(supervisor.getHealth),
		getProcessInfo: (): Promise<any> => runPromiseUnwrapped(supervisor.getProcessInfo),
		getStateSnapshot: () => runSyncUnwrapped(supervisor.getStateSnapshot),
		/** What the registrar does at module init: decide, then register with the orchestrator. Resolves to whether it registered. */
		async register(orchestrator: SupervisorOrchestratorShape): Promise<boolean> {
			const activation = await runPromiseUnwrapped(registration.activate);
			if (activation === null) return false;
			runSyncUnwrapped(orchestrator.register(supervisor));
			if (activation.background !== undefined) Effect.runFork(activation.background);
			return true;
		},
	};
}
