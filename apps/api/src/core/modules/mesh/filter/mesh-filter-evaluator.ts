import type { MeshFilterDescriptor } from "./mesh-filter.types";
import { isRecord, isObjectLike } from "@repo/type-guards"

/**
 * Reconstruct a MeshFilterDescriptor into an evaluator function.
 * The reconstructed function is semantically identical to the client-side
 * MeshFilterOperator.evaluate — same logic, same behavior.
 */


export function reconstructFilter<T>(descriptor: MeshFilterDescriptor): (item: T) => boolean {
  switch (descriptor.op) {
    case "always":
      return () => true;
    case "never":
      return () => false;
    case "eq":
      return (item) => item[descriptor.field] === descriptor.value;
    case "neq":
      return (item) => item[descriptor.field] !== descriptor.value;
    case "gt":
      return (item) => item[descriptor.field] as number > (descriptor.value as number);
    case "gte":
      return (item) => item[descriptor.field] as number >= (descriptor.value as number);
    case "lt":
      return (item) => item[descriptor.field] as number < (descriptor.value as number);
    case "lte":
      return (item) => item[descriptor.field] as number <= (descriptor.value as number);
    case "in":
      return (item) => descriptor.values.includes(item[descriptor.field] as never);
    case "notIn":
      return (item) => !descriptor.values.includes(item[descriptor.field] as never);
    case "exists": {
      return (item) => {
        const v = (isRecord(item) ? item : {})[descriptor.field];
        return v !== undefined && v !== null;
      };
    }
    case "missing": {
      return (item) => {
        const v = (isRecord(item) ? item : {})[descriptor.field];
        return v === undefined || v === null;
      };
    }
    case "matches": {
      const re = new RegExp(descriptor.pattern, descriptor.flags);
      return (item) => re.test(String((isRecord(item) ? item : {})[descriptor.field]));
    }
    case "and": {
      const fns = descriptor.operands.map((op) => reconstructFilter<T>(op));
      return (item) => fns.every((fn) => fn(item));
    }
    case "or": {
      const fns = descriptor.operands.map((op) => reconstructFilter<T>(op));
      return (item) => fns.some((fn) => fn(item));
    }
    case "not": {
      const fn = reconstructFilter<T>(descriptor.operand);
      return (item) => !fn(item);
    }
  }
}
