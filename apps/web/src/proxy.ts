// middleware.ts

import { stackMiddlewares } from "./middlewares/utils/stackMiddlewares";
import { withHeaders } from "./middlewares/WithHeaders";
import * as HealthCheckMiddleware from "./middlewares/WithHealthCheck";
import * as SetupMiddleware from "./middlewares/WithSetup";
import * as AuthMiddleware from "./middlewares/WithAuth";
import * as EnvMiddleware from "./middlewares/WithEnv";
// import * as WithTiming from './middlewares/WithTiming'
import type { Middleware } from "./middlewares/utils/types";


const middlewares = [
  // WithTiming, // use this to know the timing of each request in the middleware stack
  EnvMiddleware,
  HealthCheckMiddleware,
  SetupMiddleware,
  // WithRedirect,
  AuthMiddleware,
  withHeaders,
] satisfies Middleware[];

export default stackMiddlewares(middlewares);

// ── WHY THIS IS A LITERAL AND NOT `compileMatchers(middlewares)` ─────────────
// Next.js statically analyzes this export before running any code, so it must
// be a constant. Its own docs are explicit:
//
//   "The `matcher` values need to be constants so they can be statically
//    analyzed at build-time. Dynamic values such as variables will be ignored."
//   — next/dist/docs/.../proxy.md
//
// A CALL is not a constant. Passing `compileMatchers(middlewares)` produced:
//
//   Error: Next.js can't recognize the exported `config` field in route.
//   `matcher` needs to be a static string or array of static strings or array
//   of static objects.
//
// and every page then returned 500 — the middleware error was reported once per
// request, above the app's own error, which is why the failure looked like a
// rendering problem rather than a config one.
//
// `["/:path*"]` is not a guess: it is exactly what `compileMatchers(middlewares)`
// returns for this stack. One member is treated as unconditionally applicable —
// `EnvMiddleware` has no `matcher` of its own — and that returns `MATCH_EVERY_PATH`
// immediately, so the whole union collapses to "every path".
//
// `bun --bun src/proxy.matcher.spec.ts` asserts this equality, so a change to
// the middleware stack that alters the compiled result fails instead of silently
// making the two disagree.
export const config = {
  matcher: ["/:path*"],
};