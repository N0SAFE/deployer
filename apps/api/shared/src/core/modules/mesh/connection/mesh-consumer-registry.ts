import { Injectable } from "@nestjs/common";
import type { MeshConsumerId, MeshFilterDescriptor } from "../filter/mesh-filter.types";
import { reconstructFilter } from "../filter/mesh-filter-evaluator";
import { unionFilters } from "../filter/mesh-filter-subset";

// ─── Server-side consumer registration ────────────────────────────────────────

interface ServerConsumerRegistration {
  consumerId: MeshConsumerId;
  filterDescriptor: MeshFilterDescriptor;
  evaluator: (item: unknown) => boolean;
  registeredAt: Date;
}

/**
 * Per-connection consumer registry on the server.
 * Tracks all consumers attached to a single SSE connection,
 * computes recipients for each event, and maintains the union filter.
 */
@Injectable()
export class ServerConnectionConsumerRegistry {
  private consumers = new Map<MeshConsumerId, ServerConsumerRegistration>();

  attach(consumerId: MeshConsumerId, descriptor: MeshFilterDescriptor): void {
    this.consumers.set(consumerId, {
      consumerId,
      filterDescriptor: descriptor,
      evaluator: reconstructFilter(descriptor),
      registeredAt: new Date(),
    });
  }

  detach(consumerId: MeshConsumerId): void {
    this.consumers.delete(consumerId);
  }

  /**
   * Evaluate all consumer filters against an event.
   * Returns the list of consumers who should receive it.
   * O(n) where n = number of consumers on this connection (typically small).
   */
  computeRecipients(item: unknown): MeshConsumerId[] {
    const recipients: MeshConsumerId[] = [];
    for (const [id, consumer] of this.consumers) {
      if (consumer.evaluator(item)) {
        recipients.push(id);
      }
    }
    return recipients;
  }

  isEmpty(): boolean {
    return this.consumers.size === 0;
  }

  getConsumerCount(): number {
    return this.consumers.size;
  }

  /**
   * Get the union of all active consumer filters.
   * This is the effective server-side emit predicate for the connection.
   */
  getUnionFilter(): MeshFilterDescriptor {
    const filters = [...this.consumers.values()].map((r) => r.filterDescriptor);
    if (filters.length === 0) return { op: "never" };
    if (filters.length === 1) return filters[0]!;
    return filters.reduce(unionFilters);
  }

  /**
   * Get all registered consumers (for introspection).
   */
  getConsumers(): ReadonlyMap<MeshConsumerId, ServerConsumerRegistration> {
    return this.consumers;
  }
}
