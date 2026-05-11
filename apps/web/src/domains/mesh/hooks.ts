"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import {
  meshRuntimeEventSchema,
  type MeshRuntimeEvent,
} from "@repo/contracts-entities";
import { meshEndpoints } from "./endpoints";
import { meshInvalidations } from "./invalidations";
import { wrapWithInvalidations } from "@/domains/shared/helpers";

const enhancedMesh = wrapWithInvalidations(meshEndpoints, meshInvalidations);

type MeshStreamStatus = "connecting" | "connected" | "disconnected" | "error";
export interface MeshSseState {
  status: MeshStreamStatus;
  lastError: string | null;
  state: MeshRuntimeEvent | null;
}

type MeshRuntimeStreamInput = Parameters<
  typeof meshEndpoints.streamEvents.experimental_liveObservableOptions
>[0]["input"];

const DEFAULT_MESH_RUNTIME_STREAM_INPUT: MeshRuntimeStreamInput = {
  query: {
    replay: true,
    replayLimit: 1,
  },
};

export function useMeshLocalNode(options?: { enabled?: boolean }) {
  return useQuery(
    meshEndpoints.getLocalNode.queryOptions({
      input: {},
      enabled: options?.enabled ?? true,
      refetchInterval: false,
    }),
  );
}

export function useMeshPeers(options?: { enabled?: boolean }) {
  return useQuery(
    meshEndpoints.listPeers.queryOptions({
      input: {},
      enabled: options?.enabled ?? true,
      refetchInterval: false,
    }),
  );
}

export function useMeshPeerSessions(options?: { enabled?: boolean }) {
  return useQuery(
    meshEndpoints.listPeerSessions.queryOptions({
      input: {},
      enabled: options?.enabled ?? true,
      refetchInterval: false,
    }),
  );
}

type MeshListEventStreamsInput = Parameters<typeof meshEndpoints.listEventStreams.queryOptions>[0]["input"];

export function useMeshEventStreams(input: MeshListEventStreamsInput, options?: { enabled?: boolean }) {
  return useQuery(
    meshEndpoints.listEventStreams.queryOptions({
      input,
      enabled: options?.enabled ?? true,
      refetchInterval: false,
    }),
  );
}

export function useMeshEventStreamById(streamId: string | undefined, options?: { enabled?: boolean }) {
  return useQuery(
    meshEndpoints.findEventStreamById.queryOptions({
      input: {
        params: {
          id: streamId ?? "00000000-0000-0000-0000-000000000000",
        },
      },
      enabled: (options?.enabled ?? true) && !!streamId,
      refetchInterval: false,
    }),
  );
}

export function useMeshMembershipSnapshot(options?: { enabled?: boolean }) {
  return useQuery(
    meshEndpoints.membershipSnapshot.queryOptions({
      input: {},
      enabled: options?.enabled ?? true,
      refetchInterval: false,
    }),
  );
}

export function useConnectMeshPeer() {
  return useMutation(
    meshEndpoints.connectPeer.mutationOptions({
      onSuccess: enhancedMesh.connectPeer.withInvalidationOnSuccess(),
    }),
  );
}

export function useDisconnectMeshPeer() {
  return useMutation(
    meshEndpoints.disconnectPeer.mutationOptions({
      onSuccess: enhancedMesh.disconnectPeer.withInvalidationOnSuccess(),
    }),
  );
}

export function useReconcileMeshMembership() {
  return useMutation(
    meshEndpoints.reconcileMembership.mutationOptions({
      onSuccess: enhancedMesh.reconcileMembership.withInvalidationOnSuccess(),
    }),
  );
}

export function useLookupMeshResource() {
  return useMutation(meshEndpoints.lookupResource.mutationOptions({}));
}

export function useUpsertMeshResourceIndex() {
  return useMutation(
    meshEndpoints.upsertResourceIndex.mutationOptions({
      onSuccess: enhancedMesh.upsertResourceIndex.withInvalidationOnSuccess(),
    }),
  );
}

export function usePlanMeshStreamRoute() {
  return useMutation(meshEndpoints.planStreamRoute.mutationOptions({}));
}

export function useMeshSseState(
  input: MeshRuntimeStreamInput = DEFAULT_MESH_RUNTIME_STREAM_INPUT,
): MeshSseState {
  const streamQuery = useQuery(
    meshEndpoints.streamEvents.experimental_liveObservableOptions({
      input,
      refetchInterval: false,
    }),
  );

  const parsedState = meshRuntimeEventSchema.safeParse(streamQuery.data);
  const state = parsedState.success ? parsedState.data : null;

  const status: MeshStreamStatus = streamQuery.isError
    ? "error"
    : streamQuery.fetchStatus === "fetching"
      ? streamQuery.data
        ? "connected"
        : "connecting"
      : "disconnected";

  return {
    status,
    lastError: streamQuery.isError
      ? streamQuery.error instanceof Error
        ? streamQuery.error.message
        : "Mesh stream connection error"
      : null,
    state,
  };
}