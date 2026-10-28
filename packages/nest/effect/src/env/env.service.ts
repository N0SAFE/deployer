import { Injectable, Logger, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { runSyncUnwrapped } from "@deployer/effect-core";
import {
	makeEnvironment,
	makeLenientEnvironment,
	processEnvironment,
	type EnvironmentShape,
	type EnvironmentSource,
} from "@deployer/environment";
import type { z } from "zod";

/**
 * Typed, validated access to the environment for Nest callers. It holds no schema of its own: the
 * app supplies its contract, and the validation and reads are `@deployer/environment`'s, so Effect
 * code can use `effect` directly.
 *
 * With a `ConfigService` (`EnvModule.forRoot`) the values are re-read through the schema and an
 * invalid environment throws `EnvironmentInvalid`. Without one (a CLI, a unit test) an invalid
 * environment degrades to the raw `process.env` with a warning.
 */
@Injectable()
export class EnvService<TSchema extends Record<string, unknown> = Record<string, unknown>> {
	private readonly logger = new Logger(EnvService.name);

	/** The Effect environment this host exposes. */
	readonly effect: EnvironmentShape<TSchema>;

	constructor(
		schema: z.ZodType,
		@Optional() private readonly configService?: ConfigService,
	) {
		if (process.env.NODE_ENV !== "test") {
			this.logger.log(`EnvService constructed. ConfigService available: ${String(!!this.configService)}`);
		}
		const source = this.sourceFor(configService);
		const typed = schema as z.ZodType<TSchema>;
		this.effect = runSyncUnwrapped(
			configService === undefined ? makeLenientEnvironment(typed, source) : makeEnvironment(typed, source),
		);
	}

	private sourceFor(configService: ConfigService | undefined): EnvironmentSource {
		return configService === undefined
			? processEnvironment
			: { read: (key) => configService.get(key), all: () => ({ ...process.env }) };
	}

	/** Read a value, typed by the schema the app supplied. */
	get<T extends keyof TSchema>(key: T): TSchema[T] {
		return this.effect.get(key);
	}

	/** The same environment under a different contract (a narrow per-command schema), sharing the ConfigService. */
	use<TNewSchema extends Record<string, unknown>>(schema: z.ZodType<TNewSchema>): EnvService<TNewSchema> {
		return new EnvService<TNewSchema>(schema, this.configService);
	}

	isDevelopment(): boolean {
		return this.effect.isDevelopment();
	}

	isProduction(): boolean {
		return this.effect.isProduction();
	}

	isTest(): boolean {
		return this.effect.isTest();
	}
}
