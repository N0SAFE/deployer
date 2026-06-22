"use client"

import { Network, Sparkles, ArrowRight, Check } from "lucide-react"
import { Button } from "@repo/ui/components/shadcn/button"
import { cn } from "@/lib/utils"
import { useState } from "react"

type Props = {
  initialMode: "local" | "remote" | null
  onContinue: (mode: "local" | "remote") => void
}

export function ModeStep({ initialMode, onContinue }: Props) {
  const [selected, setSelected] = useState<"local" | "remote" | null>(initialMode)

  return (
    <div className="flex flex-col gap-7">
      <div className="flex flex-col gap-2">
        <h2 className="text-2xl font-semibold tracking-tight text-balance">How do you want to start?</h2>
        <p className="text-sm text-muted-foreground leading-relaxed text-pretty">
          You can spin up a brand new instance from scratch, or wire this node into a cluster that&apos;s already up
          and running. You&apos;ll be able to invite more nodes later either way.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <ModeCard
          icon={Sparkles}
          title="Set up a new instance"
          subtitle="Become the founding node"
          description="Start from a clean slate. You&apos;ll create the admin account and the database that this cluster will be built on."
          highlights={["Create admin account", "Provision PostgreSQL", "Bootstrap a fresh cluster"]}
          tag="LOCAL"
          selected={selected === "local"}
          onClick={() => setSelected("local")}
        />
        <ModeCard
          icon={Network}
          title="Join an existing cluster"
          subtitle="Add this node to a running mesh"
          description="Connect to a cluster that&apos;s already online. Authenticate through one of its peers and inherit its configuration."
          highlights={["Verify cluster URL", "Authenticate via a peer", "Sync shared identity"]}
          tag="REMOTE"
          selected={selected === "remote"}
          onClick={() => setSelected("remote")}
        />
      </div>

      <div className="flex justify-end">
        <Button
          disabled={!selected}
          onClick={() => selected && onContinue(selected)}
          className="gap-2"
          size="lg"
        >
          Continue
          <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}

function ModeCard({
  icon: Icon,
  title,
  subtitle,
  description,
  highlights,
  selected,
  onClick,
  tag,
}: {
  icon: typeof Network
  title: string
  subtitle: string
  description: string
  highlights: string[]
  selected: boolean
  onClick: () => void
  tag: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        "group relative flex flex-col gap-4 rounded-xl border p-5 text-left transition-all duration-200",
        "hover:border-primary/40 hover:bg-muted/40",
        selected
          ? "border-primary bg-primary/[0.04] ring-1 ring-primary shadow-[0_0_0_4px_rgba(167,139,250,0.08)]"
          : "border-border bg-background/40",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div
          className={cn(
            "flex h-11 w-11 items-center justify-center rounded-lg transition-colors",
            selected ? "bg-primary text-primary-foreground" : "bg-muted text-foreground",
          )}
        >
          <Icon className="h-5 w-5" aria-hidden="true" />
        </div>
        <span
          className={cn(
            "font-mono text-[10px] font-medium tracking-[0.18em] px-2 py-1 rounded-md transition-colors",
            selected
              ? "bg-primary/10 text-primary"
              : "bg-muted/60 text-muted-foreground",
          )}
        >
          {tag}
        </span>
      </div>

      <div className="flex flex-col gap-1">
        <h3 className="text-base font-semibold text-foreground leading-tight">{title}</h3>
        <p className="text-xs font-medium text-muted-foreground/90 uppercase tracking-wide">{subtitle}</p>
        <p className="text-sm text-muted-foreground leading-relaxed text-pretty mt-1.5">{description}</p>
      </div>

      <ul className="flex flex-col gap-1.5 mt-auto pt-3 border-t border-border/60">
        {highlights.map((h) => (
          <li key={h} className="flex items-center gap-2 text-xs text-muted-foreground">
            <Check
              className={cn(
                "h-3.5 w-3.5 shrink-0 transition-colors",
                selected ? "text-primary" : "text-muted-foreground/60",
              )}
              aria-hidden="true"
            />
            <span>{h}</span>
          </li>
        ))}
      </ul>
    </button>
  )
}
