import { refuseAdminAction, refuseRoleGrant, isPlatformAdministrator, roleGrants } from "@deployer/auth/authz";

import type { Permission } from "@deployer/auth/authz";
import { ForbiddenError, ValidationError } from "@deployer/errors";

import type { Actor, User, UserPatch } from "./user.types";

/** The fields a user may change on THEMSELVES. */
const SELF_SERVICE_FIELDS: ReadonlySet<keyof UserPatch> = new Set(["name", "email"]);

/** Guards the two fields the contract admits but the domain refuses. */
const AUDIT_FIELDS: readonly string[] = ["createdAt", "updatedAt"];

/**
 * The rules about a USER's validity — as opposed to a row's shape.
 *
 * Pure: no database, no Nest container, no HTTP.
 */
export const userRules = {
  normaliseEmail(raw: string): string {
    return raw.trim().toLowerCase();
  },

  assertEmailIsUsable(email: string): void {
    const usable = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email);
    if (!usable) {
      throw new ValidationError("email is not usable", [
        {
          path: "email",
          code: "invalid_format",
          severity: "error",
          message: "must be a single address of the form local@domain.tld",
        },
      ]);
    }
  },

  assertNameIsUsable(name: string): void {
    if (name.trim().length === 0) {
      throw new ValidationError("name must not be blank", [
        { path: "name", code: "too_small", severity: "error", message: "must not be blank" },
      ]);
    }
  },

  assertNoAuditFields(raw: Record<string, unknown>): void {
    for (const field of AUDIT_FIELDS) {
      if (raw[field] !== undefined) {
        throw new ValidationError(`${field} is not client-writable`, [
          {
            path: field,
            code: "unrecognized_keys",
            severity: "error",
            message: "audit timestamps are recorded by the platform, not supplied by a client",
          },
        ]);
      }
    }
  },

  /**
   * The capability check: a role either holds the permission or it does not.
   *
   * `Permission` is the catalog union, so a misspelled or removed capability fails the build; the rank rules below are a
   * separate question ("may this actor act on THAT account"), and both apply.
   */
  assertCapability(actor: Actor, permission: Permission): void {
    if (!roleGrants(actor.role, permission)) {
      throw new ForbiddenError(`actor lacks ${permission}`);
    }
  },

  assertCanAdminister(actor: Actor): void {
    if (!isPlatformAdministrator(actor.role)) {
      throw new ForbiddenError("this operation requires platform administration");
    }
  },

  assertSelfOrAdmin(actor: Actor, targetId: string): void {
    if (actor.userId === targetId) return;
    userRules.assertCanAdminister(actor);
  },

  assertNotSelfDestruct(actor: Actor, targetId: string, action: string): void {
    if (actor.userId === targetId) {
      throw new ForbiddenError(`an administrator may not ${action} their own account`);
    }
  },

  assertRoleIsAssignable(actor: Actor, role: User["role"]): void {
    if (role === undefined) return;
    // The same rule Better Auth's admin endpoints enforce, so the two paths cannot disagree: an administrator hands out
    // only roles strictly below its own, and only the root role grants the root role.
    const refusal = refuseRoleGrant({ actorRole: actor.role, grantedRole: role });
    if (refusal !== null) throw new ForbiddenError(refusal.message);
  },

  /**
   * An actor may only act on an account the hierarchy puts strictly below it; the root role is
   * exempt. Peer and superior accounts are untouchable, so an admin cannot delete, ban or re-email
   * another admin or a superAdmin. Pair with `assertCanAdminister` — this rule is about rank only.
   */
  assertOutranks(actor: Actor, targetRole: User["role"]): void {
    const refusal = refuseAdminAction({ actorRole: actor.role, targetRole: targetRole ?? null });
    if (refusal !== null) throw new ForbiddenError(refusal.message);
  },

  toSelfServicePatch(patch: UserPatch, current: User): UserPatch {
    const narrowed: UserPatch = {};
    for (const field of SELF_SERVICE_FIELDS) {
      if (field === "name" && patch.name !== undefined) narrowed.name = patch.name;
      if (field === "email" && patch.email !== undefined) narrowed.email = patch.email;
    }
    if (patch.email !== undefined && patch.email === current.email) delete narrowed.email;
    return narrowed;
  },
} as const;
