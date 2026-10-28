/**
 * The phases an application moves through while it starts and runs.
 *
 *   initialized          App module loaded, HTTP server starting
 *   discovering          Resolving the database URL (mesh, then the SQLite cache)
 *   probing              Testing database connectivity (`SELECT 1`)
 *   bootstrapping        Sub-app bootstrap steps
 *   joining_mesh         Connecting to mesh peers
 *   ready                All sub-apps completed, full functionality
 *   degraded             Database lost mid-run, recovery loop active
 *   error                Irrecoverable error during bootstrap
 */
export const AppLifecyclePhase = {
	INITIALIZED: "initialized",
	DISCOVERING: "discovering",
	PROBING: "probing",
	BOOTSTRAPPING: "bootstrapping",
	JOINING_MESH: "joining_mesh",
	READY: "ready",
	DEGRADED: "degraded",
	ERROR: "error",
} as const;
export type AppLifecyclePhase = (typeof AppLifecyclePhase)[keyof typeof AppLifecyclePhase];

/** The steps of the bootstrapping phase. */
export const BootstrapStep = {
	DEV: "dev",
	CONFIG: "config",
	SETUP_WIZARD: "setupWizard",
	DATABASE: "database",
	MESH: "mesh",
} as const;
export type BootstrapStep = (typeof BootstrapStep)[keyof typeof BootstrapStep];

/** One change of lifecycle state, as subscribers see it. */
export type AppLifecycleEvent = {
	readonly phase: AppLifecyclePhase;
	readonly step?: BootstrapStep | undefined;
	readonly message?: string | undefined;
	readonly timestamp: string;
	readonly error?: string | undefined;
	readonly metadata?: Readonly<Record<string, unknown>> | undefined;
};

/** What `transition` may carry besides free-form metadata. */
export type TransitionDetails = { readonly error?: string; readonly message?: string } & Readonly<Record<string, unknown>>;

export type LifecycleState = {
	readonly phase: AppLifecyclePhase;
	readonly step: BootstrapStep | null;
	readonly error: string | null;
	readonly metadata: Readonly<Record<string, unknown>>;
};

export const describePhase = (state: Pick<LifecycleState, "phase" | "step" | "error">): string => {
	switch (state.phase) {
		case AppLifecyclePhase.INITIALIZED:
			return "Application initialized, awaiting bootstrap";
		case AppLifecyclePhase.DISCOVERING:
			return "Resolving database URL";
		case AppLifecyclePhase.PROBING:
			return "Testing database connectivity";
		case AppLifecyclePhase.BOOTSTRAPPING:
			return `Bootstrapping: ${state.step ?? "unknown"}`;
		case AppLifecyclePhase.JOINING_MESH:
			return "Connecting to mesh peers";
		case AppLifecyclePhase.READY:
			return "Application is fully ready";
		case AppLifecyclePhase.DEGRADED:
			return "Application is running in degraded mode";
		case AppLifecyclePhase.ERROR:
			return `Bootstrap failed: ${state.error ?? "unknown error"}`;
	}
};
