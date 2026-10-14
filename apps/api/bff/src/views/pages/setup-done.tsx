"use client";

import React from "react";
import { ArrowRight, CheckCircle2, ExternalLink } from "lucide-react";
import { Button } from "@repo/ui/components/shadcn/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@repo/ui/components/shadcn/card";

/**
 * The page `setup.<host>` serves once onboarding is finished.
 *
 * ── WHY IT EXISTS AND WHY IT LIVES IN THE API ───────────────────────────────
 * The setup app RETARGETS the setup hostname to this page as its last act, then
 * exits. Rewriting the router rather than deleting it is what keeps the hostname
 * answerable (plan §9.2): an operator who bookmarked the wizard must see "done"
 * and a way forward, not a Traefik 404.
 *
 * Because the setup process is GONE by the time anyone loads this, the page has
 * to be served by the process that outlives it — the API. That is also why it is
 * static: the only inputs are the destinations, and there is no state left to
 * read (setup wrote everything it was going to write into `node_config`).
 *
 * ── THE TWO BUTTONS, AND WHY THERE ARE EXACTLY TWO ──────────────────────────
 * The plan's decision #4: the primary destination is the managed web app when it
 * is enabled and running, otherwise the API's own console (`/manage/web-app`).
 * Those two cases are decided SERVER-SIDE and passed in, so this component stays
 * a pure renderer and the "which destination" policy lives in one place — the
 * controller — rather than being duplicated in the browser.
 *
 * Both targets already exist in the platform (`dynamic-web.yml` routes the web
 * host and the console path), so neither button introduces a new surface.
 */
export type SetupDoneViewProps = {
  /** Where the primary button goes. */
  primaryHref: string;
  /** Label for the primary button (names the actual destination). */
  primaryLabel: string;
  /** True when the primary target is the managed web app rather than the console. */
  webAppEnabled: boolean;
};

export default function SetupDoneView({
  primaryHref,
  primaryLabel,
  webAppEnabled,
}: SetupDoneViewProps) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6">
      <Card className="w-full max-w-lg">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
            <CheckCircle2 className="h-7 w-7 text-primary" aria-hidden="true" />
          </div>
          <CardTitle className="text-2xl">Setup complete</CardTitle>
          <CardDescription>
            {webAppEnabled
              ? "This node is on the cluster and the dashboard is running."
              : "This node is on the cluster. The dashboard is not enabled — use the console."}
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          {/*
            One primary action. A second equal-weight button would make the
            operator choose between two things that are not equivalent: only one
            of them is the intended destination on this node.
          */}
          <Button asChild className="w-full">
            <a href={primaryHref}>
              {primaryLabel}
              <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
            </a>
          </Button>

          {/*
            The console is always reachable (Traefik routes `/manage/web-app` on
            every platform host), so offering it as a secondary link is a real
            escape hatch — particularly when the web app IS the primary and the
            operator wants the management view instead.
          */}
          {webAppEnabled ? (
            <Button asChild variant="outline" className="w-full">
              <a href="/manage/web-app">
                Open the management console
                <ExternalLink className="ml-2 h-4 w-4" aria-hidden="true" />
              </a>
            </Button>
          ) : null}

          <p className="text-center text-xs text-muted-foreground">
            This page is served by the platform API. The setup app has finished and stopped.
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
