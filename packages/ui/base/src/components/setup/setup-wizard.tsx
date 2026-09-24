"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Boxes } from "lucide-react"
import { QueryClientProvider } from "@tanstack/react-query"
import type { SetupStreamEvent } from "@repo/contracts-entities"
import { StepIndicator } from "@repo/ui/components/setup/step-indicator"
import { ModeStep } from "@repo/ui/components/setup/steps/mode-step"
import { RemoteUrlStep } from "@repo/ui/components/setup/steps/remote-url-step"
import { RemoteAuthStep } from "@repo/ui/components/setup/steps/remote-auth-step"
import { ProgressStep, type ProgressStepContext } from "@repo/ui/components/setup/steps/progress-step"
import { LocalAccountStep } from "@repo/ui/components/setup/steps/local-account-step"
import { LocalDatabaseStep } from "@repo/ui/components/setup/steps/local-database-step"
import { ClusterStep } from "@repo/ui/components/setup/steps/cluster-step"
import { JoinClusterStep } from "@repo/ui/components/setup/steps/join-cluster-step"
import {
  foundingDraftToSelection,
  joinDraftToSelection,
  type SwarmParticipationDraft,
} from "@repo/ui/components/setup/swarm-participation-form"
import { Alert, AlertDescription } from "@repo/ui/components/shadcn/alert"
import { Button } from "@repo/ui/components/shadcn/button"
import { toast } from "sonner"
import ModeToggle from "@repo/ui/components/shadcn/mode-toggle"
import { markSetupComplete } from "@repo/ui/components/setup/setup-storage"
import { setupQueryClient } from "@repo/ui/components/setup/query-client"
import type { SetupWizardApi } from "@repo/ui/components/setup/types"

type WizardStep =
  | "mode"
  | "remote-url"
  | "remote-auth"
  | "join-cluster"
  | "remote-progress"
  | "cluster"
  | "local-account"
  | "local-database"
  | "local-progress"
  | "complete"

interface WizardState {
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
    dbMode: "managed" | "existing"
    dbUrl: string
  }
  swarm: SwarmParticipationDraft
  recovery: boolean // true when we auto-navigated from existing stream events
}

const initialState: WizardState = {
  step: "mode",
  mode: null,
  remote: { meshUrl: "", authToken: null },
  local: { username: "", email: "", password: "", dbMode: "managed", dbUrl: "" },
  // Swarm is always on: a founding node starts a cluster, so `create` is the
  // default entry mode (the mode itself is implied per wizard branch).
  swarm: { mode: "create", policy: "auto", advertiseAddr: "", joinToken: "", joinAddrs: "" },
  recovery: false,
}

const remoteLabels = ["Mode", "Mesh URL", "Authenticate", "Cluster", "Setup", "Done"]
const localLabels = ["Mode", "Cluster", "Database", "Account", "Setup", "Done"]
const defaultLabels = ["Mode", "Configure", "Verify", "Setup", "Done"]

export interface SetupWizardProps {
  /**
   * Host-supplied data access. The API and the web app reach the platform
   * through different ORPC clients, so the shared wizard receives behaviour
   * instead of importing a client — that is what makes one implementation
   * serve both apps.
   */
  api: SetupWizardApi
}

export function SetupWizard({ api }: SetupWizardProps) {
  // Own the React Query context HERE rather than relying on an ancestor: the
  // wizard is mounted from several SSR entry paths, and a missing (or
  // duplicated) provider is fatal at render time — "No QueryClient set, use
  // QueryClientProvider" is exactly how this page failed. Owning it makes the
  // wizard self-contained regardless of how the host composes providers.
  return (
    <QueryClientProvider client={setupQueryClient}>
      <SetupWizardContent api={api} />
    </QueryClientProvider>
  )
}

