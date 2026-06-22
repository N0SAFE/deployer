import type { Dispatch, SetStateAction } from "react"
import type { ProgressTask } from "./types"

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

type RunTaskArgs = {
  taskId: string
  lines: string[]
  setTasks: Dispatch<SetStateAction<ProgressTask[]>>
  totalMs?: number
}

/**
 * Runs a single mock task: marks it as running, streams the provided log lines
 * one by one with small randomized delays, then marks it as done.
 *
 * Note: intentionally has no cancellation. The setup wizard runs to completion
 * once started and we don't want React Strict Mode's effect double-invocation
 * to leave us in a partially-started state.
 */
export async function runTaskWithLogs({ taskId, lines, setTasks, totalMs = 1100 }: RunTaskArgs) {
  setTasks((prev) =>
    prev.map((t) => (t.id === taskId ? { ...t, status: "running", logs: [] } : t)),
  )

  const linesCount = Math.max(lines.length, 1)
  const baseDelay = totalMs / linesCount

  for (const line of lines) {
    const jitter = 0.55 + Math.random() * 0.9
    await wait(baseDelay * jitter)
    setTasks((prev) =>
      prev.map((t) => (t.id === taskId ? { ...t, logs: [...t.logs, line] } : t)),
    )
  }

  // Small settling delay so the user can see the last line briefly.
  await wait(220)

  setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, status: "done" } : t)))
}
