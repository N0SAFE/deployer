import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { ContractRouterClient } from "@orpc/contract";
import type { AppContract } from "./contract";
import { withObservableChain } from "./observable-chain";

function resolveRpcUrl(): string {
  if (typeof window !== "undefined") {
    return new URL("/api/rpc", window.location.origin).toString();
  }

  const configuredBaseUrl = process.env.NEXT_PUBLIC_APP_URL;
  const fallbackBaseUrl = "http://localhost:3210";

  if (!configuredBaseUrl) {
    return new URL("/api/rpc", fallbackBaseUrl).toString();
  }

  const normalizedBaseUrl = configuredBaseUrl.startsWith("http")
    ? configuredBaseUrl
    : `https://${configuredBaseUrl}`;

  return new URL("/api/rpc", normalizedBaseUrl).toString();
}

const link = new RPCLink({
  url: resolveRpcUrl(),
  fetch(request, init) {
    return fetch(request, {
      ...init,
      cache: "no-store",
    });
  },
});

const baseClient = createORPCClient<ContractRouterClient<AppContract>>(link);

export const orpc = withObservableChain(baseClient);
