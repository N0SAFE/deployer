"use client";

/**
 * The setup data hooks for the API-served wizard.
 *
 * The UI itself is shared (`@repo/ui/components/setup`); only the transport is
 * app-specific. The API serves the page AND the ORPC endpoints on one origin,
 * so these differ from the web app's hooks only in the client they use.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { SetupInitializeInput, SetupStreamEvent } from "@repo/contracts-entities";
import { setupEndpoints } from "@/views/setup-adapters/endpoints";
import { getErrorMessage } from "@/views/lib/errors";

const setupKeys = {
	all: ["setup"] as const,
	state: () => [...setupKeys.all, "state"] as const,
	nodeStatus: () => [...setupKeys.all, "nodeStatus"] as const,
	destination: () => [...setupKeys.all, "destination"] as const,
};

/** Current setup state (drives step selection + recovery adoption). */
export function useSetupState(options?: { enabled?: boolean }) {
	return useQuery({
		queryKey: setupKeys.state(),
		queryFn: () => setupEndpoints.getState.call({}),
		enabled: options?.enabled ?? true,
		staleTime: 15_000,
		gcTime: 60_000,
	});
}

/** Node status — network identity, configuredAt, etc. */
export function useNodeStatus(options?: { enabled?: boolean }) {
	return useQuery({
		queryKey: setupKeys.nodeStatus(),
		queryFn: () => setupEndpoints.getNodeStatus.call({}),
		enabled: options?.enabled ?? true,
		staleTime: 30_000,
		gcTime: 120_000,
	});
}

/** Test a PostgreSQL URL — instant feedback, no side effects. */
export function useProbeDatabase() {
	return useMutation({
		mutationFn: async (databaseUrl: string) => {
			const res = await setupEndpoints.probeDatabase.call({ databaseUrl });
			return res.body;
		},
	});
}

/** Test a mesh URL — instant feedback, no side effects. */
export function useProbeMesh() {
	return useMutation({
		mutationFn: async (meshUrl: string) => {
			const res = await setupEndpoints.probeMesh.call({ meshUrl });
			return res.body as {
				reachable: boolean;
				latencyMs?: number;
				advertisedHost?: string;
				version?: string;
				error?: string;
			};
		},
	});
}

/** Authenticate against a remote mesh node, returning an auth token. */
export function useRemoteAuth() {
	return useMutation({
		mutationFn: async (input: { meshUrl: string; username: string; password: string }) => {
			const res = await setupEndpoints.remoteAuth.call(input);
			return res.body as {
				authToken: string;
				userId: string;
				email: string;
				meshUrl: string;
				latencyMs?: number;
			};
		},
	});
}

/** Start provisioning in the background (progress arrives on the stream). */
export function useTriggerInitialize() {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: (input: SetupInitializeInput) => setupEndpoints.triggerInitialize.call(input),
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: setupKeys.state() });
			void queryClient.invalidateQueries({ queryKey: setupKeys.nodeStatus() });
		},
		onError: (error: Error) => {
			toast.error(getErrorMessage(error, "Setup trigger failed"));
		},
	});
}

/**
 * Subscribe to the provisioning event stream (SSE).
 *
 * The observable endpoint replays past events for late subscribers, so a reload
 * mid-provision still shows the full progress rather than an empty view.
 *
 * ── WHY THE STREAM DROPS, AND WHY RETRYING THE SAME URL IS RIGHT ────────────
 * The ingress is REPLACED during the handover: setup's bootstrap Traefik
 * releases the entry port and the swarm-managed one binds it. The browser's SSE
 * connection is open across that swap, so it is torn down — and without a
 * reconnect the operator's timeline stops mid-pipeline.
 *
 * The SAME origin is the correct target rather than a convenient one: the page's
 * origin is `setup.<host>`, and the handover's last act points that hostname at
 * the API. So the URL that answers before the swap answers after it — the
 * router's backend changes, the address does not. No endpoint discovery needed.
 *
 * ── `isComplete`, NOT JUST `retry` ──────────────────────────────────────────
 * A torn-down SSE ends with a CLEAN `complete()`, which is indistinguishable
 * from "the work finished" unless something says otherwise. With only a `retry`
 * configured, the query was marked successful, nothing retried, and the network
 * tab showed no request — because none was made. The operator saw the steps
 * blank out with no explanation.
 *
 * `isComplete` is what tells the collector that a clean end WITHOUT a terminal
 * event is a failure, so it rejects, TanStack's `retry` fires, and `queryFn`
 * runs again — issuing a genuinely new request against whatever now serves this
 * origin.
 *
 * The step list is PRESERVED across those reconnects (the collector accumulates
 * onto the cached values), so the operator keeps seeing the progress they
 * already had instead of an empty "Starting setup…" view.
 */
