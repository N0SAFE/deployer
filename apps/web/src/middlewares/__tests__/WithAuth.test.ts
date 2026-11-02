import { NextRequest, NextResponse, type NextFetchEvent } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
      AuthDashboard: vi.fn(() => "/dashboard"),
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

  describe("authGateDecision", () => {
    it("sends a request without a session cookie to sign-in, even if a cache blob was passed", async () => {
      const { authGateDecision } = await import("../WithAuth");

      expect(authGateDecision({ hasSessionCookie: false, session: { user: { role: "admin" } }, path: "/dashboard" })).toBe(
        "signin",
      );
    });

    it("sends a request whose session did not resolve to sign-in", async () => {
      const { authGateDecision } = await import("../WithAuth");

      expect(authGateDecision({ hasSessionCookie: true, session: null, path: "/dashboard" })).toBe("signin");
    });

    it("allows any signed-in role on a normal page", async () => {
      const { authGateDecision } = await import("../WithAuth");

      expect(authGateDecision({ hasSessionCookie: true, session: { user: { role: "viewer" } }, path: "/dashboard" })).toBe(
        "allow",
      );
    });

    it("refuses a viewer the user-administration page", async () => {
      const { authGateDecision } = await import("../WithAuth");

      expect(
        authGateDecision({ hasSessionCookie: true, session: { user: { role: "viewer" } }, path: "/settings/users" }),
      ).toBe("forbidden");
      expect(
        authGateDecision({ hasSessionCookie: true, session: { user: { role: "user" } }, path: "/settings/users/42" }),
      ).toBe("forbidden");
    });

    it("lets an administrator through the user-administration page", async () => {
      const { authGateDecision } = await import("../WithAuth");

      expect(
        authGateDecision({ hasSessionCookie: true, session: { user: { role: "admin" } }, path: "/settings/users" }),
      ).toBe("allow");
      expect(
        authGateDecision({ hasSessionCookie: true, session: { user: { role: "superAdmin" } }, path: "/settings/users" }),
      ).toBe("allow");
    });

    it("protects the device-approval page like any other signed-in page", async () => {
      const { authGateDecision } = await import("../WithAuth");

      expect(authGateDecision({ hasSessionCookie: false, session: null, path: "/device" })).toBe("signin");
      expect(authGateDecision({ hasSessionCookie: true, session: { user: { role: "user" } }, path: "/device" })).toBe(
        "allow",
      );
    });
  });

  it("verifies a cold cookie cache against the API instead of trusting the cookie alone", async () => {
    mockGetSessionCookie.mockReturnValue("session-token");
    mockGetCookieCache.mockResolvedValue(null);
    const fetchMock = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ user: { role: "viewer" } }) }));
    vi.stubGlobal("fetch", fetchMock);

    const { default: withAuth } = await import("../WithAuth");
    const next = vi.fn().mockReturnValue(NextResponse.next());
    const middleware = withAuth(next);

    const request = createRequest("http://localhost:3003/dashboard");
    await middleware(request, {} as NextFetchEvent);

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:3001/api/auth/get-session",
      expect.objectContaining({ cache: "no-store" }),
    );
    expect(next).toHaveBeenCalled();

    vi.unstubAllGlobals();
  });

  it("sends the request to sign-in when the API refuses the cold session", async () => {
    mockGetSessionCookie.mockReturnValue("session-token");
    mockGetCookieCache.mockResolvedValue(null);
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ ok: false, json: () => Promise.resolve(null) })));

    const { default: withAuth } = await import("../WithAuth");
    const next = vi.fn().mockReturnValue(NextResponse.next());
    const middleware = withAuth(next);

    const request = createRequest("http://localhost:3003/dashboard");
    const response = await middleware(request, {} as NextFetchEvent);

    expect(next).not.toHaveBeenCalled();
    expect(response?.headers.get("location") ?? "").toContain("/auth/signin");

    vi.unstubAllGlobals();
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