/** Query options shared by the one-shot / streamed container queries: never refetch on their own. */
export const STREAM_QUERY_BASE_OPTIONS = {
  refetchInterval: false,
  refetchOnMount: false,
  refetchOnWindowFocus: false,
  refetchOnReconnect: false,
  staleTime: Infinity,
  retry: false,
} as const
