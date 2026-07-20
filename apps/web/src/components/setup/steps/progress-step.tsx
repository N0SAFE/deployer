"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Activity, CheckCircle2, Loader2, XCircle } from "lucide-react"
import { useRouter } from "next/navigation"
import type { SetupStreamEvent } from "@repo/contracts-entities"
import { Button } from "@repo/ui/components/shadcn/button"
import { ProgressTasks, buildTasksFromEvents } from "@/components/setup/progress-tasks"

/**
 * Optional context about the configuration the user submitted. Any
 * field that's provided is shown as an info tile above the progress
 * list. The progress list itself is fully driven by the stream events
 * (step_detail → snapshot → log → completed | error), so this
 * component is the same for every flow (local, remote, recovery…).
 */
export type ProgressStepContext = {
  /** Strategy that was selected. Drives the heading copy. */
  mode: "local" | "remote"
  /** Local admin user info (shown when provided). */
  username?: string
  email?: string
  /** Local admin password for auto-login after setup completes */
  password?: string
  /** Local database info (shown when provided). */
  dbMode?: "managed" | "existing"
  dbUrl?: string
  /** Remote mesh URL (shown inline in the heading). */
  meshUrl?: string
  /** True when we auto-navigated from an existing in-flight init. */
  recovery?: boolean
}

interface Props {
  events: SetupStreamEvent[]
  context: ProgressStepContext
  onComplete?: (result: { nodeId: string; strategy: "local" | "remote"; databaseUrl: string }) => void
  onError?: (message: string) => void
}

export function ProgressStep({ events, context, onComplete, onError }: Props) {
  const router = useRouter()
  const tasks = useMemo(() => buildTasksFromEvents(events), [events])

  // Derive terminal state from the latest event so the parent doesn't
  // have to maintain its own copy. The wizard listens via onComplete
  // and decides whether to navigate, show a CTA, or stay put.
  const last = events[events.length - 1]
  const completedEvent = last?.type === "completed" ? last : undefined
  const errorEvent = last?.type === "error" ? last : undefined
  const isTerminal = Boolean(completedEvent) || Boolean(errorEvent)

  if (completedEvent && onComplete) {
    onComplete(completedEvent.result)
  }
  if (errorEvent && onError) {
    onError(errorEvent.message)
  }

  const heading = getHeading(context)
  const description = getDescription(context, completedEvent, errorEvent)

  const showAdminTile = Boolean(context.username && context.email && context.dbMode)
  const showDbTile = Boolean(context.dbMode)
  const showInfoTiles = showAdminTile || showDbTile

  return (
    <div className="flex flex-col gap-7">
      <div className="flex flex-col gap-2">
        <h2 className="text-2xl font-semibold tracking-tight text-balance">
          {context.recovery ? "Setup in progress" : heading}
        </h2>
        <p className="text-sm text-muted-foreground leading-relaxed text-pretty">
          {description}
        </p>
      </div>

      {showInfoTiles ? (
        <div className="grid gap-3 md:grid-cols-2">
          {showAdminTile ? (
            <InfoTile label="Admin" value={context.username!} subValue={context.email!} />
          ) : null}
          {showDbTile ? (
            <InfoTile
              label="Database"
              value={context.dbMode === "managed" ? "Managed PostgreSQL" : "Your PostgreSQL"}
              subValue={context.dbMode === "managed" ? "127.0.0.1:5432/workspace" : maskUrl(context.dbUrl ?? "")}
              mono
            />
          ) : null}
        </div>
      ) : null}

      {events.length > 0 || isTerminal ? (
        <>
          <div className="flex items-center gap-2 pt-1">
            {completedEvent ? (
              <CheckCircle2 className="h-4 w-4 text-emerald-500" aria-hidden="true" />
            ) : errorEvent ? (
              <XCircle className="h-4 w-4 text-destructive" aria-hidden="true" />
            ) : (
              <Activity className="h-4 w-4 text-primary animate-pulse" aria-hidden="true" />
            )}
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              {completedEvent
                ? "Setup complete — review the output below"
                : errorEvent
                  ? "Setup stopped — review the error"
                  : "Live setup output"}
            </span>
            <span className="flex-1 h-px bg-border/60 ml-2" aria-hidden="true" />
          </div>
          <ProgressTasks tasks={tasks} />

          {completedEvent ? (
            <ContinueButton context={context} />
          ) : null}
          {errorEvent ? (
            <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4">
              <div className="flex items-start gap-3">
                <XCircle className="h-5 w-5 text-destructive shrink-0 mt-0.5" aria-hidden="true" />
                <div className="flex flex-col gap-1.5 min-w-0">
                  <span className="text-sm font-semibold text-destructive">Setup failed</span>
                  <code className="font-mono text-xs text-destructive/90 break-all whitespace-pre-wrap">
                    {errorEvent.message}
                  </code>
                </div>
              </div>
            </div>
          ) : null}
        </>
      ) : (
        <div className="flex items-center justify-center py-12">
          <span className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-primary/30 border-t-primary" />
          <span className="ml-3 text-sm text-muted-foreground">Starting setup…</span>
        </div>
      )}
    </div>
  )
}

