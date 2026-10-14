import type { z, ZodType } from "zod";
import type { Observable } from "rxjs";

import { AppError } from "@repo/errors";
// ═══════════════════════════════════════════════════════════════════════════════
// EVENT SOURCE DEFINITIONS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Event source types for mesh resources.
 * Defines where events can originate from.
 */
export type MeshEventSourceType = 
  | "mutation"      // Events from mutation operations (create, update, delete)
  | "external"      // Events from external systems (webhooks, integrations)
  | "timer"         // Events from scheduled jobs/cron
  | "stream"        // Events from real-time data streams (logs, metrics)
  | "replication";  // Events from replication/fan-out

/**
 * Configuration for a specific event source.
 */
export interface MeshEventSourceConfig<
  TType extends MeshEventSourceType = MeshEventSourceType,
  TPayload = unknown,
> {
  /** Type of event source */
  readonly type: TType;
  
  /** Zod schema for validating events from this source */
  readonly schema: ZodType<TPayload>;
  
  /** Whether this source emits create events */
  readonly emitsCreated: boolean;
  
  /** Whether this source emits update events */
  readonly emitsUpdated: boolean;
  
  /** Whether this source emits delete events */
  readonly emitsDeleted: boolean;
  
  /** Source-specific configuration */
  readonly config: TType extends "mutation" ? MeshMutationEventConfig
    : TType extends "external" ? MeshExternalEventConfig
    : TType extends "timer" ? MeshTimerEventConfig
    : TType extends "stream" ? MeshStreamEventConfig
    : TType extends "replication" ? MeshReplicationEventConfig
    : never;
}

/** Mutation event source configuration */
export interface MeshMutationEventConfig {
  /** Which mutations trigger events */
  readonly mutations: readonly string[];
  /** Include previous state in update events */
  readonly includePreviousState: boolean;
}

/** External event source configuration */
export interface MeshExternalEventConfig {
  /** Source system identifier (e.g., "github", "stripe") */
  readonly system: string;
  /** Webhook endpoint path */
  readonly webhookPath?: string;
  /** Custom validation function */
  readonly validate?: (payload: unknown) => boolean;
}

/** Timer event source configuration */
export interface MeshTimerEventConfig {
  /** Cron expression or interval */
  readonly schedule: string;
  /** Whether to query and emit current state */
  readonly emitCurrentState: boolean;
}

/** Stream event source configuration */
export interface MeshStreamEventConfig {
  /** Stream type identifier */
  readonly streamType: string;
  /** Buffer size for backpressure */
  readonly bufferSize: number;
  /** Transform function for stream data */
  readonly transform?: (chunk: unknown) => unknown;
}

/** Replication event source configuration */
export interface MeshReplicationEventConfig {
  /** Source node IDs */
  readonly sources: readonly string[];
  /** Conflict resolution strategy */
  readonly conflictStrategy: "last-write-wins" | "vector-clock" | "custom";
}

// ═══════════════════════════════════════════════════════════════════════════════
// RESOURCE OWNERSHIP PATTERNS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Resource ownership patterns in the mesh.
 */
export type MeshResourceOwnership =
  | { type: "global"; coordinatorNode?: string }
  | { type: "node-owned"; ownerField: string }
  | { type: "sharded"; shardField: string; shardCount: number }
  | { type: "replicated"; replicaNodes: readonly string[]; consistency: "strong" | "eventual" }
  | { type: "partitioned"; partitionField: string; partitionFunction: (value: unknown) => string };

// ═══════════════════════════════════════════════════════════════════════════════
// QUERY DEFINITIONS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Query capability flags.
 */
export interface MeshQueryCapabilities {
  /** Supports one-time requests */
  readonly request: boolean;
  /** Supports real-time streaming */
  readonly listen: boolean;
  /** Supports pagination */
  readonly paginate: boolean;
  /** Supports sorting */
  readonly sort: boolean;
  /** Supports filtering */
  readonly filter: boolean;
  /** Supports field selection/projection */
  readonly project: boolean;
}

/**
 * Complete query definition with type-safe input/output.
 */
export interface MeshQueryDefinition<
  TInput extends ZodType = ZodType,
  TOutput extends ZodType = ZodType,
  TCapabilities extends MeshQueryCapabilities = MeshQueryCapabilities,
