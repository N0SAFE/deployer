"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { ProgressTasks } from "@/components/setup/progress-tasks"
import { mockGenerateNodeId, taskLogs } from "@/lib/setup/mock-api"
import { runTaskWithLogs } from "@/lib/setup/run-task"
import type { LocalDbMode, ProgressTask } from "@/lib/setup/types"
import { Activity } from "lucide-react"

type Props = {
  username: string
  email: string
  dbMode: LocalDbMode
  dbUrl: string
  onDone: (data: { nodeId: string }) => void
}

function buildTasks(dbMode: LocalDbMode): ProgressTask[] {
  return [
    {
      id: "create-db",
      label: dbMode === "managed" ? "Set up the database" : "Connect to your database",
      description:
        dbMode === "managed"
          ? "Spinning up a fresh PostgreSQL instance on this machine."
          : "Opening a secure connection to your PostgreSQL server.",
      status: "pending",
      logs: [],
    },
    {
      id: "migrate",
      label: "Apply database schema",
      description: "Creating the tables your workspace needs to run.",
      status: "pending",
      logs: [],
    },
    {
      id: "admin",
      label: "Create your account",
      description: "Hashing your password and saving the admin user.",
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
      id: "mesh",
      label: "Initialize your workspace",
      description: "Wiring everything together and getting this node online.",
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
}

export function LocalProgressStep({ username, email, dbMode, dbUrl, onDone }: Props) {
  const baseTasks = useMemo(() => buildTasks(dbMode), [dbMode])
  const [tasks, setTasks] = useState<ProgressTask[]>(baseTasks)
  const startedRef = useRef(false)

  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true

    ;(async () => {
      for (const task of baseTasks) {
        const logsKey =
          task.id === "create-db"
            ? dbMode === "managed"
              ? "create-db.managed"
              : "create-db.existing"
            : task.id
        const lines = taskLogs[logsKey] ?? []
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
        <h2 className="text-2xl font-semibold tracking-tight text-balance">Setting up your workspace</h2>
        <p className="text-sm text-muted-foreground leading-relaxed text-pretty">
          Hang tight — this usually takes about a minute. Click any step to see what&apos;s happening behind the
          scenes.
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <InfoTile label="Admin" value={username} subValue={email} />
        <InfoTile
          label="Database"
          value={dbMode === "managed" ? "Managed PostgreSQL" : "Your PostgreSQL"}
          subValue={dbMode === "managed" ? "127.0.0.1:5432/workspace" : maskUrl(dbUrl)}
          mono
        />
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

function InfoTile({
  label,
  value,
  subValue,
  mono,
}: {
  label: string
  value: string
  subValue?: string
  mono?: boolean
}) {
  return (
    <div className="rounded-lg border border-border bg-muted/20 p-3.5">
      <div className="text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground">{label}</div>
      <div className={`mt-1 text-sm font-semibold truncate ${mono ? "font-mono" : ""}`} title={value}>
        {value}
      </div>
      {subValue ? (
        <div className="text-xs text-muted-foreground truncate font-mono mt-0.5" title={subValue}>
          {subValue}
        </div>
      ) : null}
    </div>
  )
}

function maskUrl(url: string) {
  try {
    const u = new URL(url)
    if (u.password) u.password = "•••"
    return u.toString()
  } catch {
    return url
  }
}
