"use client";

/**
 * ClusterStep — the FOUNDING step of the setup wizard (reached only from
 * "Set up a new instance").
 *
 * The previous step already decided that this node CREATES the cluster, so
 * this step only asks how Swarm should run here: run a Swarm cluster (this
 * node becomes the founding manager) or stay on plain containers. Offering
 * "join an existing cluster" here contradicted the founding decision and was
 * impossible anyway — see `swarmFoundingSelectionSchema`.
 */

import { ArrowLeft, ArrowRight, Sparkles } from "lucide-react";
import { Button } from "@repo/ui/components/shadcn/button";
import { useState } from "react";
import type { SwarmPolicyDocument } from "@repo/contracts-entities";
import {
  SwarmParticipationForm,
  type SwarmParticipationDraft,
} from "@repo/ui/components/setup/swarm-participation-form";

/**
 * Founding policies (copy mirrors the API's policy documents — only the two
 * that are possible for a founder are listed; the API rejects the rest, and
 * "worker" would leave the brand-new cluster with no manager).
 */
const FOUNDING_POLICIES: SwarmPolicyDocument[] = [
  {
    policy: "auto",
    name: "Mixed — manager & worker",
    description:
      "This node is the cluster's manager AND keeps running workloads. Every server pulls its weight: a small cluster (2–3 nodes) gets quorum and capacity without dedicating a server to the control plane.",
    bestFor: "Small clusters (2–3 nodes), single-node",
    role: "manager",
    schedulesWorkloads: true,
    recommended: true,
  },
  {
    policy: "manager",
    name: "Dedicated master",
    description:
      "This node manages the cluster but does NOT run workload tasks (drained). Reserve it for the control plane — this needs more than one manager, so it is only useful once you have added other nodes.",
    bestFor: "Larger clusters with a dedicated controller",
    role: "manager",
    schedulesWorkloads: false,
    recommended: false,
  },
];

type Props = {
  initial: SwarmParticipationDraft;
  onBack?: () => void;
  onContinue: (draft: SwarmParticipationDraft) => void;
};

export function ClusterStep({ initial, onBack, onContinue }: Props) {
  const [draft, setDraft] = useState<SwarmParticipationDraft>(initial);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h2 className="text-2xl font-semibold tracking-tight text-balance">
          Run the cluster on Swarm?
        </h2>
        <p className="text-sm text-muted-foreground leading-relaxed text-pretty">
          This node is the founding node, so it will start the cluster. Swarm lets that cluster span
          several servers later — and every supervised service (Traefik, the database, Redis…) is
          then scheduled through it instead of running as a plain container.
        </p>
      </div>

      <div className="rounded-lg border bg-muted/30 px-4 py-3 text-xs text-muted-foreground flex gap-2 items-start">
        <Sparkles className="h-3.5 w-3.5 mt-0.5 shrink-0" aria-hidden="true" />
        <span>
          Nothing starts now. Swarm is initialized once setup completes, and you can change this
          later from the Cluster page.
        </span>
      </div>

      <SwarmParticipationForm
        initial={draft}
        policies={FOUNDING_POLICIES}
        context="founding"
        onChange={setDraft}
      />

      <div className="flex items-center justify-between">
        {onBack ? (
          <Button type="button" variant="ghost" onClick={onBack} className="gap-2">
            <ArrowLeft className="h-4 w-4" />
            Back
          </Button>
        ) : (
          <span />
        )}
        <Button size="lg" type="button" onClick={() => onContinue(draft)} className="gap-2">
          Continue
          <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
