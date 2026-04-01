import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  replace: vi.fn(),
  useSetupStatus: vi.fn(),
  useSetupStateMachine: vi.fn(),
  useInitializeSetup: vi.fn(),
  useConnectMeshPeer: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("@/domains/mesh/hooks", () => ({
  useConnectMeshPeer: mocks.useConnectMeshPeer,
}));

vi.mock("@/domains/mesh/connect-flow", () => ({
  buildMeshEndpointUrl: vi.fn(() => "wss://remote.example/mesh"),
  buildRemoteSignInUrl: vi.fn(() => "http://remote.example/auth/signin"),
  detectRemoteServer: vi.fn(),
  fetchRemoteAuthSession: vi.fn(),
  normalizeServerHttpUrl: vi.fn((value: string) => value),
}));

vi.mock("@repo/ui/components/shadcn/card", () => ({
  Card: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CardHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CardTitle: ({ children }: { children: React.ReactNode }) => <h1>{children}</h1>,
  CardDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  CardContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
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

vi.mock("@repo/ui/components/shadcn/form", () => ({
  Form: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  FormControl: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  FormItem: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  FormLabel: ({ children }: { children: React.ReactNode }) => <label>{children}</label>,
  FormMessage: () => null,
  FormField: ({
    render,
    name,
  }: {
    render: (arg: {
      field: {
        name: string;
        value: string;
        onChange: () => void;
        onBlur: () => void;
        ref: () => void;
      };
    }) => React.ReactNode;
    name: string;
  }) =>
    render({
      field: {
        name,
        value: "",
        onChange: vi.fn(),
        onBlur: vi.fn(),
        ref: vi.fn(),
      },
    }),
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
  useSetupStatus: mocks.useSetupStatus,
  useSetupStateMachine: mocks.useSetupStateMachine,
  useInitializeSetup: mocks.useInitializeSetup,
}));

import SetupPage from "./page";
const SetupPageLoose = SetupPage as unknown as React.ComponentType<{
  params?: Record<string, never>;
  searchParams: { redirectTo?: string; callbackUrl?: string; meshSetupReturn?: string; meshServer?: string };
}>;

describe("Setup page", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mocks.useSetupStateMachine.mockReturnValue({ data: { transitions: [] } });
    mocks.useInitializeSetup.mockReturnValue({ mutateAsync: vi.fn(), isPending: false });
    mocks.useConnectMeshPeer.mockReturnValue({ mutateAsync: vi.fn(), isPending: false });
  });

  it("redirects to signin with redirectTo when setup is already completed", async () => {
    mocks.useSetupStatus.mockReturnValue({
      isLoading: false,
      data: {
        needsSetup: false,
        state: "completed",
        progressPercent: 100,
        steps: [],
      },
    });

    render(<SetupPageLoose params={{}} searchParams={{ redirectTo: "/dashboard/services" }} />);

    await waitFor(() => {
      expect(mocks.replace).toHaveBeenCalledWith("/auth/signin?redirectTo=%2Fdashboard%2Fservices");
    });
  });

  it("renders setup form when setup is required", () => {
    mocks.useSetupStatus.mockReturnValue({
      isLoading: false,
      data: {
        needsSetup: true,
        state: "awaiting_initial_admin",
        progressPercent: 20,
        steps: [
          {
            id: "create_initial_user",
            title: "Create initial admin user",
            status: "pending",
          },
        ],
      },
    });

    render(<SetupPageLoose params={{}} searchParams={{}} />);

    expect(screen.getByText("Create first administrator")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create administrator" })).toBeInTheDocument();
    expect(mocks.replace).not.toHaveBeenCalled();
  });
});
