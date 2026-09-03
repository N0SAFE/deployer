"use client";

import { isDefinedORPCError, UNKNOWN_ORPC_ERROR_MESSAGE, getErrorMessage } from "@/lib/orpc/typed-errors";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type {
    SetupStreamEvent,
    SetupInitializeInput,
} from "@repo/contracts-entities";
import { setupEndpoints } from "./endpoints";

// ─── Query keys ───────────────────────────────────────────────────────────────

const setupKeys = {
  all: ['setup'] as const,
  state: () => [...setupKeys.all, 'state'] as const,
  nodeStatus: () => [...setupKeys.all, 'nodeStatus'] as const,
};

// ─── Query hooks ──────────────────────────────────────────────────────────────

/**
 * Current setup state (SetupStateSnapshot).
 * Used by the middleware to redirect to /setup when `needsSetup` is true,
 * and by the wizard page to render the correct step.
 */
export function useSetupState(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: setupKeys.state(),
    queryFn: () =>
      setupEndpoints.getState.call({}, {
        context: { cookie: document.cookie },
      }),
    enabled: options?.enabled ?? true,
    staleTime: 15_000,
    gcTime: 60_000,
  });
}

/**
 * Node status — network identity, configuredAt, etc.
 */
export function useNodeStatus(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: setupKeys.nodeStatus(),
    queryFn: () =>
      setupEndpoints.getNodeStatus.call({}, {
        context: { cookie: document.cookie },
      }),
    enabled: options?.enabled ?? true,
    staleTime: 30_000,
    gcTime: 120_000,
  });
}

// ─── Pre-flight probes ────────────────────────────────────────────────────────

/**
 * Test a PostgreSQL connection URL — instant feedback, no side effects.
 * The contract wraps the result in `{ status: 201, body: ... }`, so unwrap `.body`.
 */
export function useProbeDatabase() {
  return useMutation({
    mutationFn: async (databaseUrl: string) => {
      const res = await setupEndpoints.probeDatabase.call({ databaseUrl });
      return res.body
    },
  });
}

/**
 * Test a mesh URL — instant feedback, no side effects.
 * The contract wraps the result in `{ status: 201, body: ... }`, so unwrap `.body`.
 */
export function useProbeMesh() {
  return useMutation({
    mutationFn: async (meshUrl: string) => {
      const res = await setupEndpoints.probeMesh.call({ meshUrl });
      return res.body as { reachable: boolean; latencyMs?: number; advertisedHost?: string; version?: string; error?: string };
    },
  });
}

// ─── Remote auth (step before remote initialize) ──────────────────────────────

/**
 * Authenticate against a remote mesh node.
 * Returns an authToken used in the initialize call.
 * The contract wraps the result in `{ status: 201, body: ... }`, so unwrap `.body`.
 */
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

// ─── Trigger initialization ──────────────────────────────────────────────────

/**
 * Start the initialization process in the background.
 * Returns `{ accepted: boolean }` immediately. Live progress can be consumed
 * via `useInitializeStream()`.
 *
 * `triggerInitialize` is a simple POST mutation that fires the initialization
 * on the server. Unlike the old `initialize` endpoint, it does NOT return
 * the event stream — that's handled separately by `useInitializeStream`.
 *
 * On successful trigger, invalidate setup state queries so the wizard
 * reflects the new status.
 */
export function useTriggerInitialize() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: SetupInitializeInput) =>
      setupEndpoints.triggerInitialize.call(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: setupKeys.state() });
      queryClient.invalidateQueries({ queryKey: setupKeys.nodeStatus() });
    },
    onError: (error: Error) => {
      toast.error(isDefinedORPCError(error) ? getErrorMessage(error, 'Setup trigger failed') : UNKNOWN_ORPC_ERROR_MESSAGE);
    },
  });
}

// ─── Stream initialization events (SSE) ──────────────────────────────────────

/**
 * Subscribe to the initialization event stream via TanStack Query's
 * `experimental_streamedObservableOptions`.
 *
 * The observable endpoint replays past events for late subscribers,
 * so this hook works seamlessly across page reloads / reconnections.
 *
 * @param options.enabled - Enable the query (e.g. only after trigger)
 */
export function useInitializeStream(options?: { enabled?: boolean }) {
  return useQuery({
    ...setupEndpoints.getInitializeStream.experimental_streamedObservableOptions({
      input: undefined,
      enabled: options?.enabled ?? false,
      refetchInterval: false,
    }),
    staleTime: Infinity,
    gcTime: 0, // don't persist stream data across navigations
  });
}

/**
 * Check if initialization is currently in progress by inspecting the
 * stream data — if the last event is not `completed` or `error`,
 * initialization is still running (or pending).
 */
export function isInitializing(events: SetupStreamEvent[] | undefined): boolean {
  if (!events || events.length === 0) return false;
  const last = events.at(-1);
  if (!last) return false;
  return last.type !== "completed" && last.type !== "error";
}
