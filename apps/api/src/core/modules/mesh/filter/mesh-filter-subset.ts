import type { MeshFilterDescriptor } from "./mesh-filter.types";

/**
 * Returns true if filterA's event set is a subset of filterB's event set.
 * i.e., everything filterA would match, filterB also matches.
 */
export function isFilterSubset(filterA: MeshFilterDescriptor, filterB: MeshFilterDescriptor): boolean {
  if ((filterB as any).op === "always") return true;
  if ((filterA as any).op === "never") return true;
  if ((filterB as any).op === "never") return false;
  if ((filterA as any).op === "always") return (filterB as any).op === "always";

  // eq(field, X) ⊆ in(field, [..., X, ...])
  if (filterA.op === "eq" && filterB.op === "in") {
    return filterA.field === filterB.field && filterB.values.includes(filterA.value);
  }

  // in(field, [A,B]) ⊆ in(field, [A,B,C])
  if (filterA.op === "in" && filterB.op === "in") {
    return filterA.field === filterB.field && filterA.values.every((v) => filterB.values.includes(v));
  }

  // and([...]) ⊆ B if any clause of A is a subset of B
  if (filterA.op === "and") {
    return filterA.operands.some((op) => isFilterSubset(op, filterB));
  }

  // A ⊆ or([...]) if A is a subset of any clause
  if (filterB.op === "or") {
    return filterB.operands.some((op) => isFilterSubset(filterA, op));
  }

  // Identical descriptors are trivially subsets of each other
  return JSON.stringify(filterA) === JSON.stringify(filterB);
}

/**
 * Compute the union (logical OR) of two filter descriptors.
 * Used when promoting a stream to cover a new consumer's broader filter.
 */
export function unionFilters(a: MeshFilterDescriptor, b: MeshFilterDescriptor): MeshFilterDescriptor {
  if (a.op === "always" || b.op === "always") return { op: "always" };
  if (a.op === "never") return b;
  if (b.op === "never") return a;
  if (JSON.stringify(a) === JSON.stringify(b)) return a;
  return { op: "or", operands: [a, b] };
}

/**
 * Check if two filters have any overlap (i.e., there exists an item that
 * could match both).
 */
export function hasFilterOverlap(a: MeshFilterDescriptor, b: MeshFilterDescriptor): boolean {
  if (a.op === "never" || b.op === "never") return false;
  if (a.op === "always" || b.op === "always") return true;

  // eq(field, X) overlaps with eq(field, X)
  if (a.op === "eq" && b.op === "eq" && a.field === b.field) {
    return a.value === b.value;
  }

  // eq(field, X) overlaps with in(field, [..., X, ...])
  if (a.op === "eq" && b.op === "in" && a.field === b.field) {
    return b.values.includes(a.value);
  }

  // in(field, [...]) overlaps with in(field, [...]) if any shared value
  if (a.op === "in" && b.op === "in" && a.field === b.field) {
    return a.values.some((v) => b.values.includes(v));
  }

  // and: overlap if all operands overlap (simplified)
  if (a.op === "and" && b.op === "and") {
    return a.operands.every((opA) => b.operands.some((opB) => hasFilterOverlap(opA, opB)));
  }

  // or: overlap if any operand overlaps
  if (a.op === "or" || b.op === "or") {
    const aOps = a.op === "or" ? a.operands : [a];
    const bOps = b.op === "or" ? b.operands : [b];
    return aOps.some((opA) => bOps.some((opB) => hasFilterOverlap(opA, opB)));
  }

  // Default: assume overlap for different fields
  if ((a as any).field && (b as any).field && (a as any).field !== (b as any).field) {
    return true; // different fields could coexist
  }

  return true;
}
