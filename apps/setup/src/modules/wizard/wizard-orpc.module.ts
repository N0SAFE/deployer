import { Logger, Module, type DynamicModule } from "@nestjs/common";
import { REQUEST } from "@nestjs/core";
import { ORPCModule, type ORPCModuleConfig } from "@orpc/nest";
import { onError, ORPCError } from "@orpc/server";
import { HttpException } from "@nestjs/common";

/**
 * One entry of the handler's interceptor list, taken from the config type that
 * declares it — `@orpc/shared` is not a dependency of this app, and reaching for
 * it just to name `Interceptor` would add one for a type alias.
 */
type ModuleInterceptor = NonNullable<ORPCModuleConfig["interceptors"]>[number];

/**
 * The setup app's oRPC registration.
 *
 * ── WHY THIS APP NEEDS ITS OWN, AND NOT THE API'S ───────────────────────────
 * The context is deliberately EMPTY of auth: setup runs before any account
 * exists, so there is no session to load and no auth service to construct. The
 * API's factory injects `AuthCoreService`, which needs the global Postgres — a
 * database that does not exist yet at this point.
 *
 * ── WHY IT EXISTS AT ALL ────────────────────────────────────────────────────
 * `@Implement` mounts each method as a Nest route on its own (via
 * `toNestRouteDecorator`), so procedures ARE reachable without this module. What
 * this module provides is the `ImplementInterceptor` — and with it the error
 * mapping below. Without it, any non-oRPC error thrown inside a handler falls
 * through to Nest's default handler and the operator sees only:
 *
 *   { "defined": false, "code": "INTERNAL_SERVER_ERROR",
 *     "message": "Internal Server Error" }
 *
 * That is what made the reported `POST /setup/trigger` failure undiagnosable:
 * the real reason (`HttpException` from a forward, a raw SQLite error from
 * `persist()`) was discarded on the way out. The token this module provides is
 * global, so `ImplementInterceptor` resolves for every `@Implement` handler in
 * the app.
 *
 * `request` is carried as context because the handlers need the caller's host to
 * decide where to send the browser after setup.
 */
export interface WizardContext {
  request: Request;
  [key: string]: unknown;
  [key: symbol]: unknown;
}

/**
 * Map a NestJS `HttpException` onto a contract-declared oRPC error.
 *
 * `setupAppErrorContracts` declares `SERVICE_UNAVAILABLE` (503), `BAD_GATEWAY`
 * (502), `GATEWAY_TIMEOUT` (504) and `INTERNAL_SERVER_ERROR` (500), all carrying
 * `standardDomainErrorPayloadSchema`. oRPC marks a thrown error as DEFINED on the
 * client only when its `code` is declared AND its `data` validates — so the
 * payload is built to that exact shape, and the handler's own status map turns
 * the code back into the HTTP status.
 *
 * This is what keeps "the API is not reachable yet" a 503 the wizard renders as
 * progress, instead of collapsing it into a 500 the operator reads as a fault.
 */
function transformHttpException(error: unknown): void {
  if (!(error instanceof HttpException)) return;

  const status = error.getStatus();
  const response = error.getResponse();
  const raw =
    typeof response === "object" && response !== null && "message" in response
      ? (response as { message?: unknown }).message
      : undefined;
  // Validation pipes produce `string[]`; the declared payload requires a string.
  const message = Array.isArray(raw)
    ? raw.filter((entry): entry is string => typeof entry === "string").join("; ")
    : typeof raw === "string"
      ? raw
      : error.message;

  const code =
    status === 503
      ? "SERVICE_UNAVAILABLE"
      : status === 502
        ? "BAD_GATEWAY"
        : status === 504
          ? "GATEWAY_TIMEOUT"
          : "INTERNAL_SERVER_ERROR";

  throw new ORPCError(code, {
    message,
    data: { statusCode: status, code, message, orpcCode: code },
    cause: error,
  });
}

/**
 * Any other error becomes a declared `INTERNAL_SERVER_ERROR`.
 *
 * A raw failure (an SQLite error out of a repository, a TypeError) carries no
 * status of its own. Reporting it as an undeclared error would put the generic
 * body back on the wire and hide the reason; mapping it here keeps the response
 * typed and carries the actual message through `data.message`, which the
 * wizard's `getErrorMessage` already reads.
 */
function transformUnknownError(error: unknown): void {
  if (error instanceof ORPCError) return;

  const message = error instanceof Error ? error.message : String(error);
  throw new ORPCError("INTERNAL_SERVER_ERROR", {
    message,
    data: {
      statusCode: 500,
      code: "INTERNAL_SERVER_ERROR",
      message,
      orpcCode: "INTERNAL_SERVER_ERROR",
    },
    cause: error,
  });
}

const orpcLogger = new Logger("ORPC Errors");

/**
 * Write the failure to the setup container's console, as the API does.
 *
 * Runs BEFORE the mapping below on purpose: mapping replaces the error with an
 * `ORPCError` whose message is all the browser gets, so this is the only place
 * the original stack (a raw SQLite error, a failed forward) is still visible.
 * A 503 ("API not up yet") is expected during setup and logged as a warning so
 * it does not read as a fault.
 */
function logOrpcError(error: unknown): void {
  if (error instanceof HttpException && error.getStatus() === 503) {
    orpcLogger.warn(`[SERVICE_UNAVAILABLE] ${error.message}`);
    return;
  }
  if (error instanceof ORPCError && error.code !== "INTERNAL_SERVER_ERROR") {
    orpcLogger.warn(`[${error.code}] ${error.message}`);
    return;
  }
  const origin = error instanceof ORPCError && error.cause !== undefined ? error.cause : error;
  if (origin instanceof Error) {
    orpcLogger.error(`[${origin.constructor.name}] ${origin.message}`, origin.stack);
  } else {
    orpcLogger.error(`Unhandled non-Error thrown: ${String(origin)}`);
  }
}

/** The interceptors both error paths above are wired through. */
function errorMappingInterceptors(): ModuleInterceptor[] {
  return [
    onError((error: unknown) => {
      logOrpcError(error);
      transformHttpException(error);
      transformUnknownError(error);
    }),
  ];
}

@Module({})
export class WizardOrpcModule {
  static forRoot(): DynamicModule {
    return {
      module: WizardOrpcModule,
      imports: [
        ORPCModule.forRootAsync({
          inject: [REQUEST],
          useFactory: (request: Request) => ({
            context: { request },
            interceptors: errorMappingInterceptors(),
          }),
        }),
      ],
    };
  }
}
