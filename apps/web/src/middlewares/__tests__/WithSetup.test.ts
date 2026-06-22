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

    vi.doMock("@/routes/index", () => ({
      Setup: vi.fn((_: unknown = {}, search: Record<string, string> = {}) => {
        const params = new URLSearchParams(search);
        const query = params.toString();
        return query ? `/setup?${query}` : "/setup";
      }),
    }));

    mockMatcherHandler.mockReturnValue({ hit: false });
  });

  const createRequest = (url: string) => new NextRequest(url);

  it("redirects any page request to setup when setup is required", async () => {
    mocks.getStateCall.mockResolvedValueOnce({ needsSetup: true });

    const { default: withSetup } = await import("../WithSetup");
    const next = vi.fn().mockReturnValue(NextResponse.next());
    const middleware = withSetup(next);

    const request = createRequest("http://localhost:3003/auth/signin?redirectTo=%2Fdashboard");
    const response = await middleware(request, {} as NextFetchEvent);
    const location = response?.headers.get("location") ?? "";

    expect(location).toContain("/setup");
    expect(location).toContain("redirectTo=%2Fauth%2Fsignin%3FredirectTo%3D%252Fdashboard");
    expect(next).not.toHaveBeenCalled();
  });

  it("does not redirect setup route to itself when setup is required", async () => {
    mocks.getStateCall.mockResolvedValueOnce({ needsSetup: true });

    const { default: withSetup } = await import("../WithSetup");
    const nextResponse = NextResponse.next();
    const next = vi.fn().mockReturnValue(nextResponse);
    const middleware = withSetup(next);

    const request = createRequest("http://localhost:3003/setup?redirectTo=%2Fdashboard");
    const response = await middleware(request, {} as NextFetchEvent);

    expect(next).toHaveBeenCalled();
    expect(response).toBe(nextResponse);
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
