import {
  Inject,
  Module,
  type DynamicModule,
  type MiddlewareConsumer,
  type NestModule,
} from "@nestjs/common";
import { toNodeHandler } from "better-auth/node";
import type { Auth } from "./auth";
import { AUTH, AUTH_MODULE_OPTIONS } from "./auth.token";
import { SessionMiddleware } from "./session.middleware";

export interface AuthModuleOptions {
  readonly auth: Auth;
  /** Overrides the `basePath` configured on the Better Auth instance. */
  readonly basePath?: `/${string}`;
  /** Set false to skip session resolution (e.g. a service that only verifies tokens). */
  readonly session?: boolean;
}

function normalizeBasePath(path: string): string {
  const withSlash = path.startsWith("/") ? path : `/${path}`;
  return withSlash.endsWith("/") ? withSlash.slice(0, -1) : withSlash;
}

/**
 * Middleware-driven Better Auth, following the pattern used by
 * `apps/api`:
 *
 * 1. The Better Auth handler is mounted as a NestJS middleware on `basePath`,
 *    before the router exists — no manual `app.use` in bootstrap.
 * 2. `SessionMiddleware` resolves the session once per request and attaches
 *    `request.session` / `request.user`.
 *
 * Enforcement is intentionally NOT a global guard: oRPC procedures are the
 * only protected routes here, and `requireSession` throws a contract-defined
 * `UNAUTHORIZED` that the client can type-check. A global guard would answer
 * first with a Nest-shaped 401 and break that envelope.
 */
@Module({})
export class AuthModule implements NestModule {
  static forRoot(options: AuthModuleOptions): DynamicModule {
    return {
      module: AuthModule,
      providers: [
        { provide: AUTH_MODULE_OPTIONS, useValue: options },
        { provide: AUTH, useValue: options.auth },
        SessionMiddleware,
      ],
    };
  }

  constructor(@Inject(AUTH_MODULE_OPTIONS) private readonly options: AuthModuleOptions) {}

  configure(consumer: MiddlewareConsumer): void {
    const configured = this.options.auth.options.basePath;
    const basePath = normalizeBasePath(
      this.options.basePath ?? (typeof configured === "string" ? configured : "/api/auth"),
    );

    consumer.apply(toNodeHandler(this.options.auth)).forRoutes(basePath);

    if (this.options.session !== false) {
      consumer.apply(SessionMiddleware).forRoutes("*path");
    }
  }
}
