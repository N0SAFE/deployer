import type { z } from "zod/v4";

// ─── Subscription event types ─────────────────────────────────────────────────

export type MeshSubscriptionEventType = "created" | "updated" | "deleted" | "*";

/**
 * A subscription event for global resources.
 */
export type MeshSubscriptionEvent<TItem> = {
  /** The type of event that occurred */
  readonly type: MeshSubscriptionEventType;

  /** The item that was affected */
  readonly item: TItem;

  /** Previous state of the item (for updates and deletes) */
  readonly previousItem?: TItem;

  /** Timestamp when the event occurred */
  readonly timestamp: string;

  /** ID of the node that triggered the change */
  readonly sourceNodeId: string;
}

// ─── Subscription filter types ────────────────────────────────────────────────

/**
 * Filters for mesh subscriptions.
 */
export type MeshSubscriptionFilter<TItem> = {
  /** Only receive events for specific event types */
  readonly eventTypes?: readonly MeshSubscriptionEventType[];

  /** Only receive events matching this predicate */
  readonly where?: (item: TItem) => boolean;
}

// ─── Subscription handle ──────────────────────────────────────────────────────

/**
 * Handle to a subscription that allows management.
 */
export type MeshSubscriptionHandle<TItem> = {
  /** Unique ID for this subscription */
  readonly id: string;

  /** Stop receiving events */
  unsubscribe(): void;

  /** Check if subscription is still active */
  readonly isActive: boolean;
}

// ─── Subscription handler type ────────────────────────────────────────────────

/**
 * Handler function for subscription events.
 */
export type MeshSubscriptionHandler<TItem> = (
  event: MeshSubscriptionEvent<TItem>,
) => void | Promise<void>;

// ─── Resource change notifier ─────────────────────────────────────────────────

/**
 * Interface for notifying about resource changes (used by global resource services).
 */
export type MeshResourceChangeNotifier<TItem> = {
  /**
   * Notify subscribers that an item was created.
   */
  notifyCreated(item: TItem, sourceNodeId: string): Promise<void>;

  /**
   * Notify subscribers that an item was updated.
   */
  notifyUpdated(item: TItem, previousItem: TItem, sourceNodeId: string): Promise<void>;

  /**
   * Notify subscribers that an item was deleted.
   */
  notifyDeleted(item: TItem, sourceNodeId: string): Promise<void>;
}

// ─── Global resource registry entry ───────────────────────────────────────────

/**
 * Registry entry for global resources that support subscriptions.
 */
export type GlobalResourceRegistryEntry<TItem> = {
  /** Entity key for this resource */
  readonly entityKey: string;

  /** Zod schema for validation */
  readonly itemSchema: z.ZodType<TItem>;

  /** Notifier for broadcasting changes */
  readonly notifier: MeshResourceChangeNotifier<TItem>;

  /** Subscribe to changes */
  subscribe(
    handler: MeshSubscriptionHandler<TItem>,
    filter?: MeshSubscriptionFilter<TItem>,
  ): MeshSubscriptionHandle<TItem>;
}
