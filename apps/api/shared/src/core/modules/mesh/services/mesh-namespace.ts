/**
 * One mesh topic namespace: registered with the topic service, it broadcasts a request to every node and collects
 * the responses (`callMany`), and answers requests from other nodes (`registerCallHandler`). A plain object over
 * its collaborators, so a service composes it instead of extending a base class, and it is tested with fakes.
 */
import { randomUUID } from "node:crypto";
import { AppError } from "@deployer/errors";
import type { EventContracts, EventInput, EventOutput } from "@deployer/events";
import { filter } from "rxjs";

import type {
  MeshCallManyOptions,
  MeshCallManyResult,
  MeshCancelEnvelope,
  MeshQueryHandler,
  MeshRequestEnvelope,
  MeshResponseEnvelope,
} from "./base-mesh.service";
import type { MeshTopicNamespaceHandle } from "./system-mesh-topic/domain/mesh-topic-types";

/** What a namespace needs from the topic service. */
export type MeshNamespaceTopics<TContracts extends EventContracts> = {
  registerNamespace(input: { namespace: string; contracts: TContracts }): MeshTopicNamespaceHandle<TContracts>;
};

/** What a namespace needs from the topology service. */
export type MeshNamespaceTopology = {
  getLocalNode(): { nodeId: string };
  /** Present on the real topology: how many peers are connected, to know how many answers to expect. */
  listPeerSessions?: () => { items: { state?: string | null }[] };
};

export type MeshNamespaceLogger = {
  error(message: string, error?: unknown): void;
};

export type MeshNamespace<TContracts extends EventContracts> = {
  /** The topic handle, or null before `initialize` and after `teardown`. */
  readonly handle: MeshTopicNamespaceHandle<TContracts> | null;
  initialize(): void;
  teardown(): void;
  callMany<TRequest, TResponse>(
    requestTopic: keyof TContracts,
    responseTopic: keyof TContracts,
    cancelTopic: keyof TContracts,
    payload: TRequest,
    options?: MeshCallManyOptions<TResponse>,
  ): Promise<MeshCallManyResult<TResponse>>;
  registerCallHandler<TRequest, TResponse>(
    requestTopic: keyof TContracts,
    responseTopic: keyof TContracts,
    cancelTopic: keyof TContracts,
    handler: MeshQueryHandler<TRequest, TResponse>,
  ): void;
  broadcastCancel(cancelTopic: keyof TContracts, correlationId: string, reason: MeshCancelEnvelope["reason"]): void;
};

/** How many nodes should answer: this one plus every connected peer, or unknown when the topology cannot say. */
export function resolveExpectedResponders(topology: MeshNamespaceTopology): number | null {
  if (typeof topology.listPeerSessions !== "function") return null;
  const connected = topology.listPeerSessions().items.filter((session) => session.state === "connected").length;
  return Math.max(1, connected + 1);
}

const DEFAULT_CALL_TIMEOUT_MS = 1_500;
const DEFAULT_MAX_COLLECTED_RESPONSES = 256;

