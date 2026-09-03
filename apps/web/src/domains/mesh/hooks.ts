"use client";

import { isDefinedORPCError, UNKNOWN_ORPC_ERROR_MESSAGE, getErrorMessage } from "@/lib/orpc/typed-errors";
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
      input: undefined,
      enabled: options?.enabled ?? true,
      refetchInterval: false,
    }),
  );
}

export function useMeshPeers(options?: { enabled?: boolean }) {
  return useQuery(
    meshEndpoints.listPeers.queryOptions({
      input: undefined,
      enabled: options?.enabled ?? true,
      refetchInterval: false,
    }),
  );
}

export function useMeshPeerSessions(options?: { enabled?: boolean }) {
  return useQuery(
    meshEndpoints.listPeerSessions.queryOptions({
      input: undefined,
      enabled: options?.enabled ?? true,
      refetchInterval: false,
    }),
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
    meshEndpoints.membershipSnapshot.queryOptions({
      input: undefined,
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

// ─── Trust & Security Hooks ──────────────────────────────────────────────────

export function useMeshTrustKeyringStatus(options?: { enabled?: boolean }) {
  return useQuery(
    meshEndpoints.trustKeyringStatus.queryOptions({
      input: undefined,
      enabled: options?.enabled ?? true,
      refetchInterval: false,
    }),
  );
}

export function useMeshTrustKeyringSecrets(options?: { enabled?: boolean }) {
  return useQuery(
    meshEndpoints.trustKeyringSecrets.queryOptions({
      input: undefined,
      enabled: options?.enabled ?? true,
      refetchInterval: false,
    }),
  );
}

export function useMeshTrustKeyringRotate() {
  return useMutation(
    meshEndpoints.trustKeyringRotate.mutationOptions({
      onSuccess: enhancedMesh.trustKeyringRotate.withInvalidationOnSuccess(),
    }),
  );
}

export function useMeshTrustKeyringConvergenceStatus(options?: { enabled?: boolean }) {
  return useQuery(
    meshEndpoints.trustKeyringConvergenceStatus.queryOptions({
      input: undefined,
      enabled: options?.enabled ?? true,
      refetchInterval: false,
    }),
  );
}

export function useMeshTrustStrictReadiness(options?: { enabled?: boolean }) {
  return useQuery(
    meshEndpoints.trustStrictReadiness.queryOptions({
      input: undefined,
      enabled: options?.enabled ?? true,
      refetchInterval: false,
    }),
  );
}

export function useMeshTrustStrictModeSet() {
  return useMutation(
    meshEndpoints.trustStrictModeSet.mutationOptions({
      onSuccess: enhancedMesh.trustStrictModeSet.withInvalidationOnSuccess(),
    }),
  );
}

export function useMeshTrustStrictRolloutPlan(options?: {
  enabled?: boolean;
  waveSize?: number;
}) {
  return useQuery(
    meshEndpoints.trustStrictRolloutPlan.queryOptions({
      input: {
        query: {
          waveSize: options?.waveSize,
        },
      },
      enabled: options?.enabled ?? true,
      refetchInterval: false,
    }),
  );
}

export function useMeshTrustStrictRollback() {
  return useMutation(
    meshEndpoints.trustStrictRollback.mutationOptions({
      onSuccess: enhancedMesh.trustStrictRollback.withInvalidationOnSuccess(),
    }),
  );
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
      ? (isDefinedORPCError(streamQuery.error)
          ? getErrorMessage(streamQuery.error, "Mesh stream connection error")
          : UNKNOWN_ORPC_ERROR_MESSAGE)
      : null,
    state,
  };
}