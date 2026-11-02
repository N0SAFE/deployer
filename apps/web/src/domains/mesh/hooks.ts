"use client";

import { useMutation, useQuery } from "@tanstack/react-query";

import { nodeAgentSnapshotSchema, type NodeAgentSnapshot } from "@deployer/contracts-entities";

import { wrapWithInvalidations } from "@/domains/shared/helpers";
import { isDefinedORPCError, UNKNOWN_ORPC_ERROR_MESSAGE, getErrorMessage } from "@/lib/orpc/typed-errors";

import { meshEndpoints } from "./endpoints";
import { meshInvalidations } from "./invalidations";


const enhancedMesh = wrapWithInvalidations(meshEndpoints, meshInvalidations);

type MeshStreamStatus = "connecting" | "connected" | "disconnected" | "error";
export interface MeshSseState {
  status: MeshStreamStatus;
  lastError: string | null;
  state: NodeAgentSnapshot | null;
}

export function useMeshLocalNode(options?: { enabled?: boolean }) {
  return useQuery(
    { ...meshEndpoints.getLocalNode.queryOptions({ input: {} }), enabled: options?.enabled ?? true, refetchInterval: false },
  );
}

export function useMeshPeers(options?: { enabled?: boolean }) {
  return useQuery(
    { ...meshEndpoints.listPeers.queryOptions({ input: {} }), enabled: options?.enabled ?? true, refetchInterval: false },
  );
}

type MeshListEventStreamsInput = Parameters<typeof meshEndpoints.listEventStreams.queryOptions>[0]["input"];

/** Only fetch when the stream id is a real UUID — never a `:id` template placeholder. */
const MESH_STREAM_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
function isMeshStreamIdUsable(id: string | undefined | null): id is string {
  return typeof id === 'string' && MESH_STREAM_UUID_RE.test(id)
}

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
  const usable = isMeshStreamIdUsable(streamId)
  return useQuery(
    meshEndpoints.findEventStreamById.queryOptions({
      input: {
        params: {
          id: usable ? streamId : "00000000-0000-0000-0000-000000000000",
        },
      },
      // Strict UUID guard: a template placeholder like `:id` must NOT fire.
      // The all-zeros id below only ever leaves the client when the guard
      // accidentally allows it; the contract rejects it server-side.
      enabled: (options?.enabled ?? true) && usable,
      refetchInterval: false,
    }),
  );
}

export function useMeshMembershipSnapshot(options?: { enabled?: boolean }) {
  return useQuery(
    { ...meshEndpoints.membershipSnapshot.queryOptions({ input: {} }), enabled: options?.enabled ?? true, refetchInterval: false },
  );
}

export function useCreateMeshJoinToken() {
  return useMutation(meshEndpoints.issueJoinToken.mutationOptions({}));
}

export function useLookupMeshResource() {
  return useMutation(meshEndpoints.lookupResource.mutationOptions({}));
}

// ─── Node Configuration Hooks ─────────────────────────────────────────────────

export function useMeshNodeConfig(options?: { enabled?: boolean }) {
  return useQuery(
    meshEndpoints.getNodeConfig.queryOptions({
      input: {},
      enabled: options?.enabled ?? true,
      refetchInterval: false,
    }),
  );
}

export function useMeshUpdateNodeConfig() {
  return useMutation(
    meshEndpoints.updateNodeConfig.mutationOptions({
      onSuccess: enhancedMesh.updateNodeConfig.withInvalidationOnSuccess(),
    }),
  );
}

export function useMeshRegenerateNodeConfigSecret() {
  return useMutation(
    meshEndpoints.regenerateNodeConfigSecret.mutationOptions({
      onSuccess: enhancedMesh.regenerateNodeConfigSecret.withInvalidationOnSuccess(),
    }),
  );
}

export function useMeshTestNodeConfigDb() {
  return useMutation(
    meshEndpoints.testNodeConfigDb.mutationOptions({}),
  );
}

export function useMeshSseState(): MeshSseState {
  const streamQuery = useQuery(
    meshEndpoints.streamTopology.experimental_liveObservableOptions({
      input: {},
      refetchInterval: false,
    }),
  );

  const parsedState = nodeAgentSnapshotSchema.safeParse(streamQuery.data);
  const state = parsedState.success ? parsedState.data : null;

  const status: MeshStreamStatus = streamQuery.isError
    ? "error"
    : streamQuery.fetchStatus === "fetching"
      ? streamQuery.data
        ? "connected"
        : "connecting"
      : streamQuery.data
        ? "connected"
        : "disconnected";

  return {
    status,
    lastError: streamQuery.isError
      ? (isDefinedORPCError(streamQuery.error)
          ? getErrorMessage(streamQuery.error, "Mesh stream connection error")
          : UNKNOWN_ORPC_ERROR_MESSAGE)
      : null,
    state,
  };
}
