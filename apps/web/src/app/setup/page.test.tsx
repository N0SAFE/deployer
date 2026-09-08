import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  safe: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("@repo/ui/components/shadcn/card", () => ({
  Card: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CardHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CardTitle: ({ children }: { children: React.ReactNode }) => <h1>{children}</h1>,
  CardDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  CardContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CardFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@repo/ui/components/shadcn/button", () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
}));

vi.mock("@repo/ui/components/shadcn/input", () => ({
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}));

vi.mock("@repo/ui/components/shadcn/alert", () => ({
  Alert: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@repo/ui/components/atomics/atoms/Icon", () => ({
  Spinner: () => <span>spinner</span>,
}));

vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
}));

vi.mock("@/routes", () => ({
  Setup: Object.assign(
    vi.fn((_params: unknown = {}, search: Record<string, string | undefined> = {}) => {
      const qs = new URLSearchParams();
      if (search.redirectTo) qs.set("redirectTo", search.redirectTo);
      const query = qs.toString();
      return query ? `/setup?${query}` : "/setup";
    }),
    {
      // Wrap the async server function as a regular React component
      // that calls the function and renders the result.
      Route: (component: (props: { searchParams: Record<string, string | undefined> }) => React.ReactNode | Promise<React.ReactNode>) => {
        const WrappedPage = (props: { searchParams: Record<string, string | undefined> }) => {
          const [result, setResult] = React.useState<React.ReactNode | null>(null);
          const [error, setError] = React.useState<Error | null>(null);
          React.useEffect(() => {
            Promise.resolve(component({ searchParams: props.searchParams }))
              .then(setResult)
              .catch(setError);
          }, []);
          if (error) throw error;
          return <>{result}</>;
        };
        return WrappedPage;
      },
    },
  ),
  AuthSignin: Object.assign(
    vi.fn((_params: unknown = {}, search: Record<string, string | undefined> = {}) => {
      const qs = new URLSearchParams();
      if (search.redirectTo) qs.set("redirectTo", search.redirectTo);
      if (search.callbackUrl) qs.set("callbackUrl", search.callbackUrl);
      const query = qs.toString();
      return query ? `/auth/signin?${query}` : "/auth/signin";
    }),
    {
      Link: ({ children }: { children: React.ReactNode }) => <a href="/auth/signin">{children}</a>,
    },
  ),
}));

vi.mock("@/domains/setup/endpoints", () => ({
  setupEndpoints: {
    getState: { call: vi.fn() },
  },
}));

vi.mock("@orpc/client", () => ({
  safe: mocks.safe,
}));

vi.mock("@/lib/orpc/typed-errors", () => ({
  getErrorMessage: vi.fn((_err: unknown, fallback: string) => {
    // Simulate real behavior: if error has a message, return it
    const err = _err as { message?: string } | null;
    return err?.message ?? fallback;
  }),
}));

vi.mock("@/components/setup/setup-wizard", () => ({
  SetupWizard: () => <div>Setup Wizard</div>,
}));

vi.mock("./_component/ErrorScreen", () => ({
  ErrorScreen: ({ message }: { message: string }) => <div>{message}</div>,
}));

import SetupPage from "./page";
const SetupPageLoose = SetupPage as unknown as React.ComponentType<{
  params?: Record<string, never>;
  searchParams: { redirectTo?: string; callbackUrl?: string; meshSetupReturn?: string; meshServer?: string };
}>;

describe("Setup page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("redirects to signin when setup is already completed", async () => {
    mocks.safe.mockResolvedValue([
      null, // error
      { needsSetup: false, state: "completed", strategy: "local", currentStep: null, progressPercent: 100, steps: [], completedAt: new Date() },
      true, // isDefined
    ]);

    render(<SetupPageLoose params={{}} searchParams={{ redirectTo: "/dashboard/services" }} />);

    await waitFor(() => {
      expect(mocks.redirect).toHaveBeenCalled();
    });
  });

  it("shows setup wizard when setup is needed", async () => {
    mocks.safe.mockResolvedValue([
      null,
      {
        needsSetup: true,
        state: "not_started",
        strategy: null,
        currentStep: "choose_strategy",
        progressPercent: 0,
        steps: [{ id: "choose_strategy", title: "Choose bootstrap strategy", status: "pending" }],
        completedAt: null,
      },
      true,
    ]);

    render(<SetupPageLoose params={{}} searchParams={{}} />);

    await waitFor(() => {
      expect(screen.getByText("Setup Wizard")).toBeInTheDocument();
    });
  });

  it("shows error screen on failure", async () => {
    mocks.safe.mockResolvedValue([
      { code: "INTERNAL_SERVER_ERROR", message: "Connection failed" },
      undefined,
      true,
    ]);

    render(<SetupPageLoose params={{}} searchParams={{}} />);

    await waitFor(() => {
      expect(screen.getByText("Connection failed")).toBeInTheDocument();
    });
  });
});