> {
  /** Zod schema for input validation */
  readonly inputSchema: TInput;
  
  /** Zod schema for output validation */
  readonly outputSchema: TOutput;
  
  /** Supported capabilities */
  readonly capabilities: TCapabilities;
  
  /** Default pagination limit */
  readonly defaultLimit?: number;
  
  /** Maximum pagination limit */
  readonly maxLimit?: number;
  
  /** Default sort field */
  readonly defaultSort?: {
    readonly field: string;
    readonly direction: "asc" | "desc";
  };
  
  /** Supported filter fields */
  readonly filterableFields?: readonly string[];
  
  /** Required permissions */
  readonly requiredPermissions?: readonly string[];
}

// ═══════════════════════════════════════════════════════════════════════════════
// MUTATION DEFINITIONS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Mutation capability flags.
 */
export interface MeshMutationCapabilities {
  /** Returns the modified item */
  readonly returnsItem: boolean;
  /** Can be batched */
  readonly batchable: boolean;
  /** Triggers events */
  readonly emitsEvents: boolean;
  /** Supports optimistic updates */
  readonly optimisticUpdates: boolean;
}

/**
 * Side effect definition for mutations.
 */
export interface MeshMutationSideEffect<
  TInput = unknown,
  TContext = unknown,
> {
  /** When to run: pre-mutation or post-mutation */
  readonly when: "before" | "after";
  
  /** Handler function */
  readonly handler: (input: TInput, context: TContext) => Promise<void> | void;
  
  /** Whether to fail the mutation if side effect fails */
  readonly required: boolean;
}

/**
 * Complete mutation definition.
 */
export interface MeshMutationDefinition<
  TInput extends ZodType = ZodType,
  TOutput extends ZodType = ZodType,
  TCapabilities extends MeshMutationCapabilities = MeshMutationCapabilities,
