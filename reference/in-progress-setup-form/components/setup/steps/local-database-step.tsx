"use client"

import { useEffect, useState } from "react"
import { ArrowLeft, ArrowRight, Database, Sparkles, Lock, Server, HardDrive } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { ConnectionStatus } from "@/components/setup/connection-status"
import { checkPostgresReachability } from "@/lib/setup/mock-api"
import type { ConnectionState, LocalDbMode } from "@/lib/setup/types"

type Props = {
  initial: { dbMode: LocalDbMode; dbUrl: string }
  onBack: () => void
  onContinue: (data: { dbMode: LocalDbMode; dbUrl: string }) => void
}

export function LocalDatabaseStep({ initial, onBack, onContinue }: Props) {
  const [useExisting, setUseExisting] = useState(initial.dbMode === "existing")
  const [dbUrl, setDbUrl] = useState(initial.dbUrl)
  const [state, setState] = useState<ConnectionState>("idle")
  const [detail, setDetail] = useState<string | undefined>()

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
    setState("checking")
    setDetail(undefined)
    let cancelled = false
    const handle = setTimeout(async () => {
      const result = await checkPostgresReachability(dbUrl.trim())
      if (cancelled) return
      if (result.reachable) {
        setState("reachable")
        setDetail(`${result.version} • database: ${result.database}`)
      } else {
        setState("unreachable")
        setDetail(result.error)
      }
    }, 500)
    return () => {
      cancelled = true
      clearTimeout(handle)
    }
  }, [useExisting, dbUrl])

  const dbMode: LocalDbMode = useExisting ? "existing" : "managed"
  const canContinue = !useExisting || state === "reachable"

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
          "rounded-xl border bg-gradient-to-br from-primary/[0.04] to-transparent p-5 transition-all " +
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
        htmlFor="use-existing"
        className="flex items-start gap-3 rounded-lg border border-border bg-muted/20 p-4 cursor-pointer hover:bg-muted/30 transition-colors"
      >
        <Checkbox
          id="use-existing"
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
              <Label htmlFor="db-url" className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Connection string
              </Label>
              <Input
                id="db-url"
                value={dbUrl}
                onChange={(e) => setDbUrl(e.target.value)}
                placeholder="postgres://user:password@host:5432/dbname"
                className="font-mono text-sm h-10"
                spellCheck={false}
                autoComplete="off"
              />
              <ConnectionStatus
                state={state}
                idleLabel="Waiting for connection string"
                checkingLabel="Connecting to database..."
                reachableLabel="Database is reachable"
                unreachableLabel="Cannot connect to database"
                detail={detail}
              />
              <p className="text-xs text-muted-foreground leading-relaxed">
                Tip: include <span className="font-mono text-foreground/80">fail</span> in the URL to see the failure
                state.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 pt-1">
        <Button variant="ghost" onClick={onBack} className="gap-2">
          <ArrowLeft className="h-4 w-4" />
          Back
        </Button>
        <Button
          disabled={!canContinue}
          onClick={() => onContinue({ dbMode, dbUrl: dbUrl.trim() })}
          className="gap-2"
          size="lg"
        >
          Run setup
          <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}

function FeatureLine({ icon: Icon, label }: { icon: typeof Database; label: string }) {
  return (
    <li className="flex items-center gap-2 text-xs text-muted-foreground">
      <Icon className="h-3.5 w-3.5 shrink-0 text-primary/80" aria-hidden="true" />
      <span className="font-mono">{label}</span>
    </li>
  )
}
