"use client";

/**
 * SwarmConfigPanel — live "Swarm participation" editor on the Cluster page.
 * Reads the participation view (mode/policy/engine state/join tokens) and
 * lets the operator change how THIS node participates, then persists +
 * converges via cluster.setSwarmConfig.
 */

import { useEffect, useState } from "react";
import { Loader2, Save } from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@repo/ui/components/shadcn/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@repo/ui/components/shadcn/card";
import { Badge } from "@repo/ui/components/shadcn/badge";
import { useSetSwarmConfig, useSwarmConfig } from "@/domains/cluster/hooks";
import { clusterEndpoints } from "@/domains/cluster/endpoints";
import {
  SwarmParticipationForm,
  draftToInput,
  participationDraftFromView,
  type SwarmParticipationDraft,
} from "@repo/ui/components/setup/swarm-participation-form";

export function SwarmConfigPanel() {
  const { data: view, isPending, error } = useSwarmConfig()
  const setConfig = useSetSwarmConfig()
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState<SwarmParticipationDraft | null>(null)

  // Re-sync the draft whenever the server view changes (until the user edits).
  useEffect(() => {
    if (view && draft === null) {
      setDraft(participationDraftFromView(view))
    }
  }, [view, draft])

  const dirty = view && draft ? JSON.stringify(participationDraftFromView(view)) !== JSON.stringify(draft) : false

  const save = () => {
    if (!draft) return
    setConfig.mutate(draftToInput(draft), {
      onSuccess: (updated) => {
        setDraft(participationDraftFromView(updated))
        void queryClient.invalidateQueries({ queryKey: clusterEndpoints.swarmConfig.get.queryKey({ input: {} }) })
        void queryClient.invalidateQueries({ queryKey: clusterEndpoints.getSnapshot.queryKey({ input: {} }) })
        toast.success("Swarm participation updated")
      },
      onError: (err) => toast.error(err instanceof Error ? err.message : "Failed to update swarm participation"),
    })
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Badge variant="outline" className="font-mono text-[10px]">SWARM</Badge>
            Participation
          </CardTitle>
          <CardDescription className="text-xs">
            How this node joins the cluster — decide create/join and the master policy here.
          </CardDescription>
        </div>
        {view && (
          <Badge variant={view.engineState === "active" ? "default" : "secondary"}>
            engine: {view.engineState}
          </Badge>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {isPending ? (
          <div className="flex h-32 items-center justify-center text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          </div>
        ) : error ? (
          <p className="text-sm text-destructive">Unable to load swarm configuration — {String(error)}</p>
        ) : view && draft ? (
          <>
            <SwarmParticipationForm
              initial={draft}
              policies={view.policies}
              onChange={setDraft}
              status={{
                setupDone: view.setupDone,
                engineState: view.engineState,
                role: view.role,
                availability: view.availability,
                nodeCount: view.nodeCount,
                managerCount: view.managerCount,
                joinTokens: view.joinTokens,
              }}
            />
            <p className="rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              {view.resolveNote}
            </p>
            <div className="flex items-center justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => view && setDraft(participationDraftFromView(view))}
                disabled={!dirty || setConfig.isPending}
              >
                Reset
              </Button>
              <Button size="sm" onClick={save} disabled={!dirty || setConfig.isPending} className="gap-2">
                {setConfig.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                Apply
              </Button>
            </div>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}