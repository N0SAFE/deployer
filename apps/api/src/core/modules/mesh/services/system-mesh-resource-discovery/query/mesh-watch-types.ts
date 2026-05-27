// ─── Change event types ───────────────────────────────────────────────────────

export type MeshChangeType = "initial" | "created" | "updated" | "deleted" | "reconnect";

/**
 * Event emitted when watched items change.
 */
export interface MeshChangeEvent<TItem> {
  /** The type of change that occurred */
  readonly type: MeshChangeType;

  /** The item that was affected (undefined for initial load) */
  readonly item?: TItem;

  /** Previous state of the item (for updates and deletes) */
  readonly previousItem?: TItem;

  /** Timestamp when the event occurred */
  readonly timestamp: string;

  /** Source node that triggered the change */
  readonly sourceNodeId?: string;
}

// ─── Watch handle ─────────────────────────────────────────────────────────────

/**
 * Handle to control a watch operation.
 */
export interface MeshWatchHandle {
  /** Stop watching for changes */
  stop(): void;

  /** Check if watch is still active */
  readonly isActive: boolean;

  /** Force a refresh of the watched data */
  refresh(): Promise<void>;
}

// ─── Watch strategy ───────────────────────────────────────────────────────────

/**
 * Strategy used to watch for changes.
 */
export type MeshWatchStrategy = "subscription" | "polling" | "hybrid";

/**
 * Options for watching mesh resources.
 */
export interface MeshWatchOptions<TItem, TResultShape> {
  /** Called when items change */
  onChange: (items: readonly TResultShape[], event: MeshChangeEvent<TItem>) => void | Promise<void>;

  /** Called on errors */
  onError?: (error: Error) => void;

  /** Polling interval for non-subscribable resources */
  pollIntervalMs?: number;

  /** Reconnect delay after connection loss */
  reconnectDelayMs?: number;

  /** Whether to include initial data load */
  includeInitial?: boolean;
}
