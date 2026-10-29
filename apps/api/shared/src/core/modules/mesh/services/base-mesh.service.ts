import { Logger } from "@nestjs/common";
import type { Observable } from "rxjs";
import { makeMeshNamespace, type MeshNamespace, type MeshNamespaceTopology } from "./mesh-namespace";
import type { SystemMeshTopicService } from "./system-mesh-topic/orchestrator/system-mesh-topic.service";
import type { MeshTopicNamespaceHandle } from "./system-mesh-topic/domain/mesh-topic-types";
import type { SystemMeshTopologyService } from "./system-mesh-topology/orchestrator/system-mesh-topology.service";
import type { EventContracts, EventInput, EventOutput } from "@deployer/events";
import type { AnyMeshEntity, MeshEntityItem } from "../mesh-entity";
import type { AnyMeshQuery } from "../mesh-query";
import type { AnyMeshMutation } from "../mesh-mutation";
import type { MeshOperation } from "../primitives";
import * as z from "zod/v4";

import { AppError } from "@deployer/errors";
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
    const o = ops[method]!;
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

export type MeshRequestEnvelope<TPayload> = {
  readonly correlationId: string;
  readonly callerNodeId: string;
  readonly payload: TPayload;
  readonly emittedAt: string;
}

export type MeshResponseEnvelope<TPayload> = {
  readonly correlationId: string;
  readonly responderNodeId: string;
  readonly payload: TPayload;
  readonly stopPropagation: boolean;
  readonly emittedAt: string;
}

export type MeshCancelEnvelope = {
  readonly correlationId: string;
  readonly callerNodeId: string;
  readonly reason: "caller_stop" | "handler_stop";
  readonly emittedAt: string;
}

// ─── Entity change event ──────────────────────────────────────────────────────

export type MeshEntityEventType = "created" | "updated" | "deleted";

export type MeshEntityChangeEvent<TItem> = {
  readonly type: MeshEntityEventType;
  readonly entityKey: string;
  readonly item: TItem;
  readonly previous: TItem | null;
  readonly sourceNodeId: string;
  readonly timestamp: string;
}

// ─── Call-many types ──────────────────────────────────────────────────────────

export type MeshCallManyOptions<TResponse> = {
  readonly timeoutMs?: number;
  readonly stopWhen?: (response: TResponse, collected: readonly TResponse[]) => boolean;
  readonly maxCollectedResponses?: number;
}

export type MeshCallManyMetrics = {
  readonly expectedResponders: number;
  readonly receivedResponses: number;
  readonly droppedResponses: number;
  readonly retryResponses: number;
  readonly maxLagMs: number;
  readonly avgLagMs: number;
  readonly timedOut: boolean;
}

export type MeshCallManyResult<TResponse> = {
  readonly correlationId: string;
  readonly responses: readonly TResponse[];
  readonly stoppedEarly: boolean;
  readonly reason: "timeout" | "killer_switch";
  readonly metrics: MeshCallManyMetrics;
}

// ─── Handler types ────────────────────────────────────────────────────────────

export type MeshHandlerInput<TPayload> = {
  readonly correlationId: string;
  readonly callerNodeId: string;
  readonly payload: TPayload;
}

export type MeshHandlerOutput<TPayload> = {
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

// ─── Strongly typed topic handle accessor ────────────────────────────────────

type RequireHandle<TContracts extends EventContracts> = MeshTopicNamespaceHandle<TContracts>;

// ─── InternalBaseMeshService ──────────────────────────────────────────────────

export abstract class InternalBaseMeshService<
  TContracts extends EventContracts,
  TEntities extends Record<string, AnyMeshEntity>,
> {
  protected readonly logger: Logger;

  private readonly meshNamespace: MeshNamespace<TContracts>;

  protected constructor(
    protected readonly meshTopicService: SystemMeshTopicService,
    protected readonly meshTopologyService: SystemMeshTopologyService,
    protected readonly namespace: string,
    protected readonly contracts: TContracts,
    protected readonly entityDefinitions: TEntities,
  ) {
    this.logger = new Logger(`${namespace}MeshService`);
    this.meshNamespace = makeMeshNamespace({
      topics: meshTopicService,
      topology: meshTopologyService as unknown as MeshNamespaceTopology,
      namespace,
      contracts,
      logger: this.logger,
    });
  }

  /** The topic handle, or null before the namespace is initialized. */
  protected get handle(): RequireHandle<TContracts> | null {
    return this.meshNamespace.handle;
  }

  // ─── Lifecycle ──────────────────────────────────────────────────────────

  onModuleInit(): void {
    this.initializeMeshNamespace();
  }

  onModuleDestroy(): void {
    this.teardownMeshNamespace();
  }

  protected initializeMeshNamespace(): void {
    this.meshNamespace.initialize();
  }

  protected teardownMeshNamespace(): void {
    this.meshNamespace.teardown();
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

  protected callManyOnTopics<TRequest, TResponse>(
    requestTopic: keyof TContracts,
    responseTopic: keyof TContracts,
    cancelTopic: keyof TContracts,
    payload: TRequest,
    options?: MeshCallManyOptions<TResponse>,
  ): Promise<MeshCallManyResult<TResponse>> {
    return this.meshNamespace.callMany(requestTopic, responseTopic, cancelTopic, payload, options);
  }

  // ─── registerCallHandler() ──────────────────────────────────────────────

  protected registerCallHandler<TRequest, TResponse>(
    requestTopic: keyof TContracts,
    responseTopic: keyof TContracts,
    cancelTopic: keyof TContracts,
    _options: Record<string, never>,
    handler: MeshQueryHandler<TRequest, TResponse>,
  ): void {
    this.meshNamespace.registerCallHandler(requestTopic, responseTopic, cancelTopic, handler);
  }

  // ─── requireHandle() ────────────────────────────────────────────────────

  private requireHandle(): RequireHandle<TContracts> {
    const handle = this.meshNamespace.handle;
    if (!handle) {
      throw new AppError(
        `Mesh namespace '${this.namespace}' is not initialized. ` +
        `Ensure onModuleInit() has been called.`,
        "INTERNAL_ERROR",
      );
    }
    return handle;
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