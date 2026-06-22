"use client"

import { useCallback, useMemo, useState } from "react"
import { Boxes } from "lucide-react"
import { StepIndicator } from "@/components/setup/step-indicator"
import { ModeStep } from "@/components/setup/steps/mode-step"
import { RemoteUrlStep } from "@/components/setup/steps/remote-url-step"
import { RemoteAuthStep } from "@/components/setup/steps/remote-auth-step"
import { RemoteProgressStep } from "@/components/setup/steps/remote-progress-step"
import { LocalAccountStep } from "@/components/setup/steps/local-account-step"
import { LocalDatabaseStep } from "@/components/setup/steps/local-database-step"
import { LocalProgressStep } from "@/components/setup/steps/local-progress-step"
import { CompleteStep } from "@/components/setup/steps/complete-step"
import { initialWizardState, getStepIndex } from "@/lib/setup/wizard-state"
import type { WizardState } from "@/lib/setup/types"

const remoteLabels = ["Mode", "Mesh URL", "Authenticate", "Setup", "Done"]
const localLabels = ["Mode", "Account", "Database", "Setup", "Done"]
const defaultLabels = ["Mode", "Configure", "Verify", "Setup", "Done"]

export function SetupWizard() {
  const [state, setState] = useState<WizardState>(initialWizardState)

  const labels = state.mode === "remote" ? remoteLabels : state.mode === "local" ? localLabels : defaultLabels
  const { current, total } = useMemo(() => getStepIndex(state), [state])

  const handleRemoteDone = useCallback(({ nodeId }: { nodeId: string }) => {
    setState((s) => ({ ...s, finalNodeId: nodeId, step: "complete" }))
  }, [])

  const handleLocalDone = useCallback(({ nodeId }: { nodeId: string }) => {
    setState((s) => ({ ...s, finalNodeId: nodeId, step: "complete" }))
  }, [])

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
          <ModeStep
            initialMode={state.mode}
            onContinue={(mode) =>
              setState((s) => ({
                ...s,
                mode,
                step: mode === "remote" ? "remote-url" : "local-account",
              }))
            }
          />
        ) : null}

        {state.step === "remote-url" ? (
          <RemoteUrlStep
            initialUrl={state.remote.meshUrl}
            onBack={() => setState((s) => ({ ...s, step: "mode" }))}
            onContinue={({ url, meshName, nodeCount }) =>
              setState((s) => ({
                ...s,
                step: "remote-auth",
                remote: { ...s.remote, meshUrl: url, meshName, nodeCount },
              }))
            }
          />
        ) : null}

        {state.step === "remote-auth" ? (
          <RemoteAuthStep
            meshUrl={state.remote.meshUrl}
            meshName={state.remote.meshName ?? "unknown"}
            onBack={() => setState((s) => ({ ...s, step: "remote-url" }))}
            onAuthenticated={({ user, sessionToken }) =>
              setState((s) => ({
                ...s,
                step: "remote-progress",
                remote: { ...s.remote, user, sessionToken },
              }))
            }
          />
        ) : null}

        {state.step === "remote-progress" && state.remote.user && state.remote.sessionToken ? (
          <RemoteProgressStep
            user={state.remote.user}
            meshName={state.remote.meshName ?? "unknown"}
            sessionToken={state.remote.sessionToken}
            onDone={handleRemoteDone}
          />
        ) : null}

        {state.step === "local-account" ? (
          <LocalAccountStep
            initial={{
              username: state.local.username,
              email: state.local.email,
              password: state.local.password,
            }}
            onBack={() => setState((s) => ({ ...s, step: "mode" }))}
            onContinue={({ username, email, password }) =>
              setState((s) => ({
                ...s,
                step: "local-database",
                local: { ...s.local, username, email, password },
              }))
            }
          />
        ) : null}

        {state.step === "local-database" ? (
          <LocalDatabaseStep
            initial={{ dbMode: state.local.dbMode, dbUrl: state.local.dbUrl }}
            onBack={() => setState((s) => ({ ...s, step: "local-account" }))}
            onContinue={({ dbMode, dbUrl }) =>
              setState((s) => ({
                ...s,
                step: "local-progress",
                local: { ...s.local, dbMode, dbUrl },
              }))
            }
          />
        ) : null}

        {state.step === "local-progress" && state.local.dbMode ? (
          <LocalProgressStep
            username={state.local.username}
            email={state.local.email}
            dbMode={state.local.dbMode}
            dbUrl={state.local.dbUrl}
            onDone={handleLocalDone}
          />
        ) : null}

        {state.step === "complete" ? (
          <CompleteStep state={state} onReset={() => setState(initialWizardState)} />
        ) : null}
      </div>

      <footer className="flex items-center justify-between text-xs text-muted-foreground">
        <span>Node identity persists to the local SQLite registry on this machine.</span>
        <a className="hover:text-foreground transition-colors" href="#">
          Need help?
        </a>
      </footer>
    </div>
  )
}
