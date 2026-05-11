import {
  NextFetchEvent,
  NextProxy,
  NextRequest,
  NextResponse,
} from "next/server";
import { ConfigFactory, Matcher, MiddlewareFactory } from "./utils/types";
import { nextjsRegexpPageOnly, nextNoApi } from "./utils/static";
import { orpc } from "@/lib/orpc";
import { toAbsoluteUrl } from "@/lib/utils";
import { Setup } from "@/routes/index";
import { createContextFilterDebugLogger } from "@/lib/logging/context-filter-debug";

const debugSetup = createContextFilterDebugLogger("WithSetup", "middleware:[WithSetup]");

const setupRegexpAndChildren = /^\/setup(\/.*)?$/;
const SETUP_STATUS_TIMEOUT_MS = 3000;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      globalThis.setTimeout(() => {
        reject(new Error(`Setup status check timed out after ${String(timeoutMs)}ms`));
      }, timeoutMs);
    }),
  ]);
}

const withSetup: MiddlewareFactory = (next: NextProxy) => {
  return async (request: NextRequest, _next: NextFetchEvent) => {
    try {
      const status = await withTimeout(
        orpc.setup.getStatus.call(
          {},
          {
            context: { cookie: request.cookies.toString() },
          },
        ),
        SETUP_STATUS_TIMEOUT_MS,
      );

      if (status.needsSetup) {
        if (setupRegexpAndChildren.test(request.nextUrl.pathname)) {
          return await next(request, _next);
        }

        const redirectTo =
          request.nextUrl.pathname + request.nextUrl.search;
        debugSetup("Setup required, redirecting request", {
          from: request.nextUrl.pathname,
          to: Setup({}, { redirectTo }),
        });
        return NextResponse.redirect(
          toAbsoluteUrl(Setup({}, { redirectTo })),
        );
      }
    } catch (error) {
      debugSetup("Failed/timed out checking setup status, skipping setup gate", {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return next(request, _next);
  };
};

export default withSetup;

export const matcher: Matcher = [
  {
    and: [
      nextNoApi,
      nextjsRegexpPageOnly,
    ],
  },
];

export const config: ConfigFactory = {
  name: "withSetup",
  matcher: true,
};
