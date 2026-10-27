import { ForbiddenError, ValidationError } from "@deployer/errors";

import type { Actor, User, UserPatch } from "./user.types";

/** Roles that may administer OTHER users. */
const ADMIN_ROLES: ReadonlySet<string> = new Set(["admin", "superAdmin"]);

/** The one role that may grant itself. */
const ROOT_ROLE = "superAdmin";

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

  assertCanAdminister(actor: Actor): void {
    if (!ADMIN_ROLES.has(actor.role)) {
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
    userRules.assertCanAdminister(actor);
    if (role === ROOT_ROLE && actor.role !== ROOT_ROLE) {
      throw new ForbiddenError(`only a ${ROOT_ROLE} may grant the ${ROOT_ROLE} role`);
    }
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
