import type { MeshQueryBuilder } from "./mesh-query-builder";
import type { MeshQueryStrategy, MeshResolvedJoin } from "./mesh-query-builder-types";
import type { MeshWhereExpression } from "./mesh-where";
import type { AnyRecord } from "../../../mesh-type-utils";

// ─── Primitive plan types ─────────────────────────────────────────────────────

export type MeshQueryPlanWhereType = "object" | "expression";

export interface MeshQueryPlanWhereClause {
  readonly type: MeshQueryPlanWhereType;
  readonly description: string;
  readonly fields: readonly string[];
}

export interface MeshQueryPlanOrder {
  readonly field: string;
  readonly direction: "asc" | "desc";
}

export interface MeshQueryPlanPagination {
  readonly limit: number | null;
  readonly offset: number;
}

export type MeshQueryPlanWarningSeverity = "info" | "warn" | "error";

export interface MeshQueryPlanWarning {
  readonly code: MeshQueryPlanWarningCode;
  readonly message: string;
  readonly severity: MeshQueryPlanWarningSeverity;
}

export type MeshQueryPlanWarningCode =
  | "CROSS_ENTITY_JOIN"
  | "UNBOUNDED_JOIN_QUERY"
  | "UNBOUNDED_QUERY"
  | "MISSING_WHERE"
  | "DEEP_NESTED_JOIN"
  | "INNER_JOIN_NO_FILTER";

// ─── Recursive plan type ──────────────────────────────────────────────────────

export interface MeshQueryPlanJoin {
  readonly alias: string;
  readonly entityKey: string;
  readonly methodName: string;
  readonly type: "left" | "inner";
  readonly nestedPlan: MeshQueryPlan;
}

export interface MeshQueryPlan {
  readonly entityKey: string;
  readonly methodName: string;
  readonly strategy: MeshQueryStrategy;
  readonly whereClauses: readonly MeshQueryPlanWhereClause[];
  readonly joins: readonly MeshQueryPlanJoin[];
  readonly projections: readonly string[] | null;
  readonly ordering: readonly MeshQueryPlanOrder[];
  readonly pagination: MeshQueryPlanPagination;
  readonly warnings: readonly MeshQueryPlanWarning[];
  readonly depth: number;
}

// ─── Where clause inspector ───────────────────────────────────────────────────

function inspectWhereClause(
  clause: Partial<AnyRecord> | MeshWhereExpression,
): MeshQueryPlanWhereClause {
  // Expression brand check — no `any`, just structural narrowing
  if (
    typeof clause === "object" &&
    "test" in clause &&
    typeof (clause as { test: unknown }).test === "function"
  ) {
    return {
      type: "expression",
      description: "functional predicate",
      fields: [],
    };
  }

  const fields = Object.keys(clause);
  return {
    type: "object",
    description: `{ ${fields.join(", ")} }`,
    fields,
  };
}

// ─── Warning collectors ───────────────────────────────────────────────────────

function collectWarnings(
  plan: Omit<MeshQueryPlan, "warnings">,
  joins: readonly MeshQueryPlanJoin[],
): readonly MeshQueryPlanWarning[] {
  const warnings: MeshQueryPlanWarning[] = [];

  if (plan.whereClauses.length === 0 && plan.pagination.limit === null) {
    warnings.push({
      code: "MISSING_WHERE",
      message: `Entity '${plan.entityKey}' is queried without any filter or limit — full distributed scan`,
      severity: "warn",
    });
  }

  if (plan.pagination.limit === null && joins.length > 0) {
    warnings.push({
      code: "UNBOUNDED_JOIN_QUERY",
      message: "Query has joins but no limit — consider .limit() to avoid large in-memory joins",
      severity: "warn",
    });
  }

  if (plan.pagination.limit === null && plan.whereClauses.length === 0) {
    warnings.push({
      code: "UNBOUNDED_QUERY",
      message: "Unbounded query with no where clauses — all distributed items will be collected",
      severity: "info",
    });
  }

  if (plan.depth > 3) {
    warnings.push({
      code: "DEEP_NESTED_JOIN",
      message: `Join depth is ${String(plan.depth)} — deeply nested joins may impact performance`,
      severity: "warn",
    });
  }

  for (const join of joins) {
    if (join.entityKey !== plan.entityKey) {
      warnings.push({
        code: "CROSS_ENTITY_JOIN",
        message: `Join '${join.alias}' crosses entity boundary (${plan.entityKey} → ${join.entityKey}) — executed in-memory post-collection`,
        severity: "info",
      });
    }

    if (join.type === "inner" && join.nestedPlan.whereClauses.length === 0) {
      warnings.push({
        code: "INNER_JOIN_NO_FILTER",
        message: `INNER JOIN '${join.alias}' has no filter on the right side — all items will be joined`,
        severity: "info",
      });
    }
  }

  return warnings;
}

