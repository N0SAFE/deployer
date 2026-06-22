"use client"

import { useEffect, useRef, useState } from "react"
import { ProgressTasks } from "@/components/setup/progress-tasks"
import { mockGenerateNodeId, taskLogs } from "@/lib/setup/mock-api"
import { runTaskWithLogs } from "@/lib/setup/run-task"
import type { ProgressTask, RemoteUser } from "@/lib/setup/types"
import { Activity } from "lucide-react"

type Props = {
  user: RemoteUser
  meshName: string
  sessionToken: string
  onDone: (data: { nodeId: string }) => void
}

const initialTasks: ProgressTask[] = [
  {
    id: "verify-token",
    label: "Verify your session",
    description: "Validating the token returned by your workspace.",
    status: "pending",
    logs: [],
  },
  {
    id: "fetch-db",
    label: "Sync workspace settings",
    description: "Retrieving the shared database connection from your peers.",
    status: "pending",
    logs: [],
  },
  {
    id: "keypair",
    label: "Generate node identity",
    description: "Creating a unique key pair so this node can talk to its peers.",
    status: "pending",
    logs: [],
  },
  {
    id: "register",
    label: "Join the workspace",
    description: "Announcing this node to your team's existing nodes.",
    status: "pending",
    logs: [],
  },
  {
    id: "persist",
    label: "Save local configuration",
    description: "Writing your settings to the local SQLite registry.",
    status: "pending",
    logs: [],
  },
]

export function RemoteProgressStep({ user, meshName, sessionToken, onDone }: Props) {
  const [tasks, setTasks] = useState<ProgressTask[]>(initialTasks)
  const startedRef = useRef(false)

  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true

    ;(async () => {
      for (const task of initialTasks) {
        const lines = taskLogs[task.id] ?? []
        await runTaskWithLogs({ taskId: task.id, lines, setTasks })
      }
      const nodeId = await mockGenerateNodeId()
      onDone({ nodeId })
    })()
    // We intentionally run once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="flex flex-col gap-7">
      <div className="flex flex-col gap-2">
        <h2 className="text-2xl font-semibold tracking-tight text-balance">Connecting your node</h2>
        <p className="text-sm text-muted-foreground leading-relaxed text-pretty">
          Hang tight while we bring this node online. Click any step to see what&apos;s happening behind the scenes.
        </p>
      </div>

      <div className="rounded-lg border border-border bg-muted/20 p-4">
        <div className="flex items-center gap-3">
          <div
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full font-mono text-sm font-semibold text-background"
            style={{ backgroundColor: user.avatarColor }}
            aria-hidden="true"
          >
            {user.name
              .split(" ")
              .map((p) => p[0])
              .join("")
              .slice(0, 2)}
          </div>
          <div className="flex flex-col gap-0.5 min-w-0 flex-1">
            <span className="text-sm font-semibold leading-tight">{user.name}</span>
            <span className="text-xs text-muted-foreground leading-tight">
              Signed in to <span className="font-medium text-foreground">{meshName}</span>
            </span>
          </div>
          <span
            className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground truncate max-w-[120px]"
            title={sessionToken}
          >
            {sessionToken.slice(0, 14)}...
          </span>
        </div>
      </div>

      <div className="flex items-center gap-2 pt-1">
        <Activity className="h-4 w-4 text-primary" aria-hidden="true" />
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          Live setup output
        </span>
        <span className="flex-1 h-px bg-border/60 ml-2" aria-hidden="true" />
      </div>

      <ProgressTasks tasks={tasks} />
    </div>
  )
}
