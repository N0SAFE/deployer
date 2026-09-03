import { BadRequestException, Injectable, Logger } from '@nestjs/common'
import { isRecord } from "@repo/type-guards"
import dns from 'node:dns/promises'
import { isIP } from 'node:net'
import { NodeConfigRepository } from "@/core/modules/setup/repositories/node-config.repository"
import { NodeNetworkConfigRepository } from "../repositories/node-network-config.repository"

/**
 * Tunnel binding of a node network config. `tunnelId` is the Cloudflare
 * tunnel created automatically when the node enables tunnel mode.
 */
export interface TunnelConfig {
  enabled: boolean
  providerId: string | null
  tunnelId: string | null
  hostname: string | null
}

/** Full per-node network config persisted in the global `node_network_config`. */
export interface NodeNetworkConfigData {
  nodeId: string
  publicAddress: string | null
  addressKind: 'ip' | 'hostname' | null
  tunnel: TunnelConfig
  updatedAt: string
}

@Injectable()
export class ReachabilityService {
  private readonly logger = new Logger(ReachabilityService.name)

  constructor(
    private readonly nodeNetworkConfigRepository: NodeNetworkConfigRepository,
    private readonly nodeConfigRepository: NodeConfigRepository,
  ) {}

  /**
   * The current node's id (from the local SQLite node_config). The network
   * config is stored per node in the global DB, keyed by this id.
   */
  getCurrentNodeId(): string {
    const row = this.nodeConfigRepository.find()
    const nodeId = row?.nodeId
    if (!nodeId) {
      throw new BadRequestException(
        'This node is not configured yet (missing node_config). Complete the setup wizard first.',
      )
    }
    return nodeId
  }

  private getConfigRow(nodeId: string) {
    return this.nodeNetworkConfigRepository.findByNodeId(nodeId);
  }

  /**
   * Read a node's network config (defaults to the current node). Returns a
   * sensible default row for nodes never configured yet.
   */
  async getNodeNetworkConfig(nodeId?: string): Promise<NodeNetworkConfigData> {
    const target = nodeId?.trim() ? nodeId : this.getCurrentNodeId()
    const row = await this.getConfigRow(target)
    const tunnel = this.parseTunnel(row?.tunnelEnabled, row?.tunnelProviderId, row?.tunnelId, row?.tunnelHostname)
    return {
      nodeId: target,
      publicAddress: row?.publicAddress?.trim() ? row.publicAddress.trim() : null,
      addressKind: this.deriveAddressKind(row?.publicAddress ?? null),
      tunnel,
      updatedAt: row?.updatedAt?.toISOString() ?? new Date(0).toISOString(),
    }
  }

  /** Every node's network config (for the System page + provider detail tags). */
  async listNodeNetworkConfigs(): Promise<NodeNetworkConfigData[]> {
    const rows = await this.nodeNetworkConfigRepository.list()
    return rows.map((row) => ({
      nodeId: row.nodeId,
      publicAddress: row.publicAddress?.trim() ? row.publicAddress.trim() : null,
      addressKind: this.deriveAddressKind(row.publicAddress ?? null),
      tunnel: this.parseTunnel(row.tunnelEnabled, row.tunnelProviderId, row.tunnelId, row.tunnelHostname),
      updatedAt: row.updatedAt.toISOString(),
    }))
  }

  private parseTunnel(
    enabled: boolean | null | undefined,
    providerId: string | null | undefined,
    tunnelId: string | null | undefined,
    hostname: string | null | undefined,
  ): TunnelConfig {
    return {
      enabled: enabled ?? false,
      providerId: providerId ?? null,
      tunnelId: tunnelId ?? null,
      hostname: hostname ?? null,
    }
  }

