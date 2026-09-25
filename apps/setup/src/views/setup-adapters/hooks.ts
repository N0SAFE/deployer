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
 */
export function useInitializeStream(options?: { enabled?: boolean }): {
	data?: SetupStreamEvent[] | undefined;
	error: unknown;
} {
	return useQuery({
		...setupEndpoints.getInitializeStream.experimental_streamedObservableOptions({
			input: undefined,
			enabled: options?.enabled ?? false,
			refetchInterval: false,
		}),
		staleTime: Infinity,
		gcTime: 0,
	});
}
