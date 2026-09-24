import { Injectable, Logger, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { z } from "zod";

/**
 * EnvService — typed, validated access to the environment.
 *
 * SCHEMA-AGNOSTIC BY DESIGN
 * This service holds NO schema of its own. It is constructed with whatever
 * schema the consuming app supplies, so a Nest app in this monorepo can use it
 * with ITS OWN environment contract:
 *
 *   // apps/api — the API's contract
 *   new EnvService(apiEnvSchema, configService)
 *   // apps/setup — a different contract, same service
 *   new EnvService(setupEnvSchema, configService)
 *
 * BAKING A SCHEMA IN WOULD BE THE BUG
 * An earlier version defaulted to the API's schema. That is not a shared
 * primitive — it is the API's contract published under a shared name, so any
 * other app importing it silently inherited the API's variables and defaults.
 * The schema belongs to the app; only the MECHANISM belongs here.
 *
 * Type parameter defaults to `Record<string, unknown>` so an un-parameterised
 * `EnvService` still compiles, while `EnvService<MyEnv>` narrows `get()` to
 * the app's own keys.
 */
@Injectable()
export class EnvService<TSchema extends Record<string, unknown> = Record<string, unknown>> {
  private readonly logger = new Logger(EnvService.name);
  private schema: z.ZodType;
  private parsedEnv: TSchema;

  constructor(
    schema: z.ZodType,
    @Optional() private readonly configService?: ConfigService,
  ) {
    this.schema = schema;
    const isTest = process.env.NODE_ENV === "test";
    if (!isTest) {
      this.logger.log(
        `EnvService constructor called. ConfigService available: ${String(!!this.configService)}`,
      );
    }
    this.parsedEnv = this.parseEnv();
  }

  /**
   * Parse the environment through the active schema once and cache the result.
   *
   * When a ConfigService is injected (`EnvModule.forRoot`), ConfigModule has
   * already validated + defaulted the env via its `validate` hook. The values
   * are re-read THROUGH the schema so defaults and coercions apply and the
   * result is fully typed.
   *
   * When no ConfigService is available (CLI, unit tests), `process.env` is
   * parsed directly.
   */
  private parseEnv(): TSchema {
    if (this.configService) {
      const shape = (this.schema as z.ZodObject<Record<string, z.ZodTypeAny>>).shape;
      const raw: Record<string, unknown> = {};
      for (const key of Object.keys(shape)) {
        raw[key] = this.configService.get(key);
      }
      return this.schema.parse(raw) as TSchema;
    }

    try {
      return this.schema.parse(process.env) as TSchema;
    } catch {
      // A failed validation must not crash a CLI or a unit test that only needs
      // a couple of values; the raw snapshot keeps it running and the warning
      // makes the degraded read visible.
      if (process.env.NODE_ENV !== "test") {
        this.logger.warn("Environment validation failed, using raw process.env snapshot");
      }
      return { ...process.env } as TSchema;
    }
  }

  /** Read a value, typed by the schema the app supplied. */
  get<T extends keyof TSchema>(key: T): TSchema[T] {
    return this.parsedEnv[key];
  }

  /**
   * Derive a service for a DIFFERENT schema — same environment, another
   * contract. Used for narrow per-command schemas so a CLI command validates
   * only the variables it actually needs.
   *
   * Shares this instance's ConfigService (so file loading is not repeated) but
   * parses independently.
   */
  use<TNewSchema extends Record<string, unknown>>(schema: z.ZodType<TNewSchema>): EnvService<TNewSchema> {
    return new EnvService<TNewSchema>(schema, this.configService);
  }

  isDevelopment(): boolean {
    return process.env.NODE_ENV === "development";
  }

  isProduction(): boolean {
    return process.env.NODE_ENV === "production";
  }

  isTest(): boolean {
    return process.env.NODE_ENV === "test";
  }
}
