import { Data } from "effect";

/** The six failure kinds a client can tell apart; the transport maps each to one code and status. */
export type ErrorKind =
	| "not_found"
	| "validation"
	| "conflict"
	| "unauthorized"
	| "forbidden"
	| "dependency_missing";

/** Instance shape every `domainError(...)` class shares. */
export interface DomainErrorFields<Tag extends string, K extends ErrorKind> {
	readonly _tag: Tag;
	readonly kind: K;
	readonly cause?: unknown;
	/** What a client may see. Defaults to nothing; never include `cause`. */
	publicData(): Record<string, unknown>;
}

/**
 * Declares a domain error class: tag, kind and public payload in one expression.
 *
 * `publicData()` is what a client may see. It defaults to nothing but the tag and must never
 * include `cause`.
 */
export const domainError =
	<const Tag extends string, const K extends ErrorKind>(tag: Tag, kind: K) =>
	<Fields extends Record<string, unknown> = Record<string, never>>(): {
		readonly kind: K;
		new (args: Fields & { readonly cause?: unknown }): Readonly<Fields> &
			DomainErrorFields<Tag, K> &
			Error;
	} => {
		const Base = Data.TaggedError(tag) as unknown as new (args: object) => Error;
		return class extends Base {
			static readonly kind = kind;
			readonly kind = kind;
			publicData(): Record<string, unknown> {
				return {};
			}
		} as never;
	};

/** Anything produced by `domainError(...)`. */
export type DomainError = {
	readonly _tag: string;
	readonly kind: ErrorKind;
	publicData(): Record<string, unknown>;
};

export const isDomainError = (value: unknown): value is DomainError =>
	typeof value === "object" &&
	value !== null &&
	"kind" in value &&
	"publicData" in value &&
	typeof (value as { publicData: unknown }).publicData === "function";
