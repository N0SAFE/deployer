"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  TanStackDevtools,
  type TanStackDevtoolsReactPlugin,
} from "@tanstack/react-devtools";
import { ReactQueryDevtoolsPanel } from "@tanstack/react-query-devtools";
import type { ReactNode } from "react";
import { useState } from "react";

interface QueryProviderProps {
  children: ReactNode;
}

const REACT_QUERY_PLUGIN: TanStackDevtoolsReactPlugin = {
  id: "react-query",
  name: "React Query",
  render: () => <ReactQueryDevtoolsPanel style={{ height: "100%", width: "100%" }} />,
};

export function QueryProvider({ children }: QueryProviderProps) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 0,
            gcTime: 5 * 60 * 1000,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      {process.env.NODE_ENV !== "production" ? (
        <TanStackDevtools
          plugins={[REACT_QUERY_PLUGIN]}
          config={{
            position: "bottom-right",
            panelLocation: "bottom",
          }}
        />
      ) : null}
    </QueryClientProvider>
  );
}
