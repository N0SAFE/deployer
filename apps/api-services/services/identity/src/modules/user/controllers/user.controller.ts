import { Controller } from "@nestjs/common";
import { Implement } from "@orpc/nest";
import { implement } from "@orpc/server";

import { userContract } from "@deployer/identity-contracts";
import { requireAuth } from "@/core/modules/auth/orpc/middlewares";

import { UserService } from "../services/user.service";
import type { Actor, UserPatch } from "../domain/user.entity";
import type { OperatorFilter, UserFilter, UserSortField } from "../repositories/user.repository";

/**
 * The user domain's oRPC surface — and the shape every other domain follows.
 *
 * ── A CONTROLLER CONTAINS NO RULE ───────────────────────────────────────────
 * Each method binds a contract procedure, takes the actor from the context, and
 * delegates. Reading it tells you which procedures exist and what they call —
 * which is what makes "no business logic leaked into the transport" checkable by
 * eye.
 *
 * ── WHY THE ACTOR IS READ HERE AND NOT PASSED IN ────────────────────────────
 * `requireAuth()` narrows the context so `context.auth.user` is non-nullable; the
 * controller turns that into the domain's `Actor`. Services never see a session, a
 * cookie or a request — they see "who is calling" as a plain value, which is what
 * lets a rule be exercised in a unit test with no request at all.
 *
 * ── WHY SOME METHODS DO NOT USE `requireAuth()` ─────────────────────────────
 * `checkEmail` is deliberately open: it is the signup form's "is this address
 * taken" probe, and it runs before the user has a session. That IS a disclosure —
 * it reveals whether an address is registered — but refusing it does not prevent
 * the disclosure, it only moves it into the create call, where it arrives too late
 * to be useful and is delivered as a failed signup instead of a hint.
 */
@Controller()
export class UserController {
	constructor(private readonly users: UserService) {}

	/** The caller, as the domain sees them. */
	private actorOf(context: { auth: { user: { id: string; role?: string | null } } }): Actor {
		return { userId: context.auth.user.id, role: context.auth.user.role ?? "user" };
	}

	@Implement(userContract.list)
	list() {
		return implement(userContract.list)
			.use(requireAuth())
			.handler(async ({ input, context }) => {
				// ── WHY EVERY FIELD IS READ THROUGH `?.` AND NOT VIA A `?? {}` FALLBACK ──
				// `query` arrives OPTIONAL (the list builder wraps it in `.optional()`).
				// The tempting fix is `const query = input.query ?? {}`, and it is wrong:
				// TypeScript widens the result to `Query | {}`, so every property access
				// becomes `Property 'limit' does not exist on type '{}'`. Reading each
				// field off the optional — `input.query?.limit` — keeps the real field
				// types AND supplies the default in the same expression, so an absent
				// query means "no options", which is exactly what the defaults say.
				const limit = input.query?.limit ?? 20;
				const offset = input.query?.offset ?? 0;

				const page = await this.users.list(this.actorOf(context), {
					limit,
					offset,
					sortField: readSortField(input.query?.sortBy),
					sortDirection: input.query?.sortDirection ?? "desc",
					filter: this.readFilter(input.query?.filter),
				});

				return {
					data: page.data,
					meta: {
						total: page.total,
						limit,
						offset,
						hasMore: offset + page.data.length < page.total,
					},
				};
			});
	}

	/** One user, by id — the profile screen's read. */
	@Implement(userContract.findById)
	findById() {
		return implement(userContract.findById)
			.use(requireAuth())
			.handler(async ({ input, context }) => this.users.findById(this.actorOf(context), input.params.id));
	}

	/**
	 * Create an account.
	 *
	 * The create procedure is COMPACT: `input` IS the payload. `emailVerified` is not
	 * accepted from the caller — the domain decides it (see `UserRepository.insert`),
	 * because an input-settable verification flag would let an administrator mint
	 * pre-verified accounts.
	 */
	@Implement(userContract.create)
	create() {
		return implement(userContract.create)
			.use(requireAuth())
			.handler(async ({ input, context }) => {
				const created = await this.users.create(this.actorOf(context), {
					name: input.name,
					email: input.email,
					image: input.image ?? null,
				});
				return { status: 201 as const, headers: {}, body: created };
			});
	}

	/**
	 * Update a user.
	 *
	 * The id and the patch share one object, so `id` is destructured off. The REST of
	 * the input is passed twice, on purpose: `patch` is the narrowed, domain-typed
	 * view, and `input` is passed as `raw` so `assertNoAuditFields` can see a
	 * client-supplied `createdAt`. Passing only the narrowed view would make that
	 * attempt invisible and let the client believe it had been stored.
	 *
	 * Everything the contract admits but the domain refuses (`createdAt`,
	 * `updatedAt`) is therefore present in `raw` and filtered by the domain rather
	 * than by this file — the transport does not decide policy.
	 */
	@Implement(userContract.update)
	update() {
		return implement(userContract.update)
			.use(requireAuth())
			.handler(async ({ input, context }) => {
				const { id, ...rest } = input;
				const patch: UserPatch = {
					...(rest.name === undefined ? {} : { name: rest.name }),
					...(rest.email === undefined ? {} : { email: rest.email }),
					...(rest.emailVerified === undefined ? {} : { emailVerified: rest.emailVerified }),
					...(rest.role === undefined ? {} : { role: rest.role }),
					...(rest.banned === undefined ? {} : { banned: rest.banned }),
				};
				return this.users.update(this.actorOf(context), id, patch, rest);
			});
	}