const STREAM_RETRY_INTERVAL_MS = 1_500;
/**
 * Bounded so a genuinely dead stream eventually reports rather than retrying
 * forever. Long enough to cover the ingress swap on a warm node, which is a port
 * release plus a service scheduling round trip — setup itself waits up to 90s
 * for that, so the client must not give up first.
 */
const STREAM_MAX_RETRIES = 30;

/**
 * How long the stream may go SILENT before the connection is treated as dead.
 *
 * Short on purpose. An SSE connection has no natural end, so a HALF-OPEN one
 * (the peer disappeared without closing — what an ingress swap produces) stays
 * `pending` forever unless something aborts it, and the operator waits on a
 * frozen timeline. Setup's pipeline emits snapshots constantly while it works,
 * so seconds of total silence means a dead socket rather than a slow producer.
 */
const STREAM_INACTIVITY_TIMEOUT_MS = 8_000;

/**
 * Whether the setup stream has reached a TERMINAL event.
 *
 * SEARCHED, not read from the last event. The two producers append to one
 * timeline and the later one can append AFTER the terminal: setup reports the
 * ingress swap, and the API's `completed` can arrive before the client has
 * folded every replayed frame. Reading `at(-1)` would then miss the completion
 * and retry forever.
 */
function isSetupStreamFinished(events: readonly SetupStreamEvent[]): boolean {
	return events.some((event) => event.type === "completed" || event.type === "error");
}

export function useInitializeStream(options?: { enabled?: boolean }): {
	data?: SetupStreamEvent[] | undefined;
	error: unknown;
} {
	return useQuery({
		...setupEndpoints.getInitializeStream.experimental_streamedObservableOptions({
			input: undefined,
			enabled: options?.enabled ?? false,
			refetchInterval: false,
			// See the hook note: this is what turns a cut connection into a
			// RETRYABLE failure rather than a silent success.
			isComplete: isSetupStreamFinished,
			// Short window, so a half-open socket is abandoned in seconds instead of
			// leaving a `pending` request the operator watches indefinitely.
			inactivityTimeoutMs: STREAM_INACTIVITY_TIMEOUT_MS,
		}),
		staleTime: Infinity,
		gcTime: 0,
		// Now reachable, because `isComplete` rejects an incomplete stream.
		retry: (failureCount) => failureCount < STREAM_MAX_RETRIES,
		retryDelay: (attempt) => Math.min(STREAM_RETRY_INTERVAL_MS * (attempt + 1), 5_000),
	});
}

/**
 * Where a completed setup sends the operator, as decided by the SERVER.
 *
 * Fetched rather than derived from `window.location` because the answer depends
 * on a flag only the API can read (is a dashboard running?). Deriving it client-
 * side sent operators to a `web.<host>` with no router on an "API only" install.
 *
 * Disabled until the stream reports completion, so a fresh wizard does not ask
 * before there is anything to ask about.
 */
export function usePostSetupDestination(options?: { enabled?: boolean }) {
	return useQuery({
		queryKey: setupKeys.destination(),
		queryFn: () => setupEndpoints.getPostSetupDestination.call({}),
		enabled: options?.enabled ?? true,
		staleTime: Infinity,
		gcTime: 60_000,
	});
}
