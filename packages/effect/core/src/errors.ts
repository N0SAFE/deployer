import { Data, type Cause } from "effect";

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
	/** The message a client may see. Defaults to the tag; override with a sentence safe to expose. */
	publicMessage(): string;
}

/**
 * Declares a domain error class: tag, kind and public payload in one expression.
 *
 * `publicData()` is what a client may see. It defaults to nothing but the tag and must never
 * include `cause`.
 */
export const domainError =
	<const Tag extends string, const K extends ErrorKind>(tag: Tag, kind: K) =>
	<Fields extends object = object>(): {
		readonly kind: K;
		new (args: Fields & { readonly cause?: unknown }): Readonly<Fields> &
			DomainErrorFields<Tag, K> &
			Cause.YieldableError;
	} => {
		const Base = Data.TaggedError(tag) as unknown as new (args: object) => Error;
		const Class = class extends Base {
			static readonly kind = kind;
			readonly kind = kind;
			publicData(): Record<string, unknown> {
				return {};
			}
			publicMessage(): string {
				return tag;
			}
		};
		// `message` defaults to the public message, so logs, stacks and `toThrow(/text/)` are readable.
		// A field named `message` still wins: assigning it defines an own property over this accessor.
		Object.defineProperty(Class.prototype, "message", {
			configurable: true,
			get(this: { publicMessage(): string }) {
				return this.publicMessage();
			},
			set(this: object, value: unknown) {
				Object.defineProperty(this, "message", { value, writable: true, configurable: true, enumerable: false });
			},
		});
		return Class as never;
	};

/** Anything produced by `domainError(...)`. */
export type DomainError = {
	readonly _tag: string;
	readonly kind: ErrorKind;
	publicData(): Record<string, unknown>;
	publicMessage(): string;
};

export const isDomainError = (value: unknown): value is DomainError =>
	typeof value === "object" &&
	value !== null &&
	"kind" in value &&
	"publicData" in value &&
	typeof (value as { publicData: unknown }).publicData === "function";
