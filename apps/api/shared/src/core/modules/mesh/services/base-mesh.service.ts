import { randomUUID } from "node:crypto";
import { Logger } from "@nestjs/common";
import { filter, type Observable } from "rxjs";
import type { SystemMeshTopicService } from "./system-mesh-topic/orchestrator/system-mesh-topic.service";
import type { MeshTopicNamespaceHandle } from "./system-mesh-topic/domain/mesh-topic-types";
import type { SystemMeshTopologyService } from "./system-mesh-topology/orchestrator/system-mesh-topology.service";
import type { EventContracts, EventInput, EventOutput } from "@repo/nest-events";
import type { AnyMeshEntity, MeshEntityItem } from "../mesh-entity";
import type { AnyMeshQuery } from "../mesh-query";
import type { AnyMeshMutation } from "../mesh-mutation";
import type { MeshOperation } from "../primitives";
import * as z from "zod/v4";

import { AppError } from "@repo/errors";
// ─── Entity accessor helpers ──────────────────────────────────────────────────
//
// Support two entity shapes:
// - mesh-entity style:  { queries: Record<name, AnyMeshQuery>, mutations: ... }
//   where EachMeshQuery has { inputSchema, outputSchema }
// - mesh-primitive style: { operations: Record<name, MeshOperation> }
//   where each operation has { requestSchema, responseSchema }

function getEntityQueries(entity: AnyMeshEntity | { operations?: Record<string, MeshOperation> }):
  | Record<string, AnyMeshQuery>
  | undefined {
  if ("queries" in entity) return entity.queries;
  return undefined;
}

function getEntityOperations(entity: { operations?: Record<string, MeshOperation> }):
  | Record<string, MeshOperation>
  | undefined {
  return entity.operations;
}

// Resolved type for entity queries/mutations/operations
type ResolvedEntityQuery<T> = T extends AnyMeshQuery
  ? {
      input: ReturnType<T["inputSchema"]["parse"]>;
      output: ReturnType<T["outputSchema"]["parse"]>;
    }
  : T extends MeshOperation
    ? {
        input: ReturnType<T["requestSchema"]["parse"]>;
        output: ReturnType<T["responseSchema"]["parse"]>;
      }
    : never;

function resolveQueryInfo(entity: AnyMeshEntity, entityKey: string, method: string) {
  const queries = getEntityQueries(entity);
  if (queries && method in queries) {
    const q = queries[method]!;
    return {
      input: q.inputSchema.parse({}),
      output: q.outputSchema.parse({}),
    };
  }
  const ops = getEntityOperations(entity as { operations?: Record<string, MeshOperation> });
  if (ops && method in ops) {
    const o = ops[method] as MeshOperation;
    return {
      input: o.requestSchema.parse({}),
      output: o.responseSchema.parse({}),
    };
  }
  return undefined;
}

// ─── Contract generation helpers ──────────────────────────────────────────────
// Build MeshEvent contracts (req/res/cancel) from entity operation definitions.

function buildEntityOperationContracts(
  namespace: string,
  entityKey: string,
  operationKey: string,
): Record<string, { input: z.ZodType; output: z.ZodType }> {
  const prefix = `${namespace}:${entityKey}:${operationKey}`;
  const correlationSchema = z.object({
    correlationId: z.string().optional(),
  });

  return {
    [`${prefix}:req`]: {
      input: correlationSchema,
      output: z.object({
        correlationId: z.string(),
        callerNodeId: z.string(),
        payload: z.record(z.string(), z.unknown()),
        emittedAt: z.string(),
      }),
    },
    [`${prefix}:res`]: {
      input: correlationSchema,
      output: z.object({
        correlationId: z.string(),
        responderNodeId: z.string(),
        payload: z.record(z.string(), z.unknown()),
        stopPropagation: z.boolean().optional(),
        emittedAt: z.string(),
      }),
    },
    [`${prefix}:cancel`]: {
      input: correlationSchema,
      output: z.object({
        correlationId: z.string(),
        callerNodeId: z.string(),
        reason: z.enum(["caller_stop", "handler_stop"]),
        emittedAt: z.string(),
      }),
    },
  };
}

// ─── Topic derivation ─────────────────────────────────────────────────────────

