import { BadRequestException, Injectable, Logger } from '@nestjs/common'
import { probeAddress, probePeer } from "@repo/nest-reachability"
import dns from 'node:dns/promises'
import { isIP } from 'node:net'
import { NodeConfigRepository } from "@repo/nest-nodes/node-config.repository"
import { NodeNetworkConfigRepository } from "../repositories/node-network-config.repository"
import { PlatformIngressSettingsService } from "@/core/modules/platform-ingress/services/platform-ingress-settings.service"

/** Full per-node network config persisted in the global `node_network_config`. */
export interface NodeNetworkConfigData {
  nodeId: string
  publicAddress: string | null
  addressKind: 'ip' | 'hostname' | null
  updatedAt: string
}

/**
 * The node's reachable address, as the domain gate sees it.
 *
 * The tunnel is no longer part of this answer: it belongs to the stack
 * (`PlatformIngressSettingsService`), so the gate consults it directly rather
 * than through a per-node row.
 */
export interface NodeAddressGate {
  allowed: boolean
  reason: string | null
  publicAddress: string | null
  addressKind: 'ip' | 'hostname' | null
}

@Injectable()
export class ReachabilityService {
  private readonly logger = new Logger(ReachabilityService.name)

  constructor(
    private readonly nodeNetworkConfigRepository: NodeNetworkConfigRepository,
    private readonly nodeConfigRepository: NodeConfigRepository,
    private readonly edgeSettings: PlatformIngressSettingsService,
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
    return {
      nodeId: target,
      publicAddress: row?.publicAddress?.trim() ? row.publicAddress.trim() : null,
      addressKind: this.deriveAddressKind(row?.publicAddress ?? null),
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
      updatedAt: row.updatedAt.toISOString(),
    }))
  }

  private deriveAddressKind(value: string | null): 'ip' | 'hostname' | null {
    const clean = value?.trim()
    if (!clean) return null
    const host = clean.replace(/^https?:\/\//i, '').split('/')[0]!.split(':')[0]!
    return isIP(host) !== 0 ? 'ip' : 'hostname'
  }

  /**
   * The node's manual public address (IP/hostname), or null when none is set.
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
   * Derive the node's PUBLIC URL from the node network config — the SINGLE
   * source of truth for how this machine is reachable from the internet.
   * Never reads env vars. Precedence:
   *   1. tunnel hostname (https) when the tunnel is enabled
   *   2. the configured public address: hostname → https, IP → http
   * Returns null when neither is set.
   */
  async getNodePublicUrl(nodeId?: string): Promise<string | null> {
    // The STACK tunnel's wildcard, when the edge is actually in tunnel mode and
    // provisioned. Read from the shared edge settings, not a per-node row.
    const mode = await this.edgeSettings.getEdgeMode()
    const tunnel = await this.edgeSettings.getEdgeTunnel()
    if (mode === 'tunnel' && tunnel.token !== null && tunnel.wildcard !== null) {
      // A wildcard (`*.example.com`) is not itself a URL: the platform's own
      // hostname is what a client can open, and the wildcard only guarantees
      // that every app hostname under it routes.
      const base = tunnel.wildcard.replace(/^\*\./, '')
      return `https://${base}`
    }

    const config = await this.getNodeNetworkConfig(nodeId)
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
    const mode = await this.edgeSettings.getEdgeMode()
    const tunnel = await this.edgeSettings.getEdgeTunnel()
    // The stack tunnel counts as configured only when the edge is IN tunnel mode
    // and a token exists — a stored-but-unused tunnel must not claim the edge.
    const tunnelEnabled = mode === 'tunnel' && tunnel.token !== null
    const tunnelHostname = tunnelEnabled && tunnel.wildcard ? tunnel.wildcard.replace(/^\*\./, '') : ''
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
      providerId: tunnelEnabled ? tunnel.providerId : null,
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
   * Tunnel provisioning is NOT here: the tunnel belongs to the STACK, and is
   * provisioned by the reachability controller's stack-edge handlers.
   */
  async updateNodeNetworkConfig(input: {
    nodeId?: string
    publicAddress?: string | null
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

    await this.nodeNetworkConfigRepository.upsert({
      nodeId: target,
      publicAddress,
      addressKind: this.deriveAddressKind(publicAddress),
    })
    return this.getNodeNetworkConfig(target)
  }

  /**
   * Resolve the hostname the STACK tunnel routes (its wildcard), when set.
   *
   * Used by the provider page so deleting a tunnel can also remove the CNAME
   * record that pointed to it.
   */
  async getTunnelHostname(providerId: string, tunnelId: string): Promise<string | null> {
    const tunnel = await this.edgeSettings.getEdgeTunnel()
    if (tunnel.providerId !== providerId || tunnel.tunnelId !== tunnelId) return null
    return tunnel.wildcard?.trim() ? tunnel.wildcard.trim() : null
  }

  /**
   * Forget the stack tunnel when it is deleted externally (from the provider
   * page), so no dead tunnel id is left claiming the edge. Returns 1 when a
   * binding was cleared, 0 otherwise — same shape the per-node version had, so
   * the provider page's reporting does not change.
   */
  async clearTunnelBinding(providerId: string, tunnelId: string): Promise<number> {
    const tunnel = await this.edgeSettings.getEdgeTunnel()
    if (tunnel.providerId !== providerId || tunnel.tunnelId !== tunnelId) return 0
    await this.edgeSettings.clearEdgeTunnel()
    this.logger.log(`Cleared stack tunnel binding ${tunnelId} (tunnel deleted externally)`)
    return 1
  }

  /**
   * Verify that a public address (IP or hostname) actually points to THIS node
   * by probing its identity endpoint (/mesh/ping) and health endpoint
   * (/health) over https then http. Does not throw — returns a structured
   * result so callers can decide how to surface a failure.
   *
   * The PROBE is the package's generic primitive; which endpoints identify a
   * node, and what a failure means for the operator, are this platform's.
   */
  async verifyPublicAddress(address: string): Promise<{ valid: boolean; reason?: string; latencyMs?: number; statusCode?: number }> {
    const clean = address.trim().replace(/\/+$/, '')
    if (!clean) return { valid: false, reason: 'Address is empty' }

    const result = await probeAddress(clean, {
      paths: ['/mesh/ping', '/health'],
      tryBothSchemes: true,
      timeoutMs: 5_000,
      failureReason: (value) =>
        `Address "${value}" did not respond on this node's /mesh/ping or /health endpoints. DNS may still be propagating, or a firewall/NAT prevents this node from reaching its own public address.`,
    })

    return {
      valid: result.valid,
      reason: result.reason,
      latencyMs: result.latencyMs,
      statusCode: result.statusCode,
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
   * Domain creation gate: domains can only be created when the stack edge can
   * actually resolve them to something.
   *
   * THE ANSWER DEPENDS ON THE PROVIDER, not only on the node address:
   *
   *   `local`     — domains resolve on THIS machine through the loopback
   *                 listener, so no public address is required at all. Gating
   *                 here would block a fresh install from creating its first
   *                 domain for no reason.
   *   `wireguard` — domains resolve for enrolled mesh peers; no public address
   *                 required either.
   *   `tunnel`    — needs a provisioned, provider-backed tunnel.
   *   `direct`    — needs a public address on this node (that is what DNS points
   *                 at).
   */
  async checkDomainGate(): Promise<NodeAddressGate> {
    const config = await this.getNodeNetworkConfig()
    const mode = await this.edgeSettings.getEdgeMode()
    const tunnel = await this.edgeSettings.getEdgeTunnel()

    // `local` and `wireguard` serve names on an address they own themselves
    // (loopback / the mesh overlay), so nothing about this node's PUBLIC
    // address is needed for a domain to work. Requiring one would make a
    // fresh install unable to create a domain until it went public — the
    // inversion this change removes.
    if (mode === 'local' || mode === 'wireguard') {
      return { allowed: true, reason: null, publicAddress: config.publicAddress, addressKind: config.addressKind }
    }

    if (mode === 'tunnel') {
      if (tunnel.token === null || tunnel.tunnelId === null || tunnel.providerId === null) {
        return {
          allowed: false,
          reason: 'Edge provider is `tunnel` but no tunnel is provisioned. Set one on the edge settings page.',
          publicAddress: config.publicAddress,
          addressKind: config.addressKind,
        }
      }
      const providerActive = await this.isTunnelProviderActive(tunnel.providerId)
      if (providerActive) {
        return { allowed: true, reason: null, publicAddress: config.publicAddress, addressKind: config.addressKind }
      }
      return {
        allowed: false,
        reason: 'The stack tunnel is provisioned but the linked DNS provider is missing or inactive. Configure the provider on the Cloudflare apps page.',
        publicAddress: config.publicAddress,
        addressKind: config.addressKind,
      }
    }

    if (config.publicAddress) {
      return { allowed: true, reason: null, publicAddress: config.publicAddress, addressKind: config.addressKind }
    }
    return {
      allowed: false,
      reason: 'No public address configured for this node. Set a globally reachable address (IP or hostname), or switch the edge to tunnel mode with a provisioned tunnel.',
      publicAddress: config.publicAddress,
      addressKind: config.addressKind,
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
    // Delegated to the shared primitive: the probe mechanics (primary path,
    // liveness fallback, identity extraction) are generic; which paths identify
    // a node is our convention, passed in as options.
    const result = await probePeer(url, {
      primaryPath: '/mesh/ping',
      fallbackPath: '/health',
      timeoutMs: 5_000,
    })

    if (result.reachable) {
      this.logger.log(`✅ Mesh reachable at ${result.probeUrl} (${String(result.latencyMs)}ms)`)
    } else {
      this.logger.warn(`Mesh unreachable at ${url}: ${result.error ?? 'unknown error'}`)
    }

    return {
      url,
      reachable: result.reachable,
      probeUrl: result.probeUrl,
      latencyMs: result.latencyMs,
      advertisedHost: result.identity?.advertisedHost,
      version: result.identity?.version,
      error: result.error,
    }
  }
}