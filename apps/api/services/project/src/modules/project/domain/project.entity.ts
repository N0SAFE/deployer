import { ForbiddenError, ValidationError } from "@deployer/errors";
import type { z } from "zod/v4";
import { collaboratorSchema, projectSchema } from "@deployer/contracts-entities";

/**
 * The Project aggregate.
 *
 * ── WHY THE TYPES ARE INFERRED, NOT DECLARED ────────────────────────────────
 * `projectSchema` and `collaboratorSchema` (in `@deployer/contracts-entities`) are
 * the single source of truth for what a project and a collaborator ARE. An
 * equivalent `interface Project` here would be a second definition that drifts the
 * first time a column is added.
 */
export type Project = z.output<typeof projectSchema>;
export type Collaborator = z.output<typeof collaboratorSchema>;

/**
 * The role vocabulary, taken from the contract.
 *
 * ── WHY THIS IS DERIVED AND NOT A LOCAL UNION ───────────────────────────────
 * The role names are defined once, in the permission builder
 * (`@deployer/auth`, surfaced through `projectRoleSchema`). Spelling them out
 * again here is how the service layer came to check for `"admin"` and
 * `"developer"` — two names that exist in NEITHER the builder nor the database.
 * Because `allowedRoles.includes(collaborator.role)` simply never matched, every
 * non-owner collaborator was denied everything: `maintainer` and `deployer`
 * holders could not read a project they had been invited to.
 *
 * Deriving the union from the schema makes that class of bug impossible to write:
 * a role that is not in the contract does not type-check.
 */
export type ProjectRole = Collaborator["role"];

/**
 * What a caller is trying to do, as a LEVEL rather than a list of roles.
 *
 * ── WHY LEVELS ─────────────────────────────────────────────────────────────
 * The service asked 32 questions of the form "is the caller one of
 * `["owner","admin","developer","viewer"]`?", repeating the role list at every
 * call site. That is the policy stated 32 times, and it drifted. A named level
 * says the intent ONCE ("this operation is a read"), so the matrix below is the
 * only place the answer lives — and a call site reads as what it means rather
 * than as a list a reader has to evaluate.
 */
export type ProjectAccess = "read" | "deploy" | "manage" | "admin";

/**
 * Who may do what.
 *
 * Derived from `projectBuilder` in `@deployer/auth` rather than invented here:
 * `owner` has all project permissions, `maintainer` has project read+update and
 * `manageCollaborators`, `deployer` has project read plus service/deployment
 * write, `viewer` has read everywhere. Each set below is that statement restated
 * as a lookup, so the two cannot disagree.
 */
const ACCESS_GRANTS: Readonly<Record<ProjectAccess, ReadonlySet<ProjectRole>>> = {
	/** Reading the project and its resources. */
	read: new Set<ProjectRole>(["owner", "maintainer", "deployer", "viewer"]),
	/** Changing what runs: services, environments, deployments. */
	deploy: new Set<ProjectRole>(["owner", "maintainer", "deployer"]),
	/** Changing how the project is configured. */
	manage: new Set<ProjectRole>(["owner", "maintainer"]),
	/** Membership: who else is in the project, and as what. */
	admin: new Set<ProjectRole>(["owner", "maintainer"]),
};

/** The fields a collaborator record must never be able to grant itself. */
const RESERVED_ROLE: ProjectRole = "owner";

/**
 * The rules about a PROJECT — as opposed to a row's shape.
 *
 * Kept pure: no database, no Nest container, no HTTP, and no `@nestjs/common`
 * import. That is what lets a service, a worker and a test all enforce the same
 * policy, and it is why the errors thrown here are `@deployer/errors` domain
 * errors — the transport maps them (`transformAppErrorToORPCError`), so the
 * domain never has to know it is being reached over HTTP.
 */
