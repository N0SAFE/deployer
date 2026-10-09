"use client"

import { useEffect, useMemo, useState } from "react"
import type { SetupVerificationTarget } from "@repo/contracts-entities"

import {
  buildVerificationTasks,
  isVerified,
  probeFromBrowser,
  verificationFailed,
  type BrowserProbe,
} from "@repo/ui/components/setup/platform-verification"
import type { ProgressTask } from "@repo/ui/components/setup/progress-tasks"
import type { SetupWizardApi } from "@repo/ui/components/setup/types"

/**
 * How long the platform has to start answering before the check gives up.
 *
 * The ingress swap legitimately fails every probe for a while — the entry port
 * changes owner, the new ingress loads its routers, the API restarts behind it —
 * so the first failure is never final. 90s covers a warm swap with margin (setup
 * itself budgets 60s for the new ingress to route), and the wizard offers a retry
 * rather than a dead end when it is exceeded.
 */
export const VERIFICATION_DEADLINE_MS = 90_000

/** Cadence of the browser's own probes. The server half is polled by the host's hook. */
const BROWSER_PROBE_INTERVAL_MS = 2_000

/**
 * Runs the final verification while mounted.
 *
 * MOUNT IT ONLY WHEN THE PIPELINE REPORTED DONE, and re-mount it (change its key)
 * to retry: the deadline starts at mount, which is what keeps a retry from
 * inheriting a clock that already ran out.
 *
 * It combines the server's verdict with the browser's own probes into ordinary
 * progress tasks (see `platform-verification.ts`). `passed` LATCHES: once every
 * step passed it stays passed, so one transient blip in the polling cannot take
 * the Continue button away from an operator who is already clicking it.
 */
export function usePlatformVerification(api: SetupWizardApi) {
  const query = api.usePostSetupVerification({ enabled: true })
  const verification = query.data ?? null
  const serverUnavailable = verification === null && query.error !== null && query.error !== undefined

  const [startedAt] = useState(() => Date.now())
  const [now, setNow] = useState(() => Date.now())
  const [browser, setBrowser] = useState<Partial<Record<SetupVerificationTarget["id"], BrowserProbe>>>({})
  const [latched, setLatched] = useState(false)

  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now())
    }, 1_000)
    return () => {
      clearInterval(timer)
    }
  }, [])

  // The browser only probes what the SERVER says is routed: probing earlier would
  // only record "unreachable" for a hostname that has no router yet, which is the
  // server's finding to report, not the browser's.
  const probeTargets = useMemo(
    () =>
      (verification?.targets ?? [])
        .filter((target) => target.expected && target.routed.ok && target.probeUrl !== null)
        .map((target) => ({ id: target.id, url: target.probeUrl ?? "" })),
    [verification],
  )
  // A stable key, because `verification` is a NEW object on every poll and an
  // effect keyed on it would restart the probe loop every two seconds.
  const probeKey = JSON.stringify(probeTargets)
  useEffect(() => {
    const targets = JSON.parse(probeKey) as { id: SetupVerificationTarget["id"]; url: string }[]
    let cancelled = false
    // Local to this run: a target that answered is not probed again, and a changed
    // key (a new URL) starts the loop over with a clean slate.
    const reached = new Set<string>()
    const run = async (): Promise<void> => {
      for (const target of targets) {
        if (reached.has(target.id)) continue
        const result = await probeFromBrowser(target.url)
        if (cancelled) return
        if (result.ok) reached.add(target.id)
        setBrowser((previous) => ({ ...previous, [target.id]: result }))
      }
    }
    void run()
    const timer = setInterval(() => {
      void run()
    }, BROWSER_PROBE_INTERVAL_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [probeKey])

  const expired = now - startedAt > VERIFICATION_DEADLINE_MS
  const tasks: ProgressTask[] = buildVerificationTasks({
    verification,
    browserByTarget: browser,
    serverUnavailable,
    active: true,
    expired,
  })

  // Adjusted during render — React's documented pattern for state derived from
  // data. An effect would commit one frame of "not passed" before latching.
  const passedNow = isVerified(tasks)
  if (passedNow && !latched) setLatched(true)

  return {
    tasks,
    passed: latched || passedNow,
    failed: !latched && !passedNow && verificationFailed(tasks),
  }
}
