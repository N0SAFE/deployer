"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { fleetEndpoints } from "./endpoints";
import { fleetInvalidations } from "./invalidations";
import { wrapWithInvalidations } from "@/domains/shared/helpers";

const enhancedFleet = wrapWithInvalidations(fleetEndpoints, fleetInvalidations);

export function useFleetServers(options?: { enabled?: boolean }) {
  return useQuery(
    fleetEndpoints.listServers.queryOptions({
      input: undefined,
      enabled: options?.enabled ?? true,
      refetchInterval: false,
    }),
  );
}

export function useFleetAllocations(
  input?: {
    serverNodeId?: string;
  },
  options?: { enabled?: boolean },
) {
  return useQuery(
    fleetEndpoints.listAllocations.queryOptions({
      input: {
        query: {
          serverNodeId: input?.serverNodeId,
        },
      },
      enabled: options?.enabled ?? true,
      refetchInterval: false,
    }),
  );
}

export function useMyFleetAllocations(options?: { enabled?: boolean }) {
  return useQuery(
    fleetEndpoints.listMyAllocations.queryOptions({
      input: undefined,
      enabled: options?.enabled ?? true,
      refetchInterval: false,
    }),
  );
}

export function useCheckMyFleetAdmission() {
  return useMutation(fleetEndpoints.checkMyAdmission.mutationOptions());
}

export function useMyFleetAdmissionRequests(
  input?: {
    status?: 'pending' | 'approved' | 'rejected' | 'cancelled'
  },
  options?: { enabled?: boolean },
) {
  return useQuery(
    fleetEndpoints.listMyAdmissionRequests.queryOptions({
      input: {
        query: {
          status: input?.status,
        },
      },
      enabled: options?.enabled ?? true,
      refetchInterval: false,
    }),
  );
}

export function useFleetAdmissionRequests(
  input?: {
    status?: 'pending' | 'approved' | 'rejected' | 'cancelled'
  },
  options?: { enabled?: boolean },
) {
  return useQuery(
    fleetEndpoints.listAdmissionRequests.queryOptions({
      input: {
        query: {
          status: input?.status,
        },
      },
      enabled: options?.enabled ?? true,
      refetchInterval: false,
    }),
  );
}

export function useCreateMyFleetAdmissionRequest() {
  return useMutation(
    fleetEndpoints.createMyAdmissionRequest.mutationOptions({
      onSuccess: enhancedFleet.createMyAdmissionRequest.withInvalidationOnSuccess(),
    }),
  );
}

export function useResolveFleetAdmissionRequest() {
  return useMutation(
    fleetEndpoints.resolveAdmissionRequest.mutationOptions({
      onSuccess: enhancedFleet.resolveAdmissionRequest.withInvalidationOnSuccess(),
    }),
  );
}

export function useUpsertFleetAllocation() {
  return useMutation(
    fleetEndpoints.upsertAllocation.mutationOptions({
      onSuccess: enhancedFleet.upsertAllocation.withInvalidationOnSuccess(),
    }),
  );
}

export function useDeleteFleetAllocation() {
  return useMutation(
    fleetEndpoints.deleteAllocation.mutationOptions({
      onSuccess: enhancedFleet.deleteAllocation.withInvalidationOnSuccess(),
    }),
  );
}

export function useSetFleetServerCapacity() {
  return useMutation(
    fleetEndpoints.setServerCapacity.mutationOptions({
      onSuccess: enhancedFleet.setServerCapacity.withInvalidationOnSuccess(),
    }),
  );
}