export const projectRules = {
	/** The complete role vocabulary, for callers that need to validate input. */
	roles: Object.freeze([
		"owner",
		"maintainer",
		"deployer",
		"viewer",
	] as const satisfies readonly ProjectRole[]),

	/** Is `role` a role the platform actually defines? */
	isRole(value: string): value is ProjectRole {
		return (projectRules.roles as readonly string[]).includes(value);
	},

	/** May `role` perform `access`? */
	allows(role: ProjectRole, access: ProjectAccess): boolean {
		return ACCESS_GRANTS[access].has(role);
	},

	/**
	 * The roles that may perform `access`, for an error message that says what
	 * WOULD have worked instead of only refusing.
	 */
	rolesFor(access: ProjectAccess): readonly ProjectRole[] {
		return [...ACCESS_GRANTS[access]];
	},

	/**
	 * Reject a write that names a role the platform does not define.
	 *
	 * ── WHY THIS IS CHECKED AT ALL ──────────────────────────────────────────
	 * The contract's `projectRoleSchema` already constrains the enum, so this
	 * fires only when a caller reaches the service WITHOUT contract validation —
	 * an internal caller, a script, or a test. It exists because the failure it
	 * prevents is silent: an unknown role stores fine and then matches no
	 * `allows()` check, producing a collaborator who can do nothing and an error
	 * message that blames their permissions rather than their role name.
	 */
	assertRoleIsAssignable(role: string): asserts role is ProjectRole {
		if (!projectRules.isRole(role)) {
			throw new ValidationError(`${role} is not a project role`, [
				{
					path: "role",
					code: "invalid_enum_value",
					severity: "error",
					message: `must be one of: ${projectRules.roles.join(", ")}`,
				},
			]);
		}
	},

	/**
	 * The caller's effective role on a project.
	 *
	 * The owner is `owner` by definition of the row, whether or not a collaborator
	 * record was ever written for them — ownership is set at creation, so a missing
	 * record must not read as "no access".
	 */
	resolveRole(
		project: Pick<Project, "ownerId">,
		actorId: string,
		collaborator: Pick<Collaborator, "role"> | null,
	): ProjectRole | null {
		if (project.ownerId === actorId) return RESERVED_ROLE;
		return collaborator?.role ?? null;
	},

	/**
	 * Assert the caller may perform `access`, and answer the role they did it as.
	 *
	 * Returns rather than only throwing so a caller that needs the role (to decide
	 * whether to include owner-only fields, say) does not have to re-derive it.
	 */
	assertAccess(
		project: Pick<Project, "ownerId" | "id">,
		actorId: string,
		collaborator: Pick<Collaborator, "role"> | null,
		access: ProjectAccess,
	): ProjectRole {
		const role = projectRules.resolveRole(project, actorId, collaborator);
		if (role === null || !projectRules.allows(role, access)) {
			throw new ForbiddenError(
				`This project requires ${access} access`,
				access,
				`project:${project.id}`,
			);
		}
		return role;
	},

	/**
	 * Deleting a project is the OWNER's alone.
	 *
	 * Not an access level: it is not a stronger `admin`, because `maintainer` is
	 * defined as "project management WITHOUT deletion capabilities" and collapsing
	 * the two would silently widen that role.
	 */
	assertCanDelete(project: Pick<Project, "ownerId" | "id">, actorId: string): void {
		if (project.ownerId !== actorId) {
			throw new ForbiddenError(
				"Only the project owner can delete the project",
				"delete",
				`project:${project.id}`,
			);
		}
	},

	/**
	 * The project's owner membership is immutable through the collaborator API.
	 *
	 * ── WHY ─────────────────────────────────────────────────────────────────
	 * Ownership is a property of the PROJECT row, so editing a collaborator record
	 * with `role: "owner"` would create a second, contradictory source of truth —
	 * and demoting the owner's record would leave the project owned by somebody
	 * with no member entry. Transferring ownership is a separate operation that
	 * must move both facts together; until it exists, the honest answer is refusal.
	 */
	assertNotOwnerMembership(target: Pick<Collaborator, "role">, action: string): void {
		if (target.role === RESERVED_ROLE) {
			throw new ForbiddenError(
				`Cannot ${action} the project owner's membership; transfer ownership instead`,
				action,
				"collaborator",
			);
		}
	},

	/**
	 * A collaborator may not be promoted to `owner` through the membership API.
	 *
	 * See {@link projectRules.assertNotOwnerMembership} — this closes the other
	 * half, where the role arrives in the PATCH body rather than on the row.
	 */
	assertNotOwnerGrant(role: string | undefined): void {
		if (role === RESERVED_ROLE) {
			throw new ForbiddenError(
				"Cannot grant ownership through the collaborator API; transfer ownership instead",
				"grant",
				"collaborator",
			);
		}
	},
};