function getHeading(context: ProgressStepContext): string {
  if (context.recovery) return "Setup in progress"
  return context.mode === "remote" ? "Joining the mesh cluster" : "Setting up your workspace"
}

/**
 * Continue button shown after setup completes.
 * For local mode: calls BetterAuth sign-in with the credentials from the form,
 * then redirects to /. For remote mode: just redirects to /.
 * Sets localStorage flags so PostSetupHints shows after redirect.
 */
function ContinueButton({ context }: { context: ProgressStepContext }) {
  const router = useRouter()
  const [loggingIn, setLoggingIn] = useState(false)
  const [loginError, setLoginError] = useState<string | null>(null)

  const handleContinue = useCallback(async () => {
    // Set localStorage flag so PostSetupHints shows on the dashboard
    try { localStorage.setItem("post-setup-complete", "1") } catch { /* noop */ }

    if (context.mode === "remote") {
      router.push("/")
      return
    }

    if (!context.email || !context.password) {
      router.push("/login")
      return
    }

    setLoggingIn(true)
    setLoginError(null)

    try {
      const res = await fetch("/api/auth/sign-in/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: context.email, password: context.password }),
      })

      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error((body as Record<string, unknown>).message as string ?? "Sign in failed")
      }

      router.push("/")
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      setLoginError(msg)
      setLoggingIn(false)
    }
  }, [router, context.email, context.password, context.mode])

  return (
    <div className="flex flex-col gap-2">
      <Button className="w-full gap-2" onClick={handleContinue} disabled={loggingIn}>
        {loggingIn ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Signing in…
          </>
        ) : (
          "Continue to dashboard"
        )}
      </Button>
      {loginError && (
        <p className="text-xs text-destructive text-center">{loginError}</p>
      )}
    </div>
  )
}

function getDescription(
  context: ProgressStepContext,
  completedEvent: { type: "completed" } | undefined,
  errorEvent: { type: "error"; message: string } | undefined,
): React.ReactNode {
  if (errorEvent) {
    return "Setup stopped — see the failing step below for the error message."
  }
  if (completedEvent) {
    if (context.mode === "remote") {
      return "Done — your logs are still available below."
    }
    return "Setup finished. Your logs are still available above."
  }
  if (context.mode === "remote" && context.meshUrl) {
    return (
      <>
        Connecting to{" "}
        <code className="text-xs bg-muted px-1.5 py-0.5 rounded">{context.meshUrl}</code>{" "}
        and syncing shared identity. This usually takes a few seconds.
      </>
    )
  }
  return "Hang tight — this usually takes about a minute. Click any step to see what&apos;s happening behind the scenes."
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