export function makeMeshNamespace<TContracts extends EventContracts>(options: {
  readonly topics: MeshNamespaceTopics<TContracts>;
  readonly topology: MeshNamespaceTopology;
  readonly namespace: string;
  readonly contracts: TContracts;
  readonly logger: MeshNamespaceLogger;
}): MeshNamespace<TContracts> {
  const { topics, topology, namespace, contracts, logger } = options;

  let handle: MeshTopicNamespaceHandle<TContracts> | null = null;
  const cleanupHandlers: (() => void)[] = [];
  const cancelledCorrelations = new Set<string>();

  const requireHandle = (): MeshTopicNamespaceHandle<TContracts> => {
    if (!handle) {
      throw new AppError(
        `Mesh namespace '${namespace}' is not initialized. Ensure onModuleInit() has been called.`,
        "INTERNAL_ERROR",
      );
    }
    return handle;
  };

  const broadcastCancel = (
    cancelTopic: keyof TContracts,
    correlationId: string,
    reason: MeshCancelEnvelope["reason"],
  ): void => {
    const mesh = requireHandle();
    const envelope: MeshCancelEnvelope = {
      correlationId,
      callerNodeId: topology.getLocalNode().nodeId,
      reason,
      emittedAt: new Date().toISOString(),
    };

    cancelledCorrelations.add(correlationId);

    mesh.publish(
      cancelTopic,
      { correlationId } as EventInput<TContracts[keyof TContracts]>,
      envelope as EventOutput<TContracts[keyof TContracts]>,
      {},
    );
  };

  return {
    get handle() {
      return handle;
    },

    initialize() {
      try {
        handle = topics.registerNamespace({ namespace, contracts });
      } catch (err: unknown) {
        // Namespace already registered (e.g. duplicate onModuleInit ordering): safe to skip.
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes("already registered")) return;
        throw err;
      }
    },

    teardown() {
      for (const cleanup of cleanupHandlers) cleanup();
      cleanupHandlers.length = 0;
      cancelledCorrelations.clear();
      handle = null;
    },

    broadcastCancel,

    async callMany<TRequest, TResponse>(
      requestTopic: keyof TContracts,
      responseTopic: keyof TContracts,
      cancelTopic: keyof TContracts,
      payload: TRequest,
      callOptions?: MeshCallManyOptions<TResponse>,
    ): Promise<MeshCallManyResult<TResponse>> {
      const mesh = requireHandle();
      const localNode = topology.getLocalNode();

      const correlationId = randomUUID();
      const timeoutMs = callOptions?.timeoutMs ?? DEFAULT_CALL_TIMEOUT_MS;
      const maxCollectedResponses =
        typeof callOptions?.maxCollectedResponses === "number"
        && Number.isInteger(callOptions.maxCollectedResponses)
        && callOptions.maxCollectedResponses > 0
          ? callOptions.maxCollectedResponses
          : DEFAULT_MAX_COLLECTED_RESPONSES;

      const expectedResponders = resolveExpectedResponders(topology);
      const responses: TResponse[] = [];
      const responderHitCount = new Map<string, number>();

      let droppedResponses = 0;
      let retryResponses = 0;
      let lagTotalMs = 0;
      let lagSamples = 0;
      let maxLagMs = 0;
      let timedOut = false;
      let stoppedEarly = false;
      let reason: "timeout" | "killer_switch" = "timeout";

      await new Promise<void>((resolve) => {
        // The subscription is declared BEFORE the timeout so the timeout callback can safely unsubscribe it
        // (the other order tripped a temporal-dead-zone error when the timeout fired first).
        const responseSubscription = mesh
          .observe$(responseTopic, { correlationId } as EventInput<TContracts[keyof TContracts]>)
          .pipe(
            filter((event) => (event as unknown as MeshResponseEnvelope<TResponse>).correlationId === correlationId),
          )
          .subscribe((event) => {
            const envelope = event as unknown as MeshResponseEnvelope<TResponse>;

            const hitCount = (responderHitCount.get(envelope.responderNodeId) ?? 0) + 1;
            responderHitCount.set(envelope.responderNodeId, hitCount);
            if (hitCount > 1) retryResponses += 1;

            const emittedAtMs = Date.parse(envelope.emittedAt);
            if (!Number.isNaN(emittedAtMs)) {
              const lagMs = Math.max(0, Date.now() - emittedAtMs);
              lagTotalMs += lagMs;
              lagSamples += 1;
              if (lagMs > maxLagMs) maxLagMs = lagMs;
            }

            if (responses.length >= maxCollectedResponses) {
              droppedResponses += 1;
            } else {
              responses.push(envelope.payload);
            }

            const predicateStop = callOptions?.stopWhen?.(envelope.payload, responses) ?? false;
            const expectedReached = expectedResponders !== null && responses.length >= expectedResponders;

            if (envelope.stopPropagation || predicateStop || expectedReached) {
              stoppedEarly = true;
              reason = "killer_switch";
              broadcastCancel(cancelTopic, correlationId, "caller_stop");
              clearTimeout(timeout);
              responseSubscription.unsubscribe();
              resolve();
            }
          });

        const timeout = setTimeout(() => {
          timedOut = true;
          responseSubscription.unsubscribe();
          resolve();
        }, timeoutMs);

        const requestEnvelope: MeshRequestEnvelope<TRequest> = {
          correlationId,
          callerNodeId: localNode.nodeId,
          payload,
          emittedAt: new Date().toISOString(),
        };

        // `publish` is typed to the contract's OUTPUT schema, while this sends a transport envelope: cast at the boundary.
        mesh.publish(
          requestTopic,
          { correlationId } as EventInput<TContracts[keyof TContracts]>,
          requestEnvelope as EventOutput<TContracts[keyof TContracts]>,
          {},
        );
      });

      return {
        correlationId,
        responses,
        stoppedEarly,
        reason,
        metrics: {
          expectedResponders: expectedResponders ?? 0,
          receivedResponses: responses.length,
          droppedResponses,
          retryResponses,
          maxLagMs,
          avgLagMs: lagSamples > 0 ? Math.round(lagTotalMs / lagSamples) : 0,
          timedOut,
        },
      };
    },

    registerCallHandler<TRequest, TResponse>(
      requestTopic: keyof TContracts,
      responseTopic: keyof TContracts,
      cancelTopic: keyof TContracts,
      handler: MeshQueryHandler<TRequest, TResponse>,
    ): void {
      const mesh = requireHandle();
      const localNode = topology.getLocalNode();

      const cancelSub = mesh
        .observe$(cancelTopic, {} as EventInput<TContracts[keyof TContracts]>)
        .subscribe((event) => {
          cancelledCorrelations.add((event as unknown as MeshCancelEnvelope).correlationId);
        });

      const requestSub = mesh
        .observe$(requestTopic, {} as EventInput<TContracts[keyof TContracts]>)
        .subscribe((event) => {
          const request = event as unknown as MeshRequestEnvelope<TRequest>;
          if (cancelledCorrelations.has(request.correlationId)) return;

          // Started in a promise so a handler that throws synchronously is logged like one that rejects.
          void Promise.resolve()
            .then(() =>
              handler({
                correlationId: request.correlationId,
                callerNodeId: request.callerNodeId,
                payload: request.payload,
              }),
            )
            .then((result) => {
              if (cancelledCorrelations.has(request.correlationId)) return;

              const response: MeshResponseEnvelope<TResponse> = {
                correlationId: request.correlationId,
                responderNodeId: localNode.nodeId,
                payload: result.payload,
                stopPropagation: result.stopPropagation ?? false,
                emittedAt: new Date().toISOString(),
              };

              mesh.publish(
                responseTopic,
                { correlationId: request.correlationId } as EventInput<TContracts[keyof TContracts]>,
                response as EventOutput<TContracts[keyof TContracts]>,
              );

              if (result.stopPropagation) {
                broadcastCancel(cancelTopic, request.correlationId, "handler_stop");
              }
            })
            .catch((err: unknown) => {
              logger.error(`Handler error for topic '${String(requestTopic)}'`, err);
            });
        });

      cleanupHandlers.push(() => {
        cancelSub.unsubscribe();
      });
      cleanupHandlers.push(() => {
        requestSub.unsubscribe();
      });
    },
  };
}
