import { Injectable, Logger } from '@nestjs/common'

@Injectable()

/**
 * Type guard that narrows `unknown` to a record-like object so we can
 * index it with string keys. Used in place of `as Record<string, unknown>`
 * to avoid the runtime lie.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
export class ReachabilityService {
  private readonly logger = new Logger(ReachabilityService.name)

  /**
   * Checks whether the given mesh URL is reachable by making a direct
   * HTTP GET to `{origin}/mesh/ping` with a 5-second timeout.
   *
   * Why `/mesh/ping` and not `/mesh/node/local`?
   * `getLocalNode` is gated behind `requireAuth() + requireInternalMesh()`
   * because it returns internal topology (region, zone, roles, lifecycle,
   * routing mode, …). A pre-auth reachability probe has neither a session
   * nor an internal key, so it would always 401. `/mesh/ping` is a
   * purpose-built, unauthenticated route that returns just `{ ok,
   * version, advertisedHost }` — enough to know the peer is alive and
   * what URL to dial back, nothing more.
   *
   * This is the probe used during the remote setup wizard step; it mirrors
   * the logic in SetupController.probeMesh.
   *
   * @returns An object with reachable flag, latency, and optional metadata
   *          returned by the remote mesh node.
   */
  async checkMeshUrlReachability(url: string): Promise<{
    url: string
    reachable: boolean
    probeUrl: string
    latencyMs: number
    advertisedHost?: string
    version?: string
    /**
     * Human-readable failure reason. Populated when `reachable` is false
     * (network error, non-2xx HTTP response, or connection refused).
     * Always `undefined` when `reachable` is true.
     */
    error?: string
  }> {
    let parsed: URL
    try {
      parsed = new URL(url.trim())
    } catch {
      return { url, reachable: false, probeUrl: url, latencyMs: 0, error: "Invalid URL format" }
    }

    const start = Date.now()
    const abort = new AbortController()
    const timeout = setTimeout(() => { abort.abort() }, 5_000)

    try {
      this.logger.debug(`Probing mesh reachability at ${parsed.origin}/mesh/ping`)
      const res = await fetch(`${parsed.origin}/mesh/ping`, {
        method: 'GET',
        signal: abort.signal,
      })

      const latencyMs = Date.now() - start

      if (!res.ok) {
        this.logger.warn(`Mesh unreachable: HTTP ${String(res.status)} from ${parsed.origin}`)
        return { url, reachable: false, probeUrl: url, latencyMs, error: `HTTP ${String(res.status)}` }
      }

      const json = await res.json().catch(() => ({})) as Record<string, unknown>
      this.logger.log(`✅ Mesh reachable at ${parsed.origin} (${latencyMs}ms)`)
      return {
        url,
        reachable: true,
        probeUrl: url,
        latencyMs,
        advertisedHost: typeof json.advertisedHost === 'string' && json.advertisedHost.length > 0
          ? json.advertisedHost
          : undefined,
        version: typeof json.version === 'string' ? json.version : undefined,
      }
    } catch (err: unknown) {
      const latencyMs = Date.now() - start
      const message = err instanceof Error ? err.message : String(err)
      this.logger.warn(`Mesh unreachable at ${parsed.origin}: ${message}`)
      return { url, reachable: false, probeUrl: url, latencyMs, error: message }
    } finally {
      clearTimeout(timeout)
    }
  }
}