> {
  /** Zod schema for input validation */
  readonly inputSchema: TInput;
  
  /** Zod schema for output validation */
  readonly outputSchema: TOutput;
  
  /** Supported capabilities */
  readonly capabilities: TCapabilities;
  
  /** Side effects to execute */
  readonly sideEffects?: readonly MeshMutationSideEffect<
    z.infer<TInput>,
    { readonly userId: string; readonly nodeId: string; readonly timestamp: string }
  >[];
  
  /** Required permissions */
  readonly requiredPermissions?: readonly string[];
  
  /** Rate limiting configuration */
  readonly rateLimit?: {
    readonly windowMs: number;
    readonly maxRequests: number;
    readonly keyGenerator?: (input: z.infer<TInput>) => string;
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// EVENT DEFINITIONS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Event type definitions with payload schemas.
 */
export interface MeshEventTypes<TItem> {
  readonly created: {
    readonly type: "created";
    readonly item: TItem;
    readonly timestamp: string;
    readonly sourceNodeId: string;
    readonly sourceType: MeshEventSourceType;
  };
  readonly updated: {
    readonly type: "updated";
    readonly item: TItem;
    readonly previousItem: TItem;
    readonly timestamp: string;
    readonly sourceNodeId: string;
    readonly sourceType: MeshEventSourceType;
    readonly changedFields: readonly (keyof TItem)[];
  };
  readonly deleted: {
    readonly type: "deleted";
    readonly item: TItem;
    readonly timestamp: string;
    readonly sourceNodeId: string;
    readonly sourceType: MeshEventSourceType;
  };
  readonly custom: {
    readonly type: string;
    readonly payload: unknown;
    readonly timestamp: string;
    readonly sourceNodeId: string;
    readonly sourceType: MeshEventSourceType;
  };
}

/**
 * Union of all event types for a resource.
 */
export type MeshResourceEvent<TItem> = 
  | MeshEventTypes<TItem>["created"]
  | MeshEventTypes<TItem>["updated"]
  | MeshEventTypes<TItem>["deleted"]
  | MeshEventTypes<TItem>["custom"];

// ═══════════════════════════════════════════════════════════════════════════════
// RESOURCE DEFINITION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Complete resource definition with all type parameters.
 * This is the core type used to define mesh resources with full type safety.
 */
export interface MeshResourceDefinition<
  // Identity
  TKey extends string = string,
  TItemSchema extends ZodType = ZodType,
  TItemKey extends string = string,
  
  // Ownership
  TOwnership extends MeshResourceOwnership = MeshResourceOwnership,
  
  // Queries
  TQueries extends Record<string, MeshQueryDefinition> = Record<string, MeshQueryDefinition>,
  
  // Mutations
  TMutations extends Record<string, MeshMutationDefinition> = Record<string, MeshMutationDefinition>,
  
  // Events
  TEventSources extends Record<string, MeshEventSourceConfig> = Record<string, MeshEventSourceConfig>,
  TCustomEvents extends Record<string, ZodType> = Record<string, ZodType>,
> {
  // ─── Identity ──────────────────────────────────────────────────────────────
  
  /** Unique key identifying this resource type */
  readonly key: TKey;
  
  /** Zod schema for the resource item */
  readonly itemSchema: TItemSchema;
  
  /** Field name that uniquely identifies items */
  readonly itemKey: TItemKey;
  
  // ─── Ownership ─────────────────────────────────────────────────────────────
  
  /** How this resource is distributed across the mesh */
  readonly ownership: TOwnership;
  
  // ─── Queries ───────────────────────────────────────────────────────────────
  
  /** Available query operations */
  readonly queries: TQueries;
  
  // ─── Mutations ─────────────────────────────────────────────────────────────
  
  /** Available mutation operations */
  readonly mutations: TMutations;
  
  // ─── Events ────────────────────────────────────────────────────────────────
  
  /** Event sources that can trigger updates */
  readonly eventSources: TEventSources;
  
  /** Custom event types beyond CRUD */
  readonly customEvents?: TCustomEvents;
  
  // ─── Configuration ─────────────────────────────────────────────────────────
  
  /** Caching configuration */
  readonly cache?: {
    readonly enabled: boolean;
    readonly ttlMs: number;
    readonly keyFields?: readonly (keyof z.infer<TItemSchema>)[];
  };
  
  /** Indexing configuration for queries */
  readonly indexes?: readonly {
    readonly fields: readonly (keyof z.infer<TItemSchema>)[];
    readonly unique: boolean;
  }[];
}

// ═══════════════════════════════════════════════════════════════════════════════
// TYPE HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

/** Extract item type from resource definition */
export type MeshResourceItem<TDef extends MeshResourceDefinition> = 
  TDef extends MeshResourceDefinition<string, infer TSchema, string, any, any, any, any, any>
    ? z.infer<TSchema>
    : never;

/** Extract query input type */
export type MeshQueryInput<TDef extends MeshQueryDefinition> =
  TDef extends MeshQueryDefinition<infer TInput, any, any>
    ? z.infer<TInput>
    : never;

/** Extract query output type */
export type MeshQueryOutput<TDef extends MeshQueryDefinition> =
  TDef extends MeshQueryDefinition<any, infer TOutput, any>
    ? z.infer<TOutput>
    : never;

/** Extract mutation input type */
export type MeshMutationInput<TDef extends MeshMutationDefinition> =
  TDef extends MeshMutationDefinition<infer TInput, any, any>
    ? z.infer<TInput>
    : never;

/** Extract mutation output type */
export type MeshMutationOutput<TDef extends MeshMutationDefinition> =
  TDef extends MeshMutationDefinition<any, infer TOutput, any>
    ? z.infer<TOutput>
    : never;

/** Extract event observable type for a resource */
export type MeshResourceEventObservable<TDef extends MeshResourceDefinition> =
  Observable<MeshResourceEvent<MeshResourceItem<TDef>>>;

// ═══════════════════════════════════════════════════════════════════════════════
// RESOURCE BUILDER
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Builder for creating type-safe resource definitions.
 * Provides a fluent API for defining all aspects of a mesh resource.
 */
export class MeshResourceBuilder<
  TKey extends string = never,
  TItemSchema extends ZodType = never,
  TItemKey extends string = never,
  TOwnership extends MeshResourceOwnership = never,
  TQueries extends Record<string, MeshQueryDefinition> = {},
  TMutations extends Record<string, MeshMutationDefinition> = {},
  TEventSources extends Record<string, MeshEventSourceConfig> = {},
  TCustomEvents extends Record<string, ZodType> = {},
> {
  private config: { -readonly [K in keyof MeshResourceDefinition]?: MeshResourceDefinition[K] } = {};

  /** Set the resource key */
  key<T extends string>(key: T): MeshResourceBuilder<
    T, TItemSchema, TItemKey, TOwnership, TQueries, TMutations, TEventSources, TCustomEvents
  > {
    this.config.key = key;
    return this as unknown as MeshResourceBuilder<
      T, TItemSchema, TItemKey, TOwnership, TQueries, TMutations, TEventSources, TCustomEvents
    >;
  }

  /** Set the item schema */
  itemSchema<T extends ZodType>(schema: T): MeshResourceBuilder<
    TKey, T, TItemKey, TOwnership, TQueries, TMutations, TEventSources, TCustomEvents
  > {
    this.config.itemSchema = schema;
    return this as unknown as MeshResourceBuilder<
      TKey, T, TItemKey, TOwnership, TQueries, TMutations, TEventSources, TCustomEvents
    >;
  }

  /** Set the item key field */
  itemKey<T extends string>(key: T): MeshResourceBuilder<
    TKey, TItemSchema, T, TOwnership, TQueries, TMutations, TEventSources, TCustomEvents
  > {
    this.config.itemKey = key;
    return this as unknown as MeshResourceBuilder<
      TKey, TItemSchema, T, TOwnership, TQueries, TMutations, TEventSources, TCustomEvents
    >;
  }

  /** Set ownership to global */
  globalOwnership(coordinatorNode?: string): MeshResourceBuilder<
    TKey, TItemSchema, TItemKey, { type: "global"; coordinatorNode?: string }, TQueries, TMutations, TEventSources, TCustomEvents
  > {
    this.config.ownership = { type: "global", coordinatorNode };
    return this as unknown as MeshResourceBuilder<
      TKey, TItemSchema, TItemKey, { type: "global"; coordinatorNode?: string }, TQueries, TMutations, TEventSources, TCustomEvents
    >;
  }

  /** Set ownership to node-owned */
  nodeOwnedOwnership<T extends string>(ownerField: T): MeshResourceBuilder<
    TKey, TItemSchema, TItemKey, { type: "node-owned"; ownerField: T }, TQueries, TMutations, TEventSources, TCustomEvents
  > {
    this.config.ownership = { type: "node-owned", ownerField };
    return this as unknown as MeshResourceBuilder<
      TKey, TItemSchema, TItemKey, { type: "node-owned"; ownerField: T }, TQueries, TMutations, TEventSources, TCustomEvents
    >;
  }

  /** Add a query */
  addQuery<
    TName extends string,
    TQuery extends MeshQueryDefinition,
  >(
    name: TName,
    query: TQuery
  ): MeshResourceBuilder<
    TKey, TItemSchema, TItemKey, TOwnership, TQueries & Record<TName, TQuery>, TMutations, TEventSources, TCustomEvents
  > {
    this.config.queries = { ...this.config.queries, [name]: query };
    return this as unknown as MeshResourceBuilder<
      TKey, TItemSchema, TItemKey, TOwnership, TQueries & Record<TName, TQuery>, TMutations, TEventSources, TCustomEvents
    >;
  }

  /** Add a mutation */
  addMutation<
    TName extends string,
    TMutation extends MeshMutationDefinition,
  >(
    name: TName,
    mutation: TMutation
  ): MeshResourceBuilder<
    TKey, TItemSchema, TItemKey, TOwnership, TQueries, TMutations & Record<TName, TMutation>, TEventSources, TCustomEvents
  > {
    this.config.mutations = { ...this.config.mutations, [name]: mutation };
    return this as unknown as MeshResourceBuilder<
      TKey, TItemSchema, TItemKey, TOwnership, TQueries, TMutations & Record<TName, TMutation>, TEventSources, TCustomEvents
    >;
  }

  /** Add an event source */
  addEventSource<
    TName extends string,
    TSource extends MeshEventSourceConfig,
  >(
    name: TName,
    source: TSource
  ): MeshResourceBuilder<
    TKey, TItemSchema, TItemKey, TOwnership, TQueries, TMutations, TEventSources & Record<TName, TSource>, TCustomEvents
  > {
    this.config.eventSources = { ...this.config.eventSources, [name]: source };
    return this as unknown as MeshResourceBuilder<
      TKey, TItemSchema, TItemKey, TOwnership, TQueries, TMutations, TEventSources & Record<TName, TSource>, TCustomEvents
    >;
  }

  /** Build the final resource definition */
  build(): MeshResourceDefinition<
    TKey, TItemSchema, TItemKey, TOwnership, TQueries, TMutations, TEventSources, TCustomEvents
  > {
    if (!this.config.key) throw new AppError("Resource key is required", "INTERNAL_ERROR");
    if (!this.config.itemSchema) throw new AppError("Item schema is required", "INTERNAL_ERROR");
    if (!this.config.itemKey) throw new AppError("Item key is required", "INTERNAL_ERROR");
    if (!this.config.ownership) throw new AppError("Ownership is required", "INTERNAL_ERROR");

    return this.config as MeshResourceDefinition<
      TKey, TItemSchema, TItemKey, TOwnership, TQueries, TMutations, TEventSources, TCustomEvents
    >;
  }
}

/** Create a new resource builder */
export function defineResource(): MeshResourceBuilder {
  return new MeshResourceBuilder();
}
