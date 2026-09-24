import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse, type NextFetchEvent } from "next/server";

const mocks = vi.hoisted(() => ({
  getStateCall: vi.fn(),
}));

vi.mock("@/lib/orpc", () => ({
  orpc: {
    setup: {
      getState: {
        call: mocks.getStateCall,
      },
    },
  },
}));

describe("WithSetup middleware", () => {
  const mockMatcherHandler = vi.fn();
  const mockToAbsoluteUrl = vi.fn((path: string) => `http://localhost:3003${path}`);
  const mockCreateContextFilterDebugLogger = vi.fn(() => vi.fn());

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();

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

    // Setup is served by the API, not the web app: the matcher forwards to the
    // API origin rather than a client-side web route.
    vi.doMock("@/lib/setup-url", () => ({
      setupDestinationUrl: ({ redirectTo }: { redirectTo?: string } = {}) =>
        `http://localhost:3005/setup${redirectTo ? `?redirectTo=${encodeURIComponent(redirectTo)}` : ""}`,
    }));

    mockMatcherHandler.mockReturnValue({ hit: false });
  });

  const createRequest = (url: string) => new NextRequest(url);

  it("redirects any page request to the API-served setup page when setup is required", async () => {
    mocks.getStateCall.mockResolvedValueOnce({ needsSetup: true });

    const { default: withSetup } = await import("../WithSetup");
    const next = vi.fn().mockReturnValue(NextResponse.next());
    const middleware = withSetup(next);

    const request = createRequest("http://localhost:3003/auth/signin?redirectTo=%2Fdashboard");
    const response = await middleware(request, {} as NextFetchEvent);
    const location = response?.headers.get("location") ?? "";

    // The API serves onboarding, so the redirect crosses origins.
    expect(location).toContain("localhost:3005/setup");
    expect(location).toContain("redirectTo=");
    expect(next).not.toHaveBeenCalled();
  });

  it("passes through when setup is already completed", async () => {
    mocks.getStateCall.mockResolvedValueOnce({ needsSetup: false });

    const { default: withSetup } = await import("../WithSetup");
    const nextResponse = NextResponse.next();
    const next = vi.fn().mockReturnValue(nextResponse);
    const middleware = withSetup(next);

    const request = createRequest("http://localhost:3003/dashboard");
    const response = await middleware(request, {} as NextFetchEvent);

    expect(next).toHaveBeenCalled();
    expect(response).toBe(nextResponse);
  });
});