export type MeshTopicSuffix = "req" | "res" | "cancel" | "changed";

export type MeshDerivedTopic<
  TNamespace extends string,
  TEntityKey extends string,
  TMethod extends string,
  TSuffix extends MeshTopicSuffix,
> = `${TNamespace}:${TEntityKey}:${TMethod}:${TSuffix}`;

export type MeshChangeTopic<
  TNamespace extends string,
  TEntityKey extends string,
> = `${TNamespace}:${TEntityKey}:changed`;

// ─── Envelope types ───────────────────────────────────────────────────────────

export interface MeshRequestEnvelope<TPayload> {
  readonly correlationId: string;
  readonly callerNodeId: string;
  readonly payload: TPayload;
  readonly emittedAt: string;
}

export interface MeshResponseEnvelope<TPayload> {
  readonly correlationId: string;
  readonly responderNodeId: string;
  readonly payload: TPayload;
  readonly stopPropagation: boolean;
  readonly emittedAt: string;
}

export interface MeshCancelEnvelope {
  readonly correlationId: string;
  readonly callerNodeId: string;
  readonly reason: "caller_stop" | "handler_stop";
  readonly emittedAt: string;
}

// ─── Entity change event ──────────────────────────────────────────────────────

export type MeshEntityEventType = "created" | "updated" | "deleted";

export interface MeshEntityChangeEvent<TItem> {
  readonly type: MeshEntityEventType;
  readonly entityKey: string;
  readonly item: TItem;
  readonly previous: TItem | null;
  readonly sourceNodeId: string;
  readonly timestamp: string;
}

// ─── Call-many types ──────────────────────────────────────────────────────────

export interface MeshCallManyOptions<TResponse> {
  readonly timeoutMs?: number;
  readonly stopWhen?: (response: TResponse, collected: readonly TResponse[]) => boolean;
  readonly maxCollectedResponses?: number;
}

export interface MeshCallManyMetrics {
  readonly expectedResponders: number;
  readonly receivedResponses: number;
  readonly droppedResponses: number;
  readonly retryResponses: number;
  readonly maxLagMs: number;
  readonly avgLagMs: number;
  readonly timedOut: boolean;
}

export interface MeshCallManyResult<TResponse> {
  readonly correlationId: string;
  readonly responses: readonly TResponse[];
  readonly stoppedEarly: boolean;
  readonly reason: "timeout" | "killer_switch";
  readonly metrics: MeshCallManyMetrics;
}

// ─── Handler types ────────────────────────────────────────────────────────────

export interface MeshHandlerInput<TPayload> {
  readonly correlationId: string;
  readonly callerNodeId: string;
  readonly payload: TPayload;
}

export interface MeshHandlerOutput<TPayload> {
  readonly payload: TPayload;
  readonly stopPropagation?: boolean;
}

export type MeshQueryHandler<TRequest, TResponse> = (
  input: MeshHandlerInput<TRequest>,
) => Promise<MeshHandlerOutput<TResponse>> | MeshHandlerOutput<TResponse>;

export type MeshMutationHandler<TInput, TResult> = (
  input: MeshHandlerInput<TInput>,
) => Promise<MeshHandlerOutput<TResult>> | MeshHandlerOutput<TResult>;

// ─── Entity-keyed handler registries ─────────────────────────────────────────

type UnsubscribeFn = () => void;

// ─── Strongly typed topic handle accessor ────────────────────────────────────

type RequireHandle<TContracts extends EventContracts> = MeshTopicNamespaceHandle<TContracts>;

// ─── InternalBaseMeshService ──────────────────────────────────────────────────

export abstract class InternalBaseMeshService<
  TContracts extends EventContracts,
  TEntities extends Record<string, AnyMeshEntity>,
