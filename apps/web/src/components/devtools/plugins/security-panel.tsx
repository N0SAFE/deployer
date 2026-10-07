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
import { Separator } from "@repo/ui/components/shadcn/separator";

/**
 * DevTools panel: account security.
 *
 * Two factors, in one panel because they answer the same question ("how is this
 * account protected?") and are configured together:
 *
 * - **Passkeys** — WebAuthn credentials registered on this account. Doubles as
 *   the proof-of-physical-presence factor Agent Auth requires for mutating
 *   capabilities, so an empty list here means agent writes will fail with
 *   `WEBAUTHN_NOT_ENROLLED`.
 * - **Two-factor** — TOTP enrolment state and remaining backup codes.
 *
 * ## Why the passkey list uses a store subscription
 *
 * better-auth does not expose passkeys as a REST list endpoint. The passkey
 * plugin publishes them through a reactive atom (`listPasskeys`), which it
 * refreshes itself when a credential is added, deleted or the user signs out
 * (`atomListeners`). Subscribing to that atom is the supported path and gets
 * the invalidation for free — polling a made-up endpoint would not exist.
 */

interface Passkey {
  id: string;
  name?: string | null;
  createdAt: Date | string;
  deviceType?: string;
  backedUp?: boolean;
}

function relativeTime(value: Date | string | null | undefined): string {
  if (!value) return "—";
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) return "—";

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

// ---------------------------------------------------------------------------
// Passkeys
// ---------------------------------------------------------------------------

/**
 * Read the account's passkeys.
 *
 * There is no client method for this. The passkey plugin declares
 * `listPasskeys` on the SERVER api (`/passkey/list-user-passkeys`) but exposes
 * it to browsers only as a reactive atom, and that atom is created by
 * `$store.atoms()` — which is a function that issues a fetch itself, so calling
 * it from an effect both fires an unstoppable request and cannot be awaited
 * cleanly.
 *
 * Going through `$fetch` speaks to the documented endpoint directly. It is the
 * same request the atom makes, with none of the framework indirection.
 */
function usePasskeys() {
  const [passkeys, setPasskeys] = useState<Passkey[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await authClient.$fetch<Passkey[]>("/passkey/list-user-passkeys", {
        method: "GET",
      });

      if (result.error) {
        setError(result.error.message ?? "Failed to list passkeys");
        return;
      }
      const data = result.data;
      setPasskeys(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to list passkeys");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return { passkeys, error, loading, reload: load };
}

function PasskeysSection() {
  const { passkeys, error, loading, reload } = usePasskeys();
  const [deleting, setDeleting] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const handleDelete = async (id: string) => {
    setDeleting(id);
    try {
      await authClient.passkey.deletePasskey({ id });
      await reload();
    } finally {
      setDeleting(null);
    }
  };

  const handleAdd = async () => {
    setAdding(true);
    try {
      await authClient.passkey.addPasskey();
      await reload();
    } finally {
      setAdding(false);
    }
  };

  if (loading && passkeys === null) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Failed to load passkeys</AlertTitle>
        <AlertDescription className="flex flex-col gap-2">
          <span>{error}</span>
          <Button size="sm" variant="outline" className="self-start" onClick={() => void reload()}>
            Retry
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  const list = passkeys ?? [];

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold">
          Passkeys <span className="text-muted-foreground font-normal">({list.length})</span>
        </h4>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => void reload()} disabled={loading}>
            {loading ? "Refreshing…" : "Refresh"}
          </Button>
          <Button size="sm" onClick={() => void handleAdd()} disabled={adding}>
            {adding ? "Waiting…" : "Add passkey"}
          </Button>
        </div>
      </div>

      {list.length === 0 ? (
        <Alert>
          <AlertTitle>No passkeys registered</AlertTitle>
          <AlertDescription className="text-xs">
            Agent Auth requires WebAuthn for mutating capabilities. Without a passkey,
            agent write requests fail with <code>WEBAUTHN_NOT_ENROLLED</code>.
          </AlertDescription>
        </Alert>
      ) : (
        <div className="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Backed up</TableHead>
                <TableHead>Added</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.map((pk) => (
                <TableRow key={pk.id}>
                  <TableCell className="font-medium">{pk.name ?? "Unnamed"}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{pk.deviceType ?? "unknown"}</Badge>
                  </TableCell>
                  <TableCell>
                    {pk.backedUp ? (
                      <Badge variant="secondary">synced</Badge>
                    ) : (
                      <span className="text-muted-foreground text-xs">device-only</span>
                    )}
                  </TableCell>
                  <TableCell className="text-xs">{relativeTime(pk.createdAt)}</TableCell>
                  <TableCell>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={deleting === pk.id}
                      onClick={() => void handleDelete(pk.id)}
                    >
                      {deleting === pk.id ? "Deleting…" : "Delete"}
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

// ---------------------------------------------------------------------------
// Two-factor
// ---------------------------------------------------------------------------

function TwoFactorSection() {
  const { data: session } = authClient.useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);

  // `twoFactorEnabled` is an additional field on the user, added by the plugin.
  const enabled = Boolean(
    (session?.user as { twoFactorEnabled?: boolean } | undefined)?.twoFactorEnabled,
  );

  const handleEnable = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await authClient.twoFactor.enable({ password: "" });
      if (result.error) {
        setError(result.error.message ?? "Failed to enable two-factor");
        return;
      }
      // The plugin returns TOTP URI + backup codes on enable; surface the codes
      // once, since they are not retrievable afterwards by design.
      const codes = (result.data as { backupCodes?: string[] } | undefined)?.backupCodes;
      if (codes?.length) setBackupCodes(codes);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to enable two-factor");
    } finally {
      setBusy(false);
    }
  };

  const handleDisable = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await authClient.twoFactor.disable({});
      if (result.error) {
        setError(result.error.message ?? "Failed to disable two-factor");
        return;
      }
      setBackupCodes(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to disable two-factor");
    } finally {
      setBusy(false);
    }
  };

  const handleRegenerate = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await authClient.twoFactor.generateBackupCodes({});
      if (result.error) {
        setError(result.error.message ?? "Failed to generate backup codes");
        return;
      }
      const codes = (result.data as { backupCodes?: string[] } | undefined)?.backupCodes;
      setBackupCodes(codes ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate backup codes");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold">Two-factor (TOTP)</h4>
        {enabled ? (
          <Badge variant="default">enabled</Badge>
        ) : (
          <Badge variant="secondary">disabled</Badge>
        )}
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertTitle>Request failed</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="flex items-center gap-2">
        {enabled ? (
          <>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void handleRegenerate()}>
              {busy ? "Working…" : "Regenerate backup codes"}
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => void handleDisable()}>
              Disable
            </Button>
          </>
        ) : (
          <Button size="sm" disabled={busy} onClick={() => void handleEnable()}>
            {busy ? "Working…" : "Enable two-factor"}
          </Button>
        )}
      </div>

      {backupCodes && backupCodes.length > 0 && (
        <Alert>
          <AlertTitle>Backup codes — copy them now</AlertTitle>
          <AlertDescription className="text-xs">
            These are shown once. Each code works a single time.
            <div className="mt-2 grid grid-cols-2 gap-1 font-mono">
              {backupCodes.map((code) => (
                <span key={code}>{code}</span>
              ))}
            </div>
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

export function SecurityPanel() {
  return (
    <div className="flex h-full flex-col gap-4 overflow-auto p-4">
      <PasskeysSection />
      <Separator />
      <TwoFactorSection />
    </div>
  );
}

export default SecurityPanel;
