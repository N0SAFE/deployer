import { Injectable, Logger } from "@nestjs/common";
import type { z } from "zod/v4";
import { randomUUID } from "crypto";
import type {
  MeshSubscriptionEvent,
  MeshSubscriptionEventType,
  MeshSubscriptionFilter,
  MeshSubscriptionHandle,
  MeshSubscriptionHandler,
  MeshResourceChangeNotifier,
} from "./mesh-subscription-types";

// ─── Internal subscription record ─────────────────────────────────────────────

interface SubscriptionRecord<TItem> {
  readonly id: string;
  readonly handler: MeshSubscriptionHandler<TItem>;
  readonly filter: MeshSubscriptionFilter<TItem>;
  isActive: boolean;
}

// ─── Subscription Manager ─────────────────────────────────────────────────────

@Injectable()
export class MeshSubscriptionManager {
  private readonly logger = new Logger(MeshSubscriptionManager.name);
  private readonly subscriptions = new Map<string, SubscriptionRecord<unknown>[]>();
  private readonly globalNotifiers = new Map<string, MeshResourceChangeNotifier<unknown>>();

  /**
   * Register a global resource notifier.
   * Called by global resource services during initialization.
   */
  registerGlobalResource<TItem>(
    entityKey: string,
    itemSchema: z.ZodType<TItem>,
  ): MeshResourceChangeNotifier<TItem> {
    if (this.globalNotifiers.has(entityKey)) {
      this.logger.warn(`Global resource "${entityKey}" already registered, returning existing notifier`);
      return this.globalNotifiers.get(entityKey) as MeshResourceChangeNotifier<TItem>;
    }

    const notifier = this.createNotifier<TItem>(entityKey);
    this.globalNotifiers.set(entityKey, notifier as MeshResourceChangeNotifier<unknown>);
    this.logger.debug(`Registered global resource notifier for "${entityKey}"`);

    return notifier;
  }

  /**
   * Subscribe to changes for a global resource.
   */
  subscribe<TItem>(
    entityKey: string,
    handler: MeshSubscriptionHandler<TItem>,
    filter?: MeshSubscriptionFilter<TItem>,
  ): MeshSubscriptionHandle<TItem> {
    const id = randomUUID();
    const subs = this.subscriptions.get(entityKey) ?? [];

    const record: SubscriptionRecord<TItem> = {
      id,
      handler,
      filter: filter ?? {},
      isActive: true,
    };

    subs.push(record as SubscriptionRecord<unknown>);
    this.subscriptions.set(entityKey, subs);

    this.logger.debug(`Subscribed "${id}" to "${entityKey}"`);

    return {
      id,
      isActive: true,
      unsubscribe: () => this.unsubscribe(entityKey, id),
    };
  }

  /**
   * Unsubscribe from a resource.
   */
  private unsubscribe(entityKey: string, subscriptionId: string): void {
    const subs = this.subscriptions.get(entityKey);
    if (!subs) return;

    const index = subs.findIndex(s => s.id === subscriptionId);
    if (index >= 0 && index < subs.length) {
      const sub = subs[index];
      if (sub) {
        sub.isActive = false;
        subs.splice(index, 1);
        this.logger.debug(`Unsubscribed "${subscriptionId}" from "${entityKey}"`);
      }
    }

    if (subs.length === 0) {
      this.subscriptions.delete(entityKey);
    }
  }

  /**
   * Create a notifier for a global resource.
   */
  private createNotifier<TItem>(entityKey: string): MeshResourceChangeNotifier<TItem> {
    const notifySubscribers = async (
      event: MeshSubscriptionEvent<TItem>,
    ): Promise<void> => {
      const subs = this.subscriptions.get(entityKey) ?? [];

      for (const sub of subs) {
        if (!sub.isActive) continue;

        // Check event type filter
        if (sub.filter.eventTypes && sub.filter.eventTypes.length > 0) {
          if (!sub.filter.eventTypes.includes(event.type) && !sub.filter.eventTypes.includes("*")) {
            continue;
          }
        }

        // Check where filter
        if (sub.filter.where && !sub.filter.where(event.item)) {
          continue;
        }

        // Notify handler
        try {
          await sub.handler(event);
        } catch (err) {
          this.logger.error(`Error in subscription handler for "${entityKey}": ${err}`);
        }
      }
    };

    return {
      notifyCreated: async (item: TItem, sourceNodeId: string) => {
        await notifySubscribers({
          type: "created",
          item,
          timestamp: new Date().toISOString(),
          sourceNodeId,
        });
      },

      notifyUpdated: async (item: TItem, previousItem: TItem, sourceNodeId: string) => {
        await notifySubscribers({
          type: "updated",
          item,
          previousItem,
          timestamp: new Date().toISOString(),
          sourceNodeId,
        });
      },

      notifyDeleted: async (item: TItem, sourceNodeId: string) => {
        await notifySubscribers({
          type: "deleted",
          item,
          timestamp: new Date().toISOString(),
          sourceNodeId,
        });
      },
    };
  }

  /**
   * Get subscription stats for monitoring.
   */
  getStats(): { totalSubscriptions: number; resources: Record<string, number> } {
    const resources: Record<string, number> = {};
    let total = 0;

    for (const [key, subs] of this.subscriptions) {
      resources[key] = subs.length;
      total += subs.length;
    }

    return { totalSubscriptions: total, resources };
  }
}
