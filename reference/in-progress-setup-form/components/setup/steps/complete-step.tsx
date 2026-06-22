"use client"

import { CheckCircle2, Copy, RotateCcw } from "lucide-react"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import type { WizardState } from "@/lib/setup/types"

type Props = {
  state: WizardState
  onReset: () => void
}

export function CompleteStep({ state, onReset }: Props) {
  const [copied, setCopied] = useState(false)
  const nodeId = state.finalNodeId ?? "node_unknown"

  const summary =
    state.mode === "remote"
      ? {
          title: "Node joined the cluster",
          line1: `Cluster: ${state.remote.meshName ?? "unknown"}`,
          line2: `Authenticated as ${state.remote.user?.name ?? "unknown"}`,
          line3: `Entry: ${state.remote.meshUrl}`,
        }
      : {
          title: "Your cluster is online",
          line1: `Admin: ${state.local.username} (${state.local.email})`,
          line2:
            state.local.dbMode === "managed"
              ? "Database: managed PostgreSQL"
              : "Database: existing PostgreSQL",
          line3: `Node role: founding peer`,
        }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(nodeId)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // ignore
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col items-center gap-3 text-center py-2">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-950/50">
          <CheckCircle2 className="h-8 w-8 text-emerald-600" aria-hidden="true" />
        </div>
        <h2 className="text-2xl font-semibold tracking-tight text-balance">{summary.title}</h2>
        <p className="text-sm text-muted-foreground leading-relaxed max-w-md text-pretty">
          The local SQLite registry has been sealed and this node is ready to serve traffic.
        </p>
      </div>

      <div className="rounded-lg border border-border bg-muted/20 p-5 flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Node ID</span>
          <div className="flex items-center gap-2">
            <code className="font-mono text-sm bg-background border border-border rounded-md px-3 py-2 flex-1 break-all">
              {nodeId}
            </code>
            <Button
              size="icon"
              variant="outline"
              onClick={handleCopy}
              aria-label="Copy node ID"
              title={copied ? "Copied!" : "Copy"}
            >
              <Copy className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="border-t border-border" />

        <ul className="flex flex-col gap-1.5 text-sm">
          <li className="flex items-center gap-2 text-muted-foreground">
            <span className="h-1 w-1 rounded-full bg-muted-foreground" aria-hidden="true" />
            <span>{summary.line1}</span>
          </li>
          <li className="flex items-center gap-2 text-muted-foreground">
            <span className="h-1 w-1 rounded-full bg-muted-foreground" aria-hidden="true" />
            <span>{summary.line2}</span>
          </li>
          <li className="flex items-center gap-2 text-muted-foreground">
            <span className="h-1 w-1 rounded-full bg-muted-foreground" aria-hidden="true" />
            <span>{summary.line3}</span>
          </li>
        </ul>
      </div>

      <div className="flex items-center justify-between gap-3">
        <Button variant="ghost" onClick={onReset} className="gap-2">
          <RotateCcw className="h-4 w-4" />
          Run setup again
        </Button>
        <Button className="gap-2" disabled>
          Open dashboard
        </Button>
      </div>
    </div>
  )
}
