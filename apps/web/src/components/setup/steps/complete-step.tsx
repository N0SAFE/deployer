import { CheckCircle2, Copy, Loader2 } from "lucide-react"
import { useState } from "react"
import { Button } from "@repo/ui/components/shadcn/button"
import { useRouter, useSearchParams } from "next/navigation"
import { AuthDashboard } from "@/routes"

type Props = {
  nodeId: string
  strategy: "local" | "remote"
  /** For local: { username, email, dbMode } */
  localInfo?: { username: string; email: string; password: string; dbMode: "managed" | "existing" }
  /** For remote: { meshUrl } */
  remoteInfo?: { meshUrl: string }
}

export function CompleteStep({ nodeId, strategy, localInfo, remoteInfo }: Props) {
  const [copied, setCopied] = useState(false)
  const [loggingIn, setLoggingIn] = useState(false)
  const [loginError, setLoginError] = useState<string | null>(null)
  const router = useRouter()
  const searchParams = useSearchParams()
  const redirectTo = searchParams.get("redirectTo") ?? "/dashboard"

  /** Auto-login using BetterAuth credentials from setup */
  async function handleContinue() {
    setLoggingIn(true)
    setLoginError(null)

    try {
      // For local: auto-login with credentials the user just entered
      if (localInfo?.email && localInfo?.password) {
        const res = await fetch("/api/auth/sign-in/email", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: localInfo.email, password: localInfo.password }),
        })

        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error((body as Record<string, unknown>).message as string ?? "Sign in failed")
        }
      }

      // Success — redirect to the target URL
      router.push(redirectTo)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      setLoginError(msg)
      setLoggingIn(false)
    }
  }

  const summary =
    strategy === "remote" && remoteInfo
      ? {
          title: "Node joined the cluster",
          line1: `Entry: ${remoteInfo.meshUrl}`,
          line2: "Authenticated via remote peer",
          line3: "Configuration synced",
        }
      : {
          title: "Your cluster is online",
          line1: localInfo ? `Admin: ${localInfo.username} (${localInfo.email})` : "Admin account created",
          line2: localInfo?.dbMode === "managed" ? "Database: managed PostgreSQL" : "Database: existing PostgreSQL",
          line3: "Node role: founding peer",
        }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(nodeId)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // ignore
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col items-center gap-3 text-center py-2">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-950/50">
          <CheckCircle2 className="h-8 w-8 text-emerald-600" aria-hidden="true" />
        </div>
        <h2 className="text-2xl font-semibold tracking-tight text-balance">{summary.title}</h2>
        <p className="text-sm text-muted-foreground leading-relaxed max-w-md text-pretty">
          The local SQLite registry has been sealed and this node is ready to serve traffic.
        </p>
      </div>

      <div className="rounded-lg border border-border bg-muted/20 p-5 flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Node ID</span>
          <div className="flex items-center gap-2">
            <code className="font-mono text-sm bg-background border border-border rounded-md px-3 py-2 flex-1 break-all">
              {nodeId}
            </code>
            <Button
              size="icon"
              variant="outline"
              onClick={handleCopy}
              aria-label="Copy node ID"
              title={copied ? "Copied!" : "Copy"}
            >
              <Copy className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="border-t border-border" />

        <ul className="flex flex-col gap-1.5 text-sm">
          <li className="flex items-center gap-2 text-muted-foreground">
            <span className="h-1 w-1 rounded-full bg-muted-foreground" aria-hidden="true" />
            <span>{summary.line1}</span>
          </li>
          <li className="flex items-center gap-2 text-muted-foreground">
            <span className="h-1 w-1 rounded-full bg-muted-foreground" aria-hidden="true" />
            <span>{summary.line2}</span>
          </li>
          <li className="flex items-center gap-2 text-muted-foreground">
            <span className="h-1 w-1 rounded-full bg-muted-foreground" aria-hidden="true" />
            <span>{summary.line3}</span>
          </li>
        </ul>
      </div>

      {loginError && (
        <p className="text-xs text-destructive text-center">{loginError}</p>
      )}

      <Button
        className="w-full gap-2"
        onClick={handleContinue}
        disabled={loggingIn}
      >
        {loggingIn ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Signing in…
          </>
        ) : (
          "Continue to dashboard"
        )}
      </Button>
    </div>
  )
}