> {
  protected readonly logger: Logger;

  protected handle: RequireHandle<TContracts> | null = null;
  private readonly cleanupHandlers: UnsubscribeFn[] = [];
  private readonly cancelledCorrelations = new Set<string>();

  protected constructor(
    protected readonly meshTopicService: SystemMeshTopicService,
    protected readonly meshTopologyService: SystemMeshTopologyService,
    protected readonly namespace: string,
    protected readonly contracts: TContracts,
    protected readonly entityDefinitions: TEntities,
  ) {
    this.logger = new Logger(`${namespace}MeshService`);
  }

  // ─── Lifecycle ──────────────────────────────────────────────────────────

  onModuleInit(): void {
    this.initializeMeshNamespace();
  }

  onModuleDestroy(): void {
    this.teardownMeshNamespace();
  }

  protected initializeMeshNamespace(): void {
    try {
      this.handle = this.meshTopicService.registerNamespace({
        namespace: this.namespace,
        contracts: this.contracts,
      });
    } catch (err: unknown) {
      // Namespace already registered (e.g., duplicate onModuleInit ordering) — safe to skip
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("already registered")) {
        return;
      }
      throw err;
    }
  }

  protected teardownMeshNamespace(): void {
    for (const cleanup of this.cleanupHandlers) cleanup();
    this.cleanupHandlers.length = 0;
    this.cancelledCorrelations.clear();
    this.handle = null;
  }

  // ─── Topic derivation ───────────────────────────────────────────────────

  protected deriveRequestTopic<
    TEntityKey extends string & keyof TEntities,
    TMethod extends string,
  >(
    entityKey: TEntityKey,
    method: TMethod,
  ): MeshDerivedTopic<string, TEntityKey, TMethod, "req"> {
    return `${this.namespace}:${entityKey}:${method}:req`
  }

  protected deriveResponseTopic<
    TEntityKey extends string & keyof TEntities,
    TMethod extends string,
  >(
    entityKey: TEntityKey,
    method: TMethod,
  ): MeshDerivedTopic<string, TEntityKey, TMethod, "res"> {
    return `${this.namespace}:${entityKey}:${method}:res`
  }

  protected deriveCancelTopic<
    TEntityKey extends string & keyof TEntities,
    TMethod extends string,
  >(
    entityKey: TEntityKey,
    method: TMethod,
  ): MeshDerivedTopic<string, TEntityKey, TMethod, "cancel"> {
    return `${this.namespace}:${entityKey}:${method}:cancel`
  }

  protected deriveChangeTopic<
    TEntityKey extends string & keyof TEntities,
  >(
    entityKey: TEntityKey,
  ): MeshChangeTopic<string, TEntityKey> {
    return `${this.namespace}:${entityKey}:changed`
  }

  // ─── registerQueryHandler() ─────────────────────────────────────────────
  //
  // Registers a typed handler for a specific entity query method.
  // TEntityKey is constrained to actual entity keys in TEntities.
  // TMethod is constrained to actual query keys on that entity.

  protected registerQueryHandler<
    TEntityKey extends string & keyof TEntities,
    TMethod extends string & keyof TEntities[TEntityKey]["queries"],
    TRequest extends TEntities[TEntityKey]["queries"][TMethod] extends AnyMeshQuery
      ? ReturnType<TEntities[TEntityKey]["queries"][TMethod]["inputSchema"]["parse"]>
      : never,
    TResponse extends TEntities[TEntityKey]["queries"][TMethod] extends AnyMeshQuery
      ? ReturnType<TEntities[TEntityKey]["queries"][TMethod]["outputSchema"]["parse"]>
      : never,
  >(
    entityKey: TEntityKey,
    method: TMethod,
    handler: MeshQueryHandler<TRequest, TResponse>,
    options?: Record<string, never>,
  ): void {
    const reqTopic = this.deriveRequestTopic(entityKey, method);
    const resTopic = this.deriveResponseTopic(entityKey, method);
    const cancelTopic = this.deriveCancelTopic(entityKey, method);

    this.registerCallHandler<TRequest, TResponse>(
      reqTopic,
      resTopic,
      cancelTopic,
      options ?? {},
      handler,
    );
  }

  // ─── registerMutationHandler() ──────────────────────────────────────────
  //
  // Same as registerQueryHandler but for mutation methods.

  protected registerMutationHandler<
    TEntityKey extends string & keyof TEntities,
    TMethod extends string & keyof TEntities[TEntityKey]["mutations"],
    TInput extends TEntities[TEntityKey]["mutations"][TMethod] extends AnyMeshMutation
      ? ReturnType<TEntities[TEntityKey]["mutations"][TMethod]["inputSchema"]["parse"]>
      : never,
    TResult extends TEntities[TEntityKey]["mutations"][TMethod] extends AnyMeshMutation
      ? ReturnType<TEntities[TEntityKey]["mutations"][TMethod]["outputSchema"]["parse"]>
      : never,
  >(
    entityKey: TEntityKey,
    method: TMethod,
    handler: MeshMutationHandler<TInput, TResult>,
    options?: Record<string, never>,
  ): void {
    const reqTopic = this.deriveRequestTopic(entityKey, method);
    const resTopic = this.deriveResponseTopic(entityKey, method);
    const cancelTopic = this.deriveCancelTopic(entityKey, method);

    this.registerCallHandler<TInput, TResult>(
      reqTopic,
      resTopic,
      cancelTopic,
      options ?? {},
      handler,
    );
  }

  // ─── emitEntityEvent() ──────────────────────────────────────────────────
  //
  // Emits a typed change event for a specific entity.
  // TEntityKey is constrained to actual entity keys.
  // TItem is inferred from the entity definition.

  protected emitEntityEvent<
    TEntityKey extends string & keyof TEntities,
    TItem extends MeshEntityItem<TEntities[TEntityKey]>,
  >(
    entityKey: TEntityKey,
    type: MeshEntityEventType,
    payload: {
      readonly item: TItem;
      readonly previous: TItem | null;
    },
  ): void {
    const changeTopic = this.deriveChangeTopic(entityKey);
    const localNode = this.meshTopologyService.getLocalNode();

    const event: MeshEntityChangeEvent<TItem> = {
      type,
      entityKey,
      item: payload.item,
      previous: payload.previous,
      sourceNodeId: localNode.nodeId,
      timestamp: new Date().toISOString(),
    };

    this.requireHandle().publish(
      changeTopic,
      {} as EventInput<TContracts[keyof TContracts]>,
      event as EventOutput<TContracts[keyof TContracts]>,
    );
  }

  // ─── observeEntityEvents$() ─────────────────────────────────────────────
  //
  // Returns a typed Observable of change events for a specific entity.

  protected observeEntityEvents$<
    TEntityKey extends string & keyof TEntities,
    TItem extends MeshEntityItem<TEntities[TEntityKey]>,
  >(
    entityKey: TEntityKey,
    options?: Record<string, never>,
  ): Observable<MeshEntityChangeEvent<TItem>> {
    const changeTopic = this.deriveChangeTopic(entityKey);

    return this.requireHandle().observe$(
      changeTopic,
      {} as EventInput<TContracts[keyof TContracts]>,
    );
  }

  // ─── callMany() ─────────────────────────────────────────────────────────
  //
  // Broadcasts a request to all nodes and collects typed responses.

  protected async callMany<
    TEntityKey extends string & keyof TEntities,
    TMethod extends string,
    TRequest,
    TResponse,
  >(
    entityKey: TEntityKey,
    method: TMethod,
    payload: TRequest,
    options?: MeshCallManyOptions<TResponse>,
  ): Promise<MeshCallManyResult<TResponse>> {
    const reqTopic = this.deriveRequestTopic(entityKey, method);
    const resTopic = this.deriveResponseTopic(entityKey, method);
    const cancelTopic = this.deriveCancelTopic(entityKey, method);

    return this.callManyOnTopics<TRequest, TResponse>(
      reqTopic,
      resTopic,
      cancelTopic,
      payload,
      options,
    );
  }

  // ─── Low-level topic-based callMany ─────────────────────────────────────

  protected async callManyOnTopics<TRequest, TResponse>(
    requestTopic: keyof TContracts,
    responseTopic: keyof TContracts,
    cancelTopic: keyof TContracts,
    payload: TRequest,
    options?: MeshCallManyOptions<TResponse>,
  ): Promise<MeshCallManyResult<TResponse>> {
    const mesh = this.requireHandle();
    const localNode = this.meshTopologyService.getLocalNode();

    const correlationId = randomUUID();
    const timeoutMs = options?.timeoutMs ?? 1_500;
    const maxCollectedResponses =
      typeof options?.maxCollectedResponses === "number" &&
      Number.isInteger(options.maxCollectedResponses) &&
      options.maxCollectedResponses > 0
        ? options.maxCollectedResponses
        : 256;

    const expectedResponders = this.resolveExpectedResponders();
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
      // Declare the subscription BEFORE the timeout so the timeout
      // callback can safely `unsubscribe()` it. The previous layout
      // (timeout declared first, subscription second) tripped a TDZ
      // `ReferenceError` whenever the timeout fired before the next
      // tick, which then triggered a graceful-shutdown path on the
      // container.
      const responseSubscription = mesh
        .observe$(
          responseTopic,
          { correlationId } as EventInput<TContracts[keyof TContracts]>,
        )
        .pipe(
          filter((event) => {
            const envelope = event as unknown as MeshResponseEnvelope<TResponse>;
            return envelope.correlationId === correlationId;
          }),
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

          const explicitStop = envelope.stopPropagation;
          const predicateStop = options?.stopWhen?.(envelope.payload, responses) ?? false;
          const expectedReached =
            expectedResponders !== null && responses.length >= expectedResponders;

          if (explicitStop || predicateStop || expectedReached) {
            stoppedEarly = true;
            reason = "killer_switch";
            this.broadcastCancel(cancelTopic, correlationId, "caller_stop");
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

      mesh.publish(
        requestTopic,
        { correlationId } as EventInput<TContracts[keyof TContracts]>,
        requestEnvelope as unknown as EventOutput<TContracts[keyof TContracts]>,
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
  }

  // ─── registerCallHandler() ──────────────────────────────────────────────

  protected registerCallHandler<TRequest, TResponse>(
    requestTopic: keyof TContracts,
    responseTopic: keyof TContracts,
    cancelTopic: keyof TContracts,
    options: Record<string, never>,
    handler: MeshQueryHandler<TRequest, TResponse>,
  ): void {
    const mesh = this.requireHandle();
    const localNode = this.meshTopologyService.getLocalNode();

    const cancelSub = mesh
      .observe$(
        cancelTopic,
        {} as EventInput<TContracts[keyof TContracts]>,
      )
      .subscribe((event) => {
        const envelope = event as unknown as MeshCancelEnvelope;
        this.cancelledCorrelations.add(envelope.correlationId);
      });

    const requestSub = mesh
      .observe$(
        requestTopic,
        {} as EventInput<TContracts[keyof TContracts]>,
      )
      .subscribe((event) => {
        const request = event as unknown as MeshRequestEnvelope<TRequest>;

        if (this.cancelledCorrelations.has(request.correlationId)) return;

        void Promise.resolve(
          handler({
            correlationId: request.correlationId,
            callerNodeId: request.callerNodeId,
            payload: request.payload,
          }),
        )
          .then((result) => {
            if (this.cancelledCorrelations.has(request.correlationId)) return;

            const response: MeshResponseEnvelope<TResponse> = {
              correlationId: request.correlationId,
              responderNodeId: localNode.nodeId,
              payload: result.payload,
              stopPropagation: result.stopPropagation ?? false,
              emittedAt: new Date().toISOString(),
            };

            mesh.publish(
              responseTopic,
              {
                correlationId: request.correlationId,
              } as EventInput<TContracts[keyof TContracts]>,
              response as unknown as EventOutput<TContracts[keyof TContracts]>,
            );

            if (result.stopPropagation) {
            this.broadcastCancel(
              cancelTopic,
              request.correlationId,
              "handler_stop",
            );
            }
          })
          .catch((err: unknown) => {
            this.logger.error(
              `Handler error for topic '${String(requestTopic)}'`,
              err,
            );
          });
      });

    this.cleanupHandlers.push(() => {cancelSub.unsubscribe()});
    this.cleanupHandlers.push(() => {requestSub.unsubscribe()});
  }

  // ─── broadcastCancel() ──────────────────────────────────────────────────

  private broadcastCancel(
    cancelTopic: keyof TContracts,
    correlationId: string,
    reason: MeshCancelEnvelope["reason"],
  ): void {
    const mesh = this.requireHandle();
    const localNode = this.meshTopologyService.getLocalNode();

    const envelope: MeshCancelEnvelope = {
      correlationId,
      callerNodeId: localNode.nodeId,
      reason,
      emittedAt: new Date().toISOString(),
    };

    this.cancelledCorrelations.add(correlationId);

    mesh.publish(
      cancelTopic,
      { correlationId } as EventInput<TContracts[keyof TContracts]>,
      envelope as unknown as EventOutput<TContracts[keyof TContracts]>,
      {},
    );
  }

  // ─── resolveExpectedResponders() ────────────────────────────────────────

  private resolveExpectedResponders(): number | null {
    const topology = this.meshTopologyService as unknown as {
      listPeerSessions?: () => { items: { state?: string | null }[] };
    };

    if (typeof topology.listPeerSessions !== "function") return null;

    const peers = topology.listPeerSessions().items;
    const connected = peers.filter((s) => s.state === "connected").length;
    return Math.max(1, connected + 1);
  }

  // ─── requireHandle() ────────────────────────────────────────────────────

  private requireHandle(): RequireHandle<TContracts> {
    if (!this.handle) {
      throw new AppError(
        `Mesh namespace '${this.namespace}' is not initialized. ` +
        `Ensure onModuleInit() has been called.`,
        "INTERNAL_ERROR",
      );
    }
    return this.handle;
  }
}

// ─── BaseMeshService factory ──────────────────────────────────────────────────
//
// BaseMeshService can be used in two ways:
//
// 1. As a factory:  const Base = BaseMeshService({ namespace, entities, contracts });
//                  class MyService extends Base { ... }
//    The generated class accepts (meshTopic, meshTopology) and bakes in the config.
//    Use this when you don't override constructor.
//
// 2. As a class constructor:  class MyService extends InternalBaseMeshService { ... }
//    For services that pass explicit namespace/contracts to super() with 5 args.
//    Import InternalBaseMeshService directly.
//
// Examples:
//   - SystemMeshResourceService:  uses factory (BaseMeshService({ ns, entities, contracts }))
//   - DockerContainerMeshService: uses class extension (extends InternalBaseMeshService)

export type BaseMeshServiceConstructor<
  TEntities extends Record<string, AnyMeshEntity> = Record<string, AnyMeshEntity>,
  TContracts extends EventContracts = EventContracts,
> = abstract new (
  meshTopicService: SystemMeshTopicService,
  meshTopologyService: SystemMeshTopologyService,
) => InternalBaseMeshService<TContracts, TEntities> & {
  readonly entityDefinitions: TEntities;
};

// Factory: creates a typed abstract base class for a specific set of entities.
export function BaseMeshService<
  TEntities extends Record<string, AnyMeshEntity> = Record<string, AnyMeshEntity>,
  TContracts extends EventContracts = EventContracts,
>(config: {
  readonly namespace: string;
  readonly entities: TEntities;
  readonly contracts?: TContracts;
}): BaseMeshServiceConstructor<TEntities, TContracts> & {
  readonly entities: TEntities;
  readonly namespace: string;
} {
  // Auto-generate contracts from entity operations if not provided
  let contracts: TContracts = config.contracts ?? ({} as TContracts);
  if (!config.contracts && config.entities) {
    const generated: Record<string, { input: z.ZodType; output: z.ZodType }> = {};
    for (const [entityKey, entity] of Object.entries(config.entities)) {
      const ops = getEntityOperations(entity as { operations?: Record<string, MeshOperation> });
      if (ops) {
        for (const [opKey] of Object.entries(ops)) {
          const built = buildEntityOperationContracts(config.namespace, entityKey, opKey);
          Object.assign(generated, built);
        }
      }
    }
    contracts = generated as TContracts;
  }

  abstract class GeneratedBaseMeshService extends InternalBaseMeshService<
    TContracts,
    TEntities
  > {
    static readonly entities: TEntities = config.entities;
    static readonly namespace: string = config.namespace;

    constructor(
      meshTopicService: SystemMeshTopicService,
      meshTopologyService: SystemMeshTopologyService,
    ) {
      super(
        meshTopicService,
        meshTopologyService,
        config.namespace,
        contracts,
        config.entities,
      );
    }
  }

  return GeneratedBaseMeshService as unknown as BaseMeshServiceConstructor<TEntities, TContracts> & {
    readonly entities: TEntities;
    readonly namespace: string;
  };
}

// Backward-compat alias (unused internally but kept for any external consumers)
export const _BaseMeshServiceClass = InternalBaseMeshService;