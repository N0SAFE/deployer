"use client";

import type {
	SetupInitializeInput,
	SetupPostSetupDestination,
	SetupPostSetupVerification,
	SetupStreamEvent,
} from "@deployer/contracts-entities";

/**
 * The wizard's DATA seam.
 *
 * `@deployer/ui` owns the presentation; each host app owns how it talks to the
 * platform. The API and the web app use different ORPC clients (different
 * origins, different plugins), so passing behaviour in — rather than importing
 * a client — is what lets ONE wizard implementation serve both without
 * duplication.
 *
 * Every member mirrors the hooks the wizard used to import directly, so the
 * moved components kept their exact shape:
 *
 *   useSetupState / useTriggerInitialize / useInitializeStream  → read + drive setup
 *   useProbeDatabase / useProbeMesh / useRemoteAuth             → pre-flight probes
 */
export interface SetupWizardApi {
	/**
	 * Current setup state. Deliberately a loose structural type: the API and the
	 * web app use different query clients (different result envelopes), so the
	 * wizard reads only the fields it actually needs.
	 */
	useSetupState: () => {
		data?:
			| {
					state?: string;
					needsSetup?: boolean;
					/** `null` until a strategy is chosen (the API reports it that way). */
					bootstrapStrategy?: string | null;
			  }
			| undefined;
	};

	/** Starts provisioning; resolves immediately (progress arrives on the stream). */
	useTriggerInitialize: () => {
		mutate: (input: SetupInitializeInput) => void;
		reset: () => void;
		error: unknown;
	};

	/** Live provisioning events (SSE). */
	useInitializeStream: (options?: { enabled?: boolean }) => {
		data?: SetupStreamEvent[] | undefined;
		error: unknown;
		/**
		 * The connection dropped and is being re-established. Expected during the
		 * handover (the ingress is replaced under the stream) — the wizard says so
		 * instead of leaving the timeline silently frozen.
		 */
		reconnecting?: boolean;
	};

	/** Probe a PostgreSQL URL without side effects. */
	useProbeDatabase: () => {
		mutate: (
			databaseUrl: string,
			options?: {
				onSuccess?: (result: { reachable: boolean; latencyMs?: number; error?: string }) => void;
				onError?: (error: unknown) => void;
			},
		) => void;
		isPending?: boolean;
	};

	/** Probe a mesh URL without side effects. */
	useProbeMesh: () => {
		mutate: (
			meshUrl: string,
			options?: {
				onSuccess?: (result: {
					reachable: boolean;
					latencyMs?: number;
					advertisedHost?: string;
					version?: string;
					error?: string;
				}) => void;
				onError?: (error: unknown) => void;
			},
		) => void;
		isPending?: boolean;
	};

	/** Authenticate against a remote mesh node, returning an auth token. */
	useRemoteAuth: () => {
		mutate: (
			input: { meshUrl: string; username: string; password: string },
			options?: {
				onSuccess?: (result: {
					authToken: string;
					userId: string;
					email: string;
					meshUrl: string;
					latencyMs?: number;
				}) => void;
				onError?: (error: unknown) => void;
			},
		) => void;
		isPending?: boolean;
	};

	/** Sign the freshly-created admin in (local setup only). */
	signInWithEmail: (input: { email: string; password: string }) => Promise<unknown>;

	/** Human-readable message for any thrown error. */
	getErrorMessage: (error: unknown, fallback?: string) => string;

	/**
	 * The API origin provisioning calls must target. The API serving the page
	 * knows its own origin; the web app must target the API explicitly.
	 */
	apiBaseUrl: () => string;

	/**
	 * Where the "Continue to dashboard" button lands the operator. The wizard
	 * is served by the API, but the dashboard lives in the web app, so this is
	 * supplied by the host rather than guessed inside the shared component.
	 */
	/**
	 * Where a completed setup sends the operator.
	 *
	 * ASKED OF THE SERVER, not derived from `window.location`. The client cannot
	 * know whether a dashboard exists — that is a flag the API owns — and
	 * guessing from its own hostname is what sent operators to a `web.<host>`
	 * with no router (a 404 on the last click of a successful "API only" setup).
	 *
	 * Returns the resolved destination so the button can be worded truthfully
	 * ("Open the dashboard" vs "Finish") without probing anything.
	 */
	usePostSetupDestination: (options?: { enabled?: boolean }) => {
		data?: SetupPostSetupDestination | undefined;
	};

	/**
	 * Do the API and the dashboard REALLY answer through the cluster ingress?
	 *
	 * The wizard gates its final button on this (plus the browser's own probes of
	 * the returned URLs): the ingress is replaced at the end of setup, and the
	 * stream reporting "done" is not evidence that the new one routes.
	 *
	 * The host polls it while `enabled`. An `error` means the platform could not be
	 * asked yet — a WAIT during the swap, not a verdict.
	 */
	usePostSetupVerification: (options?: { enabled?: boolean }) => {
		data?: SetupPostSetupVerification | undefined;
		error?: unknown;
	};

	/**
	 * Run a failed handover again. Optional: only the setup app owns the handover,
	 * so a host without it (the dashboard) simply offers no retry.
	 */
	retryHandover?: () => Promise<{ accepted: boolean }>;

	/**
	 * Fallback destination used while the answer is loading or if it failed.
	 * Same-origin by construction, so it is always answerable.
	 */
	postSetupRedirectUrl: () => string;
}
