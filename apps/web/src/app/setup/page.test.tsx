import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  replace: vi.fn(),
  useSetupState: vi.fn(),
  useInitializeSetup: vi.fn(),
  useProbeDatabase: vi.fn(),
  useProbeMesh: vi.fn(),
  useRemoteAuth: vi.fn(),
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
  useRouter: () => ({
    replace: mocks.replace,
    push: vi.fn(),
    prefetch: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
  }),
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
      Route: (component: (props: { searchParams: Promise<{ redirectTo?: string; callbackUrl?: string; meshSetupReturn?: string; meshServer?: string }> }) => React.ReactElement) =>
        component,
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

vi.mock("@/domains/setup/hooks", () => ({
  useSetupState: mocks.useSetupState,
  useInitializeSetup: mocks.useInitializeSetup,
  useProbeDatabase: mocks.useProbeDatabase,
  useProbeMesh: mocks.useProbeMesh,
  useRemoteAuth: mocks.useRemoteAuth,
}));

vi.mock("@/components/setup/setup-wizard", () => ({
  SetupWizard: () => <div>Setup Wizard</div>,
}));

import SetupPage from "./page";
const SetupPageLoose = SetupPage as unknown as React.ComponentType<{
  params?: Record<string, never>;
  searchParams: { redirectTo?: string; callbackUrl?: string; meshSetupReturn?: string; meshServer?: string };
}>;

describe("Setup page", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mocks.useInitializeSetup.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
      isSuccess: false,
      isError: false,
      error: null,
      reset: vi.fn(),
    });
    mocks.useProbeDatabase.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
      data: undefined,
    });
    mocks.useProbeMesh.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
      data: undefined,
    });
    mocks.useRemoteAuth.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
      data: undefined,
    });
  });

  it("redirects to signin when setup is already completed", async () => {
    mocks.useSetupState.mockReturnValue({
      isLoading: false,
      data: {
        needsSetup: false,
        state: "completed",
        strategy: "local",
        currentStep: null,
        progressPercent: 100,
        steps: [],
        completedAt: new Date(),
      },
    });

    render(<SetupPageLoose params={{}} searchParams={{ redirectTo: "/dashboard/services" }} />);

    await waitFor(() => {
      expect(mocks.replace).toHaveBeenCalledWith("/auth/signin?redirectTo=%2Fdashboard%2Fservices");
    });
  });

  it("shows setup wizard when setup is needed", () => {
    mocks.useSetupState.mockReturnValue({
      isLoading: false,
      data: {
        needsSetup: true,
        state: "not_started",
        strategy: null,
        currentStep: "choose_strategy",
        progressPercent: 0,
        steps: [{ id: "choose_strategy", title: "Choose bootstrap strategy", status: "pending" }],
        completedAt: null,
      },
    });

    render(<SetupPageLoose params={{}} searchParams={{}} />);

    expect(screen.getByText("Setup Wizard")).toBeInTheDocument();
  });

  it("shows loading while fetching state", () => {
    mocks.useSetupState.mockReturnValue({
      isLoading: true,
      data: undefined,
    });

    render(<SetupPageLoose params={{}} searchParams={{}} />);

    expect(screen.getByText("spinner")).toBeInTheDocument();
  });
});
