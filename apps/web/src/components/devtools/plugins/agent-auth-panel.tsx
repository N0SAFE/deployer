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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@repo/ui/components/shadcn/tabs";

/**
 * DevTools panel: Agent Auth.
 *
 * The observability surface for AI agents operating this platform. Three views,
 * because they answer three different questions:
 *
 * - **Agents** — who is connected, in which mode, and are they still live?
 * - **Hosts** — which enrolled machines can vouch for those agents, and with
 *   which capabilities auto-granted?
 * - **Session** — what identity is *this* page's agent request resolving to
 *   right now? (Only meaningful when the page itself is agent-driven; it
 *   reports "no active agent session" for a human browsing normally.)
 *
 * ## Why this panel matters more than the others
 *
 * Agent Auth is the one plugin here that lets a NON-HUMAN actor mutate the
 * platform. Every other panel shows data about the current user; this one shows
 * autonomous actors that outlive the browser tab. Without it, an agent's grants
 * are only visible through SQL — which is exactly the "audit emission not
 * wired" gap the platform audit flagged, and why `onEvent` was pointed at the
 * audit log in `useAgentAuth`.
 *
 * ## Status vocabulary
 *
 * Agents: `active | pending | expired | revoked | rejected | claimed`
 * Hosts:  `active | pending | pending_enrollment | revoked | rejected`
 * Grants: `active | pending | denied | revoked | consumed`
 *
 * `claimed` is the subtle one: an autonomous agent whose identity was taken
 * over by a user. It still exists, but it is no longer acting on its own.
 */

type AgentStatus = "active" | "pending" | "expired" | "revoked" | "rejected" | "claimed";
type HostStatus = "active" | "pending" | "pending_enrollment" | "revoked" | "rejected";

interface AgentRow {
  id: string;
  name: string;
  hostId: string;
  userId: string | null;
  status: AgentStatus;
  mode: "delegated" | "autonomous";
  lastUsedAt: Date | null;
  createdAt: Date;
  expiresAt: Date | null;
}

interface HostRow {
  id: string;
  name: string | null;
  userId: string | null;
  defaultCapabilities: string[];
  status: HostStatus;
  lastUsedAt: Date | null;
  createdAt: Date;
}

const AGENT_STATUS_VARIANT: Record<
  AgentStatus,
  "default" | "secondary" | "destructive" | "outline"
> = {
  active: "default",
  pending: "outline",
  expired: "secondary",
  revoked: "destructive",
  rejected: "destructive",
  claimed: "secondary",
};

const HOST_STATUS_VARIANT: Record<
  HostStatus,
  "default" | "secondary" | "destructive" | "outline"
> = {
  active: "default",
  pending: "outline",
  pending_enrollment: "outline",
  revoked: "destructive",
  rejected: "destructive",
};

