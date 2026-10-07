"use client";

import { useCallback, useEffect, useState } from "react";
import { authClient } from "@/lib/auth";
import { Badge } from "@repo/ui/components/shadcn/badge";
import { Button } from "@repo/ui/components/shadcn/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@repo/ui/components/shadcn/table";
import { Skeleton } from "@repo/ui/components/shadcn/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@repo/ui/components/shadcn/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/components/shadcn/select";

/**
 * DevTools panel: API keys.
 *
 * Surfaces the data the API Key plugin owns — keys, their status, expiry, last
 * use and remaining quota — and lets a developer revoke one without leaving the
 * app. Before this panel the plugin worked but nothing displayed it, so a stale
 * dev key or a leaked CI key was invisible.
 *
 * ## Why plain state rather than TanStack Query
 *
 * `authClient.apiKey.*` are framework-agnostic Better Auth client methods, not
 * ORPC contracts, so there are no `queryOptions()` helpers to hand to
 * `useQuery`. A small effect + refetch is the honest shape here; wrapping them
 * in a synthetic query key would add a cache layer nothing else shares.
 *
 * The raw key is never rendered: the API returns it exactly once, at creation,
 * and this panel reads the list afterwards — which carries only the `start`
 * preview.
 */

interface ApiKeyRow {
  id: string;
  name: string | null;
  start: string | null;
  enabled: boolean;
  expiresAt: Date | null;
  lastRequest: Date | null;
  remaining: number | null;
  requestCount: number;
}

function relativeTime(value: Date | null): string {
  if (!value) return "never";
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) return "never";

  const diffMs = date.getTime() - Date.now();
  const abs = Math.abs(diffMs);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;

  const fmt = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  if (abs < minute) return fmt.format(Math.round(diffMs / 1000), "second");
  if (abs < hour) return fmt.format(Math.round(diffMs / minute), "minute");
  if (abs < day) return fmt.format(Math.round(diffMs / hour), "hour");
  return fmt.format(Math.round(diffMs / day), "day");
}

function ExpiryCell({ expiresAt }: { expiresAt: Date | null }) {
  if (!expiresAt) return <span className="text-muted-foreground text-xs">never</span>;

  const date = expiresAt instanceof Date ? expiresAt : new Date(String(expiresAt));
  if (Number.isNaN(date.getTime())) {
    return <span className="text-muted-foreground text-xs">never</span>;
  }
  if (date.getTime() <= Date.now()) return <Badge variant="destructive">expired</Badge>;

  return (
    <span className="text-xs" title={date.toISOString()}>
      {relativeTime(date)}
    </span>
  );
}

export function ApiKeysPanel() {
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "disabled">("all");
  const [keys, setKeys] = useState<ApiKeyRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [revoking, setRevoking] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // GET /api-key/list — query params, returns { apiKeys: ApiKey[] }.
      const result = await authClient.apiKey.list({
        query: { limit: 50, offset: 0 },
      });

      if (result.error) {
        setError(result.error.message ?? "Failed to load API keys");
        return;
      }
      setKeys((result.data?.apiKeys ?? []) as ApiKeyRow[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load API keys");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleRevoke = async (keyId: string) => {
    setRevoking(keyId);
    try {
      await authClient.apiKey.delete({ keyId });
      await load();
    } finally {
      setRevoking(null);
    }
  };

  if (loading && keys === null) {
    return (
      <div className="space-y-2 p-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4">
        <Alert variant="destructive">
          <AlertTitle>Failed to load API keys</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      </div>
    );
  }

  const all = keys ?? [];
  const visible = all.filter((k) =>
    statusFilter === "all" ? true : statusFilter === "active" ? k.enabled : !k.enabled,
  );

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm">
          <span className="font-medium">{visible.length}</span>
          <span className="text-muted-foreground"> of {all.length} keys</span>
        </div>
        <div className="flex items-center gap-2">
          <Select
            value={statusFilter}
            onValueChange={(v) => setStatusFilter(v as typeof statusFilter)}
          >
            <SelectTrigger className="h-8 w-[130px]" aria-label="Filter by status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="disabled">Disabled</SelectItem>
            </SelectContent>
          </Select>
          <Button size="sm" variant="outline" onClick={() => void load()} disabled={loading}>
            {loading ? "Refreshing…" : "Refresh"}
          </Button>
        </div>
      </div>

      {visible.length === 0 ? (
        <div className="text-muted-foreground rounded-lg border p-6 text-center text-sm">
          No API keys{statusFilter !== "all" ? " with this status" : ""}.
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Preview</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Expires</TableHead>
                <TableHead>Last used</TableHead>
                <TableHead>Used</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((key) => (
                <TableRow key={key.id}>
                  <TableCell className="font-medium">{key.name ?? "—"}</TableCell>
                  <TableCell className="font-mono text-xs">{key.start ?? "—"}…</TableCell>
                  <TableCell>
                    {key.enabled ? (
                      <Badge variant="default">active</Badge>
                    ) : (
                      <Badge variant="secondary">disabled</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <ExpiryCell expiresAt={key.expiresAt} />
                  </TableCell>
                  <TableCell className="text-xs">{relativeTime(key.lastRequest)}</TableCell>
                  <TableCell className="text-xs">
                    {key.remaining === null
                      ? `${key.requestCount} (uncapped)`
                      : `${key.requestCount} / ${key.requestCount + key.remaining}`}
                  </TableCell>
                  <TableCell>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={!key.enabled || revoking === key.id}
                      onClick={() => void handleRevoke(key.id)}
                    >
                      {revoking === key.id ? "Revoking…" : "Revoke"}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

export default ApiKeysPanel;
