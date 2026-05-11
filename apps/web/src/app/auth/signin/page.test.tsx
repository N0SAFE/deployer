import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  replace: vi.fn(),
  redirectAction: vi.fn(),
  signInEmail: vi.fn(),
  useSetupStatus: vi.fn(),
}));

vi.mock("@repo/ui/components/shadcn/button", () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
}));

vi.mock("@repo/ui/components/shadcn/input", () => ({
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}));

vi.mock("@repo/ui/components/shadcn/card", () => ({
  Card: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CardHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CardTitle: ({ children }: { children: React.ReactNode }) => <h1>{children}</h1>,
  CardDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  CardContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@repo/ui/components/shadcn/alert", () => ({
  Alert: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));


vi.mock("@repo/ui/components/atomics/atoms/Icon", () => ({
  Spinner: () => <span>spinner</span>,
  AlertCircle: () => <span>alert</span>,
}));

vi.mock("@/lib/timing", () => ({
  PageTimingLogger: () => null,
}));

vi.mock("@/actions/redirect", () => ({
  default: mocks.redirectAction,
}));

vi.mock("@/lib/auth", () => ({
  authClient: {
    signIn: {
      email: mocks.signInEmail,
    },
  },
}));

vi.mock("@/domains/setup/hooks", () => ({
  useSetupStatus: mocks.useSetupStatus,
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
      Link: ({ children }: { children: React.ReactNode }) => <a href="/setup">{children}</a>,
    },
  ),
  AuthSignup: Object.assign(
    vi.fn(() => "/auth/signup"),
    {
      Link: ({ children }: { children: React.ReactNode }) => <a href="/auth/signup">{children}</a>,
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
      Route: (component: (props: { searchParams: { redirectTo?: string; callbackUrl?: string } }) => React.ReactElement) =>
        component,
    },
  ),
}));

import SignInPage from "./page";
const SignInPageLoose = SignInPage as unknown as React.ComponentType<{
  params?: Record<string, never>;
  searchParams: { redirectTo?: string; callbackUrl?: string };
}>;

describe("SignIn page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.redirectAction.mockResolvedValue(undefined);
  });

  it("redirects to setup with redirectTo when setup is required", async () => {
    mocks.useSetupStatus.mockReturnValue({
      data: { needsSetup: true },
      isLoading: false,
    });

    render(<SignInPageLoose params={{}} searchParams={{ redirectTo: "/dashboard/services" }} />);

    await waitFor(() => {
      expect(mocks.replace).toHaveBeenCalledWith("/setup?redirectTo=%2Fdashboard%2Fservices");
    });

    expect(screen.getByText("Redirecting to setup...")).toBeInTheDocument();
  });

  it("redirects to redirectTo after successful signin", async () => {
    mocks.useSetupStatus.mockReturnValue({
      data: { needsSetup: false },
      isLoading: false,
    });
    mocks.signInEmail.mockResolvedValue({ data: { user: { id: "u1" } } });

    render(<SignInPageLoose params={{}} searchParams={{ redirectTo: "/dashboard/services" }} />);

    fireEvent.change(screen.getByLabelText(/email address/i), {
      target: { value: "admin@admin.com" },
    });
    fireEvent.change(screen.getByLabelText(/^password$/i), {
      target: { value: "adminadmin" },
    });

    fireEvent.click(screen.getByRole("button", { name: /sign in with email/i }));

    await waitFor(() => {
      expect(mocks.redirectAction).toHaveBeenCalledWith("/dashboard/services");
    });
  });
});