  private deriveAddressKind(value: string | null): 'ip' | 'hostname' | null {
    const clean = value?.trim()
    if (!clean) return null
    const host = clean.replace(/^https?:\/\//i, '').split('/')[0]!.split(':')[0]!
    return isIP(host) !== 0 ? 'ip' : 'hostname'
  }

  /**
   * The node's manual public address (IP/hostname), or null when the node is
   * reached through a tunnel instead. Kept for legacy consumers.
   */
  async getConfiguredPublicIp(nodeId?: string): Promise<string | null> {
    try {
      const config = await this.getNodeNetworkConfig(nodeId)
      return config.publicAddress
    } catch {
      return null
    }
  }

  /**
   * The node's tunnel binding. Kept for legacy consumers.
   */
  async getTunnelConfig(nodeId?: string): Promise<TunnelConfig> {
    try {
      const config = await this.getNodeNetworkConfig(nodeId)
      return config.tunnel
    } catch {
      return { enabled: false, providerId: null, tunnelId: null, hostname: null }
    }
  }

  /**
   * Derive the node's PUBLIC URL from the node network config — the SINGLE
   * source of truth for how this machine is reachable from the internet.
   * Never reads env vars. Precedence:
   *   1. tunnel hostname (https) when the tunnel is enabled
   *   2. the configured public address: hostname → https, IP → http
   * Returns null when neither is set.
   */
  async getNodePublicUrl(nodeId?: string): Promise<string | null> {
    const config = await this.getNodeNetworkConfig(nodeId)
    const tunnelHostname = config.tunnel.enabled && config.tunnel.hostname ? config.tunnel.hostname.trim() : ''
    if (tunnelHostname) {
      // Preserve any path the tunnel hostname carries.
      const base = tunnelHostname.replace(/^https?:\/\//i, '')
      return /^https?:\/\//i.test(tunnelHostname) ? tunnelHostname : `https://${base}`
    }
    const address = config.publicAddress?.trim() ?? ''
    if (!address) return null
    // Preserve the full origin + path the user configured (e.g.
    // https://example.com/base stays intact; a bare IP/hostname gets a scheme).
    if (/^https?:\/\//i.test(address)) {
      return address.replace(/\/+$/, '')
    }
    const host = address.split('/')[0]!
    return isIP(host) !== 0 ? `http://${address}` : `https://${address}`
  }

  /**
   * Like getNodePublicUrl but throws a clear error when no public URL is
   * configured — used to BLOCK functionality that requires the node to be
   * publicly reachable (OAuth redirects, webhook callbacks, provider flows).
   */
  async requireNodePublicUrl(what: string): Promise<string> {
    const url = await this.getNodePublicUrl()
    if (!url) {
      throw new BadRequestException(
        `${what} requires a globally reachable address for this node. Set a public IP or hostname (or enable the tunnel with a hostname) in System → Node Network & Reachability first.`,
      )
    }
    return url
  }

  /**
   * Resolve the FULL public access point state: config (IP / hostname /
   * tunnel + provider) AND a live availability probe. Used by the
   * PublicAccessPointRelayService to broadcast over the global relay.
   */
  async resolveAccessPointState(): Promise<import("./public-access-point.state").PublicAccessPointState> {
    const config = await this.getNodeNetworkConfig()
    const tunnelEnabled = config.tunnel.enabled
    const tunnelHostname = tunnelEnabled && config.tunnel.hostname ? config.tunnel.hostname.trim() : ''
    const address = tunnelHostname || (config.publicAddress?.trim() ?? '')
    const publicUrl = await this.getNodePublicUrl()

    if (!address || !publicUrl) {
      return {
        configured: false,
        kind: null,
        address: null,
        publicUrl: null,
        providerId: null,
        tunnelEnabled,
        reachable: false,
        lastCheckedAt: new Date().toISOString(),
        latencyMs: null,
        statusCode: null,
        error: 'No public address configured for this node. Set a public IP or hostname (or enable the tunnel with a hostname) in System → Node Network & Reachability first.',
      }
    }

    const hostPart = address.split('/')[0]!
    const kind = tunnelHostname ? 'tunnel' : (isIP(hostPart) !== 0 ? 'ip' : 'hostname') as 'ip' | 'hostname' | 'tunnel'

    const verification = await this.verifyPublicAddress(publicUrl)
    return {
      configured: true,
      kind,
      address,
      publicUrl,
      providerId: tunnelEnabled ? config.tunnel.providerId : null,
      tunnelEnabled,
      reachable: verification.valid,
      lastCheckedAt: new Date().toISOString(),
      latencyMs: verification.latencyMs ?? null,
      statusCode: verification.statusCode ?? null,
      error: verification.valid ? null : (verification.reason ?? 'Public access point is not reachable'),
    }
  }

  /**
   * Persist a node's network config in the global `node_network_config` table.
   * Setting a non-empty public address REQUIRES verification that it actually
   * points to this node (see verifyPublicAddress) — it is rejected otherwise.
   * Clearing the address is always allowed.
   *
   * Tunnel provisioning (creating the Cloudflare tunnel) happens one layer up
   * in the product controller — this service persists intent + result.
   */
  async updateNodeNetworkConfig(input: {
    nodeId?: string
    publicAddress?: string | null
    tunnel?: { enabled: boolean; providerId?: string; hostname?: string; tunnelId?: string | null }
  }): Promise<NodeNetworkConfigData> {
    const target = input.nodeId?.trim() ? input.nodeId : this.getCurrentNodeId()
    const current = await this.getNodeNetworkConfig(target)

    let publicAddress = current.publicAddress
    if (input.publicAddress !== undefined) {
      const value = input.publicAddress?.trim() ?? ''
      if (value) {
        const verification = await this.verifyPublicAddress(value)
        if (!verification.valid) {
          throw new BadRequestException(
            verification.reason ?? `Address "${value}" is not reachable from this node`,
          )
        }
        this.logger.log(`Public address verified: ${value} (${String(verification.statusCode ?? '')} in ${String(verification.latencyMs ?? '?')}ms)`)
      }
      publicAddress = value ? value : null
    }

    let tunnel = current.tunnel
    if (input.tunnel !== undefined) {
      const t = input.tunnel
      if (t.enabled) {
        tunnel = {
          enabled: true,
          providerId: t.providerId !== undefined ? t.providerId : current.tunnel.providerId,
          hostname: t.hostname !== undefined ? t.hostname : current.tunnel.hostname,
          tunnelId: t.tunnelId !== undefined ? t.tunnelId : current.tunnel.tunnelId,
        }
        // The tunnel takes over the node's public address.
        publicAddress = null
      } else {
        tunnel = { enabled: false, providerId: null, tunnelId: null, hostname: null }
      }
    }

    await this.nodeNetworkConfigRepository.upsert({
      nodeId: target,
      publicAddress,
      addressKind: this.deriveAddressKind(publicAddress),
      tunnelEnabled: tunnel.enabled,
      tunnelProviderId: tunnel.enabled ? tunnel.providerId : null,
      tunnelId: tunnel.enabled ? tunnel.tunnelId : null,
      tunnelHostname: tunnel.enabled ? tunnel.hostname : null,
    })
    return this.getNodeNetworkConfig(target)
  }

  /**
   * Clear any node's tunnel binding that references a given Cloudflare tunnel
   * (e.g. when the tunnel is deleted from the DNS-provider page). Keeps
   * node_network_config consistent — no dead tunnel ids after an external
   * deletion. Returns the number of nodes whose binding was cleared.
   */
  async clearTunnelBinding(providerId: string, tunnelId: string): Promise<number> {
    const rows = await this.nodeNetworkConfigRepository.list()
    let cleared = 0
    for (const row of rows) {
      if (row.tunnelEnabled && row.tunnelProviderId === providerId && row.tunnelId === tunnelId) {
        await this.nodeNetworkConfigRepository.upsert({
          nodeId: row.nodeId,
          publicAddress: row.publicAddress,
          addressKind: this.deriveAddressKind(row.publicAddress),
          tunnelEnabled: false,
          tunnelProviderId: null,
          tunnelId: null,
          tunnelHostname: null,
        })
        cleared += 1
        this.logger.log(`Cleared tunnel binding ${tunnelId} on node ${row.nodeId} (tunnel deleted externally)`)
      }
    }
    return cleared
  }

  /**
   * Resolve the hostname a tunnel is bound to (the first node config that
   * references it). Used by the provider page so deleting a tunnel can also
   * remove the CNAME record that pointed to it.
   */
  async getTunnelHostname(providerId: string, tunnelId: string): Promise<string | null> {
    const rows = await this.nodeNetworkConfigRepository.list()
    for (const row of rows) {
      if (row.tunnelEnabled && row.tunnelProviderId === providerId && row.tunnelId === tunnelId) {
        if (row.tunnelHostname?.trim()) return row.tunnelHostname.trim()
      }
    }
    return null
  }

  /**
   * Verify that a public address (IP or hostname) actually points to THIS node
   * by probing its identity endpoint (/mesh/ping) and health endpoint
   * (/health) over https then http. Does not throw — returns a structured
   * result so callers can decide how to surface a failure.
   */
  async verifyPublicAddress(address: string): Promise<{ valid: boolean; reason?: string; latencyMs?: number; statusCode?: number }> {
    const clean = address.trim().replace(/\/+$/, '')
    if (!clean) return { valid: false, reason: 'Address is empty' }

    // Normalize to a full origin+path: keep whatever scheme/path the user
    // provided (e.g. https://example.com/base), fall back to https for
    // hostnames and http for bare IPs.
    let origin = clean
    if (!/^https?:\/\//i.test(origin)) {
      const host = origin.split('/')[0]!
      origin = isIP(host) !== 0 ? `http://${origin}` : `https://${origin}`
    }

    const probes: Array<{ label: string; url: string }> = [
      { label: 'mesh-ping', url: `${origin}/mesh/ping` },
      { label: 'mesh-ping-http', url: `${origin.replace(/^https/, 'http')}/mesh/ping` },
      { label: 'health', url: `${origin}/health` },
      { label: 'health-http', url: `${origin.replace(/^https/, 'http')}/health` },
    ]

    for (const probe of probes) {
      try {
        const start = Date.now()
        const resp = await fetch(probe.url, { signal: AbortSignal.timeout(5000) })
        if (resp.ok) {
          return { valid: true, latencyMs: Date.now() - start, statusCode: resp.status }
        }
      } catch {
        // try the next probe
      }
    }
    return {
      valid: false,
      reason: `Address "${clean}" did not respond on this node's /mesh/ping or /health endpoints. DNS may still be propagating, or a firewall/NAT prevents this node from reaching its own public address.`,
    }
  }

  /**
   * Whether a provider app referenced by the tunnel config exists, is active
   * and has the tunnelManagement feature enabled. Data access goes through
   * NodeNetworkConfigRepository (the reachability domain's repository).
   */
  private async isTunnelProviderActive(providerId: string): Promise<boolean> {
    try {
      const row = await this.nodeNetworkConfigRepository.findTunnelProviderById(providerId)
      if (!row) return false
      if (!row.isActive) return false
      if (!row.features?.tunnelManagement) return false
      return typeof row.credentials === 'string' && row.credentials.length > 0
    } catch {
      return false
    }
  }

  /**
   * Domain creation gate: domains can only be created when the node has a
   * configured public address OR is reached through a provisioned,
   * provider-backed tunnel. The bare `enabled` flag no longer grants access.
   */
  async checkDomainGate(): Promise<{ allowed: boolean; reason: string | null; publicAddress: string | null; addressKind: 'ip' | 'hostname' | null; tunnel: TunnelConfig }> {
    const config = await this.getNodeNetworkConfig()
    if (config.tunnel.enabled && config.tunnel.providerId && config.tunnel.tunnelId) {
      const providerActive = await this.isTunnelProviderActive(config.tunnel.providerId)
      if (providerActive) {
        return { allowed: true, reason: null, publicAddress: config.publicAddress, addressKind: config.addressKind, tunnel: config.tunnel }
      }
      return {
        allowed: false,
        reason: 'Tunnel is enabled but the linked DNS provider is missing or inactive. Configure the provider on the Cloudflare apps page.',
        publicAddress: config.publicAddress,
        addressKind: config.addressKind,
        tunnel: config.tunnel,
      }
    }
    if (config.publicAddress) {
      return { allowed: true, reason: null, publicAddress: config.publicAddress, addressKind: config.addressKind, tunnel: config.tunnel }
    }
    return {
      allowed: false,
      reason: 'No public address configured and no provisioned tunnel. Set a globally reachable address (IP or hostname) in System settings, or enable the Cloudflare Tunnel with a configured provider app.',
      publicAddress: config.publicAddress,
      addressKind: config.addressKind,
      tunnel: config.tunnel,
    }
  }

  /**
   * Get the public IP of this API server by querying an external service.
   * Uses the manually configured node public IP first, then falls back to
   * external detection.
   */
  async getPublicIp(): Promise<string | null> {
    const configured = await this.getConfiguredPublicIp()
    if (configured) return configured
    for (const service of ['https://checkip.amazonaws.com', 'https://api.ipify.org', 'https://icanhazip.com']) {
      try {
        const resp = await fetch(service, { signal: AbortSignal.timeout(5000) })
        if (resp.ok) {
          const ip = (await resp.text()).trim()
          if (ip) return ip
        }
      } catch { continue }
    }
    return null
  }

  /**
   * Check if a domain resolves via DNS and optionally verify it points to an expected IP.
   * Then attempt HTTP reachability check.
   */
  async checkDomainReachability(domain: string, expectedIp?: string): Promise<{
    domain: string
    expectedIp: string | undefined
    resolvedIps: string[]
    httpReachable: boolean
    httpStatusCode?: number
    dnsMatch: boolean | null
    error?: string
  }> {
    const cleanDomain = domain.replace(/^https?:\/\//, '').split('/')[0]!.split(':')[0]!
    let resolvedIps: string[] = []
    let dnsMatch: boolean | null = null

    // Step 1: DNS resolution via system DNS
    try {
      const addresses = await dns.resolve4(cleanDomain)
      resolvedIps = addresses
    } catch (err) {
      // DNS resolution failed
    }

    // Step 2: Also try Google DNS-over-HTTPS for cross-validation
    if (resolvedIps.length === 0) {
      try {
        const resp = await fetch(`https://dns.google/resolve?name=${cleanDomain}&type=A`, {
          signal: AbortSignal.timeout(5000),
        })
        if (resp.ok) {
          const data = await resp.json() as { Answer?: Array<{ data: string }> }
          resolvedIps = (data.Answer ?? []).map((a: { data: string }) => a.data)
        }
      } catch { /* fallback failed */ }
    }

    // Step 3: Check if resolved IP matches expected.
    // expectedIp may be an IP or a hostname (the configured global public
    // address supports both). A hostname is resolved and compared by
    // intersection with the domain's IPs.
    if (expectedIp && resolvedIps.length > 0) {
      const expected = expectedIp.replace(/^https?:\/\//, '').split('/')[0]!.split(':')[0]!
      if (isIP(expected) !== 0) {
        dnsMatch = resolvedIps.includes(expected)
      } else {
        try {
          const expectedIps = await dns.resolve4(expected)
          dnsMatch = expectedIps.some((ip) => resolvedIps.includes(ip))
        } catch {
          dnsMatch = false
        }
      }
    }

    // Step 4: HTTP reachability
    let httpReachable = false
    let httpStatusCode: number | undefined
    try {
      const resp = await fetch(`https://${cleanDomain}`, {
        method: 'HEAD',
        signal: AbortSignal.timeout(8000),
      })
      httpStatusCode = resp.status
      httpReachable = true
    } catch {
      try {
        const resp = await fetch(`http://${cleanDomain}`, {
          method: 'HEAD',
          signal: AbortSignal.timeout(5000),
        })
        httpStatusCode = resp.status
        httpReachable = true
      } catch { /* not reachable */ }
    }

    return {
      domain: cleanDomain,
      expectedIp,
      resolvedIps,
      dnsMatch,
      httpReachable,
      httpStatusCode,
      error: resolvedIps.length === 0 ? 'Domain does not resolve to any IP' : undefined,
    }
  }

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

      if (res.ok) {
        const json = await res.json().catch(() => ({}))
        const record = isRecord(json) ? json : {}
        this.logger.log(`✅ Mesh reachable at ${parsed.origin} (${latencyMs}ms)`)
        return {
          url,
          reachable: true,
          probeUrl: url,
          latencyMs,
          advertisedHost: typeof record.advertisedHost === 'string' && record.advertisedHost.length > 0
            ? record.advertisedHost
            : undefined,
          version: typeof record.version === 'string' ? record.version : undefined,
        }
      }

      // ── Fallback: /health ─────────────────────────────────────────────
      // /mesh/ping is served by the mesh controller (mounted only after a
      // node finishes setup). During bootstrap — exactly when the remote
      // wizard probes a peer — a live node may only expose the always-on
      // /health endpoint (the gateway answers /mesh/ping with 503 until the
      // main app mounts). So when /mesh/ping is non-2xx, fall back to
      // /health on the same origin to tell "host is a live deployer node"
      // apart from "nothing is listening". Mirrors verifyPublicAddress(),
      // which also treats /health as a node identity signal.
      this.logger.warn(`Mesh ping HTTP ${String(res.status)} from ${parsed.origin} — falling back to /health`)
      const healthAbort = new AbortController()
      const healthTimeout = setTimeout(() => { healthAbort.abort() }, 5_000)
      try {
        const healthRes = await fetch(`${parsed.origin}/health`, {
          method: 'GET',
          signal: healthAbort.signal,
        })
        const healthLatency = Date.now() - start
        if (healthRes.ok) {
          this.logger.log(`✅ Mesh host reachable via /health (${parsed.origin}, ping was HTTP ${String(res.status)})`)
          return {
            url,
            reachable: true,
            probeUrl: `${parsed.origin}/health`,
            latencyMs: healthLatency,
          }
        }
        return { url, reachable: false, probeUrl: url, latencyMs: healthLatency, error: `HTTP ${String(res.status)} (ping), HTTP ${String(healthRes.status)} (health)` }
      } finally {
        clearTimeout(healthTimeout)
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