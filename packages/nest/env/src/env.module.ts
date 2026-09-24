import { Global, Module, type DynamicModule, type Provider } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import * as path from "path";
import * as fs from "fs";
import type { z } from "zod";

import { EnvService } from "./env.service";

/** What `EnvModule.forRoot` needs from the consuming app. */
export interface EnvModuleOptions {
  /** The app's OWN environment contract. The package ships none. */
  schema: z.ZodType;
  /** Extra `.env` file paths to load, relative to `process.cwd()`. */
  envFilePaths?: string[];
}

/**
 * EnvModule — wires `@nestjs/config` to a schema the APP supplies.
 *
 * WHY forRoot, AND WHY THAT IS THE POINT
 * The schema is application policy: which variables exist, their defaults, which
 * are required. This module owns the MECHANISM (load `.env`, validate once);
 * the app owns the CONTRACT:
 *
 *   EnvModule.forRoot({ schema: apiEnvSchema })      // apps/api
 *   EnvModule.forRoot({ schema: setupEnvSchema })    // apps/setup
 *
 * An earlier version hardcoded the API's schema here, which made the package
 * unusable by any other app — it would silently validate against the API's
 * variables. That is the "business logic in a package" failure the boundary
 * rule exists to prevent.
 *
 * APPS TYPICALLY ALSO SUBCLASS `EnvService` so injection is typed to their own
 * keys; the subclass is provided by Nest as its own token, and this module does
 * not need to know about it.
 *
 * `@Global` because the environment is process-wide: every module needs it, and
 * threading an import through each one would be noise.
 */
@Global()
@Module({})
export class EnvModule {
  static forRoot(options: EnvModuleOptions): DynamicModule {
    const envFilePath = EnvModule.resolveEnvFiles(options.envFilePaths);

    return {
      module: EnvModule,
      imports: [
        ConfigModule.forRoot({
          // Validate through the APP's schema, so a malformed environment fails
          // at boot with the schema's own message rather than surfacing later as
          // an undefined read.
          validate: (env) => options.schema.parse(env) as Record<string, unknown>,
          isGlobal: true,
          envFilePath,
          ignoreEnvFile: false,
          expandVariables: true,
          cache: true,
        }),
      ],
      providers: [EnvModule.buildProvider(options.schema)],
      exports: [EnvService, ConfigModule],
    };
  }

  /** Build the base `EnvService` bound to the app's schema. */
  private static buildProvider(schema: z.ZodType): Provider {
    return {
      provide: EnvService,
      useFactory: (configService: ConfigService) => new EnvService(schema, configService),
      inject: [ConfigService],
    };
  }

  /**
   * Resolve the `.env` files to load.
   *
   * Defaults to `<cwd>/.env` and `<cwd>/../../.env`, covering both running from
   * an app directory and from the repo root — the resolution the API relied on
   * before this module was shared.
   */
  private static resolveEnvFiles(extra: string[] | undefined): string[] {
    const candidates = extra ?? [
      path.resolve(process.cwd(), ".env"),
      path.resolve(process.cwd(), "..", "..", ".env"),
    ];
    return candidates.filter((p) => fs.existsSync(p));
  }
}
