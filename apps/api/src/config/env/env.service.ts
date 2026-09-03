import { Injectable, Logger, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { envSchema, type Env } from "./env";
import type { z } from "zod";

@Injectable()
export class EnvService<TSchema extends Record<string, unknown> = Env> {
  private readonly logger = new Logger(EnvService.name);
  private schema: z.ZodType;
  private parsedEnv: TSchema; // Parsed environment - immutable after construction

  constructor(
    @Optional() private readonly configService?: ConfigService
  ) {
    this.schema = envSchema;
    const isTest = process.env.NODE_ENV === 'test';

    if (!isTest) {
      this.logger.log(`EnvService constructor called. ConfigService available: ${String(!!this.configService)}`);
    }
    this.parsedEnv = this.parseEnv();
  }

  /**
   * Parse the environment through the active schema once and cache the result.
   *
   * When a ConfigService is injected (EnvModule), ConfigModule.forRoot already
   * validated + defaulted the env via `validate: (env) => envSchema.parse(env)`.
   * We re-read the validated values through the schema so defaults/coercions are
   * applied and the result is fully typed — no `as unknown as` at read time.
   *
   * When no ConfigService is available (CLI, tests), parse `process.env` directly.
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
      // If validation fails, take a direct snapshot of process.env
      if (process.env.NODE_ENV !== 'test') {
        this.logger.warn('Environment validation failed, using raw process.env snapshot');
      }
      return { ...process.env } as TSchema;
    }
  }

  /**
   * Set a custom schema for this EnvService instance
   * @param schema - Zod schema to validate environment variables against
   */
  private setSchema(schema: z.ZodType): void {
    this.schema = schema;
    this.parsedEnv = this.parseEnv();
  }

  get<T extends keyof TSchema>(key: T): TSchema[T] {
    return this.parsedEnv[key];
  }

  /**
   * Create a new EnvService instance with a different environment schema
   * @param schema - Zod schema to validate environment variables against
   * @returns New EnvService instance with the provided schema
   * 
   * @example
   * ```typescript
   * import { webEnvSchema, type WebEnv } from '@repo/env';
   * 
   * const webEnv = this.envService.use<WebEnv>(webEnvSchema);
   * const apiUrl = webEnv.get('API_URL');
   * ```
   */
  use<TNewSchema extends Record<string, unknown>>(schema: z.ZodType<TNewSchema>): EnvService<TNewSchema> {
    const instance = new EnvService<TNewSchema>(this.configService);
    instance.setSchema(schema);
    return instance;
  }

  /**
   * Check if we're in development mode
   */
  isDevelopment(): boolean {
    return this.get("NODE_ENV") === "development";
  }

  /**
   * Check if we're in production mode
   */
  isProduction(): boolean {
    return this.get("NODE_ENV") === "production";
  }

  /**
   * Check if we're in test mode
   */
  isTest(): boolean {
    return this.get("NODE_ENV") === "test";
  }
}
