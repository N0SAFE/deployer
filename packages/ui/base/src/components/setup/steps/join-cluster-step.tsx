"use client";

/**
 * JoinClusterStep — the JOINING step of the setup wizard (reached only from
 * "Join an existing cluster").
 *
 * The mirror of `ClusterStep`: the previous step already decided that this
 * node JOINS an existing cluster, so Swarm mode is implied (`join`) and never
 * asked. Only the ROLE this node takes in the target cluster is chosen —
 * worker (pure capacity), mixed manager, or dedicated manager — plus the
 * cluster's join token, which can also be added later once the node is up.
 *
 * Without this step a joining node kept the env default (`SWARM_MODE=create`)
 * and would have founded a SECOND, unrelated swarm next to the cluster it
 * just joined.
 */

import { ArrowLeft, ArrowRight, Info } from "lucide-react";
import { Button } from "@repo/ui/components/shadcn/button";
import { useState } from "react";
import type { SwarmPolicyDocument } from "@repo/contracts-entities";
import {
  SwarmParticipationForm,
  type SwarmParticipationDraft,
} from "@repo/ui/components/setup/swarm-participation-form";

/** Roles a joining node can take (copy mirrors the API's policy documents). */
const JOINING_POLICIES: SwarmPolicyDocument[] = [
  {
    policy: "worker",
    name: "Worker only",
    description:
      "This node only runs workloads. Control-plane duties stay on the cluster's existing managers — the most common way to add capacity.",
    bestFor: "Adding capacity to a running cluster",
    role: "worker",
    schedulesWorkloads: true,
    recommended: true,
  },
  {
    policy: "auto",
    name: "Mixed — manager & worker",
    description:
      "This node joins as a manager as well, so it shares control-plane duties (redundancy) while still running workloads. Recommended once a cluster has 3+ nodes.",
    bestFor: "Reinforcing a cluster's control plane",
    role: "manager",
    schedulesWorkloads: true,
    recommended: false,
  },
  {
    policy: "manager",
    name: "Dedicated master",
    description:
      "This node joins as a manager that does NOT run workload tasks (drained) — a pure control-plane node for larger clusters.",
    bestFor: "Larger clusters with a dedicated controller",
    role: "manager",
    schedulesWorkloads: false,
    recommended: false,
  },
];

/** Derive the cluster's swarm control-plane address from its mesh URL. */
function controlPlaneFromMeshUrl(meshUrl: string): string {
  const trimmed = meshUrl.trim();
  if (trimmed === "") return "";
  try {
    const host = new URL(trimmed.includes("://") ? trimmed : `http://${trimmed}`).hostname;
    return host === "" ? "" : `${host}:2377`;
  } catch {
    return "";
  }
}

type Props = {
  initial: SwarmParticipationDraft;
  /** The cluster URL entered in the previous step — used to prefill the
   *  control-plane address the swarm join needs. */
  meshUrl: string;
  onBack?: () => void;
  onContinue: (draft: SwarmParticipationDraft) => void;
};

export function JoinClusterStep({ initial, meshUrl, onBack, onContinue }: Props) {
  const suggestedAddress = controlPlaneFromMeshUrl(meshUrl);
  const [draft, setDraft] = useState<SwarmParticipationDraft>({
    ...initial,
    mode: "join",
    joinAddrs: initial.joinAddrs || suggestedAddress,
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h2 className="text-2xl font-semibold tracking-tight text-balance">
          Your role in the cluster
        </h2>
        <p className="text-sm text-muted-foreground leading-relaxed text-pretty">
          This node joins the Swarm cluster that{" "}
          <span className="font-medium text-foreground">{suggestedAddress || "the cluster"}</span>{" "}
          already runs — it never starts a cluster of its own.
        </p>
      </div>

      <div className="rounded-lg border bg-muted/30 px-4 py-3 text-xs text-muted-foreground flex gap-2 items-start">
        <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" aria-hidden="true" />
        <span>
          Node identity, database and mesh credentials are inherited from the cluster during setup.
          Swarm joins after setup completes.
        </span>
      </div>

      <SwarmParticipationForm
        initial={draft}
        policies={JOINING_POLICIES}
        context="joining"
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
