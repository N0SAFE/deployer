import React, { useEffect, useState } from "react";
import type { ManagedWebState } from "@repo/api-contracts";
import type { PageProps } from "@nestjs-ssr/react";
import { useForm } from "@tanstack/react-form";
import { toast } from "sonner";
import { Activity, Cable, Globe, Loader2, Plug, Power, RefreshCw, ShieldAlert, Trash2 } from "lucide-react";
import { Badge } from "@repo/ui/components/shadcn/badge";
import { Button } from "@repo/ui/components/shadcn/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@repo/ui/components/shadcn/card";
import { Input } from "@repo/ui/components/shadcn/input";
import { Label } from "@repo/ui/components/shadcn/label";
import { Separator } from "@repo/ui/components/shadcn/separator";
import { Skeleton } from "@repo/ui/components/shadcn/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@repo/ui/components/shadcn/alert";
import { getErrorMessage } from "../lib/errors";
import {
  useDisableManagedWebTunnel,
  useEnableManagedWebTunnel,
  useManagedWebState,
  useRestartManagedWeb,
  useSetManagedWebOrigin,
  useToggleManagedWeb,
} from "../lib/managed-web-hooks";

export type ManagedWebAppViewProps = {
  /** SSR-seeded state (the @Render controller fetches it server-side). */
  state: ManagedWebState;
};

type LedTone = "green" | "amber" | "red" | "gray";

/** Front-panel LED — same design language as the web app console. */
function Led({ tone, className }: { tone: LedTone; className?: string }) {
  const color =
    tone === "green" ? "#22c55e" : tone === "amber" ? "#f59e0b" : tone === "red" ? "#ef4444" : "#64748b";
  return (
    <span
      className={`inline-block size-2.5 shrink-0 rounded-full ${className ?? ""}`}
      style={{
        backgroundColor: color,
        boxShadow: `0 0 6px 1px ${tone === "gray" ? "transparent" : color}66`,
        animation: tone === "amber" ? "pulse 1.4s ease-in-out infinite" : undefined,
      }}
    />
  );
}

function StatusRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <span className="text-xs uppercase tracking-wider text-muted-foreground">{label}</span>
      <div className="flex items-center gap-2 text-sm">{children}</div>
    </div>
  );
}

/** Patch-panel row: mode tag + mono address (one public reach point of the web). */
function PatchRow({
  mode,
  address,
  chip,
  tone = "gray",
}: {
  mode: "PLATFORM" | "CUSTOM" | "TUNNEL";
  address: string;
  chip?: string;
  tone?: LedTone;
}) {
  const modeColor =
    mode === "PLATFORM"
      ? "border-sky-500/30 bg-sky-500/10 text-sky-300"
      : mode === "CUSTOM"
        ? "border-violet-500/30 bg-violet-500/10 text-violet-300"
        : "border-amber-500/30 bg-amber-500/10 text-amber-300";
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border/60 bg-card/60 px-3 py-2.5">
      <Led tone={tone} />
      <Badge variant="outline" className={`font-mono text-[10px] tracking-wider ${modeColor}`}>
        {mode}
      </Badge>
      <code className="min-w-0 flex-1 truncate font-mono text-sm">{address}</code>
      {chip !== undefined ? <span className="text-xs text-muted-foreground">{chip}</span> : null}
    </div>
  );
}

/**
 * Managed Web App console — the API-served fallback visual of the single
 * `/manage/web-app` URL, now fully dynamic: the page SSR-renders the initial
 * state (props), then React Query drives live ORPC calls; every action is a
 * typed mutation (no HTTP form POSTs / redirects).
 */
