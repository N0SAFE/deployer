import type { z, ZodType } from "zod";
import type { MeshQuery, AnyMeshQuery } from "./mesh-query";
import type { MeshMutation, AnyMeshMutation } from "./mesh-mutation";
import type {
  MeshResourceOwnership,
  MeshEventSourceConfig,
  MeshEventSourceType,
} from "./mesh-resource-definition";

// ─── Re-exports from resource definition ──────────────────────────────────────

export type {
  MeshResourceOwnership,
  MeshEventSourceConfig,
  MeshEventSourceType,
} from "./mesh-resource-definition";

// ─── Resource Scope Types (legacy, use MeshResourceOwnership instead) ─────────

/**
 * @deprecated Use MeshResourceOwnership instead for more flexibility
 */
export type MeshResourceScope = "global" | "node-owned";

/**
 * @deprecated Use MeshResourceOwnership instead
 */
export interface MeshResourceConfig<TScope extends MeshResourceScope = MeshResourceScope> {
  /** How this resource is distributed across the mesh */
  readonly scope: TScope;

  /** For global resources: whether real-time subscriptions are supported */
  readonly subscriptions?: TScope extends "global" ? boolean : never;

  /** For node-owned resources: the field that identifies which node owns the item */
  readonly nodeIdField?: TScope extends "node-owned" ? string : never;
}

// ─── Core interface ───────────────────────────────────────────────────────────

/**
 * A distributed queryable entity — the primary abstraction exposed to users.
 *
 * @param TKey       - Literal string key identifying this entity (e.g. "deployments")
 * @param TItemSchema - Zod schema for the entity's item type
 * @param TItemKey   - The field name that uniquely identifies an item (e.g. "deploymentId")
 * @param TQueries   - Map of query operations this entity supports
 * @param TMutations - Map of mutation operations this entity supports
 * @param TScope     - Resource scope: "global" or "node-owned"
 */
export interface MeshEntity<
  TKey extends string,
  TItemSchema extends ZodType,
  TItemKey extends keyof z.infer<TItemSchema> & string,
  TQueries extends Record<string, AnyMeshQuery>,
  TMutations extends Record<string, AnyMeshMutation>,
  TScope extends MeshResourceScope = MeshResourceScope,
> {
  readonly key: TKey;
  readonly item: TItemSchema;
  readonly itemKey: TItemKey;
  readonly queries: TQueries;
  readonly mutations: TMutations;
  readonly config: MeshResourceConfig<TScope>;
}

// ─── Any-type alias ───────────────────────────────────────────────────────────

/**
 * Unconstrained mesh entity type.
 * Uses 'never' for TItemKey because we can't verify the key constraint
 * without knowing the specific item schema. Concrete entities will have the
 * correct constrained key.
 */
export type AnyMeshEntity = MeshEntity<string, ZodType, never, Record<string, AnyMeshQuery>, Record<string, AnyMeshMutation>, MeshResourceScope>;

// ─── Type transformers for bound queries/mutations ────────────────────────────

/**
 * Transforms a record of MeshQueries into BoundMeshQueries.
 * This represents the type after meshEntity() has attached metadata.
 */
export type BoundEntityQueries<
  TQueries extends Record<string, AnyMeshQuery>,
  TItem,
> = {
  [K in keyof TQueries]: TQueries[K] extends MeshQuery<infer TIn, infer TOut>
    ? BoundMeshQuery<TItem, TIn, TOut>
    : never;
};

/**
 * Transforms a record of MeshMutations into BoundMeshMutations.
 */
export type BoundEntityMutations<
  TMutations extends Record<string, AnyMeshMutation>,
  TItem,
> = {
  [K in keyof TMutations]: TMutations[K] extends MeshMutation<infer TIn, infer TOut>
    ? BoundMeshMutation<TItem, TIn, TOut>
    : never;
};

// ─── Item type extraction ─────────────────────────────────────────────────────

