/**
 * MeshResourceDispatcher
 *
 * Registry + dispatch for mesh resource handlers.
 * Populated by MeshResourceService subclasses during onModuleInit().
 * Consumed by MeshResourceController which implements the single
 * meshBaseResourceContract with @Implement.
 *
 * This is the ORPC-native dynamic dispatch layer:
 *   POST /api/mesh/:entityKey/:methodName
 *   → MeshResourceController.handle()
 *   → MeshResourceDispatcher.dispatch(entityKey, methodName, body)
 *   → Registered handler function
 */

import { Injectable, Logger } from "@nestjs/common";
import { ORPCError } from "@orpc/server";

interface HandlerEntry {
  fn: (input: unknown) => Promise<unknown>;
  description?: string;
}

@Injectable()
export class MeshResourceDispatcher {
  private readonly logger = new Logger(MeshResourceDispatcher.name);
  private readonly registry = new Map<string, HandlerEntry>();

  /**
   * Register an entity operation handler.
   * Called by MeshResourceService subclasses during onModuleInit().
   *
   * @param entityKey - The entity key (e.g. "deployments")
   * @param methodName - The method name (e.g. "list")
   * @param handlerFn - The handler function (receives parsed input body)
   */
  register(
    entityKey: string,
    methodName: string,
    handlerFn: (input: unknown) => Promise<unknown>,
  ): void {
    const key = this.buildKey(entityKey, methodName);
    if (this.registry.has(key)) {
      throw new Error(
        `Duplicate mesh resource handler: ${key}. ` +
        `Each entityKey+methodName combination must be unique.`,
      );
    }
    this.registry.set(key, { fn: handlerFn });
    this.logger.debug(`Registered mesh resource: ${key}`);
  }

  /**
   * Unregister all handlers for a given entity.
   * Called during onModuleDestroy().
   */
  unregisterAll(entityKey: string): void {
    let count = 0;
    for (const key of this.registry.keys()) {
      if (key.startsWith(`${entityKey}/`)) {
        this.registry.delete(key);
        count++;
      }
    }
    if (count > 0) {
      this.logger.debug(`Unregistered ${count} handlers for entity: ${entityKey}`);
    }
  }

  /**
   * Dispatch a request to the registered handler.
   * Called by MeshResourceController.handle().
   *
   * @param entityKey - From path params
   * @param methodName - From path params
   * @param body - Request body forwarded to the handler
   * @returns The handler's response
   */
  async dispatch(
    entityKey: string,
    methodName: string,
    body: unknown,
  ): Promise<unknown> {
    const key = this.buildKey(entityKey, methodName);
    const entry = this.registry.get(key);

    if (!entry) {
      this.logger.warn(`No handler registered for: ${key}`);
      throw new ORPCError("NOT_FOUND", {
        message: `No mesh resource handler for '${entityKey}/${methodName}'`,
      });
    }

    return entry.fn(body);
  }

  /** Check if a handler is registered */
  has(entityKey: string, methodName: string): boolean {
    return this.registry.has(this.buildKey(entityKey, methodName));
  }

  /** List all registered entity keys (for introspection) */
  get registeredEntities(): string[] {
    return [...new Set(
      Array.from(this.registry.keys()).map((k) => k.split("/")[0] as string),
    )];
  }

  /** Get total registered handler count */
  get totalHandlers(): number {
    return this.registry.size;
  }

  private buildKey(entityKey: string, methodName: string): string {
    return `${entityKey}/${methodName}`;
  }
}
