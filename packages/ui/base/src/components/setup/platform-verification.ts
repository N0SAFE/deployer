import type { SetupPostSetupVerification, SetupVerificationTarget } from "@deployer/contracts-entities"

import type { ProgressTask, TaskStatus } from "@deployer/ui/components/setup/progress-tasks"

/**
 * The wizard's last gate: do the API and the dashboard REALLY answer?
 *
 * ── WHY THIS IS NOT DERIVED FROM THE STREAM ──────────────────────────────────
 * The ingress is replaced at the very end of setup, which tears the wizard's own
 * connection down. The stream reporting "done" therefore says the PIPELINE
 * finished — it cannot say the operator's browser can open the platform, and the
 * old completion logic (the API speaking again ⇒ everything before it is done)
 * unlocked the Continue button in front of a platform that did not answer yet.
 *
 * So the button is gated on a CHECK with two halves that fail independently:
 *
 *   SERVER  the platform asks its own ingress for the hostname, with the Host
 *           header the browser would send. Only the platform can tell "the
 *           ingress is up but has no route yet" from "the backend is failing".
 *   BROWSER the browser dials the same surface itself. Only the browser can know
 *           that DNS, the port and the network path work from where the operator
 *           sits — a server-side pass says nothing about that.
 *
 * Both must pass. A target the install does not include (no dashboard on an
 * "API only" setup) is skipped, never failed.
 */

export interface BrowserProbe {
  ok: boolean
  detail: string
}

/**
 * Whether the BROWSER can reach `url` at all.
 *
 * `no-cors` on purpose: the surfaces are different origins from the wizard and
 * send no CORS headers for it. The response is OPAQUE — its status is hidden — so
 * this proves only that something answered over the network, and a Traefik
 * "no route" 404 looks identical to a real page. That is exactly why the SERVER
 * half exists; this half answers the one question the server cannot: "can THIS
 * browser get there?".
 */
export async function probeFromBrowser(
  url: string,
  options: { timeoutMs?: number; fetchImpl?: typeof fetch } = {},
): Promise<BrowserProbe> {
  const { timeoutMs = 5_000, fetchImpl = fetch } = options
  const controller = new AbortController()
  const timer = setTimeout(() => {
    controller.abort()
  }, timeoutMs)
  try {
    await fetchImpl(url, { mode: "no-cors", cache: "no-store", signal: controller.signal })
    return { ok: true, detail: "answered" }
  } catch (error: unknown) {
    const aborted = controller.signal.aborted
    return {
      ok: false,
      detail: aborted
        ? `no answer within ${String(timeoutMs / 1000)}s`
        : `this browser cannot reach it (${error instanceof Error ? error.message : String(error)})`,
    }
  } finally {
    clearTimeout(timer)
  }
}

/** What the wizard knows about one target at one moment. */
export interface TargetObservation {
  /** The server's verdict, or null while the platform has not answered the question yet. */
  target: SetupVerificationTarget | null
  /** The browser's most recent probe of `target.probeUrl`, or null if none ran yet. */
  browser: BrowserProbe | null
  /** The platform could not be asked (API mid-swap) — a WAIT, not a verdict. */
  serverUnavailable: boolean
}

export type TargetVerdict =
  | { state: "pending"; lines: string[] }
  | { state: "checking"; lines: string[] }
  | { state: "ok"; lines: string[] }
  | { state: "skipped"; lines: string[] }
  | { state: "failing"; lines: string[] }

/**
 * One target's verdict, with the lines that justify it.
 *
 * `failing` means "not yet" — the caller turns it into a hard failure only after
 * its deadline. During the ingress swap every target fails for a while, so
 * treating the first failure as final would reject a healthy platform.
 */
export function judgeTarget(label: string, observation: TargetObservation): TargetVerdict {
  const { target, browser, serverUnavailable } = observation

  if (target === null) {
    return serverUnavailable
      ? { state: "checking", lines: ["Waiting for the platform API to answer (the ingress is switching)…"] }
      : { state: "pending", lines: [] }
  }
  if (!target.expected) {
    return { state: "skipped", lines: [`${label} is not part of this installation`] }
  }

  const lines: string[] = []
  lines.push(
    target.routed.ok
      ? `Cluster ingress routes ${target.host}: ${target.routed.detail}`
      : `Cluster ingress does not route ${target.host} yet: ${target.routed.detail}`,
  )
  if (!target.routed.ok) return { state: "failing", lines }

  if (target.probeUrl === null) return { state: "ok", lines }
  if (browser === null) {
    lines.push(`Checking that this browser can reach ${target.probeUrl}…`)
    return { state: "checking", lines }
  }
  lines.push(
    browser.ok
      ? `This browser reached ${target.probeUrl}`
      : `This browser could not reach ${target.probeUrl}: ${browser.detail}`,
  )
  return { state: browser.ok ? "ok" : "failing", lines }
}

const STATUS_BY_STATE: Record<TargetVerdict["state"], (expired: boolean) => TaskStatus> = {
  pending: () => "pending",
  checking: () => "running",
  ok: () => "done",
  skipped: () => "done",
  failing: (expired) => (expired ? "error" : "running"),
}

export interface VerificationInput {
  verification: SetupPostSetupVerification | null
  browserByTarget: Partial<Record<SetupVerificationTarget["id"], BrowserProbe>>
  /** The platform could not be asked (a transport error), as opposed to "not asked yet". */
  serverUnavailable: boolean
  /** Whether the verification has started (the server pipeline reported done). */
  active: boolean
  /** The deadline passed: a target that still fails is now a FAILURE, not a wait. */
  expired: boolean
}

const TARGETS: { id: SetupVerificationTarget["id"]; label: string; title: string; description: string }[] = [
  {
    id: "api",
    label: "The API",
    title: "Check that the API is reachable",
    description: "Routed by the cluster ingress, and reachable from this browser",
  },
  {
    id: "web",
    label: "The dashboard",
    title: "Check that the dashboard is reachable",
    description: "Routed by the cluster ingress, and reachable from this browser",
  },
]

/**
 * The two verification steps as ordinary progress tasks, so they render on the
 * SAME timeline as the pipeline's steps rather than as a separate widget.
 *
 * Ids are prefixed `verify_` and are NOT in the stream's step vocabulary: they
 * are produced here, from the platform's answer and the browser's own probes, so
 * a dropped stream event can never fake or hide them.
 */
export function buildVerificationTasks(input: VerificationInput): ProgressTask[] {
  return TARGETS.map(({ id, label, title, description }) => {
    const target = input.verification?.targets.find((candidate) => candidate.id === id) ?? null
    const verdict = input.active
      ? judgeTarget(label, { target, browser: input.browserByTarget[id] ?? null, serverUnavailable: input.serverUnavailable })
      : ({ state: "pending", lines: [] } satisfies TargetVerdict)
    const status = STATUS_BY_STATE[verdict.state](input.expired)
    return {
      id: `verify_${id}`,
      label: title,
      description: verdict.state === "skipped" ? `${label} is not part of this installation` : description,
      status,
      logs: verdict.lines,
      ...(status === "error" ? { error: verdict.lines.at(-1) ?? "not reachable" } : {}),
    }
  })
}

/** Whether every verification step passed (skipped counts as passed). */
export function isVerified(tasks: ProgressTask[]): boolean {
  return tasks.length > 0 && tasks.every((task) => task.status === "done")
}

/** Whether a verification step has given up. */
export function verificationFailed(tasks: ProgressTask[]): boolean {
  return tasks.some((task) => task.status === "error")
}