function SetupWizardContent({ api }: SetupWizardProps) {
  const { useSetupState, useTriggerInitialize, useInitializeStream, getErrorMessage, apiBaseUrl, signInWithEmail, postSetupRedirectUrl } = api
  const [state, setState] = useState<WizardState>(initialState)
  const { data: setupState } = useSetupState()

  // ── Stream enable ────────────────────────────────────────────────
  // A reload while the server is mid-provision must subscribe too, or the
  // progress view would sit empty on an init this client never started.
  const [streamRequested, setStreamRequested] = useState(false)
  const streamEnabled = streamRequested || setupState?.state === "provisioning"

  // ── Trigger initialization (POST) ──────────────────────────────────────────
  const triggerInit = useTriggerInitialize()

  // ── Stream initialization events via TanStack Query (observable) ───────────
  // Only enabled when we know init is actually happening (server state or trigger).
  // This avoids stale cached events from a previous session.
  const initializeStream = useInitializeStream({ enabled: streamEnabled })
  // Memoised so `events` keeps its identity between renders: it is a dependency
  // of the completion effect below, and a fresh `[]` on every render would make
  // that effect re-run forever.
  const events: SetupStreamEvent[] = useMemo(
    () => initializeStream.data ?? [],
    [initializeStream.data],
  )

  // ── Recovery: adopt an init the server is already running ──
  // Adjusted during render rather than from an effect — React's documented
  // pattern for state derived from incoming data. An effect would first commit
  // the un-recovered step, flashing the configuration form for a frame before
  // the progress view replaced it.
  const [recoveryAdopted, setRecoveryAdopted] = useState(false)
  if (!recoveryAdopted && setupState?.state === "provisioning") {
    setRecoveryAdopted(true)
    // Narrow to the two strategies the wizard models; anything else is treated
    // as the local flow (the only alternative the bootstrap supports).
    const strategy: "local" | "remote" =
      setupState.bootstrapStrategy === "remote" ? "remote" : "local"
    setState((prev) => ({
      ...prev,
      step: "local-progress",
      mode: strategy,
      recovery: true,
    }))
  }

  // Announce completion once. `announced` guards the toast because the stream
  // can push more events after `completed`, which re-runs this effect.
  const announced = useRef(false)
  useEffect(() => {
    if (announced.current) return
    if (state.step !== "local-progress" && state.step !== "remote-progress") return
    if (!events.some((e) => e.type === "completed")) return
    announced.current = true
    toast.success("Initial setup completed successfully")
    markSetupComplete()
  }, [events, state.step])

  const labels = state.mode === "remote" ? remoteLabels : state.mode === "local" ? localLabels : defaultLabels
  const { current, total } = useMemo(() => getStepIndex(state), [state])

  const handleModeContinue = useCallback((mode: "local" | "remote") => {
    setState((s) => ({
      ...s,
      mode,
      step: mode === "remote" ? "remote-url" : "cluster",
    }))
  }, [])

  const handleClusterContinue = useCallback((draft: SwarmParticipationDraft) => {
    setState((s) => ({
      ...s,
      step: "local-database",
      swarm: draft,
    }))
  }, [])

  const handleRemoteUrlContinue = useCallback((data: { url: string }) => {
    setState((s) => ({
      ...s,
      step: "remote-auth",
      remote: { ...s.remote, meshUrl: data.url },
    }))
  }, [])

  // Auth succeeded → ask which ROLE this node takes in the cluster before
  // starting (the join itself is triggered from that step).
  const handleRemoteAuth = useCallback((data: { authToken: string }) => {
    setState((s) => ({
      ...s,
      step: "join-cluster",
      remote: { ...s.remote, ...data },
    }))
  }, [])

  const handleJoinClusterContinue = useCallback(
    (draft: SwarmParticipationDraft) => {
      setState((s) => ({
        ...s,
        step: "remote-progress",
        swarm: draft,
      }))
      setStreamRequested(true)
      const { authToken, meshUrl } = state.remote
      if (authToken && meshUrl) {
        triggerInit.mutate({
          strategy: "remote",
          meshUrl,
          authToken,
          serverUrl: apiBaseUrl(),
          swarm: joinDraftToSelection(draft),
        })
      }
    },
    [state.remote, triggerInit, apiBaseUrl],
  )

  const handleLocalAccountContinue = useCallback(
    (data: { username: string; email: string; password: string }) => {
      const merged = { ...state.local, ...data }
      setState((s) => ({
        ...s,
        step: "local-progress",
        local: merged,
      }))
      setStreamRequested(true)
      triggerInit.mutate({
        strategy: "local",
        name: merged.username,
        email: merged.email,
        password: merged.password,
        serverUrl: apiBaseUrl(),
        existingDatabaseUrl: merged.dbMode === "existing" ? merged.dbUrl : undefined,
        // This branch FOUNDS the cluster, so the swarm selection is a
        // founding one (mode is implied: this node starts the swarm).
        swarm: foundingDraftToSelection(state.swarm),
      })
    },
    [state.local, state.swarm, triggerInit, apiBaseUrl],
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
    setStreamRequested(false)
    // Allow recovery adoption to run again — the operator explicitly asked to
    // start over, so an in-flight server init should be re-adopted.
    setRecoveryAdopted(false)
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
        <div className="flex items-center gap-2">
          {/* Light/dark picker. Reuses the platform's shared ModeToggle so the
              wizard and the app expose exactly the same control. The default
              comes from the ThemeProvider (next-themes `system`), so a fresh
              install follows the OS preference until the operator chooses. */}
          <ModeToggle />
          <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">v1.0.0</span>
        </div>
      </header>

      <StepIndicator current={current} total={total} labels={labels} />

      <div className="rounded-xl border border-border bg-card p-6 md:p-8 shadow-sm">
        {state.step === "mode" ? (
          <ModeStep initialMode={state.mode} onContinue={handleModeContinue} />
        ) : null}

        {state.step === "remote-url" ? (
          <RemoteUrlStep
            api={api}
            initialUrl={state.remote.meshUrl}
            onBack={() => {
              setState((s) => ({ ...s, step: "mode" }))
            }}
            onContinue={handleRemoteUrlContinue}
          />
        ) : null}

        {state.step === "remote-auth" ? (
          <RemoteAuthStep
            api={api}
            meshUrl={state.remote.meshUrl}
            onBack={() => {
              setState((s) => ({ ...s, step: "remote-url" }))
            }}
            onAuthenticated={handleRemoteAuth}
          />
        ) : null}

        {state.step === "join-cluster" ? (
          <JoinClusterStep
            initial={state.swarm}
            meshUrl={state.remote.meshUrl}
            onBack={() => {
              setState((s) => ({ ...s, step: "remote-auth" }))
            }}
            onContinue={handleJoinClusterContinue}
          />
        ) : null}

        {state.step === "remote-progress" ? (
          <>
            <ProgressStep
              api={api}
              events={events}
              context={{ mode: "remote", meshUrl: state.remote.meshUrl } satisfies ProgressStepContext}
            />
            {error ? (
              <Alert variant="destructive" className="mt-4">
                <AlertDescription className="flex items-center justify-between gap-2">
                  <span>{getErrorMessage(error)}</span>
                  <Button variant="outline" size="sm" onClick={handleReset}>
                    Retry
                  </Button>
                </AlertDescription>
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
            onBack={() => {
              setState((s) => ({ ...s, step: "local-database" }))
            }}
            onContinue={handleLocalAccountContinue}
          />
        ) : null}
        {state.step === "cluster" ? (
          <ClusterStep
            initial={state.swarm}
            onBack={() => {
              setState((s) => ({ ...s, step: "mode" }))
            }}
            onContinue={handleClusterContinue}
          />
        ) : null}
        {state.step === "local-database" ? (
          <LocalDatabaseStep
            api={api}
            initial={{ dbMode: state.local.dbMode, dbUrl: state.local.dbUrl }}
            onBack={() => {
              setState((s) => ({ ...s, step: "cluster" }))
            }}
            onContinue={handleLocalDatabaseContinue}
          />
        ) : null}

        {state.step === "local-progress" ? (
          <>
            <ProgressStep
              api={api}
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
                <AlertDescription className="flex items-center justify-between gap-2">
                  <span>{getErrorMessage(error)}</span>
                  <Button variant="outline" size="sm" onClick={handleReset}>
                    Retry
                  </Button>
                </AlertDescription>
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
    const order: WizardStep[] = [
      "mode",
      "remote-url",
      "remote-auth",
      "join-cluster",
      "remote-progress",
      "complete",
    ]
    const idx = order.indexOf(state.step)
    return { current: idx === -1 ? 0 : idx, total: order.length }
  }
  if (state.mode === "local") {
    const order: WizardStep[] = ["mode", "cluster", "local-database", "local-account", "local-progress", "complete"]
    const idx = order.indexOf(state.step)
    return { current: idx === -1 ? 0 : idx, total: order.length }
  }
  return { current: 0, total: 5 }
}
