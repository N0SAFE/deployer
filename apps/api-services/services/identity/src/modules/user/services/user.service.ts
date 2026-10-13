import { Injectable } from "@nestjs/common";


import {
	emailAlreadyTaken,
	userNotFound,
	userRules,
	type Actor,
	type NewUser,
	type User,
	type UserPatch,
} from "../domain/user.entity";
import { UserRepository, type UserFilter, type UserPage } from "../repositories/user.repository";

/** The filters `list` and `count` accept, as the contract declares them. */
export interface UserQuery {
	readonly limit: number;
	readonly offset: number;
	readonly sortField: "createdAt" | "name" | "email" | "updatedAt";
	readonly sortDirection: "asc" | "desc";
	readonly filter: UserFilter;
}

/**
 * The User domain's rules.
 *
 * ── WHAT BELONGS HERE, AND WHAT DOES NOT ────────────────────────────────────
 * Here: decisions about USERS — who may read or change whom, whether an address is
 * legal, whether a role may be granted, what normalisation is applied, and what a
 * ban means.
 *
 * Not here: SQL (the repository), the HTTP shape (the controller), or the shape a
 * SCREEN needs (the BFF — a screen wanting "users with their session counts"
 * composes it). Credentials are not here either: passwords, sessions and OAuth
 * accounts belong to Better Auth, and this service deliberately has no door onto
 * them.
 *
 * ── WHY THE RULES RUN IN A FIXED ORDER ──────────────────────────────────────
 *   1. reject fields the domain refuses outright (audit timestamps)
 *   2. normalise (so every later comparison is against canonical values)
 *   3. validate format
 *   4. resolve the target (a missing user is 404 regardless of the actor)
 *   5. authorise (a non-owner is 403, not a confusing 404)
 *   6. narrow what a self-service edit may touch
 *   7. check the database constraints (uniqueness)
 *   8. write
 * Reversing 4 and 5 leaks whether an account exists to someone who may not see it;
 * reversing 2 and 7 makes the uniqueness check compare a raw value against
 * canonical ones and miss the collision it exists to catch.
 */
@Injectable()
export class UserService {
	constructor(private readonly users: UserRepository) {}

	/**
	 * A page of users.
	 *
	 * ── ADMINISTRATOR-ONLY, AND THAT IS THE WHOLE POLICY ────────────────────
	 * There is no "own row" shortcut here: asking for the collection is not asking
	 * for yourself, and a per-row filter would make the response's `total` a count of
	 * rows the caller cannot see. A caller who wants their own profile calls
	 * `findById(actor.userId)`.
	 */
	async list(actor: Actor, query: UserQuery): Promise<UserPage> {
		userRules.assertCanAdminister(actor);
		return this.users.list({
			...query.filter,
			limit: query.limit,
			offset: query.offset,
			sortField: query.sortField,
			sortDirection: query.sortDirection,
		});
	}

	/**
	 * The total for the same filters `list` accepts.
	 *
	 * A separate procedure rather than `page.meta.total` because a count is asked for
	 * on its own: a dashboard badge wants "how many users" without paying for a page
	 * of rows, and a client that wanted both would already have them from `list`.
	 */
	async count(actor: Actor, filter: UserFilter): Promise<number> {
		userRules.assertCanAdminister(actor);
		return this.users.count(filter);
	}

	/**
	 * One user.
	 *
	 * Returns `null` rather than throwing: the contract declares `.nullable()`, so
	 * "not found" is a legitimate VALUE. Mutations below do the opposite because
	 * their contracts declare an error.
	 *
	 * Readable by the account itself or an administrator — the one place the
	 * self-or-admin rule applies, because a profile screen exists for exactly this.
	 */
	async findById(actor: Actor, id: string): Promise<User | null> {
		userRules.assertSelfOrAdmin(actor, id);
		return this.users.findById(id);
	}

	/**
	 * Is this address already registered?
	 *
	 * ── WHY A 409-CAPABLE CREATE STILL NEEDS A CHECK ENDPOINT ───────────────
	 * It lets a signup form say "that address is taken" while the user is still
	 * typing, instead of after they have picked a password. Accordingly it does NOT
	 * require an administrator: refusing it would hand the caller a create error
	 * that leaks the same fact anyway, only later and less usefully.
	 */
	async checkEmail(email: string): Promise<boolean> {
		return this.users.emailExists(userRules.normaliseEmail(email));
	}

	/**
	 * Create an account.
	 *
	 * The caller must be an administrator: this path mints a row that has no
	 * credential yet, and letting anyone call it would let them pre-register an
	 * address the real owner cannot then claim.
	 */
	async create(actor: Actor, input: NewUser): Promise<User> {
		userRules.assertCanAdminister(actor);
		userRules.assertRoleIsAssignable(actor, input.role);

		const email = userRules.normaliseEmail(input.email);
		userRules.assertEmailIsUsable(email);
		userRules.assertNameIsUsable(input.name);

		// Checked before the insert so the common case gets a clear 409 rather than a
		// driver-level unique violation. The race between the check and the insert is
		// real but harmless: the database's unique constraint is the authority, and
		// this only improves the message.
		if (await this.users.emailExists(email)) throw emailAlreadyTaken(email);

		return this.users.insert({
			name: input.name.trim(),
			email,
			...(input.image === undefined ? {} : { image: input.image }),
			...(input.role === undefined ? {} : { role: input.role }),
		});
	}

