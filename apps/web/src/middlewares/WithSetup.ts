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
import { createDebug } from "@/lib/debug";

const debugSetup = createDebug("middleware/setup");

const setupRegexpAndChildren = /^\/setup(\/.*)?$/;

const withSetup: MiddlewareFactory = (next: NextProxy) => {
  return async (request: NextRequest, _next: NextFetchEvent) => {
    try {
      const status = await orpc.setup.getStatus.call(
        {},
        {
          context: { cookie: request.cookies.toString() },
        },
      );
      
      console.log("Setup status:", status);

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
      debugSetup("Failed to check setup status, skipping setup gate", {
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
