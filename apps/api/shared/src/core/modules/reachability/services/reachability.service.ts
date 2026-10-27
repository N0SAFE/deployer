import type { PublicAccessPointState } from './public-access-point.state'
import { BadRequestException, Injectable, Logger } from '@nestjs/common'
import { probeAddress, probePeer } from "@deployer/nest-reachability"
import dns from 'node:dns/promises'
import { isIP } from 'node:net'
import { NodeConfigRepository } from "@deployer/nest-nodes/node-config.repository"
import { NodeNetworkConfigRepository } from "../repositories/node-network-config.repository"
import { IngressLanesService } from "../../platform-ingress/services/ingress-lanes.service"
import { EgressService } from "../../egress/egress.service"
import { EdgeProviderRegistry } from "../../edge/edge-provider.registry"
import { deriveAddressKind, toNodeNetworkConfigData, type NodeNetworkConfigData } from "./node-network-config.mapper"
import { PublicEdgeService } from "./public-edge.service"


/**
 * The node's reachable address, as the domain gate sees it.
 *
 * The public edge is not part of this row: it belongs to the stack, so the gate
 * asks the edge provider rather than a per-node row.
 */
export type NodeAddressGate = {
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
    private readonly lanes: IngressLanesService,
    private readonly edges: EdgeProviderRegistry,
    private readonly publicEdge: PublicEdgeService,
    private readonly egress: EgressService,
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
    return toNodeNetworkConfigData(target, await this.getConfigRow(target))
  }

  /** Every node's network config (for the System page + provider detail tags). */
  async listNodeNetworkConfigs(): Promise<NodeNetworkConfigData[]> {
    const rows = await this.nodeNetworkConfigRepository.list()
    return rows.map((row) => toNodeNetworkConfigData(row.nodeId, row))
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
   * The platform's PUBLIC URL — where OAuth redirects and webhook callbacks reach
   * the API — derived from the lanes, never from env.
   *
   * It exists only when a public lane is on AND the console is public on it:
   * `https://api.<public domain>` when the edge serves HTTPS (a tunnel terminating
   * TLS, or Traefik with ACME), `http://` otherwise. The apex of the domain is NOT
   * used: the edge and its DNS record only cover `*.<domain>`, so the apex routes
   * nowhere.
   */
  async getNodePublicUrl(_nodeId?: string): Promise<string | null> {
    const lanes = await this.lanes.getLanes()
    const lane = lanes.public
    if (lane === null || lanes.consoleVisibility !== 'public') return null
    const scheme = this.edges.ingressPlan(lanes).tls === 'none' ? 'http' : 'https'
    return `${scheme}://api.${lane.domain}`
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
        `${what} requires the platform to be publicly reachable. Enable a public lane with a public console on the Network → Ingress page first.`,
      )
    }
    return url
  }

  /**
   * Resolve the FULL public access point state: config (IP / hostname /
   * tunnel + provider) AND a live availability probe. Used by the
   * PublicAccessPointRelayService to broadcast over the global relay.
   */
  async resolveAccessPointState(): Promise<PublicAccessPointState> {
    const lanes = await this.lanes.getLanes()
    const edge = this.edges.active(lanes)?.descriptor ?? null
    const tunnelEnabled = edge?.kind === 'tunnel'
    const [account = null] = this.edges.accountsInUse(lanes)
    const publicUrl = await this.getNodePublicUrl()

    if (lanes.public === null || publicUrl === null) {
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
        error: 'No public lane with a public console is enabled. Turn one on on the Network → Ingress page.',
      }
    }

    const verification = await this.verifyPublicAddress(publicUrl)
    return {
      configured: true,
      kind: tunnelEnabled ? 'tunnel' : 'hostname',
      address: new URL(publicUrl).hostname,
      publicUrl,
      providerId: account,
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
   * Edge provisioning is NOT here: the public edge belongs to the STACK and is
   * provisioned through its edge provider (`IngressEdgeService`).
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
      addressKind: deriveAddressKind(publicAddress),
    })
    return this.getNodeNetworkConfig(target)
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
      http: this.egress.probeHttp('external'),
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
   * Domain creation gate: a custom domain is served on the public lane, so it can
   * be created when the public edge can carry it.
   *
   * With NO public lane a domain can still be registered — it goes live when one is
   * turned on — so a fresh, local-only install is never blocked from preparing its
   * domains. With a public lane, its edge provider must report itself provisioned
   * (a tunnel created, a public address declared…); otherwise its own reason is
   * returned, so this gate never has to know which provider it is.
   */
  async checkDomainGate(): Promise<NodeAddressGate> {
    const config = await this.getNodeNetworkConfig()
    const lanes = await this.lanes.getLanes()
    const base = { publicAddress: config.publicAddress, addressKind: config.addressKind }
    const edge = await this.publicEdge.view(lanes)
    if (edge === null || edge.status.provisioned) return { allowed: true, reason: null, ...base }
    return {
      allowed: false,
      reason: edge.status.detail ?? `The public edge (${edge.provider?.label ?? edge.providerId}) is not ready yet.`,
      ...base,
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
        const resp = await this.egress.fixedExternal({ url: service }, [new URL(service).hostname])
        if (resp.status >= 200 && resp.status < 300) {
          // The answer is untrusted input that ends up in DNS guidance: only an IP is accepted.
          const ip = new TextDecoder().decode(resp.body).trim()
          if (isIP(ip) !== 0) return ip
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
        const query = new URL('https://dns.google/resolve')
        query.searchParams.set('name', cleanDomain)
        query.searchParams.set('type', 'A')
        const resp = await this.egress.fixedExternal({ url: query.toString() }, ['dns.google'])
        if (resp.status >= 200 && resp.status < 300) {
          const data = JSON.parse(new TextDecoder().decode(resp.body)) as { Answer?: { data?: unknown }[] }
          resolvedIps = (data.Answer ?? []).flatMap((a) => (typeof a.data === 'string' && isIP(a.data) !== 0 ? [a.data] : []))
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
      const resp = await this.egress.external({ url: `https://${cleanDomain}`, method: 'HEAD' }, { timeoutMs: 8000 })
      httpStatusCode = resp.status
      httpReachable = true
    } catch {
      try {
        const resp = await this.egress.external({ url: `http://${cleanDomain}`, method: 'HEAD' }, { timeoutMs: 5000 })
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
      http: this.egress.probeHttp('operator'),
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