export default function ManagedWebAppView({ state: ssrState }: PageProps<ManagedWebAppViewProps>) {
  const { data, isLoading, isError, error, refetch } = useManagedWebState(ssrState);
  const toggle = useToggleManagedWeb();
  const restart = useRestartManagedWeb();
  const setOrigin = useSetManagedWebOrigin();
  const enableTunnel = useEnableManagedWebTunnel();
  const disableTunnel = useDisableManagedWebTunnel();

  const [confirmRemoveTunnel, setConfirmRemoveTunnel] = useState(false);

  const state = data ?? ssrState;
  const enabled = state?.enabled ?? false;
  const busy =
    toggle.isPending ||
    restart.isPending ||
    setOrigin.isPending ||
    enableTunnel.isPending ||
    disableTunnel.isPending;

  const ledTone: LedTone =
    state === undefined
      ? "gray"
      : state.external
        ? "gray"
        : !enabled
          ? "red"
          : state.supervisorState === "converging"
            ? "amber"
            : state.healthy === false
              ? "red"
              : "green";

  async function run<T>(fn: () => Promise<T>, success: string) {
    try {
      await fn();
      toast.success(success);
    } catch (e) {
      toast.error(getErrorMessage(e));
    }
  }

  // ── Origin form (TanStack Form — mirrors the web app's own console) ──────
  const originForm = useForm({
    defaultValues: { origin: state?.customOrigin ?? "" },
    onSubmit: async ({ value }) => {
      await run(
        () => setOrigin.mutateAsync({ origin: value.origin.trim() === "" ? null : value.origin.trim() }),
        "Origin updated",
      );
    },
  });

  // ── Tunnel hostname form ─────────────────────────────────────────────────
  const tunnelForm = useForm({
    defaultValues: { hostname: "" },
    onSubmit: async ({ value }) => {
      await run(
        () => enableTunnel.mutateAsync({ hostname: value.hostname.trim() }),
        "Tunnel provisioned — app restarted with the new origin",
      );
      tunnelForm.reset({ hostname: "" });
    },
  });
  // Keep forms in sync with server state after mutations/refetch.
  useEffect(() => {
    originForm.reset({ origin: state?.customOrigin ?? "" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.customOrigin]);

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 pb-10">
      {/* Eyebrow + title */}
      <div>
        <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-muted-foreground">
          Deployer · Platform Console
        </p>
        <div className="mt-2 flex items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">Managed Web App</h1>
          {state !== undefined && (
            <Badge
              variant="outline"
              className={
                enabled
                  ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                  : "border-red-500/40 bg-red-500/10 text-red-300"
              }
            >
              <Led tone={ledTone} />
              <span className="ml-1.5">{enabled ? "Enabled" : "Disabled"}</span>
            </Badge>
          )}
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Served by the API — this same URL shows the web app&apos;s own page while it runs and this
          fallback when it stops.
        </p>
      </div>

      {isLoading && (
        <div className="flex flex-col gap-4">
          <Skeleton className="h-36 w-full" />
          <Skeleton className="h-44 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      )}

      {isError && (
        <Alert variant="destructive">
          <ShieldAlert className="h-4 w-4" />
          <AlertTitle>Console unreachable</AlertTitle>
          <AlertDescription>
            {getErrorMessage(error)}
            <Button variant="outline" size="sm" className="ml-3" onClick={() => refetch()}>
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {state === undefined ? null : (
        <>
          {/* Status panel */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm">
                <Activity className="size-4 text-muted-foreground" /> Runtime status
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-1">
              <StatusRow label="Reconciler">
                <Led tone={ledTone} />
                <span className="font-mono">{state.supervisorState ?? "not registered"}</span>
              </StatusRow>
              <StatusRow label="Health">
                {state.healthy === null ? (
                  <span className="text-muted-foreground">supervisor not registered</span>
                ) : state.healthy ? (
                  <span className="text-emerald-300">healthy</span>
                ) : (
                  <span className="text-red-300">{state.detail ?? "unhealthy"}</span>
                )}
              </StatusRow>
              <StatusRow label="External mode">
                <code className="font-mono text-muted-foreground">{String(state.external)}</code>
              </StatusRow>
            </CardContent>
          </Card>

          {/* Public surface — the patch panel */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm">
                <Cable className="size-4 text-muted-foreground" /> Public surface
              </CardTitle>
              <CardDescription className="text-xs">
                Every reach point enters the platform Traefik, which routes it to this web container.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-2 pt-1">
              <PatchRow mode="PLATFORM" address={state.webHostname} tone="green" />
              {state.customOrigin !== null && (
                <PatchRow mode="CUSTOM" address={state.customOrigin} chip="custom origin" />
              )}
              {state.tunnel !== null && (
                <PatchRow
                  mode="TUNNEL"
                  address={state.tunnel.hostname}
                  tone="green"
                  chip={`tunnel ${state.tunnel.tunnelId.slice(0, 8)}…`}
                />
              )}
            </CardContent>

            <Separator />

            <CardContent className="flex flex-col gap-3 pt-4">
              {/* Custom origin — TanStack Form */}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  void originForm.handleSubmit();
                }}
              >
                <Label htmlFor="web-origin" className="text-xs text-muted-foreground">
                  Custom origin (domain / IP)
                </Label>
                <div className="mt-1.5 flex gap-2">
                  <originForm.Field name="origin">
                    {(field) => (
                      <Input
                        id="web-origin"
                        placeholder="web.example.com"
                        className="font-mono"
                        value={field.state.value}
                        onBlur={field.handleBlur}
                        onChange={(e) => field.handleChange(e.target.value)}
                      />
                    )}
                  </originForm.Field>
                  <Button type="submit" variant="default" disabled={busy}>
                    {setOrigin.isPending ? <Loader2 className="size-4 animate-spin" /> : <Globe className="size-4" />}
                    <span className="ml-1.5">Save</span>
                  </Button>
                  {state.customOrigin !== null && (
                    <Button
                      type="button"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => run(() => setOrigin.mutateAsync({ origin: null }), "Origin cleared")}
                    >
                      Clear
                    </Button>
                  )}
                </div>
              </form>

              {/* Dedicated tunnel */}
              <div>
                <Label htmlFor="web-tunnel" className="text-xs text-muted-foreground">
                  Dedicated tunnel
                </Label>
                {state.tunnel === null ? (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      void tunnelForm.handleSubmit();
                    }}
                  >
                    <div className="mt-1.5 flex gap-2">
                      <tunnelForm.Field name="hostname">
                        {(field) => (
                          <Input
                            id="web-tunnel"
                            placeholder="web.sebille.net"
                            className="font-mono"
                            value={field.state.value}
                            onBlur={field.handleBlur}
                            onChange={(e) => field.handleChange(e.target.value)}
                          />
                        )}
                      </tunnelForm.Field>
                      <tunnelForm.Subscribe selector={(s) => s.values.hostname.trim() !== ""}>
                        {(canSubmit) => (
                          <Button type="submit" variant="outline" disabled={busy || !canSubmit}>
                            {enableTunnel.isPending ? (
                              <Loader2 className="size-4 animate-spin" />
                            ) : (
                              <Plug className="size-4" />
                            )}
                            <span className="ml-1.5">Provision</span>
                          </Button>
                        )}
                      </tunnelForm.Subscribe>
                    </div>
                  </form>
                ) : (
                  <div className="mt-1.5 flex items-center gap-2">
                    <code className="flex-1 truncate rounded-md border border-border/60 bg-card/60 px-3 py-2 font-mono text-sm">
                      {state.tunnel.hostname}
                    </code>
                    <Button
                      variant={confirmRemoveTunnel ? "destructive" : "outline"}
                      disabled={busy}
                      onClick={() => {
                        if (!confirmRemoveTunnel) {
                          setConfirmRemoveTunnel(true);
                          setTimeout(() => setConfirmRemoveTunnel(false), 3000);
                          return;
                        }
                        setConfirmRemoveTunnel(false);
                        run(() => disableTunnel.mutateAsync({}), "Tunnel removed — app restarted");
                      }}
                    >
                      {disableTunnel.isPending ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <Trash2 className="size-4" />
                      )}
                      <span className="ml-1.5">{confirmRemoveTunnel ? "Click again to confirm" : "Remove tunnel"}</span>
                    </Button>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Controls */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm">
                <Power className="size-4 text-muted-foreground" /> Controls
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap items-center gap-2 pt-1">
              <Button
                variant={enabled ? "destructive" : "default"}
                disabled={busy || state.external}
                onClick={() =>
                  run(
                    () => toggle.mutateAsync({}),
                    enabled ? "Managed web app disabled" : "Managed web app enabled",
                  )
                }
              >
                {toggle.isPending ? <Loader2 className="size-4 animate-spin" /> : <Power className="size-4" />}
                <span className="ml-1.5">{enabled ? "Disable managed web app" : "Enable managed web app"}</span>
              </Button>
              <Button
                variant="outline"
                disabled={busy || state.external}
                onClick={() => run(() => restart.mutateAsync({}), "Restart requested")}
              >
                {restart.isPending ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
                <span className="ml-1.5">Force restart container</span>
              </Button>
              {state.external && (
                <span className="text-xs text-amber-300">External mode — lifecycle belongs to the compose stack.</span>
              )}
            </CardContent>
          </Card>

          <p className="text-xs text-muted-foreground">
            The node&apos;s global address (Network &amp; Reachability) serves the API via Traefik — this
            console is the web app&apos;s own surface.
          </p>
        </>
      )}
    </main>
  );
}