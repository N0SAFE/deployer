import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@deployer/errors";
import type { z } from "zod/v4";
import { userSchema } from "@deployer/contracts-entities";

/**
 * The User aggregate.
 *
 * ── WHY THE TYPE IS INFERRED, NOT DECLARED ──────────────────────────────────
 * `userSchema` (in `@deployer/contracts-entities`) is the single source of truth for
 * what a user IS. Re-declaring an equivalent `interface User` here would be a
 * second definition that drifts the first time the auth side adds a column.
 */
export type User = z.output<typeof userSchema>;

/** What `create` accepts — the entity minus everything the system assigns. */
export interface NewUser {
	readonly name: string;
	readonly email: string;
	readonly image?: string | null;
	readonly role?: User["role"];
}

/**
 * What `update` accepts.
 *
 * ── WHY `createdAt` / `updatedAt` ARE ABSENT ────────────────────────────────
 * The contract's update schema is `entitySchema.omit({ image: true, id: true }).partial()`,
 * which *technically* admits `createdAt` and `updatedAt`. The domain refuses them
 * (`assertNoAuditFields`, below): an audit timestamp is a fact ABOUT a write, so
 * a client that can set it can forge history. Their absence here is the type
 * carrying that rule, not an oversight — a controller cannot even express the
 * attempt without the compiler stopping it.
 *
 * `image` is absent for the same reason the contract omits it: the avatar is set
 * at creation and changed through the auth surface, not here.
 */
export interface UserPatch {
	name?: string;
	email?: string;
	emailVerified?: boolean;
	role?: User["role"];
	banned?: boolean;
}

/** The caller, as resolved by the BFF and forwarded over the boundary. */
export interface Actor {
	readonly userId: string;
	readonly role: string;
}

/**
 * Roles that may administer OTHER users.
 *
 * ── WHY THIS IS A NAMED SET AND NOT A COMPARISON ────────────────────────────
 * `PLATFORM_ROLES` is ordered by declaration, not by privilege, so `indexOf`-style
 * ranking silently inverts the moment someone reorders the builder config. A set
 * of names says exactly who counts, and reading it is the whole policy.
 */
const ADMIN_ROLES: ReadonlySet<string> = new Set(["admin", "superAdmin"]);

/** The one role that may grant itself. */
const ROOT_ROLE = "superAdmin";

/**
 * The fields a user may change on THEMSELVES.
 *
 * ── WHY A WHITELIST, AND WHY IT IS THE MOST IMPORTANT LINE IN THIS FILE ─────
 * `role`, `banned` and `emailVerified` are all present on the update contract, so
 * without this list a user could `PATCH /user/me { role: "superAdmin" }` and grant
 * themselves the platform. The rule is not "validate the role" — it is "a
 * self-service profile edit may only touch profile fields", which is why this is
 * an allow-list of the harmless ones rather than a deny-list of the dangerous
 * ones. A deny-list fails open on the next field somebody adds.
 */
const SELF_SERVICE_FIELDS: ReadonlySet<keyof UserPatch> = new Set(["name", "email"]);

/** Guards the two fields the contract admits but the domain refuses. */
const AUDIT_FIELDS: readonly string[] = ["createdAt", "updatedAt"];

/**
 * The rules about a USER's validity — as opposed to a row's shape.
 *
 * Kept pure (no database, no Nest container, no HTTP) so each rule can be
 * exercised directly, and so the service reads as orchestration rather than a
 * pile of guards.
 */
