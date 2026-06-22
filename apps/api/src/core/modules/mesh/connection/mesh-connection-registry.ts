import { Injectable, Logger } from "@nestjs/common";
import { Subject, Observable, filter, map, distinctUntilChanged } from "rxjs";
import type {
  MeshConnectionId,
  MeshConsumerId,
  MeshFilterDescriptor,
  MeshStreamId,
} from "../filter/mesh-filter.types";
import type { MeshStreamEnvelope } from "./mesh-connection.types";
import { generateConnectionId, generateConsumerId, generateStreamId } from "../filter/mesh-filter.types";
import type {
  MeshConnection,
  ConnectionLifecycleEvent,
  StreamAcquisitionSpec,
  NodeTarget,
} from "./mesh-connection.types";
import { ServerConnectionConsumerRegistry } from "./mesh-consumer-registry";
import { isFilterSubset, unionFilters } from "../filter/mesh-filter-subset";

// ─── Promotion decision ─────────────────────────────────────────────────────

export type PromotionDecision =
  | { action: "attach"; connectionId: MeshConnectionId }
  | { action: "promote"; connectionId: MeshConnectionId; newFilter: MeshFilterDescriptor }
  | { action: "new" };

// ─── Connection Registry ──────────────────────────────────────────────────────

@Injectable()
export class MeshConnectionRegistry {
  private readonly logger = new Logger(MeshConnectionRegistry.name);

  private connections = new Map<MeshConnectionId, MeshConnection>();
  private lifecycleSubject = new Subject<ConnectionLifecycleEvent>();

  readonly lifecycle$: Observable<ConnectionLifecycleEvent> = this.lifecycleSubject.asObservable();

  // ─── Lookup ───────────────────────────────────────────────────────────────

  lookup(nodeId: string, entityKey: string, methodName: string): MeshConnection | null {
    for (const conn of this.connections.values()) {
      if (conn.nodeId === nodeId && conn.entityKey === entityKey && conn.methodName === methodName) {
        return conn;
      }
    }
    return null;
  }

  // ─── Decide promotion ─────────────────────────────────────────────────────

  decidePromotion(
    incomingFilter: MeshFilterDescriptor,
    openConnections: MeshConnection[],
  ): PromotionDecision {
    for (const conn of openConnections) {
      // Consumer needs a subset — attach without modification
      if (isFilterSubset(incomingFilter, conn.serverFilter)) {
        return { action: "attach", connectionId: conn.id };
      }

      // Consumer needs a superset — promote the connection
      if (isFilterSubset(conn.serverFilter, incomingFilter)) {
        return {
          action: "promote",
          connectionId: conn.id,
          newFilter: incomingFilter,
        };
      }

      // Partial overlap — promote to union
      // (simplified: always open new for partial overlap to avoid complexity)
    }

    return { action: "new" };
  }

  // ─── Open a new connection ────────────────────────────────────────────────

  async open(
    nodeId: string,
    entityKey: string,
    methodName: string,
    consumerId: MeshConsumerId,
    filterDescriptor: MeshFilterDescriptor,
  ): Promise<MeshConnection> {
    const id = generateConnectionId();
    const source$ = new Subject<any>();

    const conn: MeshConnection = {
      id,
      nodeId,
      entityKey,
      methodName,
      serverFilter: filterDescriptor,
      consumers: new Map(),
      source$,
      status: "connecting",
      openedAt: new Date(),
    };

    this.connections.set(id, conn);

    // Attach the initial consumer
    conn.consumers.set(consumerId, {
      consumerId,
      filterDescriptor,
      attachedAt: new Date(),
    });

    // Simulate connection establishment
    setTimeout(() => {
      conn.status = "open";
      this.lifecycleSubject.next({
        type: "connection_opened",
        connectionId: id,
        nodeId,
        entityKey,
      });
    }, 10);

    this.logger.debug(`Opened connection ${id} to ${nodeId} for ${entityKey}:${methodName}`);
    return conn;
  }

  // ─── Attach a consumer to an existing connection ──────────────────────────

  async attach(
    connectionId: MeshConnectionId,
    consumerId: MeshConsumerId,
    filterDescriptor: MeshFilterDescriptor,
  ): Promise<void> {
    const conn = this.connections.get(connectionId);
    if (!conn) {
      throw new Error(`Connection ${connectionId} not found`);
    }

    conn.consumers.set(consumerId, {
      consumerId,
      filterDescriptor,
      attachedAt: new Date(),
    });

    this.lifecycleSubject.next({
      type: "consumer_attached",
      connectionId,
      consumerId,
      consumerCount: conn.consumers.size,
    });

    this.logger.debug(`Attached consumer ${consumerId} to connection ${connectionId} (${conn.consumers.size} total)`);
  }

  // ─── Promote a connection's filter ──────────────────────────────────────────

  async promote(
    connectionId: MeshConnectionId,
    newFilter: MeshFilterDescriptor,
  ): Promise<void> {
    const conn = this.connections.get(connectionId);
    if (!conn) {
      throw new Error(`Connection ${connectionId} not found`);
    }

    // Update the server filter to the new broader scope.
    // In a full production implementation this would also send a control frame
    // to the server to update its emit predicate in real-time.
    conn.serverFilter = newFilter;
    this.logger.debug(`Promoted connection ${connectionId} to new filter scope`);
  }

  // ─── Release a consumer ───────────────────────────────────────────────────

  release(connectionId: MeshConnectionId, consumerId: MeshConsumerId): void {
    const conn = this.connections.get(connectionId);
    if (!conn) return;

    conn.consumers.delete(consumerId);

    this.lifecycleSubject.next({
      type: "consumer_detached",
      connectionId,
      consumerId,
      consumerCount: conn.consumers.size,
    });

    if (conn.consumers.size === 0) {
      this.closeConnection(conn);
    }
  }

  // ─── Close a connection ───────────────────────────────────────────────────

  private closeConnection(conn: MeshConnection): void {
    conn.status = "closed";
    conn.source$.complete();
    this.connections.delete(conn.id);

    this.lifecycleSubject.next({
      type: "connection_closed",
      connectionId: conn.id,
      reason: "empty",
    });

    this.logger.debug(`Closed connection ${conn.id} (no remaining consumers)`);
  }

  // ─── List open connections ────────────────────────────────────────────────

  listOpen(): MeshConnection[] {
    return [...this.connections.values()].filter((c) => c.status !== "closed");
  }

  // ─── Build per-consumer Observable ────────────────────────────────────────

  buildConsumerObservable<TItem>(
    source$: Observable<MeshStreamEnvelope<TItem>>,
    consumerId: MeshConsumerId,
  ): Observable<TItem> {
    return source$.pipe(
      filter((envelope) => envelope.recipients.includes(consumerId)),
      map((envelope) => envelope.payload),
    );
  }
}
