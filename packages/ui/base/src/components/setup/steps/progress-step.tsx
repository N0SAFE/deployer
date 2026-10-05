"use client"

import { useCallback, useMemo, useState } from "react"
import { Activity, CheckCircle2, Loader2, XCircle } from "lucide-react"
import type { SetupStreamEvent } from "@repo/contracts-entities"
import { Button } from "@repo/ui/components/shadcn/button"
import { ProgressTasks, buildTasksFromEvents, isPipelineComplete } from "@repo/ui/components/setup/progress-tasks"
import { markSetupComplete } from "@repo/ui/components/setup/setup-storage"
import type { SetupWizardApi } from "@repo/ui/components/setup/types"

/**
 * Optional context about the configuration the user submitted. Any
 * field that's provided is shown as an info tile above the progress
 * list. The progress list itself is fully driven by the stream events
 * (step_detail → snapshot → log → completed | error), so this
 * component is the same for every flow (local, remote, recovery…).
 */
export interface ProgressStepContext {
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
  api: SetupWizardApi
  events: SetupStreamEvent[]
  context: ProgressStepContext
  onComplete?: (result: { nodeId: string; strategy: "local" | "remote"; databaseUrl: string }) => void
  onError?: (message: string) => void
}

export function ProgressStep({ api, events, context, onComplete, onError }: Props) {
  const tasks = useMemo(() => buildTasksFromEvents(events), [events])

  // ── SEARCHED, NOT READ FROM THE LAST EVENT ───────────────────────────────
  // Two producers append to this one timeline, and the LATER one can append
  // AFTER the terminal event: the API's `completed` reports provisioning, and
  // the ingress swap then reports `promote_ingress` on top of it. Reading
  // `events.at(-1)` therefore stopped finding the terminal once the swap
  // started — the heading reverted to "Live setup output" and the Continue
  // button vanished mid-render, which is exactly what the operator saw.
  //
  // Searching the whole timeline keeps a terminal state STICKY: once setup is
  // done it stays done, whatever else is reported afterwards.
  const completedEvent = events.find((event) => event.type === "completed")
  const errorEvent = events.find((event) => event.type === "error")
  const isTerminal = Boolean(completedEvent) || Boolean(errorEvent)

  // The pipeline is over only when every announced step has finished — the
  // terminal event alone arrives BEFORE the ingress swap. See `ContinueButton`.
  const pipelineComplete = isPipelineComplete(tasks)

  if (completedEvent && onComplete) {
    onComplete(completedEvent.result)
  }
  if (errorEvent && onError) {
    onError(errorEvent.message)
  }

  const heading = getHeading(context)
  const description = getDescription(context, completedEvent, errorEvent)

  // Narrowed once here rather than re-checked at the JSX: a boolean flag
  // (`showAdminTile`) does not carry the narrowing, which is what forced the
  // non-null assertions this replaced.
  const adminIdentity =
    context.username !== undefined && context.email !== undefined
      ? { username: context.username, email: context.email }
      : undefined
  const showDbTile = context.dbMode !== undefined
  const showInfoTiles = adminIdentity !== undefined || showDbTile

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
          {adminIdentity ? (
            <InfoTile label="Admin" value={adminIdentity.username} subValue={adminIdentity.email} />
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

          {/**
           * THE BUTTON APPEARS ONLY ONCE THE PIPELINE IS DONE.
           *
           * Rendering it earlier as a DISABLED spinner was the wrong shape: the
           * step list ABOVE already says the ingress is switching, so a second
           * loading affordance duplicated that message and then disappeared when
           * the button unmounted — reading as a glitch rather than as progress.
           * Nothing is clickable until there is somewhere safe to go, and the
           * steps are the thing reporting that.
           */}
          {completedEvent && pipelineComplete ? (
            <ContinueButton api={api} context={context} />
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
 *
 * The wizard is served by the API but the DASHBOARD lives in the web app, so
 * this is the hand-off point between the two surfaces: sign the operator in
 * (the session cookie is same-origin, so it carries to the web app) and then
 * land them on the WEB app URL rather than the API console.
 */
function ContinueButton({ api, context }: { api: SetupWizardApi; context: ProgressStepContext }) {
  const { signInWithEmail, getErrorMessage, postSetupRedirectUrl, usePostSetupDestination } = api
  const [loggingIn, setLoggingIn] = useState(false)
  const [loginError, setLoginError] = useState<string | null>(null)

  // ASKED OF THE SERVER. The client cannot know whether a dashboard exists —
  // that is a flag the API owns — and deriving it from `window.location` is what
  // sent operators to a `web.<host>` with no router on an "API only" install.
  // `postSetupRedirectUrl()` remains the fallback: it is same-origin by
  // construction, so the operator can always leave this screen.
  const destinationQuery = usePostSetupDestination({ enabled: true })
  const destination = destinationQuery.data?.url ?? postSetupRedirectUrl()
  // Worded truthfully: there is no dashboard to open on an API-only install.
  const isDashboard = destinationQuery.data?.kind === "dashboard"

  const handleContinue = useCallback(async () => {
    // Set localStorage flag so the dashboard hint queue shows on first load.
    markSetupComplete()

    if (context.mode === "remote") {
      window.location.assign(destination)
      return
    }

    if (!context.email || !context.password) {
      // No credentials to sign in with — send them on to sign in.
      window.location.assign(destination)
      return
    }

    setLoggingIn(true)
    setLoginError(null)

    try {
      await signInWithEmail({ email: context.email, password: context.password })
      window.location.assign(destination)
    } catch (err: unknown) {
      const msg = getErrorMessage(err)
      setLoginError(msg)
      setLoggingIn(false)
    }
  }, [context.email, context.password, context.mode, destination])

  return (
    <div className="flex flex-col gap-2">
      <Button
        className="w-full gap-2"
        onClick={() => {
          void handleContinue()
        }}
        disabled={loggingIn}
      >
        {loggingIn ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Signing in…
          </>
        ) : isDashboard ? (
          "Continue to dashboard"
        ) : (
          "Finish setup"
        )}
      </Button>
      {/* Explain the destination when it is not the dashboard, so the button is
          not a surprise: the operator chose API-only, and the API's own console
          is where a dashboard can be enabled later. */}
      {!isDashboard && destinationQuery.data ? (
        <p className="text-xs text-center text-muted-foreground">
          No dashboard is running — you will land on the API console, where you can enable one.
        </p>
      ) : null}
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