/** Extract the inferred item type from a MeshEntity */
export type MeshEntityItem<TEntity extends AnyMeshEntity> =
  TEntity extends MeshEntity<string, infer TSchema, never, any, any>
    ? z.infer<TSchema>
    : never;

/** Extract the itemKey field name from a MeshEntity */
export type MeshEntityItemKey<TEntity extends AnyMeshEntity> =
  TEntity extends MeshEntity<string, ZodType, infer TKey, any, any>
    ? TKey
    : string;

/** Extract query method names from a MeshEntity */
export type MeshEntityQueryNames<TEntity extends AnyMeshEntity> =
  TEntity extends MeshEntity<string, any, any, infer TQueries, any>
    ? keyof TQueries
    : never;

/** Extract mutation method names from a MeshEntity */
export type MeshEntityMutationNames<TEntity extends AnyMeshEntity> =
  TEntity extends MeshEntity<string, any, any, any, infer TMutations>
    ? keyof TMutations
    : never;

// ─── Bound Query/Mutation Types ───────────────────────────────────────────────

/**
 * A MeshQuery that has been bound to an entity by meshEntity().
 * All optional fields are now guaranteed to be present.
 */
export type BoundMeshQuery<
  TItem,
  TInputSchema extends ZodType = ZodType,
  TOutputSchema extends ZodType = ZodType,
> = AnyMeshQuery & {
  readonly itemSchema: z.ZodType<TItem>;
  readonly entityKey: string;
  readonly methodName: string;
  readonly itemKey: string;
  readonly inputSchema: TInputSchema;
  readonly outputSchema: TOutputSchema;
};

/**
 * A MeshMutation that has been bound to an entity by meshEntity().
 */
export type BoundMeshMutation<
  TItem,
  TInputSchema extends ZodType = ZodType,
  TOutputSchema extends ZodType = ZodType,
> = AnyMeshMutation & {
  readonly itemSchema: z.ZodType<TItem>;
  readonly entityKey: string;
  readonly methodName: string;
  readonly itemKey: string;
  readonly inputSchema: TInputSchema;
  readonly outputSchema: TOutputSchema;
};

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Creates a distributed queryable entity.
 *
 * Attaches routing metadata (`entityKey`, `methodName`, `itemSchema`, `itemKey`)
 * to every query and mutation so the discovery service can derive topics and
 * build typed query builders without any string literals.
 *
 * @example
 * // Node-owned resource (distributed across mesh nodes)
 * const deployments = meshEntity({
 *   key: "deployments",
 *   item: deploymentSchema,
 *   itemKey: "deploymentId",
 *   config: { scope: "node-owned", nodeIdField: "nodeId" },
 *   queries: { ... },
 *   mutations: { ... },
 * });
 *
 * @example
 * // Global resource (centralized, supports subscriptions)
 * const projects = meshEntity({
 *   key: "projects",
 *   item: projectSchema,
 *   itemKey: "projectId",
 *   config: { scope: "global", subscriptions: true },
 *   queries: { ... },
 *   mutations: { ... },
 * });
 */
export function meshEntity<
  TKey extends string,
  TItemSchema extends ZodType,
  TItemKey extends keyof z.infer<TItemSchema> & string,
  TQueries extends Record<string, AnyMeshQuery>,
  TMutations extends Record<string, AnyMeshMutation>,
  TScope extends MeshResourceScope = "node-owned",
>(config: {
  key: TKey;
  item: TItemSchema;
  itemKey: TItemKey;
  queries: TQueries;
  mutations: TMutations;
  config?: MeshResourceConfig<TScope>;
}): MeshEntity<
  TKey,
  TItemSchema,
  TItemKey,
  BoundEntityQueries<TQueries, z.infer<TItemSchema>>,
  BoundEntityMutations<TMutations, z.infer<TItemSchema>>,
  TScope
