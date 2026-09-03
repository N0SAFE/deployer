"use client";

/** React Query hooks for the managed-web console view — direct ORPC calls
 *  (the views never use HTTP form POSTs / redirects; everything is typed
 *  ORPC + RQ invalidation, exactly like the web app). */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ManagedWebState } from "@repo/api-contracts";
import { orpc } from "./orpc";

/** The getState query options (key reused for invalidation). */
export const managedWebStateOptions = orpc.platform.getManagedWebState.queryOptions({ input: {} });

/** Full console state, hydrated from SSR props then kept fresh via ORPC. */
export function useManagedWebState(initialData?: ManagedWebState) {
  return useQuery({ ...managedWebStateOptions, initialData });
}

/** Invalidate the console state after any mutation. */
function invalidateState(queryClient: ReturnType<typeof useQueryClient>) {
  return queryClient.invalidateQueries({ queryKey: managedWebStateOptions.queryKey });
}

export function useToggleManagedWeb() {
  const queryClient = useQueryClient();
  return useMutation(
    orpc.platform.toggleManagedWeb.mutationOptions({
      onSuccess: () => invalidateState(queryClient),
    }),
  );
}

export function useRestartManagedWeb() {
  const queryClient = useQueryClient();
  return useMutation(
    orpc.platform.restartManagedWeb.mutationOptions({
      onSuccess: () => invalidateState(queryClient),
    }),
  );
}

export function useSetManagedWebOrigin() {
  const queryClient = useQueryClient();
  return useMutation(
    orpc.platform.setManagedWebOrigin.mutationOptions({
      onSuccess: () => invalidateState(queryClient),
    }),
  );
}

export function useEnableManagedWebTunnel() {
  const queryClient = useQueryClient();
  return useMutation(
    orpc.platform.enableManagedWebTunnel.mutationOptions({
      onSuccess: () => invalidateState(queryClient),
    }),
  );
}

export function useDisableManagedWebTunnel() {
  const queryClient = useQueryClient();
  return useMutation(
    orpc.platform.disableManagedWebTunnel.mutationOptions({
      onSuccess: () => invalidateState(queryClient),
    }),
  );
}