function relativeTime(value: Date | null | undefined): string {
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

/** Shared empty/error chrome so the three tabs read consistently. */
function PanelState({
  loading,
  error,
  empty,
  onRetry,
}: {
  loading: boolean;
  error: string | null;
  empty?: string;
  onRetry: () => void;
}) {
  if (loading) {
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
          <AlertTitle>Request failed</AlertTitle>
          <AlertDescription className="flex flex-col gap-2">
            <span>{error}</span>
            <Button size="sm" variant="outline" className="self-start" onClick={onRetry}>
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  if (empty) {
    return (
      <div className="text-muted-foreground rounded-lg border m-4 p-6 text-center text-sm">
        {empty}
      </div>
    );
  }

  return null;
}

// ---------------------------------------------------------------------------
// Agents tab
// ---------------------------------------------------------------------------

function AgentsTab() {
  const [rows, setRows] = useState<AgentRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [revoking, setRevoking] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await authClient.$fetch<{ agents?: AgentRow[] } | AgentRow[]>(
        "/agent/list",
        { method: "GET" },
      );
      if (result.error) {
        setError(result.error.message ?? "Failed to list agents");
        return;
      }
      const data = result.data;
      setRows(Array.isArray(data) ? data : (data?.agents ?? []));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to list agents");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleRevoke = async (agentId: string) => {
    setRevoking(agentId);
    try {
      await authClient.$fetch("/agent/revoke", {
        method: "POST",
        body: { agentId },
      });
      await load();
    } finally {
      setRevoking(null);
    }
  };

  if (loading || error || (rows?.length ?? 0) === 0) {
    return (
      <PanelState
        loading={loading}
        error={error}
        empty={!loading && !error ? "No agents have registered with this platform." : undefined}
        onRetry={() => void load()}
      />
    );
  }

  const agents = rows ?? [];

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <div className="flex items-center justify-between">
        <div className="text-sm">
          <span className="font-medium">{agents.length}</span>
          <span className="text-muted-foreground"> agent(s)</span>
        </div>
        <Button size="sm" variant="outline" onClick={() => void load()} disabled={loading}>
          {loading ? "Refreshing…" : "Refresh"}
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Mode</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Last used</TableHead>
              <TableHead>Expires</TableHead>
              <TableHead>Created</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {agents.map((agent) => (
              <TableRow key={agent.id}>
                <TableCell className="font-medium">
                  {agent.name}
                  <div className="text-muted-foreground font-mono text-[10px]">{agent.id}</div>
                </TableCell>
                <TableCell>
                  <Badge variant="outline">{agent.mode}</Badge>
                </TableCell>
                <TableCell>
                  <Badge variant={AGENT_STATUS_VARIANT[agent.status] ?? "outline"}>
                    {agent.status}
                  </Badge>
                </TableCell>
                <TableCell className="text-xs">{relativeTime(agent.lastUsedAt)}</TableCell>
                <TableCell className="text-xs">{relativeTime(agent.expiresAt)}</TableCell>
                <TableCell className="text-xs" title={String(agent.createdAt)}>
                  {relativeTime(agent.createdAt)}
                </TableCell>
                <TableCell>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={agent.status !== "active" || revoking === agent.id}
                    onClick={() => void handleRevoke(agent.id)}
                    title={
                      agent.status !== "active"
                        ? `Cannot revoke an agent whose status is "${agent.status}"`
                        : "Revoke this agent"
                    }
                  >
                    {revoking === agent.id ? "Revoking…" : "Revoke"}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Hosts tab
// ---------------------------------------------------------------------------

function HostsTab() {
  const [rows, setRows] = useState<HostRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await authClient.$fetch<{ hosts?: HostRow[] } | HostRow[]>(
        "/host/list",
        { method: "GET" },
      );
      if (result.error) {
        setError(result.error.message ?? "Failed to list hosts");
        return;
      }
      const data = result.data;
      setRows(Array.isArray(data) ? data : (data?.hosts ?? []));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to list hosts");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading || error || (rows?.length ?? 0) === 0) {
    return (
      <PanelState
        loading={loading}
        error={error}
        empty={
          !loading && !error
            ? "No hosts are enrolled. A host is a machine that can run agents."
            : undefined
        }
        onRetry={() => void load()}
      />
    );
  }

  const hosts = rows ?? [];

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <div className="flex items-center justify-between">
        <div className="text-sm">
          <span className="font-medium">{hosts.length}</span>
          <span className="text-muted-foreground"> host(s)</span>
        </div>
        <Button size="sm" variant="outline" onClick={() => void load()} disabled={loading}>
          {loading ? "Refreshing…" : "Refresh"}
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Default capabilities</TableHead>
              <TableHead>Last used</TableHead>
              <TableHead>Created</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {hosts.map((host) => (
              <TableRow key={host.id}>
                <TableCell className="font-medium">
                  {host.name ?? "—"}
                  <div className="text-muted-foreground font-mono text-[10px]">{host.id}</div>
                </TableCell>
                <TableCell>
                  <Badge variant={HOST_STATUS_VARIANT[host.status] ?? "outline"}>
                    {host.status}
                  </Badge>
                </TableCell>
                <TableCell>
                  {/* These are the capabilities a newly registered agent on this
                      host inherits without a separate approval. Showing them is
                      the point: they are the standing grant. */}
                  {host.defaultCapabilities.length === 0 ? (
                    <span className="text-muted-foreground text-xs">none</span>
                  ) : (
                    <div className="flex flex-wrap gap-1">
                      {host.defaultCapabilities.slice(0, 6).map((cap) => (
                        <Badge key={cap} variant="outline" className="font-mono text-[10px]">
                          {cap}
                        </Badge>
                      ))}
                      {host.defaultCapabilities.length > 6 && (
                        <Badge variant="secondary" className="text-[10px]">
                          +{host.defaultCapabilities.length - 6}
                        </Badge>
                      )}
                    </div>
                  )}
                </TableCell>
                <TableCell className="text-xs">{relativeTime(host.lastUsedAt)}</TableCell>
                <TableCell className="text-xs" title={String(host.createdAt)}>
                  {relativeTime(host.createdAt)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Session tab
// ---------------------------------------------------------------------------

interface AgentSessionInfo {
  user?: { id: string; name?: string; email?: string };
  agent?: {
    id: string;
    name: string;
    mode: "delegated" | "autonomous";
    hostId?: string;
    capabilityGrants?: { capability: string; status: string }[];
  };
  host?: { id: string; name?: string | null };
}

function SessionTab() {
  const [session, setSession] = useState<AgentSessionInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await authClient.$fetch<AgentSessionInfo>("/agent/session", {
        method: "GET",
      });
      if (result.error) {
        // A 401 here is the NORMAL case for a human browsing the dashboard:
        // there is no agent JWT on the request. Report it as "no session"
        // rather than an error, or the panel looks broken by default.
        setSession(null);
        return;
      }
      setSession(result.data ?? null);
    } catch {
      setSession(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <div className="space-y-2 p-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    );
  }

  if (error) {
    return <PanelState loading={false} error={error} onRetry={() => void load()} />;
  }

  if (!session?.agent) {
    return (
      <div className="p-4">
        <Alert>
          <AlertTitle>No active agent session</AlertTitle>
          <AlertDescription className="text-xs">
            This request carries no agent JWT, so it resolves to you (${" "}
            <span className="font-mono">getSession()</span>), not an agent. That is the
            normal case when a human uses the dashboard.
          </AlertDescription>
        </Alert>
        <div className="mt-3">
          <Button size="sm" variant="outline" onClick={() => void load()}>
            Recheck
          </Button>
        </div>
      </div>
    );
  }

  const grants = session.agent.capabilityGrants ?? [];
  const activeGrants = grants.filter((g) => g.status === "active");

  return (
    <div className="space-y-4 p-4">
      <div className="rounded-lg border p-4">
        <h4 className="mb-2 text-sm font-semibold">Agent</h4>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
          <dt className="text-muted-foreground">Name</dt>
          <dd className="font-medium">{session.agent.name}</dd>
          <dt className="text-muted-foreground">ID</dt>
          <dd className="font-mono">{session.agent.id}</dd>
          <dt className="text-muted-foreground">Mode</dt>
          <dd>
            <Badge variant="outline">{session.agent.mode}</Badge>
          </dd>
          {session.host && (
            <>
              <dt className="text-muted-foreground">Host</dt>
              <dd>
                {session.host.name ?? "—"}{" "}
                <span className="text-muted-foreground font-mono">{session.host.id}</span>
              </dd>
            </>
          )}
        </dl>
      </div>

      <div className="rounded-lg border p-4">
        <h4 className="mb-2 text-sm font-semibold">
          Capability grants{" "}
          <span className="text-muted-foreground font-normal">
            ({activeGrants.length} active of {grants.length})
          </span>
        </h4>
        {grants.length === 0 ? (
          <p className="text-muted-foreground text-xs">
            This agent holds no capability grants — it can authenticate but not act.
          </p>
        ) : (
          <div className="flex flex-wrap gap-1">
            {grants.map((grant) => (
              <Badge
                key={grant.capability}
                variant={grant.status === "active" ? "default" : "secondary"}
                className="font-mono text-[10px]"
                title={`status: ${grant.status}`}
              >
                {grant.capability}
              </Badge>
            ))}
          </div>
        )}
      </div>

      <Button size="sm" variant="outline" onClick={() => void load()}>
        Refresh session
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

export function AgentAuthPanel() {
  return (
    <div className="flex h-full flex-col">
      <Tabs defaultValue="agents" className="flex h-full flex-col">
        <TabsList className="mx-4 mt-4 self-start">
          <TabsTrigger value="agents">Agents</TabsTrigger>
          <TabsTrigger value="hosts">Hosts</TabsTrigger>
          <TabsTrigger value="session">Session</TabsTrigger>
        </TabsList>
        <TabsContent value="agents" className="min-h-0 flex-1">
          <AgentsTab />
        </TabsContent>
        <TabsContent value="hosts" className="min-h-0 flex-1">
          <HostsTab />
        </TabsContent>
        <TabsContent value="session" className="min-h-0 flex-1">
          <SessionTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default AgentAuthPanel;