> {
  type TItem = z.infer<TItemSchema>;

  // Type the entity properly with the transformed query/mutation types
  type ResultEntity = MeshEntity<
    TKey,
    TItemSchema,
    TItemKey,
    BoundEntityQueries<TQueries, TItem>,
    BoundEntityMutations<TMutations, TItem>,
    TScope
  >;

  // Create the entity with default config
  const entity = {
    ...config,
    config: config.config ?? ({ scope: "node-owned" } as MeshResourceConfig<TScope>),
  } as unknown as ResultEntity;

  // Attach routing metadata to each query for topic derivation
  for (const [name, query] of Object.entries(entity.queries)) {
    (query as AnyMeshQuery).entityKey = entity.key;
    (query as AnyMeshQuery).methodName = name;
    (query as AnyMeshQuery).itemSchema = entity.item;
    (query as AnyMeshQuery).itemKey = entity.itemKey;
  }

  // Attach routing metadata to each mutation
  for (const [name, mutation] of Object.entries(entity.mutations)) {
    (mutation as AnyMeshMutation).entityKey = entity.key;
    (mutation as AnyMeshMutation).methodName = name;
    (mutation as AnyMeshMutation).itemSchema = entity.item;
    (mutation as AnyMeshMutation).itemKey = entity.itemKey;
  }

  return entity;
}

// ═══════════════════════════════════════════════════════════════════════════════
// ENHANCED ENTITY FACTORY WITH EVENT SOURCES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Event source registry attached to entities.
 */
export interface MeshEntityEventSources<
  TItem,
  TSources extends Record<string, MeshEventSourceConfig> = Record<string, MeshEventSourceConfig>,
> {
  /** Registry of event sources */
  readonly sources: TSources;
  
  /** Get event types that can be emitted */
  getEventTypes(): Array<"created" | "updated" | "deleted" | keyof TSources>;
  
  /** Check if a specific event type is supported */
  supportsEvent(type: string): boolean;
  
  /** Get observable for specific event source */
  getSourceObservable<TPayload>(
    sourceName: keyof TSources
  ): import("rxjs").Observable<{
    readonly type: string;
    readonly item: TItem;
    readonly payload: TPayload;
    readonly timestamp: string;
    readonly sourceNodeId: string;
  }>;
}

/**
 * Enhanced mesh entity with event source support.
 */
export interface EnhancedMeshEntity<
  TKey extends string,
  TItemSchema extends ZodType,
  TItemKey extends keyof z.infer<TItemSchema> & string,
  TOwnership extends MeshResourceOwnership,
  TQueries extends Record<string, AnyMeshQuery>,
  TMutations extends Record<string, AnyMeshMutation>,
  TEventSources extends Record<string, MeshEventSourceConfig>,
> extends MeshEntity<
  TKey,
  TItemSchema,
  TItemKey,
  TQueries,
  TMutations,
  TOwnership extends { type: "global" } ? "global" :
  TOwnership extends { type: "node-owned" } ? "node-owned" :
  MeshResourceScope
> {
  /** Event source configuration and registry */
  readonly events: MeshEntityEventSources<z.infer<TItemSchema>, TEventSources>;
  
  /** Ownership configuration (typed) */
  readonly ownership: TOwnership;
}

/**
 * Configuration for enhanced mesh entity.
 */
export interface EnhancedMeshEntityConfig<
  TItemSchema extends ZodType,
  TOwnership extends MeshResourceOwnership,
  TEventSources extends Record<string, MeshEventSourceConfig>,
> {
  /** Entity key */
  readonly key: string;
  
  /** Zod schema for items */
  readonly item: TItemSchema;
  
  /** Key field name */
  readonly itemKey: keyof z.infer<TItemSchema> & string;
  
  /** Ownership configuration */
  readonly ownership: TOwnership;
  
  /** Query definitions */
  readonly queries?: Record<string, AnyMeshQuery>;
  
  /** Mutation definitions */
  readonly mutations?: Record<string, AnyMeshMutation>;
  
  /** Event source configurations */
  readonly eventSources?: TEventSources;
}

