import type { NextRequest, NextFetchEvent, NextProxy } from "next/server";
import { AppLogger } from "@repo/logger";
import { nextNoApi, nextjsRegexpPageOnly } from "./utils/static";
import type { MiddlewareFactory } from "./utils/types";

// Helper to get readable timestamp HH:MM:SS.mmm
const ts = () => new Date().toISOString().substring(11, 23);

const proxyLogger = new AppLogger("web").scope("WithTiming");

const withTiming: MiddlewareFactory = (next: NextProxy) => {
  return async (request: NextRequest, event: NextFetchEvent) => {
    proxyLogger.debug(`[${ts()}] 🚀 PROXY: START - ${request.method} ${request.nextUrl.pathname}`);
    const response = await next(request, event);
    proxyLogger.debug(`[${ts()}] ✅ PROXY: END - ${request.method} ${request.nextUrl.pathname}`);
    return response;
  };
};

export default withTiming

export const matcher = [{ and: [nextNoApi, nextjsRegexpPageOnly] }];
