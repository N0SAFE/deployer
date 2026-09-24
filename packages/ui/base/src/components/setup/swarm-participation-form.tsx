"use client";

/**
 * SwarmParticipationForm — the shared "how does this node participate in the
 * cluster?" picker, used by BOTH the setup wizard and the dashboard cluster
 * page. It is CONTEXT-AWARE so each surface only offers choices that are
 * coherent there:
 *
 *   - "founding" (setup wizard, "Set up a new instance"): this node CREATES
 *     the cluster, so the only modes are `create` / `disabled`. Offering
 *     "join" here contradicts the previous step ("become the founding node")
 *     and is impossible anyway (there is no cluster to join yet). Policy
 *     `worker` is not offered either — a founder IS the initial manager.
 *   - "joining" (setup wizard, "Join an existing cluster"): mode is IMPLIED by
 *     the join itself, so only the cluster ROLE is chosen (worker / mixed /
 *     dedicated manager) plus the cluster's join token.
 *   - "edit" (cluster page): the full set — the operator can switch modes on a
 *     live node, and is shown the join tokens to invite peers.
 *
 * Pure/controlled: the parent owns the persisted value and the save action.
 */

import { useMemo, useState } from "react";
import { Check, Copy, Network, Sparkles, Waypoints } from "lucide-react";
import { Button } from "@repo/ui/components/shadcn/button";
import { Input } from "@repo/ui/components/shadcn/input";
import { Badge } from "@repo/ui/components/shadcn/badge";
import { cn } from "@repo/ui/lib/utils";
import type {
  SwarmConfigView,
  SwarmParticipationInput,
  SwarmNodePolicy,
  SwarmParticipationMode,
} from "@repo/contracts-entities";

export type SwarmParticipationContext = "founding" | "joining" | "edit";

export type SwarmParticipationDraft = {
  mode: SwarmParticipationMode;
  policy: SwarmNodePolicy;
  advertiseAddr: string;
  joinToken: string;
  joinAddrs: string;
};

export function participationDraftFromView(view: SwarmConfigView): SwarmParticipationDraft {
  const p = view.participation;
  return {
    mode: p.mode,
    policy: p.policy,
    advertiseAddr: p.advertiseAddr ?? "",
    joinToken: p.joinToken ?? "",
    joinAddrs: p.joinAddrs.join(", "),
  };
}

export function draftToInput(draft: SwarmParticipationDraft): SwarmParticipationInput {
  return {
    mode: draft.mode,
    policy: draft.policy,
    advertiseAddr: draft.advertiseAddr.trim() || null,
    joinToken: draft.joinToken.trim() || null,
    joinAddrs: draft.joinAddrs
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  };
}

/**
 * Payload for a FOUNDING node (`swarmFoundingSelectionSchema`): the mode is
 * implied by founding, so only the role policy + optional advertise override
 * are sent (the join fields stay empty — there is no cluster to join).
 */
export function foundingDraftToSelection(draft: SwarmParticipationDraft) {
  return {
    mode: "create" as const,
    policy: draft.policy,
    advertiseAddr: draft.advertiseAddr.trim() || null,
    joinToken: null,
    joinAddrs: [] as string[],
  };
}

/**
 * Payload for a JOINING node (`swarmJoinSelectionSchema`): the mode is implied
 * by joining, so only the role + the cluster's join token are sent.
 */
export function joinDraftToSelection(draft: SwarmParticipationDraft) {
  return {
    policy: draft.policy,
    joinToken: draft.joinToken.trim() || null,
  };
}

/** Modes offered per context, in display order. Swarm is never optional — a
 *  node either founds the cluster or joins one. */
const MODES_BY_CONTEXT: Record<SwarmParticipationContext, SwarmParticipationMode[]> = {
  founding: ["create"],
  joining: ["join"],
  edit: ["create", "join"],
};

/** Policies offered per context. A founder can never be worker-only; a joiner
 *  can take any role in the target cluster. */
const POLICIES_BY_CONTEXT: Record<SwarmParticipationContext, SwarmNodePolicy[]> = {
  founding: ["auto", "manager"],
  joining: ["worker", "auto", "manager"],
  edit: ["auto", "manager", "worker"],
};

/** Which policy is the sensible default/highlight for each context. */
const RECOMMENDED_BY_CONTEXT: Record<SwarmParticipationContext, SwarmNodePolicy> = {
  founding: "auto",
  joining: "worker",
  edit: "auto",
};