	/**
	 * Update a user — the profile fields, or the administrative ones.
	 *
	 * ── WHERE THE PRIVILEGE BOUNDARY SITS ───────────────────────────────────
	 * A user editing themselves reaches `toSelfServicePatch`, which narrows the write
	 * to `name` and `email`. Anyone else reaches it only as an administrator, and
	 * `assertRoleIsAssignable` guards the role independently of who is editing whom —
	 * an `admin` may set `operator`, and only a `superAdmin` may set `superAdmin`.
	 *
	 * `raw` is the patch as the client sent it, BEFORE narrowing. It is needed for
	 * one reason: `assertNoAuditFields` has to see the attempt. Narrowing first would
	 * silently discard `createdAt` and the client would believe it had been stored.
	 */
	async update(
		actor: Actor,
		id: string,
		patch: UserPatch,
		raw: Record<string, unknown>,
	): Promise<User> {
		userRules.assertNoAuditFields(raw);

		const current = await this.users.findById(id);
		if (current === null) throw userNotFound(id);

		const isSelf = actor.userId === id;
		userRules.assertSelfOrAdmin(actor, id);

		// Role assignment is checked only when the patch actually attempts one, so a
		// self-service profile save carrying an unchanged `role` is not mistaken for a
		// grant attempt.
		if (patch.role !== undefined && patch.role !== current.role) {
			userRules.assertRoleIsAssignable(actor, patch.role);
		}

		const next: UserPatch = isSelf ? userRules.toSelfServicePatch(patch, current) : { ...patch };

		if (next.name !== undefined) {
			userRules.assertNameIsUsable(next.name);
			next.name = next.name.trim();
		}

		if (next.email !== undefined) {
			const email = userRules.normaliseEmail(next.email);
			userRules.assertEmailIsUsable(email);
			// `excludingId` keeps re-saving an unchanged address from reading as a
			// conflict with itself.
			if (await this.users.emailExists(email, id)) throw emailAlreadyTaken(email);
			next.email = email;
		}

		// An empty narrowed patch is not written at all. Saving a profile form that
		// changed nothing would otherwise bump `updatedAt` and make the row look
		// modified in an audit view.
		if (Object.keys(next).length === 0) return current;

		return this.users.update(id, next);
	}

	/**
	 * Ban or unban an account.
	 *
	 * ── WHY THIS IS NOT AN ORDINARY UPDATE ──────────────────────────────────
	 * Banning is a moderation action with a different authority and a different
	 * failure mode from editing a profile: it revokes access, so it is
	 * administrator-only, it may never be aimed at the actor themselves
	 * (`assertNotSelfDestruct`), and it is expressed as its own procedure so that a
	 * permission change reads as a deliberate act rather than as a field that
	 * happened to be in a request body.
	 */
	async setBanned(actor: Actor, id: string, banned: boolean): Promise<User> {
		userRules.assertCanAdminister(actor);
		// Checked before the self-destruct guard so the ordering is explicit: only a
		// real administrator reaches the "you cannot ban yourself" rule, rather than a
		// non-admin learning it instead of "you are not an administrator".
		userRules.assertNotSelfDestruct(actor, id, banned ? "ban" : "unban");

		const current = await this.users.findById(id);
		if (current === null) throw userNotFound(id);

		// Already in the requested state: returned unchanged rather than written, so
		// re-issuing a ban does not bump `updatedAt` or re-notify anything downstream.
		if ((current.banned ?? false) === banned) return current;

		return this.users.update(id, { banned });
	}

	/**
	 * Delete an account.
	 *
	 * Administrator-only, and never the actor's own — see `assertNotSelfDestruct`:
	 * with a single `superAdmin`, self-deletion leaves the platform recoverable only
	 * by hand.
	 *
	 * There is deliberately no "blocked while they own projects" rule, unlike the
	 * project domain's delete. A departing employee's projects must be reassigned
	 * rather than silently cascaded away, but that reassignment is an operator
	 * decision the platform cannot infer — and refusing the delete outright would
	 * leave the account live, which is the worse of the two failure modes for an
	 * account being removed for cause.
	 */
	async delete(actor: Actor, id: string): Promise<void> {
		userRules.assertCanAdminister(actor);
		userRules.assertNotSelfDestruct(actor, id, "delete");

		const current = await this.users.findById(id);
		if (current === null) throw userNotFound(id);

		await this.users.delete(id);
	}
}

// Re-exported so the controller has one import for the domain's vocabulary.
export type { Actor, NewUser, User, UserPatch, UserFilter, UserPage };
