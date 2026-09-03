"use client";

/** React Query client for the SSR views. One per browser tab; the console
 *  page seeds its query with the server-rendered initial state (props), then
 *  RQ keeps it fresh via ORPC. */

import { QueryClient } from "@tanstack/react-query";

export const viewQueryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});