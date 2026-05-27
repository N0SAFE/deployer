import type { Observable } from "rxjs";
import type { MeshQueryResult } from "./mesh-query-builder-types";

// ─── Stream event types ───────────────────────────────────────────────────────

/**
 * Event types for streaming mesh data.
 */
export type MeshStreamEventType = "initial" | "data" | "error" | "complete";

/**
 * A stream event from the mesh.
 */
export interface MeshStreamEvent<TItem> {
  /** The type of stream event */
  readonly type: MeshStreamEventType;

  /** The items (for initial and data events) */
  readonly items?: readonly TItem[];

  /** The error (for error events) */
  readonly error?: Error;

  /** Metadata about the event */
  readonly meta?: {
    /** Total count of items (for paginated results) */
    readonly total?: number;

    /** Whether there are more items */
    readonly hasMore?: boolean;

    /** Next offset for pagination */
    readonly nextOffset?: number | null;

    /** Duration of the operation */
    readonly durationMs?: number;

    /** Source node IDs */
    readonly sourceNodes?: readonly string[];
  };
}

// ─── Observable result types ──────────────────────────────────────────────────

/**
 * Result from a request operation (single execution).
 */
export type MeshRequestResult<TItem> = Observable<MeshQueryResult<TItem>>;

/**
 * Result from a stream operation (continuous).
 */
export type MeshStreamResult<TItem> = Observable<MeshStreamEvent<TItem>>;

/**
 * Result from a listen operation (real-time updates).
 */
export interface MeshListenResult<TItem> {
  /** Observable of real-time item updates */
  readonly items$: Observable<readonly TItem[]>;

  /** Observable of change events (created/updated/deleted) */
  readonly events$: Observable<MeshChangeEvent<TItem>>;

  /** Combined observable with both items and events */
  readonly all$: Observable<MeshStreamEvent<TItem>>;
}

// ─── Change event types ───────────────────────────────────────────────────────

/**
 * Type of change event.
 */
export type MeshChangeType = "initial" | "created" | "updated" | "deleted" | "reconnect";

/**
 * A change event for real-time updates.
 */
export interface MeshChangeEvent<TItem> {
  /** The type of change */
  readonly type: MeshChangeType;

  /** The current items after the change */
  readonly items: readonly TItem[];

  /** The specific item that changed (undefined for initial/reconnect) */
  readonly changedItem?: TItem;

  /** The previous state of the changed item (for updates/deletes) */
  readonly previousItem?: TItem;

  /** Timestamp of the change */
  readonly timestamp: string;

  /** Source node that triggered the change */
  readonly sourceNodeId?: string;
}

// ─── Operation types ──────────────────────────────────────────────────────────

/**
 * Represents a mesh query operation that can be:
 * - Requested once (execute)
 * - Streamed continuously (stream)
 * - Listened to for real-time updates (listen)
 */
export interface MeshOperation<TItem, TResultShape = TItem> {
  /**
   * Execute the query once and get results.
   * Returns an Observable that emits once and completes.
   */
  request(): Observable<MeshQueryResult<TResultShape>>;

  /**
   * Stream results continuously.
   * Returns an Observable that emits items as they're found.
   */
  stream(): Observable<TResultShape>;

  /**
   * Listen for real-time updates.
   * Returns Observables for items and change events.
   */
  listen(): MeshListenResult<TResultShape>;
}