const MODE_LABEL: Record<
  SwarmParticipationMode,
  { label: string; hint: string; icon: typeof Sparkles }
> = {
  create: {
    label: "Run a Swarm cluster",
    hint: "This node becomes the founding manager and starts the cluster.",
    icon: Sparkles,
  },
  join: {
    label: "Join a cluster",
    hint: "Wire into an existing swarm with a join token.",
    icon: Network,
  },
};

interface Props {
  /** Initial value (setup: defaults; cluster page: the live view). */
  initial: SwarmParticipationDraft;
  /** Policy documents for the cards (backend-provided copy). */
  policies: SwarmConfigView["policies"];
  /** Which surface this form is rendered on — drives what is offered. */
  context?: SwarmParticipationContext;
  /** Live engine summary shown under the mode picker (optional). */
  status?: {
    setupDone: boolean;
    engineState: string;
    role: string;
    availability: string;
    nodeCount: number;
    managerCount: number;
    joinTokens?: { worker: string; manager: string } | null;
  };
  /** Fires whenever the draft changes (parent keeps its own copy). */
  onChange?: (draft: SwarmParticipationDraft) => void;
}

export function SwarmParticipationForm({
  initial,
  policies,
  context = "edit",
  status,
  onChange,
}: Props) {
  const [draft, setDraft] = useState<SwarmParticipationDraft>(initial);
  const [copied, setCopied] = useState<string | null>(null);

  const update = (patch: Partial<SwarmParticipationDraft>) => {
    const next = { ...draft, ...patch };
    setDraft(next);
    onChange?.(next);
  };

  const copy = async (label: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
      setTimeout(() => setCopied(null), 1200);
    } catch {
      /* clipboard unavailable */
    }
  };

  const modes = MODES_BY_CONTEXT[context];
  const offeredPolicies = POLICIES_BY_CONTEXT[context];
  const recommendedPolicy = RECOMMENDED_BY_CONTEXT[context];
  const visiblePolicies = policies.filter((p) => offeredPolicies.includes(p.policy));
  // A joining node's mode is implied; a one-option picker would be dead UI.
  const showModePicker = modes.length > 1;
  const effectiveMode: SwarmParticipationMode = modes.includes(draft.mode) ? draft.mode : modes[0]!;
  const joinFieldsVisible = effectiveMode === "join";

  const selectedPolicy = visiblePolicies.find((p) => p.policy === draft.policy) ?? null;
  const effectiveRole = useMemo(() => {
    if (draft.policy === "worker") return "worker";
    if (draft.policy === "manager") return "dedicated manager";
    return "manager + worker";
  }, [draft.policy]);

  return (
    <div className="flex flex-col gap-6">
      {/* ── Mode (hidden when implied, e.g. joining) ────────────────────── */}
      {showModePicker && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <Waypoints className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            <h3 className="text-sm font-semibold">
              {context === "founding" ? "Swarm on this node" : "Swarm participation"}
            </h3>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {modes.map((mode) => {
              const opt = MODE_LABEL[mode];
              const Icon = opt.icon;
              const active = effectiveMode === mode;
              return (
                <button
                  key={mode}
                  type="button"
                  onClick={() => update({ mode })}
                  aria-pressed={active}
                  className={cn(
                    "flex flex-col items-start gap-1.5 rounded-lg border p-3 text-left transition-all",
                    active
                      ? "border-primary bg-primary/6 ring-1 ring-primary"
                      : "border-border hover:border-primary/40 hover:bg-muted/40",
                  )}
                >
                  <span className="flex items-center gap-2 text-sm font-medium">
                    <Icon className={cn("h-4 w-4", active ? "text-primary" : "text-muted-foreground")} />
                    {opt.label}
                  </span>
                  <span className="text-xs leading-snug text-muted-foreground">{opt.hint}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {status && (
        <p className="text-xs text-muted-foreground">
          <StatusLine status={status} />
        </p>
      )}

      {/* ── Policy cards ────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">
            {context === "joining" ? "Role in the cluster" : "Node role policy"}
          </h3>
          <Badge variant="secondary">
            {selectedPolicy?.name ?? draft.policy} · {effectiveRole}
          </Badge>
        </div>
          <p className="text-xs text-muted-foreground">
            How this node balances control-plane duties vs running workloads.
          </p>
          <div className="grid gap-2 md:grid-cols-2">
            {visiblePolicies.map((p) => {
              const active = draft.policy === p.policy;
              return (
                <button
                  key={p.policy}
                  type="button"
                  onClick={() => update({ policy: p.policy })}
                  aria-pressed={active}
                  className={cn(
                    "relative flex flex-col gap-2 rounded-lg border p-4 text-left transition-all",
                    active
                      ? "border-primary bg-primary/5 ring-1 ring-primary"
                      : "border-border hover:border-primary/30 hover:bg-muted/40",
                  )}
                >
                  {p.policy === recommendedPolicy && (
                    <Badge className="absolute -top-2 right-3 bg-primary text-primary-foreground text-[10px]">
                      RECOMMENDED
                    </Badge>
                  )}
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium">{p.name}</span>
                    {active && <Check className="h-4 w-4 text-primary" aria-hidden="true" />}
                  </div>
                  <p className="text-xs leading-relaxed text-muted-foreground">{p.description}</p>
                  <span className="mt-auto text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    {p.schedulesWorkloads ? "Runs workloads" : "Control plane only"} · {p.role}
                  </span>
                </button>
              );
            })}
          </div>
      </div>

      {/* ── Join fields ─────────────────────────────────────────────────── */}
      {joinFieldsVisible && (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium">Join token</span>
            <Input
              type="password"
              value={draft.joinToken}
              onChange={(e) => update({ joinToken: e.target.value })}
              placeholder="SWMTKN-1-…"
              autoComplete="off"
            />
            <span className="text-xs text-muted-foreground">
              {context === "joining"
                ? "Issued by a manager of the target cluster. You can also add it later from the Cluster page."
                : "Worker or manager token issued by the controlling node."}
            </span>
          </label>
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium">Control-plane addresses</span>
            <Input
              value={draft.joinAddrs}
              onChange={(e) => update({ joinAddrs: e.target.value })}
              placeholder="10.0.0.1:2377, 10.0.0.2:2377"
            />
            <span className="text-xs text-muted-foreground">Comma-separated host:port list.</span>
          </label>
        </div>
      )}

      {/* ── Advertise override + invite tokens ──────────────────────────── */}
      <div className="grid gap-3 sm:grid-cols-2">
        {effectiveMode === "create" && (
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium">Advertise address (optional)</span>
            <Input
              value={draft.advertiseAddr}
              onChange={(e) => update({ advertiseAddr: e.target.value })}
              placeholder="10.0.0.5:2377 or empty for loopback"
            />
            <span className="text-xs text-muted-foreground">
              Overrides the engine&apos;s auto-advertise (fixes the multi-IP error).
            </span>
          </label>
        )}
        {status?.joinTokens && context === "edit" && effectiveMode === "create" && (
          <div className="flex flex-col gap-2 text-sm">
            <span className="font-medium">Invite peers with</span>
            <div className="flex flex-col gap-1.5">
              {(
                [
                  ["Worker", status.joinTokens.worker],
                  ["Manager", status.joinTokens.manager],
                ] as const
              ).map(([label, token]) => (
                <div key={label} className="flex items-center gap-2">
                  <Badge variant="outline">{label}</Badge>
                  <code className="flex-1 truncate rounded bg-muted px-2 py-1 text-[11px]">{token}</code>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={() => copy(label, token)}
                    aria-label={`Copy ${label} join token`}
                  >
                    <Check
                      className={cn(
                        "h-3.5 w-3.5",
                        copied === label ? "text-emerald-500" : "text-muted-foreground",
                      )}
                    />
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function StatusLine({
  status,
}: {
  status: {
    setupDone: boolean;
    engineState: string;
    role: string;
    availability: string;
    nodeCount: number;
    managerCount: number;
    joinTokens?: { worker: string; manager: string } | null;
  };
}) {
  if (!status.setupDone) {
    return (
      <>
        Setup isn&apos;t complete yet — this choice is applied when setup finishes. Before then,
        supervised services run as containers (Traefik serves *.deployer.localhost).
      </>
    );
  }
  const engine = status.engineState ?? "unknown";
  if (engine !== "active") {
    return (
      <>
        Engine is {engine} — this node will join/init Swarm on the next boot. Nothing is touched until
        save.
      </>
    );
  }
  return (
    <>
      Engine <span className="font-medium text-emerald-600">active</span> — this node is a{" "}
      <span className="font-medium">{status.role}</span>
      {status.availability === "drain" ? " (drained, control-plane only)" : ""} · {status.nodeCount}{" "}
      node(s) · {status.managerCount} manager(s)
    </>
  );
}
