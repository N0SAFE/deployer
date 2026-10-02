"use client"

import { useEffect, useRef, useState } from "react"
import { useForm, useStore } from "@tanstack/react-form"
import { ArrowLeft, ArrowRight, Database, Sparkles, Lock, Server, HardDrive, Check } from "lucide-react"
import { Button } from "@repo/ui/components/shadcn/button"
import { Input } from "@repo/ui/components/shadcn/input"
import { Label } from "@repo/ui/components/shadcn/label"
import { Checkbox } from "@repo/ui/components/shadcn/checkbox"
import { ConnectionStatus, type ConnectionState } from "@repo/ui/components/setup/connection-status"
import { cn } from "@repo/ui/lib/utils"
import type { SetupWizardApi } from "@repo/ui/components/setup/types"

type Props = {
  api: SetupWizardApi
  initial: { dbMode: "managed" | "existing"; dbUrl: string }
  /** The operator's dashboard choice, carried through this step. */
  initialManagedWeb: "managed" | "api-only" | null
  onBack: () => void
  onContinue: (data: {
    dbMode: "managed" | "existing"
    dbUrl: string
    managedWeb: "managed" | "api-only"
  }) => void
}

export function LocalDatabaseStep({ api, initial, initialManagedWeb, onBack, onContinue }: Props) {
  const { useProbeDatabase, getErrorMessage } = api
  const [useExisting, setUseExisting] = useState(initial.dbMode === "existing")
  const [state, setState] = useState<ConnectionState>("idle")
  const [detail, setDetail] = useState<string | undefined>()
  // Defaults to the platform's own dashboard: it ships with the platform and
  // most operators want it. Pre-selecting it (rather than defaulting the VALUE
  // server-side) keeps the decision visible and explicit.
  const [managedWeb, setManagedWeb] = useState<"managed" | "api-only">(initialManagedWeb ?? "managed")
  const probeDb = useProbeDatabase()
  const probeDbRef = useRef(probeDb)
  probeDbRef.current = probeDb

  const dbForm = useForm({
    defaultValues: { dbUrl: initial.dbUrl },
  })

  // useFormStore subscribes to the TanStack store reactively — store.state
  // alone is NOT a React state and never triggers re-renders, so the
  // debounced probe effect never fires.
  const dbUrl = useStore(dbForm.store, (s) => s.values.dbUrl)

  useEffect(() => {
    if (!useExisting) {
      setState("idle")
      setDetail(undefined)
      return
    }
    if (!dbUrl.trim()) {
      setState("idle")
      setDetail(undefined)
      return
    }
    if (!/^postgres(?:ql)?:\/\//i.test(dbUrl.trim())) {
      setState("unreachable")
      setDetail("Connection string must start with postgresql:// or postgres://")
      return
    }
    setState("checking")
    setDetail(undefined)
    let cancelled = false
    const handle = setTimeout(() => {
      probeDbRef.current.mutate(dbUrl.trim(), {
        onSuccess: (result) => {
          if (cancelled) return
          if (result.reachable) {
            setState("reachable")
            setDetail(result.latencyMs ? `${result.latencyMs}ms latency` : "Connected")
          } else {
            setState("unreachable")
            // Normalize empty error detail so the UI never shows a blank reason.
            setDetail(result.error?.trim() ? result.error : "Not reachable")
          }
        },
        onError: (err) => {
          if (cancelled) return
          setState("unreachable")
          setDetail(getErrorMessage(err))
        },
      })
    }, 500)
    return () => {
      cancelled = true
      clearTimeout(handle)
    }
  }, [useExisting, dbUrl])

  const dbMode: "managed" | "existing" = useExisting ? "existing" : "managed"
  // The probe is ADVISORY: the check runs from the API's network context, and
  // a database that is perfectly healthy on the user's machine may be
  // unreachable from there (the classic `localhost` trap: the API runs in a
  // container, so the host's DB is at a different address). Blocking forever
  // on "unreachable" makes it impossible to proceed with such a DB, even
  // though the URL is correct. So when the user opted in to existing-DB, we
  // allow continuing once the probe settles — the warning makes the risk
  // explicit, and a genuinely bad URL still surfaces the real error.
  const canContinue = !useExisting || state === "reachable" || state === "unreachable"

  return (
    <div className="flex flex-col gap-7">
      <div className="flex flex-col gap-2">
        <h2 className="text-2xl font-semibold tracking-tight text-balance">Provision the database</h2>
        <p className="text-sm text-muted-foreground leading-relaxed text-pretty">
          A PostgreSQL database is required to store mesh state. By default we&apos;ll provision and manage one for
          you on this machine. You can also bring your own.
        </p>
      </div>

      {/* Managed default panel */}
      <div
        className={
          "rounded-xl border bg-linear-to-br from-primary/4 to-transparent p-5 transition-all " +
          (useExisting ? "border-border/60 opacity-60" : "border-primary/40 ring-1 ring-primary/30")
        }
      >
        <div className="flex items-start gap-4">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Sparkles className="h-5 w-5" aria-hidden="true" />
          </div>
          <div className="flex flex-col gap-1.5 flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-base font-semibold text-foreground leading-tight">Managed PostgreSQL</h3>
              {!useExisting ? (
                <span className="font-mono text-[10px] font-medium tracking-[0.18em] px-2 py-0.5 rounded-md bg-primary/10 text-primary">
                  DEFAULT
                </span>
              ) : null}
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed text-pretty">
              We&apos;ll create a dedicated PostgreSQL instance on this node and wire it up automatically. No
              configuration needed.
            </p>
            <ul className="grid sm:grid-cols-2 gap-x-4 gap-y-1.5 mt-2.5">
              <FeatureLine icon={HardDrive} label="Stored at /var/lib/mesh/pgdata" />
              <FeatureLine icon={Server} label="Listens on 127.0.0.1:5432" />
              <FeatureLine icon={Lock} label="Password generated for you" />
              <FeatureLine icon={Database} label="PostgreSQL 16" />
            </ul>
          </div>
        </div>
      </div>

      {/* Toggle row */}
      <label
        htmlFor="setup-use-existing"
        className="flex items-start gap-3 rounded-lg border border-border bg-muted/20 p-4 cursor-pointer hover:bg-muted/30 transition-colors"
      >
        <Checkbox
          id="setup-use-existing"
          checked={useExisting}
          onCheckedChange={(v) => setUseExisting(v === true)}
          className="mt-0.5"
        />
        <div className="flex flex-col gap-0.5 flex-1 min-w-0">
          <span className="text-sm font-medium leading-tight">Use an existing PostgreSQL database</span>
          <span className="text-xs text-muted-foreground leading-relaxed">
            Skip provisioning and connect to a database you already manage.
          </span>
        </div>
      </label>

      {/* Existing-DB connection panel (revealed on toggle) */}
      <div
        className={
          "grid transition-all duration-300 ease-out " +
          (useExisting ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0")
        }
      >
        <div className="overflow-hidden">
          <div className="rounded-xl border border-border bg-card p-5 flex flex-col gap-4">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted text-foreground">
                <Database className="h-4 w-4" aria-hidden="true" />
              </div>
              <div className="flex flex-col gap-0.5 min-w-0">
                <span className="text-sm font-semibold leading-tight">External PostgreSQL</span>
                <span className="text-xs text-muted-foreground leading-tight">
                  Provide a connection string we can verify before continuing.
                </span>
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="setup-db-url" className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Connection string
              </Label>
              <dbForm.Field name="dbUrl">
                {(field) => (
                  <Input
                    id="setup-db-url"
                    value={field.state.value}
                    onChange={(e) => field.handleChange(e.target.value)}
                    placeholder="postgresql://user:pass@host:5432/db"
                    className="font-mono text-xs"
                  />
                )}
              </dbForm.Field>
            </div>

            {dbUrl.trim() ? <ConnectionStatus state={state} detail={detail} /> : null}
            {state === "unreachable" ? (
              <p className="text-xs text-muted-foreground leading-relaxed">
                The connection string could not be verified from this node. If your database is
                on a different machine than this one, use its reachable address — or
                continue anyway; initialization will fail if it is truly unreachable.
              </p>
            ) : null}
          </div>
        </div>
      </div>

      {/*
        Deployment shape. This decision used to be invisible during onboarding:
        it lived in `MANAGED_WEB_APP_ENABLED` and was therefore made BEFORE the
        operator ever saw the wizard, with no way to express it from the UI. It
        is a real choice — a headless/API-first install is a legitimate target,
        not a degraded mode — so it is asked here, alongside the database, and
        forwarded to the API as its seed value.
      */}
      <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-5">
        <div className="flex flex-col gap-1">
          <span className="text-sm font-semibold leading-tight">Dashboard</span>
          <span className="text-xs text-muted-foreground leading-relaxed">
            Whether this instance runs its own web dashboard, supervised by the platform, or serves
            the API alone. You can change this later from the platform console.
          </span>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <DashboardOption
            icon={Sparkles}
            title="Include the dashboard"
            description="The platform spawns and supervises its own web app on this node."
            selected={managedWeb === "managed"}
            onClick={() => setManagedWeb("managed")}
          />
          <DashboardOption
            icon={Server}
            title="API only"
            description="No dashboard on this node. Point your own frontend at the API."
            selected={managedWeb === "api-only"}
            onClick={() => setManagedWeb("api-only")}
          />
        </div>
      </div>

      <div className="flex items-center gap-3">
        <Button type="button" variant="ghost" onClick={onBack} className="gap-2">
          <ArrowLeft className="h-4 w-4" />
          Back
        </Button>
        <Button
          type="button"
          className="flex-1 gap-2"
          disabled={!canContinue || probeDb.isPending}
          onClick={() => onContinue({ dbMode, dbUrl, managedWeb })}
        >
          Continue
          <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}

function FeatureLine({ icon: Icon, label }: { icon: typeof Database; label: string }) {
  return (
    <li className="flex items-center gap-2 text-xs text-muted-foreground">
      <Icon className="h-3.5 w-3.5 shrink-0 text-primary/70" aria-hidden="true" />
      <span>{label}</span>
    </li>
  )
}

/**
 * One deployment-shape option.
 *
 * A `button` with `aria-pressed` rather than a radio: the two options are a
 * single-choice pair rendered as cards, and `aria-pressed` states the selection
 * without needing the group/radio landmark plumbing.
 */
function DashboardOption({
  icon: Icon,
  title,
  description,
  selected,
  onClick,
}: {
  icon: typeof Database
  title: string
  description: string
  selected: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        "flex items-start gap-3 rounded-lg border p-3.5 text-left transition-colors",
        "hover:border-primary/40 hover:bg-muted/40",
        selected ? "border-primary bg-primary/4" : "border-border bg-background/40",
      )}
    >
      <div
        className={cn(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-md transition-colors",
          selected ? "bg-primary text-primary-foreground" : "bg-muted text-foreground",
        )}
      >
        <Icon className="h-4 w-4" aria-hidden="true" />
      </div>
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="flex items-center gap-1.5 text-sm font-medium leading-tight">
          {title}
          {selected ? <Check className="h-3.5 w-3.5 text-primary" aria-hidden="true" /> : null}
        </span>
        <span className="text-xs text-muted-foreground leading-relaxed">{description}</span>
      </div>
    </button>
  )
}
