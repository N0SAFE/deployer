import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common'
import * as crypto from 'node:crypto'

interface PendingProbe {
  url: string
  token: string
  resolve: (value: boolean) => void
  promise: Promise<boolean>
  timer: NodeJS.Timeout,
  startAt: Date
}

@Injectable()
export class ReachabilityService implements OnModuleDestroy {
  private readonly logger = new Logger(ReachabilityService.name)

  // Map<token, PendingProbe> — token is the unique key
  private readonly pendingProbes = new Map<string, PendingProbe>()

  // Map<url, token> — to find an existing probe by URL
  private readonly urlToToken = new Map<string, string>()

  private readonly TIMEOUT_MS = 30_000
  private readonly EXTERNAL_FETCHERS = [
    (url: string) =>
      `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`,
    (url: string) =>
      `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  ]

  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * Returns a Promise<boolean> that resolves when:
   * - The probe endpoint is hit from outside (callback)
   * - An external fetcher confirms reachability
   * - Timeout (resolves false)
   *
   * If a probe is already pending for this URL, returns the existing Promise.
   */
  async checkMeshUrlReachability(url: string): Promise<{
    url: string
    reachable: boolean
    probeUrl: string
    latencyMs: number
  }> {
    // Return existing pending probe if already running
    const existingToken = this.urlToToken.get(url)
    if (existingToken) {
      const existingProb = this.pendingProbes.get(existingToken)
      if (existingProb) {
        this.logger.debug(`Reusing existing probe for ${url}`)
        return existingProb.promise.then((reachable) => ({
          url,
          reachable,
          probeUrl: existingProb.url,
          latencyMs: new Date().getTime() - existingProb.startAt.getTime(),
        }))
      }
    }

    // Create new probe
    const probe = this.createProbe(url)

    // Trigger external fetchers in background (fire & forget)
    void this.triggerExternalFetchers(probe.url, probe.token)

    return probe.promise.then((reachable) => ({
      url,
      reachable,
      probeUrl: probe.url,
      latencyMs: new Date().getTime() - probe.startAt.getTime(),
    }))
  }

  /**
   * Called by the controller when the probe endpoint is hit.
   * Resolves the pending Promise for the matching token.
   */
  resolveProbeByToken(token: string): boolean {
    const probe = this.pendingProbes.get(token)
    if (!probe) {
      this.logger.warn(`No pending probe found for token ${token}`)
      return false
    }

    this.logger.log(`✅ Probe resolved for ${probe.url} via callback`)
    probe.resolve(true)
    this.cleanupProbe(token)
    return true
  }

  // ── Lifecycle ───────────────────────────────────────────────────────────────

  onModuleDestroy(): void {
    // Resolve all pending probes as false on shutdown
    for (const [token, probe] of this.pendingProbes) {
      clearTimeout(probe.timer)
      probe.resolve(false)
      this.pendingProbes.delete(token)
    }
    this.urlToToken.clear()
    this.logger.log('All pending probes resolved on shutdown')
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  private createProbe(url: string): PendingProbe {
    const token = crypto.randomUUID()

    let _resolve!: (value: boolean) => void

    const promise = new Promise<boolean>((resolve) => {
      _resolve = resolve
    })

    const timer = setTimeout(() => {
      this.logger.warn(`⏰ Probe timeout for ${url}`)
      _resolve(false)
      this.cleanupProbe(token)
    }, this.TIMEOUT_MS)

    const probe: PendingProbe = { url, token, resolve: _resolve, promise, timer, startAt: new Date() }

    this.pendingProbes.set(token, probe)
    this.urlToToken.set(url, token)

    this.logger.log(`🔗 Probe created for ${url} — token: ${token}`)

    return probe
  }

  private cleanupProbe(token: string): void {
    const probe = this.pendingProbes.get(token)
    if (!probe) return
    clearTimeout(probe.timer)
    this.pendingProbes.delete(token)
    this.urlToToken.delete(probe.url)
  }

  private async triggerExternalFetchers(url: string, token: string): Promise<void> {
    const probeUrl = `${url}/_probe/${token}`

    this.logger.debug(`📤 Triggering external fetchers for ${probeUrl}`)

    const fetchers = this.EXTERNAL_FETCHERS.map(async (buildUrl) => {
      const fetcherUrl = buildUrl(probeUrl)
      try {
        const res = await fetch(fetcherUrl, {
          headers: { 'ngrok-skip-browser-warning': 'true' },
          signal: AbortSignal.timeout(12_000),
        })
        if (res.ok) {
          this.logger.log(`✅ External fetcher confirmed reachability for ${url}`)
          // The probe endpoint was hit → resolveProbeByToken() handles the rest
        }
      } catch {
        this.logger.debug(`External fetcher failed: ${new URL(fetcherUrl).hostname}`)
      }
    })

    await Promise.any(fetchers).catch(() => {
      this.logger.warn(`All external fetchers failed for ${url}`)
    })
  }
}