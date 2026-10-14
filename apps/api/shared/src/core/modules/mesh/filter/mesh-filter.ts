import { filter, type Observable } from "rxjs";
import type { MeshFilterDescriptor, MeshFilterOperator, Scalar } from "./mesh-filter.types";
export type {
  MeshWhereExpression as MeshWhereValueExpression,
  MeshWhereExpression as TypedMeshWhereExpression,
  MeshWhereExpression as FieldExpression,
} from "../services/system-mesh-resource-discovery/query/mesh-where";
export {
  createFilter,
  eq as whereEq,
  neq as whereNeq,
  gt as whereGt,
  gte as whereGte,
  lt as whereLt,
  lte as whereLte,
  inArray as whereInList,
  notInArray as whereNinList,
  and as whereAnd,
  or as whereOr,
} from "../services/system-mesh-resource-discovery/query/mesh-where";

// ─── Primitives ───────────────────────────────────────────────────────────────

export function eq<T extends object, K extends string>(field: K, value: unknown): MeshFilterOperator<T> {
  const descriptor: MeshFilterDescriptor = { op: "eq", field: field as string, value: value as Scalar };
  const evaluate = (item: T) => Reflect.get(item, field as string) === value;
  const operator = (source: Observable<T>) => source.pipe(filter(evaluate));
  return Object.assign(operator, { descriptor, evaluate });
}

export function neq<T extends object, K extends string>(field: K, value: unknown): MeshFilterOperator<T> {
  const descriptor: MeshFilterDescriptor = { op: "neq", field: field as string, value: value as Scalar };
  const evaluate = (item: T) => Reflect.get(item, field as string) !== value;
  const operator = (source: Observable<T>) => source.pipe(filter(evaluate));
  return Object.assign(operator, { descriptor, evaluate });
}

export function gt<T extends object, K extends string>(field: K, value: number): MeshFilterOperator<T> {
  const descriptor: MeshFilterDescriptor = { op: "gt", field: field as string, value };
  const evaluate = (item: T) => Reflect.get(item, field as string) as number > value;
  const operator = (source: Observable<T>) => source.pipe(filter(evaluate));
  return Object.assign(operator, { descriptor, evaluate });
}

export function gte<T extends object, K extends string>(field: K, value: number): MeshFilterOperator<T> {
  const descriptor: MeshFilterDescriptor = { op: "gte", field: field as string, value };
  const evaluate = (item: T) => Reflect.get(item, field as string) as number >= value;
  const operator = (source: Observable<T>) => source.pipe(filter(evaluate));
  return Object.assign(operator, { descriptor, evaluate });
}

export function lt<T extends object, K extends string>(field: K, value: number): MeshFilterOperator<T> {
  const descriptor: MeshFilterDescriptor = { op: "lt", field: field as string, value };
  const evaluate = (item: T) => Reflect.get(item, field as string) as number < value;
  const operator = (source: Observable<T>) => source.pipe(filter(evaluate));
  return Object.assign(operator, { descriptor, evaluate });
}

export function lte<T extends object, K extends string>(field: K, value: number): MeshFilterOperator<T> {
  const descriptor: MeshFilterDescriptor = { op: "lte", field: field as string, value };
  const evaluate = (item: T) => Reflect.get(item, field as string) as number <= value;
  const operator = (source: Observable<T>) => source.pipe(filter(evaluate));
  return Object.assign(operator, { descriptor, evaluate });
}

export function inSet<T extends object, K extends string>(field: K, values: readonly unknown[]): MeshFilterOperator<T> {
  const descriptor: MeshFilterDescriptor = { op: "in", field: field as string, values: [...values] as Scalar[] };
  const evaluate = (item: T) => values.includes(Reflect.get(item, field as string) as unknown);
  const operator = (source: Observable<T>) => source.pipe(filter(evaluate));
  return Object.assign(operator, { descriptor, evaluate });
}

export function notIn<T extends object, K extends string>(field: K, values: readonly unknown[]): MeshFilterOperator<T> {
  const descriptor: MeshFilterDescriptor = { op: "notIn", field: field as string, values: [...values] as Scalar[] };
  const evaluate = (item: T) => !values.includes(Reflect.get(item, field as string) as unknown);
  const operator = (source: Observable<T>) => source.pipe(filter(evaluate));
  return Object.assign(operator, { descriptor, evaluate });
}

export function exists<T extends object, K extends string>(field: K): MeshFilterOperator<T> {
  const descriptor: MeshFilterDescriptor = { op: "exists", field: field as string };
  const evaluate = (item: T) => {
    const v = Reflect.get(item, field);
    return v !== undefined && v !== null;
  };
  const operator = (source: Observable<T>) => source.pipe(filter(evaluate));
  return Object.assign(operator, { descriptor, evaluate });
}

export function missing<T extends object, K extends string>(field: K): MeshFilterOperator<T> {
  const descriptor: MeshFilterDescriptor = { op: "missing", field: field as string };
  const evaluate = (item: T) => {
    const v = Reflect.get(item, field);
    return v === undefined || v === null;
  };
  const operator = (source: Observable<T>) => source.pipe(filter(evaluate));
  return Object.assign(operator, { descriptor, evaluate });
}

export function matches<T extends object, K extends string>(field: K, pattern: RegExp): MeshFilterOperator<T> {
  const descriptor: MeshFilterDescriptor = {
    op: "matches",
    field: field as string,
    pattern: pattern.source,
    flags: pattern.flags,
  };
  const evaluate = (item: T) => pattern.test(String(Reflect.get(item, field as string)));
  const operator = (source: Observable<T>) => source.pipe(filter(evaluate));
  return Object.assign(operator, { descriptor, evaluate });
}

// ─── Combinators ──────────────────────────────────────────────────────────────

export function and<T>(...operators: MeshFilterOperator<T>[]): MeshFilterOperator<T> {
  const descriptor: MeshFilterDescriptor = {
    op: "and",
    operands: operators.map((o) => o.descriptor),
  };
  const evaluate = (item: T) => operators.every((o) => o.evaluate(item));
  const operator = (source: Observable<T>) => source.pipe(filter(evaluate));
  return Object.assign(operator, { descriptor, evaluate });
}

export function or<T>(...operators: MeshFilterOperator<T>[]): MeshFilterOperator<T> {
  const descriptor: MeshFilterDescriptor = {
    op: "or",
    operands: operators.map((o) => o.descriptor),
  };
  const evaluate = (item: T) => operators.some((o) => o.evaluate(item));
  const operator = (source: Observable<T>) => source.pipe(filter(evaluate));
  return Object.assign(operator, { descriptor, evaluate });
}

export function not<T>(op: MeshFilterOperator<T>): MeshFilterOperator<T> {
  const descriptor: MeshFilterDescriptor = { op: "not", operand: op.descriptor };
  const evaluate = (item: T) => !op.evaluate(item);
  const operator = (source: Observable<T>) => source.pipe(filter(evaluate));
  return Object.assign(operator, { descriptor, evaluate });
}

// ─── Passthrough ──────────────────────────────────────────────────────────────

export const always: MeshFilterOperator<unknown> = (() => {
  const descriptor: MeshFilterDescriptor = { op: "always" };
  const evaluate = () => true;
  const operator = (source: Observable<unknown>) => source;
  return Object.assign(operator, { descriptor, evaluate });
})();

export const never: MeshFilterOperator<unknown> = (() => {
  const descriptor: MeshFilterDescriptor = { op: "never" };
  const evaluate = () => false;
  const operator = (source: Observable<unknown>) => source.pipe(filter(() => false));
  return Object.assign(operator, { descriptor, evaluate });
})();
