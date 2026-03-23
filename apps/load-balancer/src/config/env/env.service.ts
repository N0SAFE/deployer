import { Injectable, Logger, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { z } from "zod";
import { envSchema, type Env } from "./env";

@Injectable()
export class EnvService<TSchema extends Record<string, unknown> = Env> {
    private readonly logger = new Logger(EnvService.name);
    private schema: z.ZodType;
    private parsedEnv?: TSchema; // Cache parsed environment - immutable after construction

    constructor(@Optional() private readonly configService?: ConfigService) {
        this.schema = envSchema;
        const isTest = process.env.NODE_ENV === "test";

        if (!isTest) {
            this.logger.log(`EnvService constructor called. ConfigService available: ${String(!!this.configService)}`);
        }

        if (this.configService) {
            if (!isTest) {
                this.logger.log("ConfigService is properly injected");
            }
        } else {
            if (!isTest) {
                this.logger.warn("ConfigService is NOT injected - will use process.env fallback");
            }

            // Parse environment once during construction when not using ConfigService
            // Take a snapshot of process.env at construction time (immutable)
            try {
                this.parsedEnv = this.schema.parse(process.env) as TSchema;
            } catch {
                if (!isTest) {
                    this.logger.warn("Environment validation failed, using raw process.env snapshot");
                }
                this.parsedEnv = { ...process.env } as TSchema;
            }
        }
    }

    /**
     * Set a custom schema for this EnvService instance
     * @param schema - Zod schema to validate environment variables against
     */
    private setSchema(schema: z.ZodType): void {
        this.schema = schema;
        if (!this.configService) {
            try {
                this.parsedEnv = this.schema.parse(process.env) as TSchema;
            } catch {
                this.parsedEnv = { ...process.env } as TSchema;
            }
        }
    }

    get<T extends keyof TSchema>(key: T): TSchema[T] {
        if (!this.configService) {
            if (this.parsedEnv) {
                return this.parsedEnv[key];
            }
            return undefined as TSchema[T];
        }
        const ret = this.configService.get<TSchema[T]>(key as string) as unknown as TSchema[T];
        return ret;
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

    isDevelopment(): boolean {
        return this.get("NODE_ENV") === "development";
    }

    isProduction(): boolean {
        return this.get("NODE_ENV") === "production";
    }

    isTest(): boolean {
        return this.get("NODE_ENV") === "test";
    }
}