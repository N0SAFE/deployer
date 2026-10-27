"use client"

import { useCallback, useMemo, useState } from "react"
import { Activity, CheckCircle2, Loader2, RefreshCw, WifiOff, XCircle } from "lucide-react"
import type { SetupStreamEvent } from "@deployer/contracts-entities"
import { Button } from "@deployer/ui/components/shadcn/button"
import { ProgressTasks, buildTasksFromEvents, isPipelineComplete } from "@deployer/ui/components/setup/progress-tasks"
import { buildVerificationTasks } from "@deployer/ui/components/setup/platform-verification"
import { markSetupComplete } from "@deployer/ui/components/setup/setup-storage"
import { usePlatformVerification } from "@deployer/ui/components/setup/use-platform-verification"
import type { SetupWizardApi } from "@deployer/ui/components/setup/types"

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
  /** The stream's connection dropped and is being re-established (see `SetupWizardApi`). */
  reconnecting?: boolean
}

export function ProgressStep({ api, events, context, onComplete, onError, reconnecting = false }: Props) {
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

  // The pipeline being done is NOT the same as the platform being usable: the
  // ingress was just replaced, and the stream reporting success says nothing about
  // whether the browser can open the API or the dashboard. The Continue button is
  // gated on the verification below, not on this.
  const serverDone = Boolean(completedEvent) && pipelineComplete
  // Remounting the verification (new key) restarts its deadline — see the hook.
  const [verificationRound, setVerificationRound] = useState(0)

  if (completedEvent && onComplete) {
    onComplete(completedEvent.result)
  }
  if (errorEvent && onError) {
    onError(errorEvent.message)
  }

  const heading = getHeading(context)
  const description = getDescription(context, completedEvent, errorEvent)
  const showReconnecting = reconnecting && !errorEvent && !serverDone

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
    <div className="flex min-h-0 flex-1 flex-col gap-7">
      <div className="flex shrink-0 flex-col gap-2">
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
                ? serverDone
                  ? "Provisioned — confirming the platform answers"
                  : "Provisioned — switching the ingress"
                : errorEvent
                  ? "Setup stopped — review the error"
                  : "Live setup output"}
            </span>
            <span className="flex-1 h-px bg-border/60 ml-2" aria-hidden="true" />
          </div>
          {showReconnecting ? <ReconnectingNotice /> : null}
          <ProgressTasks tasks={tasks} scrollable />

          {/**
           * THE LAST STEPS PROVE THE PLATFORM ANSWERS; THE BUTTON FOLLOWS THEM.
           *
           * The Continue button used to appear the moment the stream said done —
           * and, after the ingress swap dropped the connection, the moment the
           * API merely spoke again. Neither says the operator's browser can open
           * anything. So the button now appears only after the API and the
           * dashboard have each been checked from the platform's side (routed by
           * the cluster ingress) AND from this browser (reachable at all).
           *
           * Rendering it earlier as a DISABLED spinner was the wrong shape: the
           * steps above and below already say what is being waited on, and a
           * second loading affordance read as a glitch when it disappeared.
           */}
          {errorEvent ? null : serverDone ? (
            <FinalVerification
              key={verificationRound}
              api={api}
              context={context}
              onRetry={() => {
                setVerificationRound((round) => round + 1)
              }}
            />
          ) : (
            <ProgressTasks
              tasks={buildVerificationTasks({
                verification: null,
                browserByTarget: {},
                serverUnavailable: false,
                active: false,
                expired: false,
              })}
            />
          )}
          {errorEvent ? <FailureNotice api={api} message={errorEvent.message} /> : null}
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

/**
 * The connection to setup dropped and is coming back.
 *
 * Expected, not a fault: the ingress is replaced during the handover, and the
 * wizard's own connection travels through it. Said out loud because the timeline
 * above freezes while it happens, and a frozen timeline with no explanation looks
 * like a hung install. The progress already received is kept.
 */
function ReconnectingNotice() {
  return (
    <div
      role="status"
      className="flex items-start gap-3 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3.5"
    >
      <WifiOff className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" aria-hidden="true" />
      <div className="flex flex-col gap-0.5 min-w-0">
        <span className="text-sm font-medium">Connection to setup interrupted — reconnecting…</span>
        <span className="text-xs text-muted-foreground leading-relaxed">
          This is expected while the cluster ingress takes over the entry port. Your progress is kept, and the
          steps below update as soon as the connection is back.
        </span>
      </div>
    </div>
  )
}

