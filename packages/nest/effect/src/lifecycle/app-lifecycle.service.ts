import { Injectable } from "@nestjs/common";
import {
	makeAppLifecycle,
	type AppLifecyclePhase,
	type AppLifecycleShape,
	type TransitionDetails,
} from "@deployer/lifecycle";

/**
 * The Promise-free face of `@deployer/lifecycle` for Nest callers that read the phase synchronously
 * and report transitions as plain calls. It holds no state or logic of its own: everything runs
 * through `effect`, which Effect code can use directly.
 */
@Injectable()
export class AppLifecycleService {
	/** The Effect lifecycle this host exposes. */
	readonly effect: AppLifecycleShape = makeAppLifecycle();

	/** Current lifecycle phase. */
	get phase(): AppLifecyclePhase {
		return this.effect.stateNow().phase;
	}

	/** Moves to `phase`; never exits the process. */
	transition(phase: AppLifecyclePhase, details?: TransitionDetails): void {
		this.effect.transitionNow(phase, details);
	}

	markReady(): void {
		this.effect.markReadyNow();
	}

	markError(error: string): void {
		this.effect.markErrorNow(error);
	}

	/** Records a probed database URL and its reachability; subscribers are told. */
	markDatabaseProbe(url: string, reachable: boolean): void {
		this.effect.markDatabaseProbeNow(url, reachable);
	}

	markMeshConnected(connected: boolean): void {
		this.effect.markMeshConnectedNow(connected);
	}
}
