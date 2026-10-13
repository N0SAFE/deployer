import type { Observable } from "rxjs";

function makeId(): string {
  return `m-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
}

// ─── Scalar type ────────────────────────────────────────────────────────────

export type Scalar = string | number | boolean | null;

// ─── MeshFilterDescriptor (wire format) ───────────────────────────────────────

export type MeshFilterDescriptor =
  | { op: "always" }
  | { op: "never" }
  | { op: "eq"; field: string; value: Scalar }
  | { op: "neq"; field: string; value: Scalar }
  | { op: "gt"; field: string; value: number | string }
  | { op: "gte"; field: string; value: number | string }
  | { op: "lt"; field: string; value: number | string }
  | { op: "lte"; field: string; value: number | string }
  | { op: "in"; field: string; values: Scalar[] }
  | { op: "notIn"; field: string; values: Scalar[] }
  | { op: "exists"; field: string }
  | { op: "missing"; field: string }
  | { op: "matches"; field: string; pattern: string; flags?: string }
  | { op: "and"; operands: MeshFilterDescriptor[] }
  | { op: "or"; operands: MeshFilterDescriptor[] }
  | { op: "not"; operand: MeshFilterDescriptor };

// ─── MeshFilterOperator (isomorphic: RxJS + descriptor + evaluate) ──────────

export interface MeshFilterOperator<T> {
  /** Use as an RxJS operator: stream$.pipe(operator) */
  (source: Observable<T>): Observable<T>;

  /** Serialize to wire descriptor */
  readonly descriptor: MeshFilterDescriptor;

  /** Evaluate a single item synchronously */
  readonly evaluate: (item: T) => boolean;
}

// ─── Branded IDs ──────────────────────────────────────────────────────────────

export type MeshStreamId = string & { readonly __brand: "MeshStreamId" };
export type MeshConsumerId = string & { readonly __brand: "MeshConsumerId" };
export type MeshConnectionId = string & { readonly __brand: "MeshConnectionId" };

export function generateStreamId(): MeshStreamId {
  return makeId() as MeshStreamId;
}

export function generateConsumerId(): MeshConsumerId {
  return makeId() as MeshConsumerId;
}

export function generateConnectionId(): MeshConnectionId {
  return makeId() as MeshConnectionId;
}
