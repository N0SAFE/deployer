"use client";

import { useState } from "react";
import { Badge } from "@repo/ui/components/shadcn/badge";
import { Button } from "@repo/ui/components/shadcn/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@repo/ui/components/shadcn/card";
import { Skeleton } from "@repo/ui/components/shadcn/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@repo/ui/components/shadcn/alert";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@repo/ui/components/shadcn/table";
import {
  AgentConnectionsCard,
  ConnectedAccountsCard,
} from "@/components/account/security-cards";
import {
  describeUserAgent,
  isExpired,
  relativeTime,
  revokeSession,
  useActiveSessions,
} from "@/domains/account/hooks";

/**
 * DevTools panel: connections.
 *
 * The cross-cutting view of "what is wired to this account". The profile and
 * account pages each show part of this in context; here they sit together
 * because these are the relationships that explain a session — which provider
 * created it, which device holds it, which agent can act through it.
 *
 * Deliberately read-mostly: revoking a device is the one mutation, because it
 * is the one thing you want to do the moment you notice a device you do not
 * recognise. Everything else defers to the page that owns the fuller workflow.
 */

/** Devices holding a session, with revoke. */
function SessionsCard() {
  const { data, error, isLoading, reload } = useActiveSessions();
  const sessions = data ?? [];
  const [busy, setBusy] = useState<string | null>(null);

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Devices</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Devices</CardTitle>
        </CardHeader>
        <CardContent>
          <Alert variant="destructive">
            <AlertTitle>Could not load devices</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  const handleRevoke = async (token: string) => {
    setBusy(token);
    try {
      await revokeSession(token);
      await reload();
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Devices</CardTitle>
        <CardDescription>
          {sessions.length} session{sessions.length === 1 ? "" : "s"} can reach this
          account.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {sessions.length === 0 ? (
          <p className="text-muted-foreground text-sm">No sessions reported.</p>
        ) : (
          <div className="overflow-hidden rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Device</TableHead>
                  <TableHead>IP</TableHead>
                  <TableHead>Signed in</TableHead>
                  <TableHead>Expires</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {sessions.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="font-medium">
                      {describeUserAgent(s.userAgent)}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {s.ipAddress ?? "—"}
                    </TableCell>
                    <TableCell className="text-xs">
                      {relativeTime(s.createdAt, "—")}
                    </TableCell>
                    <TableCell className="text-xs">
                      {isExpired(s.expiresAt) ? (
                        <Badge variant="secondary">expired</Badge>
                      ) : (
                        relativeTime(s.expiresAt, "—")
                      )}
                    </TableCell>
                    <TableCell>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy === s.token}
                        aria-label="Revoke this session"
                        onClick={() => void handleRevoke(s.token)}
                      >
                        {busy === s.token ? "Revoking…" : "Revoke"}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function ConnectionsPanel() {
  return (
    <div className="flex h-full flex-col gap-4 overflow-auto p-4">
      <SessionsCard />
      <ConnectedAccountsCard />
      <AgentConnectionsCard />
    </div>
  );
}

export default ConnectionsPanel;
