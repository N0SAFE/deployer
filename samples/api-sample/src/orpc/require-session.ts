import { trace } from "@opentelemetry/api";
import { os } from "@orpc/server";
import { commonErrors } from "../contracts/errors";
import type { AppContext } from "./context";

export const osBase = os.$context<AppContext>();

/**
 * Enforcement point. The session was already resolved by `SessionMiddleware`,
 * so this is a pure type narrowing + error — no Better Auth call here.
 *
 * `.errors(commonErrors)` gives the middleware the same typed constructor the
 * contract declares, so `errors.UNAUTHORIZED` is the only way to fail and the
 * client sees a defined `UNAUTHORIZED` error.
 */
export const requireSession = osBase
  .errors(commonErrors)
  .middleware(({ context, next, errors }) => {
    if (!context.auth.isLoggedIn) {
      throw errors.UNAUTHORIZED({ data: { reason: "missing-session" } });
    }

    // OpenTelemetry creates one span per middleware; tag it for trace search.
    trace.getActiveSpan()?.setAttribute("enduser.id", context.auth.user.id);

    // `auth` is narrowed to the authenticated variant, so handlers get non-null
    // `user`/`session` without checks or casts.
    return next({ context: { auth: context.auth } });
  });

// oRPC uses the function name as the span name.
Object.defineProperty(requireSession, "name", { value: "requireSession" });
