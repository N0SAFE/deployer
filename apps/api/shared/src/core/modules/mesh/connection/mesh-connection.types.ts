import type { Observable, Subject } from "rxjs";
import type {
  MeshConnectionId,
  MeshConsumerId,
  MeshFilterDescriptor,
  MeshStreamId,
} from "../filter/mesh-filter.types";

// ─── Stream envelope with recipient deduplication ─────────────────────────────

export interface MeshStreamEnvelope<TPayload = unknown> {
  /** The connection this event belongs to */
  readonly connectionId: MeshConnectionId;

  /**
   * All consumer IDs whose filter matched this event.
   * Computed server-side at emit time.
   * Events with an empty recipients list are suppressed (never sent).
   */
  readonly recipients: MeshConsumerId[];

  /** Entity key for demultiplexing on multi-entity connections */
  readonly entityKey: string;

  readonly eventType: "created" | "updated" | "deleted" | string;

  readonly payload: TPayload;

  readonly timestamp: string;

  readonly sourceNodeId: string;
}

// ─── Consumer registration ──────────────────────────────────────────────────────

export interface ConsumerRegistration {
  readonly consumerId: MeshConsumerId;
  readonly filterDescriptor: MeshFilterDescriptor;
  readonly attachedAt: Date;
}

// ─── Shared stream (legacy naming, used by connection registry) ───────────────

export interface SharedStream<TEvent = unknown> {
  /** Globally unique ID for this stream */
  readonly id: MeshStreamId;

  /** Human-readable fingerprint used for deduplication */
  readonly fingerprint: string;

  /** The entity key this stream is bound to */
  readonly entityKey: string;

  /** The method name */
  readonly methodName: string;

  /** Server-side filter descriptor */
  readonly serverFilter: MeshFilterDescriptor;

  /** Target node(s) this SSE connection reaches */
  readonly targets: NodeTarget[];

  /** How many active consumers hold a reference */
  readonly refCount: number;

  /** When this stream was opened */
  readonly openedAt: Date;

  /** The raw RxJS Subject that all consumer Observables derive from */
  readonly source$: Subject<TEvent>;

  /** Current lifecycle status */
  readonly status: "connecting" | "open" | "degraded" | "closed";
}

export interface NodeTarget {
  readonly nodeId: string;
  readonly url?: string;
}

// ─── Connection (v6 unified model) ────────────────────────────────────────────

export interface MeshConnection<TItem = unknown> {
  /** Stable connection ID */
  readonly id: MeshConnectionId;

  /** The node this connection is open to */
  readonly nodeId: string;

  /** The entity key this connection serves */
  readonly entityKey: string;

  /** The method name */
  readonly methodName: string;

  /** Server-side filter descriptor (union of all consumer filters) */
  serverFilter: MeshFilterDescriptor;

  /** All registered consumers with their filter descriptors */
  readonly consumers: Map<MeshConsumerId, ConsumerRegistration>;

  /** The RxJS Subject that receives all raw envelopes from the SSE stream */
  readonly source$: Subject<MeshStreamEnvelope<TItem>>;

  /** Current connection status */
  status: "connecting" | "open" | "degraded" | "closed";

  /** When the connection was established */
  readonly openedAt: Date;
}

// ─── Lifecycle events ─────────────────────────────────────────────────────────

export type ConnectionLifecycleEvent =
  | { type: "connection_opened"; connectionId: MeshConnectionId; nodeId: string; entityKey: string }
  | { type: "connection_closed"; connectionId: MeshConnectionId; reason: "empty" | "error" | "manual" }
  | { type: "consumer_attached"; connectionId: MeshConnectionId; consumerId: MeshConsumerId; consumerCount: number }
  | { type: "consumer_detached"; connectionId: MeshConnectionId; consumerId: MeshConsumerId; consumerCount: number }
  | { type: "connection_degraded"; connectionId: MeshConnectionId; reason: string }
  | { type: "connection_reconnected"; connectionId: MeshConnectionId; attemptCount: number };

// ─── Stream acquisition spec ──────────────────────────────────────────────────

export interface StreamAcquisitionSpec {
  entityKey: string;
  methodName: string;
  serverFilter: MeshFilterDescriptor;
  targets: NodeTarget[];
  strategy: string;
  idleTtlMs?: number;
}

// ─── Typed stream handle ──────────────────────────────────────────────────────

export interface TypedStreamHandle<TItem> {
  readonly streamId: MeshStreamId;
  readonly consumerId: MeshConsumerId;
  readonly fingerprint: string;
  readonly refCount$: Observable<number>;
  readonly status$: Observable<"connecting" | "open" | "degraded" | "closed">;
  readonly events$: Observable<MeshStreamEnvelope<TItem>>;
  readonly enhance: (enhancement: unknown) => Promise<void>;
  readonly release: () => void;
}
