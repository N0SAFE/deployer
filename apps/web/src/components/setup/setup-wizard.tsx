"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Boxes } from "lucide-react"
import { useTriggerInitialize, useInitializeStream, useSetupState } from "@/domains/setup/hooks"
import type { SetupStreamEvent } from "@repo/contracts-entities"
import { StepIndicator } from "@/components/setup/step-indicator"
import { ModeStep } from "@/components/setup/steps/mode-step"
import { RemoteUrlStep } from "@/components/setup/steps/remote-url-step"
import { RemoteAuthStep } from "@/components/setup/steps/remote-auth-step"
import { ProgressStep, type ProgressStepContext } from "@/components/setup/steps/progress-step"
import { LocalAccountStep } from "@/components/setup/steps/local-account-step"
import { LocalDatabaseStep } from "@/components/setup/steps/local-database-step"
import { Alert, AlertDescription } from "@repo/ui/components/shadcn/alert"
import { toast } from "sonner"

type WizardStep =
  | "mode"
  | "remote-url"
  | "remote-auth"
  | "remote-progress"
  | "local-account"
  | "local-database"
  | "local-progress"
  | "complete"

type WizardState = {
  step: WizardStep
  mode: "local" | "remote" | null
  remote: {
    meshUrl: string
    authToken: string | null
  }
  local: {
    username: string
    email: string
    password: string
    organizationName: string
    dbMode: "managed" | "existing"
    dbUrl: string
  }
  recovery: boolean // true when we auto-navigated from existing stream events
}

const initialState: WizardState = {
  step: "mode",
  mode: null,
  remote: { meshUrl: "", authToken: null },
  local: { username: "", email: "", password: "", organizationName: "", dbMode: "managed", dbUrl: "" },
  recovery: false,
}

const remoteLabels = ["Mode", "Mesh URL", "Authenticate", "Setup", "Done"]
const localLabels = ["Mode", "Database", "Account", "Setup", "Done"]
const defaultLabels = ["Mode", "Configure", "Verify", "Setup", "Done"]

