import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse, type NextFetchEvent } from "next/server";

describe("WithAuth middleware", () => {
  const mockValidateEnvSafe = vi.fn();
  const mockToAbsoluteUrl = vi.fn((path: string) => `http://localhost:3003${path}`);
  const mockMatcherHandler = vi.fn();
  const mockCreateContextFilterDebugLogger = vi.fn(() => vi.fn());
  const mockGetSessionCookie = vi.fn();
  const mockGetCookieCache = vi.fn();

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();

    mockValidateEnvSafe.mockReturnValue({
      data: {
        NODE_ENV: "test",
        API_URL: "http://localhost:3001",
        NEXT_PUBLIC_API_URL: "http://localhost:3001",
        BETTER_AUTH_SECRET: "secret",
      },
      success: true,
    });

    vi.doMock("#/env", () => ({
      validateEnvSafe: mockValidateEnvSafe,
      envSchema: { parse: vi.fn(), safeParse: vi.fn(), shape: {} },
      envIsValid: vi.fn(),
      validateEnv: vi.fn(),
      validateEnvPath: vi.fn(),
    }));

    vi.doMock("@/lib/utils", () => ({
      toAbsoluteUrl: mockToAbsoluteUrl,
    }));

    vi.doMock("../utils/utils", () => ({
      matcherHandler: mockMatcherHandler,
    }));

    vi.doMock("../utils/static", () => ({
      nextjsRegexpPageOnly: {},
      nextNoApi: {},
    }));

    vi.doMock("@/lib/logging/context-filter-debug", () => ({
      createContextFilterDebugLogger: mockCreateContextFilterDebugLogger,
    }));

    vi.doMock("better-auth/cookies", () => ({
      getSessionCookie: mockGetSessionCookie,
      getCookieCache: mockGetCookieCache,
    }));

    vi.doMock("@/routes/index", () => ({
      AuthSignin: vi.fn((_: unknown = {}, search: Record<string, string> = {}) => {
        const params = new URLSearchParams(search);
        const query = params.toString();
        return query ? `/auth/signin?${query}` : "/auth/signin";
      }),
    }));

    mockMatcherHandler.mockReturnValue({ hit: false });
    mockGetCookieCache.mockResolvedValue({ updatedAt: Date.now() });
  });

  const createRequest = (url: string) => new NextRequest(url);

  it("redirects unauthenticated requests to signin with redirectTo", async () => {

    mockGetSessionCookie.mockReturnValue(null);

    const { default: withAuth } = await import("../WithAuth");
    const next = vi.fn().mockReturnValue(NextResponse.next());
    const middleware = withAuth(next);

    const request = createRequest("http://localhost:3003/dashboard/services");
    const response = await middleware(request, {} as NextFetchEvent);
    const location = response?.headers.get("location") ?? "";

    expect(location).toContain("/auth/signin");
    expect(location).toContain("redirectTo=%2Fdashboard%2Fservices");
    expect(next).not.toHaveBeenCalled();
  });

  it("passes through when session exists", async () => {

    mockGetSessionCookie.mockReturnValue("session-token");

    const { default: withAuth } = await import("../WithAuth");
    const nextResponse = NextResponse.next();
    const next = vi.fn().mockReturnValue(nextResponse);
    const middleware = withAuth(next);

    const request = createRequest("http://localhost:3003/dashboard");
    const response = await middleware(request, {} as NextFetchEvent);

    expect(next).toHaveBeenCalled();
    expect(response).toBe(nextResponse);
  });
});