// ─── Core plan builder ────────────────────────────────────────────────────────

export function buildQueryPlan<TItem, TResultShape>(
  builder: MeshQueryBuilder<TItem, TResultShape>,
  depth = 0,
): MeshQueryPlan {
  const state = builder._state;
  const entityKey = builder._getEntityKey();
  const methodName = state.query.methodName ?? "list";
  const strategy = state.scopeOptions.strategy ?? "broadcast-merge";

  const whereClauses = state.whereClauses.map(inspectWhereClause);

  const joins: MeshQueryPlanJoin[] = state.joins.map(
    (join: MeshResolvedJoin): MeshQueryPlanJoin => ({
      alias: join.alias,
      entityKey: join.builder._getEntityKey(),
      methodName: join.builder._state.query.methodName ?? "list",
      type: join.type,
      nestedPlan: buildQueryPlan(join.builder, depth + 1),
    }),
  );

  const ordering: readonly MeshQueryPlanOrder[] = state.orderClauses.map((o) => ({
    field: o.field,
    direction: o.direction,
  }));

  const projections: readonly string[] | null = state.selectedFields
    ? (state.selectedFields as readonly string[])
    : null;

  const pagination: MeshQueryPlanPagination = {
    limit: state.pagination.limit,
    offset: state.pagination.offset,
  };

  const planWithoutWarnings: Omit<MeshQueryPlan, "warnings"> = {
    entityKey,
    methodName,
    strategy,
    whereClauses,
    joins,
    projections,
    ordering,
    pagination,
    depth,
  };

  const warnings = collectWarnings(planWithoutWarnings, joins);

  return { ...planWithoutWarnings, warnings };
}

// ─── Pretty printer ───────────────────────────────────────────────────────────

const SEVERITY_PREFIX: Record<MeshQueryPlanWarningSeverity, string> = {
  info: "ℹ",
  warn: "⚠",
  error: "✖",
};

export function formatQueryPlan(plan: MeshQueryPlan, indent = 0): string {
  const pad = "  ".repeat(indent);
  const lines: string[] = [];

  lines.push(`${pad}MeshQueryPlan {`);
  lines.push(`${pad}  entity:   ${plan.entityKey}`);
  lines.push(`${pad}  method:   ${plan.methodName}`);
  lines.push(`${pad}  strategy: ${plan.strategy}`);
  lines.push(`${pad}  depth:    ${String(plan.depth)}`);

  if (plan.whereClauses.length > 0) {
    lines.push(`${pad}  where: [`);
    for (const w of plan.whereClauses) {
      lines.push(`${pad}    [${w.type}] ${w.description}`);
    }
    lines.push(`${pad}  ]`);
  }

  if (plan.ordering.length > 0) {
    const orderStr = plan.ordering
      .map((o) => `${o.field} ${o.direction}`)
      .join(", ");
    lines.push(`${pad}  orderBy:  ${orderStr}`);
  }

  if (plan.pagination.limit !== null || plan.pagination.offset > 0) {
    lines.push(
      `${pad}  page:     limit=${String(plan.pagination.limit ?? "∞")} offset=${String(plan.pagination.offset)}`,
    );
  }

  if (plan.projections !== null) {
    lines.push(`${pad}  select:   [${plan.projections.join(", ")}]`);
  }

  if (plan.joins.length > 0) {
    lines.push(`${pad}  joins: [`);
    for (const join of plan.joins) {
      lines.push(
        `${pad}    ${join.type.toUpperCase()} JOIN as '${join.alias}' → ${join.entityKey}`,
      );
      lines.push(formatQueryPlan(join.nestedPlan, indent + 3));
    }
    lines.push(`${pad}  ]`);
  }

  if (plan.warnings.length > 0) {
    lines.push(`${pad}  warnings: [`);
    for (const w of plan.warnings) {
      const prefix = SEVERITY_PREFIX[w.severity];
      lines.push(`${pad}    ${prefix} [${w.code}] ${w.message}`);
    }
    lines.push(`${pad}  ]`);
  }

  lines.push(`${pad}}`);
  return lines.join("\n");
}