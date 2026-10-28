import { Context, Effect, Layer } from "effect";

import { EnvironmentInvalid } from "./errors";

import type { z } from "zod";


/** Where raw values come from: `process.env`, or a config loader that has already merged `.env` files. */
export type EnvironmentSource = {
	/** Reads one variable; `undefined` when unset. */
	readonly read: (key: string) => unknown;
	/** Every variable, when the source can enumerate them. */
	readonly all?: () => Record<string, unknown>;
};

export const processEnvironment: EnvironmentSource = {
	read: (key) => process.env[key],
	all: () => ({ ...process.env }),
};

/**
 * A validated environment. The schema belongs to the app (which variables exist, their defaults,
 * which are required); only the mechanism lives here, so two apps use the same code with their own
 * contract and never inherit each other's variables.
 */
export type EnvironmentShape<T extends Record<string, unknown>> = {
	/** Reads a value, typed by the schema the app supplied. */
	readonly get: <K extends keyof T>(key: K) => T[K];
	/** The whole validated record. */
	readonly values: Readonly<T>;
	/** The same environment under another contract, validated independently. */
	readonly use: <U extends Record<string, unknown>>(schema: z.ZodType<U>) => Effect.Effect<EnvironmentShape<U>, EnvironmentInvalid>;
	readonly isDevelopment: () => boolean;
	readonly isProduction: () => boolean;
	readonly isTest: () => boolean;
};

const wrap = <T extends Record<string, unknown>>(values: T, source: EnvironmentSource): EnvironmentShape<T> => {
	const nodeEnv = (): unknown => source.read("NODE_ENV");
	return {
		get: (key) => values[key],
		values,
		use: (next) => makeEnvironment(next, source),
		isDevelopment: () => nodeEnv() === "development",
		isProduction: () => nodeEnv() === "production",
		isTest: () => nodeEnv() === "test",
	};
};

/** The keys the schema declares, when it is an object schema; the whole source otherwise. */
const rawFor = (schema: z.ZodType, source: EnvironmentSource): Record<string, unknown> => {
	const shape = (schema as unknown as { shape?: Record<string, unknown> }).shape;
	if (shape !== undefined) {
		return Object.fromEntries(Object.keys(shape).map((key) => [key, source.read(key)]));
	}
	return source.all?.() ?? {};
};

/** Validates the environment through `schema`; fails with `EnvironmentInvalid` naming every bad variable. */
export const makeEnvironment = <T extends Record<string, unknown>>(
	schema: z.ZodType<T>,
	source: EnvironmentSource = processEnvironment,
): Effect.Effect<EnvironmentShape<T>, EnvironmentInvalid> =>
	Effect.suspend(() => {
		const parsed = schema.safeParse(rawFor(schema, source));
		if (parsed.success) return Effect.succeed(wrap(parsed.data, source));
		return Effect.fail(
			new EnvironmentInvalid({
				issues: parsed.error.issues.map((issue) => ({
					variable: issue.path.map(String).join(".") || "(environment)",
					message: issue.message,
				})),
			}),
		);
	});

/**
 * Like `makeEnvironment`, but an invalid environment degrades to the raw values with a warning
 * instead of failing: for a CLI or a test that only needs a couple of variables. Apps that must not
 * boot misconfigured use `makeEnvironment`.
 */
export const makeLenientEnvironment = <T extends Record<string, unknown>>(
	schema: z.ZodType<T>,
	source: EnvironmentSource = processEnvironment,
): Effect.Effect<EnvironmentShape<T>> =>
	makeEnvironment(schema, source).pipe(
		Effect.catchTag("EnvironmentInvalid", (invalid) =>
			Effect.logWarning(`Environment validation failed, using the raw values: ${invalid.publicMessage()}`).pipe(
				Effect.as(wrap((source.all?.() ?? {}) as T, source)),
			),
		),
	);

/** The app's environment as a service, for Effect code. The app provides it with `Environment.layer`. */
export class Environment extends Context.Service<Environment, EnvironmentShape<Record<string, unknown>>>()(
	"environment/Environment",
) {
	static layer = <T extends Record<string, unknown>>(schema: z.ZodType<T>, source?: EnvironmentSource) =>
		Layer.effect(Environment, makeEnvironment(schema, source) as Effect.Effect<EnvironmentShape<Record<string, unknown>>, EnvironmentInvalid>);
}