	@Implement(userContract.delete)
	delete() {
		return implement(userContract.delete)
			.use(requireAuth())
			.handler(async ({ input, context }) => {
				await this.users.delete(this.actorOf(context), input.params.id);
				// The contract's delete output is `{ success, message? }`, not a bare 204.
				return { success: true, message: undefined };
			});
	}

	/**
	 * Is this address registered?
	 *
	 * No `requireAuth()`: see the class comment. `input.email` is flat (the contract's
	 * `check` builder puts the field at the top level), not wrapped in `params`.
	 */
	@Implement(userContract.checkEmail)
	checkEmail() {
		return implement(userContract.checkEmail).handler(async ({ input }) => ({
			exists: await this.users.checkEmail(input.email),
		}));
	}

	/**
	 * The total, under the same filters `list` accepts.
	 *
	 * ── WHY `input.query` IS READ DEFENSIVELY ──────────────────────────────
	 * The contract's `count()` builder emits `filter: z.any()` — untyped by design, for
	 * the reasons recorded on that builder — so `input.query` is a runtime value rather
	 * than a statically known shape. It is therefore checked rather than trusted:
	 * reading `.filter` off it blindly would be a lie the compiler cannot catch, since
	 * `any` silences both the read and the error it would otherwise raise.
	 */
	@Implement(userContract.count)
	count() {
		return implement(userContract.count)
			.use(requireAuth())
			.handler(async ({ input, context }) => {
				const query: unknown = input?.query;
				const filter =
					typeof query === "object" && query !== null && "filter" in query
						? (query as { filter?: unknown }).filter
						: undefined;
				return { count: await this.users.count(this.actorOf(context), this.readFilter(filter)) };
			});
	}

	/**
	 * Translate the contract's operator map into the repository's filter.
	 *
	 * ── WHY THIS IS THE ONE PLACE OPERATOR SYNTAX IS UNDERSTOOD ─────────────
	 * The generated filter is a MAP (`{ email: { operator: "ilike", value: "a" } }`)
	 * because one field may carry several operators. The repository wants the same
	 * thing, so this is a read rather than a translation — but it is typed here so
	 * that a filter field the contract stops declaring becomes a compile error in
	 * exactly one method, rather than an `undefined` silently widening a query.
	 */
	private readFilter(filter: unknown): UserFilter {
		if (typeof filter !== "object" || filter === null) return {};
		const source = filter as Record<string, unknown>;
		return {
			...(toOperatorFilter(source.id) === undefined ? {} : { id: toOperatorFilter(source.id) }),
			...(toOperatorFilter(source.email) === undefined ? {} : { email: toOperatorFilter(source.email) }),
			...(toOperatorFilter(source.name) === undefined ? {} : { name: toOperatorFilter(source.name) }),
			...(typeof source.emailVerified === "boolean" ? { emailVerified: source.emailVerified } : {}),
			...(toOperatorFilter(source.createdAt) === undefined
				? {}
				: { createdAt: toOperatorFilter(source.createdAt) }),
		};
	}
}

/**
 * Read one entry of the operator map.
 *
 * Returns `undefined` for anything that is not `{ operator, value }` rather than
 * casting: a malformed filter entry must not become a condition that matches
 * nothing, because "no results" and "your filter was ignored" look identical to a
 * caller.
 */
function toOperatorFilter(value: unknown): OperatorFilter | undefined {
	if (typeof value !== "object" || value === null) return undefined;
	const entry = value as Record<string, unknown>;
	if (typeof entry.operator !== "string") return undefined;
	return { operator: entry.operator, value: entry.value };
}

/**
 * Narrow the contract's `sortBy` into a column this service can actually order by.
 *
 * ── WHY THIS EXISTS, HAVING JUST ARGUED THE OPPOSITE FOR PROJECT ────────────
 * The project controller treats `sortBy` as already-constrained and passes it
 * straight through. That is only true when the contract's sorting config infers a
 * literal union. Here it does not: `UserListInput["query"]["sortBy"]` is `string`,
 * because the config is consumed through `ComputeInputSchema` and the literal
 * `["createdAt","name","email","updatedAt"]` is widened to `string`. It is also
 * OPTIONAL, because the whole `query` is.
 *
 * So the check is not defensive padding — it is doing the work the type system was
 * believed to be doing. Without it the value reaches `SORT_COLUMNS[...]`, yields
 * `undefined`, and `asc(undefined)` throws at query time on any `?sortBy=` the
 * builder happens to emit loosely. Falling back to the default keeps a bad sort key
 * from being an outage.
 *
 * ── WHY A SET AND A `has` RATHER THAN A CAST ────────────────────────────────
 * A cast would satisfy the compiler while leaving the runtime failure intact. The
 * set is the same list the contract declares, so a new sortable column has to be
 * added in both places — which is the compiler's chance to notice.
 */
const USER_SORT_FIELDS: ReadonlySet<string> = new Set(["createdAt", "name", "email", "updatedAt"]);

function readSortField(value: string | undefined): UserSortField {
	return value !== undefined && USER_SORT_FIELDS.has(value) ? (value as UserSortField) : "createdAt";
}