/**
 * The last two steps — "is the API reachable", "is the dashboard reachable" —
 * and the way out they unlock.
 *
 * Mounted only once the pipeline reported done, and re-mounted to retry: the
 * verification's deadline starts at mount, so a retry gets a fresh one.
 *
 * When it gives up the operator is NOT left at a dead end: they can re-check, or
 * continue anyway. Continuing is deliberately possible only AFTER a visible
 * failure — a browser on a network that cannot resolve the platform's hostnames
 * is a real situation in which the platform itself is perfectly healthy.
 */
function FinalVerification({
  api,
  context,
  onRetry,
}: {
  api: SetupWizardApi
  context: ProgressStepContext
  onRetry: () => void
}) {
  const verification = usePlatformVerification(api)
  const [continueAnyway, setContinueAnyway] = useState(false)

  return (
    <>
      <ProgressTasks tasks={verification.tasks} />
      {verification.passed ? (
        <div className="flex flex-col gap-3">
          <p className="flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
            Everything answers — you can continue.
          </p>
          <ContinueButton api={api} context={context} />
        </div>
      ) : null}
      {verification.failed ? (
        <div className="flex flex-col gap-3 rounded-lg border border-destructive/40 bg-destructive/5 p-4">
          <div className="flex items-start gap-3">
            <XCircle className="h-5 w-5 text-destructive shrink-0 mt-0.5" aria-hidden="true" />
            <div className="flex flex-col gap-1">
              <span className="text-sm font-semibold text-destructive">The platform is not answering yet</span>
              <span className="text-xs text-muted-foreground leading-relaxed">
                Setup finished, but a check above has not passed. The ingress may still be loading its routes, or this
                browser may not be able to resolve the platform&apos;s hostnames.
              </span>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" className="gap-1.5" onClick={onRetry}>
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
              Check again
            </Button>
            {continueAnyway ? null : (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setContinueAnyway(true)
                }}
              >
                Continue anyway
              </Button>
            )}
          </div>
          {continueAnyway ? <ContinueButton api={api} context={context} /> : null}
        </div>
      ) : null}
    </>
  )
}

/**
 * The run stopped. Says which step and why (both come from the stream), and
 * offers the recovery that fits: a failed handover tore nothing down, so running
 * it again is the honest fix — not "start over and re-enter every choice".
 */
function FailureNotice({ api, message }: { api: SetupWizardApi; message: string }) {
  const { retryHandover, getErrorMessage } = api
  const [retrying, setRetrying] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  const handleRetry = useCallback(async () => {
    if (retryHandover === undefined) return
    setRetrying(true)
    setNote(null)
    try {
      const { accepted } = await retryHandover()
      if (accepted) {
        // A fresh page and a fresh stream: this client's timeline still holds the
        // error event, and a re-sync from the server is the clean way to drop it.
        window.location.reload()
        return
      }
      setNote("Setup is not in a failed state, so there is nothing to retry. Use “Start over” below if it is stuck.")
    } catch (err: unknown) {
      setNote(getErrorMessage(err))
    }
    setRetrying(false)
  }, [retryHandover, getErrorMessage])

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-destructive/40 bg-destructive/5 p-4">
      <div className="flex items-start gap-3">
        <XCircle className="h-5 w-5 text-destructive shrink-0 mt-0.5" aria-hidden="true" />
        <div className="flex flex-col gap-1.5 min-w-0">
          <span className="text-sm font-semibold text-destructive">Setup failed</span>
          <code className="font-mono text-xs text-destructive/90 break-all whitespace-pre-wrap">{message}</code>
        </div>
      </div>
      {retryHandover === undefined ? null : (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-muted-foreground leading-relaxed">
            Nothing was torn down, so the failed step can simply run again.
          </p>
          <Button
            variant="outline"
            size="sm"
            className="w-fit gap-1.5"
            disabled={retrying}
            onClick={() => {
              void handleRetry()
            }}
          >
            {retrying ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />}
            Retry the failed step
          </Button>
          {note === null ? null : <p className="text-xs text-muted-foreground">{note}</p>}
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
    return "The platform is provisioned. The last steps confirm it really answers before you continue — your logs stay available above."
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