/**
 * Creates an enhanced mesh entity with full event source support.
 * 
 * @example
 * const deployments = meshEntityEnhanced({
 *   key: "deployments",
 *   item: deploymentSchema,
 *   itemKey: "deploymentId",
 *   ownership: { type: "node-owned", ownerField: "nodeId" },
 *   queries: { list, findById },
 *   mutations: { create, update, delete },
 *   eventSources: {
 *     mutations: {
 *       type: "mutation",
 *       schema: mutationEventSchema,
 *       emitsCreated: true,
 *       emitsUpdated: true,
 *       emitsDeleted: true,
 *       config: { mutations: ["create", "update", "delete"], includePreviousState: true }
 *     },
 *     webhooks: {
 *       type: "external",
 *       schema: webhookSchema,
 *       emitsCreated: false,
 *       emitsUpdated: true,
 *       emitsDeleted: false,
 *       config: { system: "github", webhookPath: "/webhooks/github" }
 *     }
 *   }
 * });
 */
export function meshEntityEnhanced<
  TItemSchema extends ZodType,
  TOwnership extends MeshResourceOwnership,
  TEventSources extends Record<string, MeshEventSourceConfig>,
>(
  config: EnhancedMeshEntityConfig<TItemSchema, TOwnership, TEventSources>
): EnhancedMeshEntity<
  string,
  TItemSchema,
  keyof z.infer<TItemSchema> & string,
  TOwnership,
  Record<string, AnyMeshQuery>,
  Record<string, AnyMeshMutation>,
  TEventSources
> {
  type TItem = z.infer<TItemSchema>;
  
  // Create base entity with legacy config format for backward compatibility
  const legacyScope: MeshResourceScope = config.ownership.type === "global" ? "global" : "node-owned";
  const legacyConfig: MeshResourceConfig<typeof legacyScope> = {
    scope: legacyScope,
    ...(config.ownership.type === "global" && { subscriptions: true }),
    ...(config.ownership.type === "node-owned" && { nodeIdField: config.ownership.ownerField }),
  };

  const baseEntity = meshEntity({
    key: config.key,
    item: config.item,
    itemKey: config.itemKey,
    queries: config.queries ?? {},
    mutations: config.mutations ?? {},
    config: legacyConfig,
  });

  // Create event source registry
  const eventSources = config.eventSources ?? {} as TEventSources;
  
  const events: MeshEntityEventSources<TItem, TEventSources> = {
    sources: eventSources,
    
    getEventTypes() {
      const types = new Set<string>(["created", "updated", "deleted"]);
      
      for (const [name, source] of Object.entries(eventSources)) {
        if (source.emitsCreated) types.add(`${name}:created`);
        if (source.emitsUpdated) types.add(`${name}:updated`);
        if (source.emitsDeleted) types.add(`${name}:deleted`);
      }
      
      return Array.from(types) as Array<"created" | "updated" | "deleted" | keyof TEventSources>;
    },
    
    supportsEvent(type: string): boolean {
      return this.getEventTypes().includes(type as never);
    },
    
    getSourceObservable<TPayload>(sourceName: keyof TEventSources) {
      const source = eventSources[sourceName];
      if (!source) {
        throw new Error(`Event source "${String(sourceName)}" not found on entity "${config.key}"`);
      }
      
      // This would be connected to the actual event stream in a real implementation
      // For now, return a placeholder that would be replaced by the mesh infrastructure
      const { Subject } = require("rxjs");
      return new Subject<{
        readonly type: string;
        readonly item: TItem;
        readonly payload: TPayload;
        readonly timestamp: string;
        readonly sourceNodeId: string;
      }>().asObservable();
    },
  };

  // Build enhanced entity
  const enhancedEntity = {
    ...baseEntity,
    ownership: config.ownership,
    events,
  } as EnhancedMeshEntity<
    string,
    TItemSchema,
    keyof z.infer<TItemSchema> & string,
    TOwnership,
    Record<string, AnyMeshQuery>,
    Record<string, AnyMeshMutation>,
    TEventSources
  >;

  return enhancedEntity;
}