export const userRules = {
	/**
	 * Normalise an email into the domain's canonical form.
	 *
	 * ── WHY THIS MUST EXIST ─────────────────────────────────────────────────
	 * The domain part of an email is case-insensitive and so, in practice, is the
	 * local part on every provider that matters. Storing `Alice@Corp.com` and
	 * `alice@corp.com` as two users means two accounts, two sessions and a
	 * password-reset that lands on "the wrong one" — a support ticket that looks
	 * like a security incident.
	 */
	normaliseEmail(raw: string): string {
		return raw.trim().toLowerCase();
	},

	/** Reject anything that is not a usable address after normalisation. */
	assertEmailIsUsable(email: string): void {
		// Deliberately structural, not a full RFC 5322 parse: the authority on whether
		// an address works is whether mail to it arrives, and over-strict patterns
		// reject valid addresses. One `@`, something either side, a dot in the domain.
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

	/** Reject a name that would render as an empty row. */
	assertNameIsUsable(name: string): void {
		if (name.trim().length === 0) {
			throw new ValidationError("name must not be blank", [
				{ path: "name", code: "too_small", severity: "error", message: "must not be blank" },
			]);
		}
	},

	/**
	 * Refuse a client-supplied audit timestamp.
	 *
	 * Called with the raw patch, BEFORE it is narrowed, because narrowing would have
	 * already discarded the evidence of the attempt.
	 */
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

	/** Only an administrator may act on the collection, or on another user. */
	assertCanAdminister(actor: Actor): void {
		if (!ADMIN_ROLES.has(actor.role)) {
			throw new ForbiddenError("this operation requires platform administration");
		}
	},

	/**
	 * A user may read and edit THEMSELVES; an administrator may do either to anyone.
	 *
	 * ── WHY ADMINISTRATION IS A SEPARATE CHECK FROM OWNERSHIP ───────────────
	 * Collapsing them into "you may read if owner OR admin" is fine for a read and
	 * wrong for a ban, a role change and a delete. Keeping them distinct lets the
	 * caller say which one it is asking about — which is what makes `ban` and
	 * `delete` below read as deliberate.
	 */
	assertSelfOrAdmin(actor: Actor, targetId: string): void {
		if (actor.userId === targetId) return;
		userRules.assertCanAdminister(actor);
	},

	/**
	 * Nobody may delete or ban THEMSELVES.
	 *
	 * ── WHY THIS IS A RULE AND NOT A UI CONCERN ─────────────────────────────
	 * The only actor who can delete users is an administrator. An administrator who
	 * deletes themselves removes one of a handful of accounts that can restore the
	 * platform, and if they are the sole `superAdmin` the platform is unrecoverable
	 * without database surgery. Hiding the button is not a control; this is.
	 */
	assertNotSelfDestruct(actor: Actor, targetId: string, action: string): void {
		if (actor.userId === targetId) {
			throw new ForbiddenError(`an administrator may not ${action} their own account`);
		}
	},

	/**
	 * Guard role assignment against privilege escalation.
	 *
	 * ── TWO DISTINCT RULES, AND WHY THEY ARE NOT ONE ────────────────────────
	 *  1. only an administrator may change a role at all;
	 *  2. only a `superAdmin` may MINT a `superAdmin`.
	 *
	 * Rule 2 is the one that matters. Without it, any `admin` promotes themselves to
	 * `superAdmin` through the ordinary update path and the two roles collapse into
	 * one — which is exactly the privilege escalation the split exists to prevent.
	 * An admin may still manage operators and viewers, so the check is not "role
	 * changes are root-only"; it is "the root role is".
	 */
	assertRoleIsAssignable(actor: Actor, role: User["role"]): void {
		if (role === undefined) return;
		userRules.assertCanAdminister(actor);
		if (role === ROOT_ROLE && actor.role !== ROOT_ROLE) {
			throw new ForbiddenError(`only a ${ROOT_ROLE} may grant the ${ROOT_ROLE} role`);
		}
	},

	/**
	 * Drop every field a self-service edit is not allowed to touch.
	 *
	 * ── WHY IT FILTERS RATHER THAN THROWS ───────────────────────────────────
	 * Sending a full entity back after editing a profile is the normal shape of an
	 * optimistic-update client, so a non-admin POSTing the form that happens to
	 * carry `role` is not an attack — it is a client sending back what it read.
	 * Refusing it would break that client for a field it never meant to change.
	 * The write is silently narrowed to the profile fields; `assertRoleIsAssignable`
	 * is what protects the dangerous path, and it fires on any ATTEMPT to change a
	 * role rather than on the presence of the key.
	 */
	toSelfServicePatch(patch: UserPatch, current: User): UserPatch {
		const narrowed: UserPatch = {};
		for (const field of SELF_SERVICE_FIELDS) {
			if (field === "name" && patch.name !== undefined) narrowed.name = patch.name;
			if (field === "email" && patch.email !== undefined) narrowed.email = patch.email;
		}
		// A no-op assignment is dropped: writing `role: "viewer"` when the user is
		// already a viewer is not a change, and treating it as one would make every
		// profile save from an admin client look like a role grant.
		if (patch.email !== undefined && patch.email === current.email) delete narrowed.email;
		return narrowed;
	},
} as const;

/** Thrown as a typed 404 rather than a null return, so a client gets a code. */
export function userNotFound(id: string): NotFoundError {
	return new NotFoundError("user", id);
}

/** Thrown when a create/update would collide with an existing account. */
export function emailAlreadyTaken(email: string): ConflictError {
	return new ConflictError(`an account for "${email}" already exists`);
}
