"use client"

import { useEffect, useRef, useState } from "react"
import { CheckCircle2, Loader2, Circle, XCircle, ChevronDown } from "lucide-react"
import type { ProgressTask, ProgressTaskStatus } from "@/lib/setup/types"
import { cn } from "@/lib/utils"

export function ProgressTasks({ tasks }: { tasks: ProgressTask[] }) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const prevStatusRef = useRef<Record<string, ProgressTaskStatus>>({})

  // Auto-expand when running, auto-collapse when done — only on transition,
  // so the user's manual clicks aren't overridden later.
  useEffect(() => {
    setExpanded((prev) => {
      const next = { ...prev }
      for (const t of tasks) {
        const prevStatus = prevStatusRef.current[t.id]
        if (prevStatus !== t.status) {
          if (t.status === "running") next[t.id] = true
          if (t.status === "done") next[t.id] = false
          if (t.status === "error") next[t.id] = true
        }
        prevStatusRef.current[t.id] = t.status
      }
      return next
    })
  }, [tasks])

  function toggle(id: string) {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  return (
    <ol className="flex flex-col gap-2.5" aria-label="Setup progress">
      {tasks.map((task) => (
        <li key={task.id}>
          <TaskCard task={task} expanded={!!expanded[task.id]} onToggle={() => toggle(task.id)} />
        </li>
      ))}
    </ol>
  )
}

function TaskCard({
  task,
  expanded,
  onToggle,
}: {
  task: ProgressTask
  expanded: boolean
  onToggle: () => void
}) {
  const hasLogs = task.logs.length > 0
  const isRunning = task.status === "running"
  const isDone = task.status === "done"
  const isError = task.status === "error"
  const isPending = task.status === "pending"

  return (
    <div
      className={cn(
        "rounded-lg border overflow-hidden transition-colors",
        isRunning && "border-primary/50 bg-primary/[0.03] shadow-[0_0_0_3px_rgba(167,139,250,0.06)]",
        isDone && "border-border bg-card/40",
        isError && "border-destructive/50 bg-destructive/[0.04]",
        isPending && "border-border/60 bg-card/20",
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        disabled={!hasLogs}
        aria-expanded={expanded}
        className={cn(
          "w-full flex items-center gap-3 px-4 py-3 text-left transition-colors",
          hasLogs && "hover:bg-muted/30 cursor-pointer",
          !hasLogs && "cursor-default",
        )}
      >
        <div className="relative flex h-6 w-6 shrink-0 items-center justify-center">
          <TaskIcon status={task.status} />
        </div>
        <div className="flex flex-col gap-0.5 min-w-0 flex-1">
          <span
            className={cn(
              "text-sm font-medium leading-tight truncate",
              isPending ? "text-muted-foreground" : "text-foreground",
            )}
          >
            {task.label}
          </span>
          <span className="text-xs text-muted-foreground leading-snug truncate">{task.description}</span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <StatusBadge status={task.status} />
          {hasLogs ? (
            <ChevronDown
              className={cn(
                "h-4 w-4 text-muted-foreground transition-transform duration-200",
                expanded && "rotate-180",
              )}
              aria-hidden="true"
            />
          ) : (
            <span className="w-4" aria-hidden="true" />
          )}
        </div>
      </button>

      {/* Expandable logs */}
      <div
        className={cn(
          "grid transition-all duration-300 ease-out",
          expanded && hasLogs ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
        )}
      >
        <div className="overflow-hidden">
          <LogPanel task={task} />
        </div>
      </div>
    </div>
  )
}

function LogPanel({ task }: { task: ProgressTask }) {
  const scrollRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to bottom while running so the latest line is visible.
  useEffect(() => {
    if (task.status === "running" && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [task.logs.length, task.status])

  return (
    <div className="border-t border-border/60 bg-background/60">
      <div className="flex items-center justify-between px-4 py-2 border-b border-border/60">
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          Output
        </span>
        <span className="font-mono text-[10px] text-muted-foreground/70">
          {task.logs.length} {task.logs.length === 1 ? "line" : "lines"}
        </span>
      </div>
      <div
        ref={scrollRef}
        className="max-h-48 overflow-y-auto px-4 py-3 font-mono text-[12px] leading-[1.7]"
      >
        {task.logs.map((line, i) => (
          <LogLine key={i} line={line} />
        ))}
        {task.status === "running" ? (
          <div className="flex items-center gap-1.5 text-muted-foreground/60">
            <span className="inline-block h-2 w-1.5 bg-primary/70 animate-pulse" aria-hidden="true" />
          </div>
        ) : null}
      </div>
    </div>
  )
}

function LogLine({ line }: { line: string }) {
  const isCommand = line.startsWith("$")
  return (
    <div className="flex gap-2 animate-in fade-in slide-in-from-left-1 duration-300">
      <span className="select-none text-muted-foreground/40 shrink-0 w-4 text-right">›</span>
      <span
        className={cn(
          "whitespace-pre-wrap break-all",
          isCommand ? "text-primary/90 font-medium" : "text-muted-foreground",
        )}
      >
        {line}
      </span>
    </div>
  )
}

function StatusBadge({ status }: { status: ProgressTaskStatus }) {
  const map: Record<ProgressTaskStatus, { label: string; className: string }> = {
    pending: {
      label: "Queued",
      className: "bg-muted/60 text-muted-foreground",
    },
    running: {
      label: "Running",
      className: "bg-primary/15 text-primary",
    },
    done: {
      label: "Done",
      className: "bg-emerald-500/15 text-emerald-400",
    },
    error: {
      label: "Failed",
      className: "bg-destructive/15 text-destructive",
    },
  }
  const { label, className } = map[status]
  return (
    <span
      className={cn(
        "font-mono text-[10px] font-medium uppercase tracking-wider px-2 py-0.5 rounded-md",
        className,
      )}
    >
      {label}
    </span>
  )
}

function TaskIcon({ status }: { status: ProgressTaskStatus }) {
  if (status === "done") return <CheckCircle2 className="h-5 w-5 text-emerald-500" aria-label="Done" />
  if (status === "running") return <Loader2 className="h-5 w-5 animate-spin text-primary" aria-label="In progress" />
  if (status === "error") return <XCircle className="h-5 w-5 text-destructive" aria-label="Error" />
  return <Circle className="h-5 w-5 text-muted-foreground/40" aria-label="Pending" />
}
