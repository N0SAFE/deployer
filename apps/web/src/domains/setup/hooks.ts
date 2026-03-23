"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { setupEndpoints } from "./endpoints";
import { setupInvalidations } from "./invalidations";
import { wrapWithInvalidations } from "@/domains/shared/helpers";

const enhancedSetup = wrapWithInvalidations(setupEndpoints, setupInvalidations);

export function useSetupStatus(options?: { enabled?: boolean }) {
  return useQuery(
    setupEndpoints.getStatus.queryOptions({
      input: {},
      enabled: options?.enabled ?? true,
      staleTime: 15_000,
      gcTime: 60_000,
    }),
  );
}

export function useSetupStateMachine(options?: { enabled?: boolean }) {
  return useQuery(
    setupEndpoints.getStateMachine.queryOptions({
      input: {},
      enabled: options?.enabled ?? true,
      staleTime: 60_000,
      gcTime: 300_000,
    }),
  );
}

export function useNodeStatus(options?: { enabled?: boolean }) {
  return useQuery(
    setupEndpoints.getNodeStatus.queryOptions({
      input: {},
      enabled: options?.enabled ?? true,
      staleTime: 30_000,
      gcTime: 120_000,
    }),
  );
}

export function useInitializeSetup() {
  return useMutation(
    setupEndpoints.initialize.mutationOptions({
      onSuccess: enhancedSetup.initialize.withInvalidationOnSuccess(() => {
        toast.success("Initial setup completed successfully");
      }),
      onError: (error) => {
        toast.error(`Setup failed: ${error.message}`);
      },
    }),
  );
}

export function useConfigureDatabase() {
  return useMutation(
    setupEndpoints.configureDatabase.mutationOptions({
      onSuccess: enhancedSetup.configureDatabase.withInvalidationOnSuccess(),
      onError: (error) => {
        toast.error(`Database configuration failed: ${error.message}`);
      },
    }),
  );
}
