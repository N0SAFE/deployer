"use client"

import { useEffect, useRef, useState } from "react"
import { CheckCircle2, Loader2, Circle, XCircle, ChevronDown } from "lucide-react"
import type { SetupStreamEvent, SetupStepId, SetupStreamStepState } from "@repo/contracts-entities"
import { cn } from "@/lib/utils"

export type TaskStatus = "pending" | "running" | "done" | "error"

export type ProgressTask = {
  id: string
  label: string
  description: string
  status: TaskStatus
  logs: string[]
  durationMs?: number
  error?: string
}

/**
 * Optional pre-populated step descriptor list. When provided, the task
 * display shows every step from the very first render (as `pending`).
 * As soon as the API emits a `snapshot` event for a step, the API's
 * authoritative state replaces the template for that step.
 */
export type TaskTemplate = {
  /** SetupStepId (or any stable string). Must match what the API emits. */
  id: SetupStepId | (string & {})
  label: string
  description: string
}

/**
 * Maps a SetupStreamStepState.status to the UI's TaskStatus.
 */
function mapStatus(s: SetupStreamStepState["status"]): TaskStatus {
  switch (s) {
    case "pending":
      return "pending"
    case "in_progress":
      return "running"
    case "completed":
      return "done"
    case "failed":
      return "error"
    case "skipped":
      return "pending"
  }
}

/**
 * Converts a stream of {@link SetupStreamEvent} into a list of
 * {@link ProgressTask} items for rendering.
 *
 * The new event model (snapshot + log) carries the full step state
 * in `snapshot` events. We treat the latest snapshot as the source of
 * truth: each snapshot replaces the entire task list with the API's
 * authoritative state, then incremental `log` events are appended on
 * top so the UI streams in real-time between snapshots.
 *
 * Templates are used as a fallback ONLY for steps the API hasn't
 * emitted yet — i.e. the first render before any snapshot arrived.
 * As soon as a snapshot lands, the API's data wins.
 */
export function buildTasksFromEvents(
  events: SetupStreamEvent[],
  templates: TaskTemplate[] = [],
): ProgressTask[] {
  const tasksById = new Map<string, ProgressTask>()
  const orderedIds: string[] = []

  const upsertFromApi = (state: SetupStreamStepState): void => {
    const task: ProgressTask = {
      id: state.id,
      label: state.title,
      description: state.description ?? state.title,
      status: mapStatus(state.status),
      logs: [...state.logs],
      durationMs: state.durationMs,
      error: state.error,
    }
    if (!tasksById.has(state.id)) {
      orderedIds.push(state.id)
    }
    tasksById.set(state.id, task)
  }

  // Seed with templates — they cover the gap before the first snapshot
  // and let the UI render immediately. The first snapshot will replace
  // them with the API's authoritative data.
  for (const t of templates) {
    tasksById.set(t.id, {
      id: t.id,
      label: t.label,
      description: t.description,
      status: "pending",
      logs: [],
    })
    orderedIds.push(t.id)
  }

  for (const event of events) {
    switch (event.type) {
      case "snapshot": {
        // Snapshot is the source of truth — replace the whole list.
        tasksById.clear()
        orderedIds.length = 0
        for (const step of event.steps) {
          upsertFromApi(step)
        }
        break
      }
      case "log": {
        // Append a single line to the matching step. If the step
        // doesn't exist yet (no snapshot arrived), create it from
        // a template fallback so the line isn't dropped.
        let task = tasksById.get(event.stepId)
        if (!task) {
          const tmpl = templates.find((t) => t.id === event.stepId)
          task = {
            id: event.stepId,
            label: tmpl?.label ?? event.stepId,
            description: tmpl?.description ?? event.stepId,
            status: "running",
            logs: [],
          }
          orderedIds.push(event.stepId)
          tasksById.set(event.stepId, task)
        }
        task.logs.push(event.line)
        // A log implies the step is running unless already finalized.
        if (task.status === "pending") task.status = "running"
        break
      }
      case "step_detail": {
        // Server tells us about a step. Create a pending placeholder
        // if we haven't seen it yet so the UI shows the full pipeline
        // immediately, without hardcoded templates.
        if (!tasksById.has(event.stepId)) {
          tasksById.set(event.stepId, {
            id: event.stepId,
            label: event.title,
            description: event.description,
            status: "pending",
            logs: [],
          })
          orderedIds.push(event.stepId)
        }
        break
      }
      case "completed":
      case "error":
        // Terminal events — no per-step state to mutate
        break
    }
  }

  return orderedIds
    .map((id) => tasksById.get(id))
    .filter((t): t is ProgressTask => Boolean(t))
}

export function ProgressTasks({ tasks }: { tasks: ProgressTask[] }) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const prevStatusRef = useRef<Record<string, TaskStatus>>({})

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
        isRunning && "border-primary/50 bg-primary/3 shadow-[0_0_0_3px_rgba(167,139,250,0.06)]",
        isDone && "border-border bg-card/40",
        isError && "border-destructive/50 bg-destructive/4",
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
        className="max-h-64 overflow-y-auto px-4 py-3 font-mono text-[12px] leading-[1.7]"
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

function StatusBadge({ status }: { status: TaskStatus }) {
  const map: Record<TaskStatus, { label: string; className: string }> = {
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
        "font-mono text-[10px] font-medium tracking-[0.18em] px-2 py-0.5 rounded-md uppercase",
        className,
      )}
    >
      {label}
    </span>
  )
}

function TaskIcon({ status }: { status: TaskStatus }) {
  switch (status) {
    case "pending":
      return <Circle className="h-4 w-4 text-muted-foreground/60" aria-hidden="true" />
    case "running":
      return <Loader2 className="h-4 w-4 text-primary animate-spin" aria-hidden="true" />
    case "done":
      return <CheckCircle2 className="h-4 w-4 text-emerald-500" aria-hidden="true" />
    case "error":
      return <XCircle className="h-4 w-4 text-destructive" aria-hidden="true" />
  }
}
