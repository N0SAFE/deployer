import { Injectable, Logger } from '@nestjs/common';

/**
 * Registry for named custom condition predicates used by deployment rules.
 * Predicates are simple functions that receive the event/context and return
 * a boolean or Promise<boolean> indicating whether the condition is met.
 */
@Injectable()
export class CustomConditionRegistry {
  private readonly logger = new Logger(CustomConditionRegistry.name);
  private readonly registry = new Map<string, (context: any) => Promise<boolean> | boolean>();

  register(name: string, predicate: (context: any) => Promise<boolean> | boolean) {
    if (this.registry.has(name)) {
      this.logger.warn(`Overriding existing custom condition: ${name}`);
    }
    this.registry.set(name, predicate);
    this.logger.log(`Registered custom condition: ${name}`);
  }

  async evaluate(name: string, context: any): Promise<{ found: boolean; result?: boolean }> {
    const pred = this.registry.get(name);
    if (!pred) {
      this.logger.warn(`Custom condition not found: ${name}`);
      return { found: false };
    }
    try {
      const res = await Promise.resolve(pred(context));
      return { found: true, result: !!res };
    } catch (err) {
      this.logger.error(`Error evaluating custom condition ${name}:`, err as any);
      return { found: true, result: false };
    }
  }
}