export function SetupWizard() {
  const [state, setState] = useState<WizardState>(initialState)
  const { data: setupState } = useSetupState()

  // ── Stream enable — only active when init is running or was triggered ──────
  const [streamEnabled, setStreamEnabled] = useState(false)

  // ── Trigger initialization (POST) ──────────────────────────────────────────
  const triggerInit = useTriggerInitialize()

  // ── Stream initialization events via TanStack Query (observable) ───────────
  // Only enabled when we know init is actually happening (server state or trigger).
  // This avoids stale cached events from a previous session.
  const initializeStream = useInitializeStream({ enabled: streamEnabled })
  const events: SetupStreamEvent[] = initializeStream.data ?? []

  // ── Recovery: detect ongoing init from server state, enable stream & skip
  //    straight to progress view without asking for config again.
  const recoveryChecked = useRef(false)

  useEffect(() => {
    if (recoveryChecked.current) return
    if (!setupState) return // not loaded yet

    recoveryChecked.current = true

    if (setupState.state === "completed") {
      // Setup already done — the middleware should redirect away, but if
      // the user lands here, show a simple message or just stay on normal
      // flow (the setup state query will confirm they don't need setup).
      // We don't have nodeId/strategy detail here, so skip CompleteStep.
      return
    }

    if (setupState.state === "provisioning") {
      // Server says init is actively running — enable stream & show progress
      setStreamEnabled(true)
      setState((prev) => ({
        ...prev,
        step: "local-progress",
        mode: setupState.strategy ?? "local",
        recovery: true,
      }))
    }
    // Any other state (not_started, awaiting_strategy, etc.) → normal flow
  }, [setupState])

  // Capture completed event — show success toast and set localStorage hint flag.
  useEffect(() => {
    if (state.step !== "local-progress" && state.step !== "remote-progress") return
    const completed = events.find((e) => e.type === "completed")
    if (!completed) return
    toast.success("Initial setup completed successfully")
    try { localStorage.setItem("post-setup-complete", "1") } catch { /* noop */ }
  }, [events, state.step])

  const labels = state.mode === "remote" ? remoteLabels : state.mode === "local" ? localLabels : defaultLabels
  const { current, total } = useMemo(() => getStepIndex(state), [state])

  const handleModeContinue = useCallback((mode: "local" | "remote") => {
    setState((s) => ({
      ...s,
      mode,
      step: mode === "remote" ? "remote-url" : "local-database",
    }))
  }, [])

  const handleRemoteUrlContinue = useCallback((data: { url: string }) => {
    setState((s) => ({
      ...s,
      step: "remote-auth",
      remote: { ...s.remote, meshUrl: data.url },
    }))
  }, [])

  const handleRemoteAuth = useCallback((data: { authToken: string }) => {
    const merged = { ...state.remote, ...data }
    setState((s) => ({
      ...s,
      step: "remote-progress",
      remote: merged,
    }))
    // Auto-trigger initialization
    setStreamEnabled(true)
    if (merged.authToken && merged.meshUrl) {
      triggerInit.mutate({
        strategy: "remote",
        meshUrl: merged.meshUrl,
        authToken: merged.authToken,
        serverUrl: process.env.NEXT_PUBLIC_API_URL || window.location.origin,
      })
    }
  }, [state.remote, triggerInit])

  const handleLocalAccountContinue = useCallback(
    (data: { username: string; email: string; password: string }) => {
      const merged = { ...state.local, ...data }
      setState((s) => ({
        ...s,
        step: "local-progress",
        local: merged,
      }))
      setStreamEnabled(true)
      triggerInit.mutate({
        strategy: "local",
        name: merged.username,
        email: merged.email,
        password: merged.password,
        organizationName: merged.organizationName || merged.username,
        serverUrl: process.env.NEXT_PUBLIC_API_URL || window.location.origin,
        existingDatabaseUrl: merged.dbMode === "existing" ? merged.dbUrl : undefined,
      })
    },
    [state.local, triggerInit],
  )

  const handleLocalDatabaseContinue = useCallback(
    (data: { dbMode: "managed" | "existing"; dbUrl: string }) => {
      setState((s) => ({
        ...s,
        step: "local-account",
        local: { ...s.local, ...data },
      }))
    },
    [],
  )

  const handleReset = useCallback(() => {
    setState({ ...initialState })
    setStreamEnabled(false)
    recoveryChecked.current = false
    triggerInit.reset()
  }, [triggerInit])

  const error = triggerInit.error ?? initializeStream.error

  return (
    <div className="flex flex-col gap-8">
      <header className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-foreground text-background">
            <Boxes className="h-4 w-4" aria-hidden="true" />
          </div>
          <div className="flex flex-col">
            <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              Mesh node
            </span>
            <span className="text-sm font-semibold leading-tight">First-time setup</span>
          </div>
        </div>
        <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">v1.0.0</span>
      </header>

      <StepIndicator current={current} total={total} labels={labels} />

      <div className="rounded-xl border border-border bg-card p-6 md:p-8 shadow-sm">
        {state.step === "mode" ? (
          <ModeStep initialMode={state.mode} onContinue={handleModeContinue} />
        ) : null}

        {state.step === "remote-url" ? (
          <RemoteUrlStep
            initialUrl={state.remote.meshUrl}
            onBack={() => setState((s) => ({ ...s, step: "mode" }))}
            onContinue={handleRemoteUrlContinue}
          />
        ) : null}

        {state.step === "remote-auth" ? (
          <RemoteAuthStep
            meshUrl={state.remote.meshUrl}
            onBack={() => setState((s) => ({ ...s, step: "remote-url" }))}
            onAuthenticated={handleRemoteAuth}
          />
        ) : null}

        {state.step === "remote-progress" ? (
          <>
            <ProgressStep
              events={events}
              context={{ mode: "remote", meshUrl: state.remote.meshUrl } satisfies ProgressStepContext}
            />
            {error ? (
              <Alert variant="destructive" className="mt-4">
                <AlertDescription>{error.message}</AlertDescription>
              </Alert>
            ) : null}
          </>
        ) : null}

        {state.step === "local-account" ? (
          <LocalAccountStep
            initial={{
              username: state.local.username,
              email: state.local.email,
              password: state.local.password,
            }}
            onBack={() => setState((s) => ({ ...s, step: "local-database" }))}
            onContinue={handleLocalAccountContinue}
          />
        ) : null}
        {state.step === "local-database" ? (
          <LocalDatabaseStep
            initial={{ dbMode: state.local.dbMode, dbUrl: state.local.dbUrl }}
            onBack={() => setState((s) => ({ ...s, step: "mode" }))}
            onContinue={handleLocalDatabaseContinue}
          />
        ) : null}

        {state.step === "local-progress" ? (
          <>
            <ProgressStep
              events={events}
              context={{
                mode: "local",
                username: state.local.username,
                email: state.local.email,
                password: state.local.password,
                dbMode: state.local.dbMode,
                dbUrl: state.local.dbUrl,
                recovery: state.recovery,
              } satisfies ProgressStepContext}
            />
            {error ? (
              <Alert variant="destructive" className="mt-4">
                <AlertDescription>{error.message}</AlertDescription>
              </Alert>
            ) : null}
          </>
        ) : null}
      </div>

      <footer className="flex items-center justify-between text-xs text-muted-foreground">
        <span>Node identity persists to the local SQLite registry on this machine.</span>
        <button
          type="button"
          onClick={handleReset}
          className="hover:text-foreground transition-colors"
        >
          Start over
        </button>
      </footer>
    </div>
  )
}

function getStepIndex(state: WizardState): { current: number; total: number } {
  if (state.mode === "remote") {
    const order: WizardStep[] = ["mode", "remote-url", "remote-auth", "remote-progress", "complete"]
    const idx = order.indexOf(state.step)
    return { current: idx === -1 ? 0 : idx, total: order.length }
  }
  if (state.mode === "local") {
    const order: WizardStep[] = ["mode", "local-database", "local-account", "local-progress", "complete"]
    const idx = order.indexOf(state.step)
    return { current: idx === -1 ? 0 : idx, total: order.length }
  }
  return { current: 0, total: 5 }
}
