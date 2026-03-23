import { Injectable } from "@nestjs/common";
import {
  PermissionEngine,
  ForbiddenError,
  type ProjectResource,
  type ResourceRule,
  type EngineContext,
  type PermissionCheckResult,
  type ColumnResolver,
  type FilterableScalar,
} from "@repo/auth/permissions";
import type { SQL } from "drizzle-orm";
import { PermissionRepository } from "../repositories/permission.repository";

/**
 * PermissionService — thin NestJS wrapper around PermissionEngine.
 *
 * Wires the engine's two loaders to the repository and exposes a clean
 * surface for controllers and other services:
 *  - check()          → full in-memory evaluation, returns ALLOW | DENY
 *  - assert()         → like check(), throws ForbiddenError on DENY
 *  - buildWhereClause() → compiles rules to a Drizzle SQL predicate
 *
 * For custom org role rules CRUD, delegate directly to PermissionRepository
 * (no business logic needed — it's pure data management).
 */
@Injectable()
export class PermissionService {
  private readonly engine: PermissionEngine;

  constructor(private readonly permissionRepository: PermissionRepository) {
    this.engine = new PermissionEngine({
      loadMemberRoles: (userId, orgId) =>
        this.permissionRepository.getMemberRoles(userId, orgId),
      loadOrgRoles: (orgId, roleNames) =>
        this.permissionRepository.getOrgRoleRules(orgId, roleNames),
    });
  }

  /**
   * Full in-memory permission check. Returns ALLOW | DENY with the matched rule.
   */
  check(
    ctx: EngineContext,
    resource: ProjectResource,
    action: string,
    resourceId?: string,
    record?: Record<string, unknown>,
  ): Promise<PermissionCheckResult> {
    return this.engine.check(ctx, resource, action, resourceId, record);
  }

  /**
   * Like check(), but throws ForbiddenError when the result is DENY.
   */
  assert(
    ctx: EngineContext,
    resource: ProjectResource,
    action: string,
    resourceId?: string,
    record?: Record<string, unknown>,
  ): Promise<void> {
    return this.engine.assert(ctx, resource, action, resourceId, record);
  }

  /**
   * Compiles rules to a Drizzle SQL predicate suitable for WHERE clauses.
   * Returns `undefined` when access is fully unrestricted (ALLOW ALL).
   *
   * @param idColumn  SQL expression for the id column of the resource table.
   * @param resolver  Maps dot-notation field path → Drizzle SQL expression.
   */
  buildWhereClause<TSchema extends object = Record<string, FilterableScalar | FilterableScalar[]>>(
    ctx: EngineContext,
    resource: ProjectResource,
    action: string,
    idColumn: SQL,
    resolver: ColumnResolver<TSchema>,
  ): Promise<SQL | undefined> {
    return this.engine.buildWhereClause(ctx, resource, action, idColumn, resolver);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Custom org role rules CRUD (delegates to repository)
  // ─────────────────────────────────────────────────────────────────────────

  upsertRoleRules(
    orgId: string,
    roleName: string,
    rules: ResourceRule[],
  ): Promise<void> {
    return this.permissionRepository.upsertRoleRules(orgId, roleName, rules);
  }

  deleteRoleRules(orgId: string, roleName: string): Promise<void> {
    return this.permissionRepository.deleteRoleRules(orgId, roleName);
  }

  listRoleRules(orgId: string) {
    return this.permissionRepository.listRoleRules(orgId);
  }

  /** Re-export so callers can catch typed permission denials */
  static readonly ForbiddenError = ForbiddenError;
}
