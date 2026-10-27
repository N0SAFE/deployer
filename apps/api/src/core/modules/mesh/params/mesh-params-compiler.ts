import type { z } from "zod/v4";
import type { MeshFilterDescriptor, Scalar } from "../filter/mesh-filter.types";

/**
 * Compile operation call params into a MeshFilterDescriptor.
 * Every field in the input schema that is not a pagination/ordering hint
 * is treated as a filter predicate.
 */
export function compileParamsToFilterDescriptor(
  params: Record<string, unknown>,
  schema?: z.ZodObject<any>,
): MeshFilterDescriptor {
  const clauses: MeshFilterDescriptor[] = [];

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;

    // Skip pagination / ordering hints
    if (["limit", "offset", "orderBy", "cursor", "$filter"].includes(key)) continue;

    // Skip if schema says this field doesn't exist
    if (schema && !schema.shape[key]) continue;

    if (Array.isArray(value)) {
      clauses.push({ op: "in", field: key, values: value as Scalar[] });
    } else {
      clauses.push({ op: "eq", field: key, value: value as Scalar });
    }
  }

  // Handle $filter escape hatch
  const $filter = params.$filter as MeshFilterDescriptor | undefined;
  if ($filter) {
    clauses.push($filter);
  }

  if (clauses.length === 0) return { op: "always" };
  if (clauses.length === 1) return clauses[0]!;
  return { op: "and", operands: clauses };
}

/**
 * Extract pagination hints from params.
 */
export function extractPagination(params: Record<string, unknown>): {
  limit?: number;
  offset?: number;
  orderBy?: string;
  cursor?: string;
} {
  const result: { limit?: number; offset?: number; orderBy?: string; cursor?: string } = {};

  if (typeof params.limit === "number") result.limit = params.limit;
  if (typeof params.offset === "number") result.offset = params.offset;
  if (typeof params.orderBy === "string") result.orderBy = params.orderBy;
  if (typeof params.cursor === "string") result.cursor = params.cursor;

  return result;
}
