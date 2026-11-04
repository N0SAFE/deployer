import dns from "node:dns/promises";
import { isIP } from "node:net";

import { Context, Effect } from "effect";

import type { NodeConfigRepositoryShape } from "@deployer/node-state";

import { deriveAddressKind, toNodeNetworkConfigData, type NodeNetworkConfigData } from "./node-network-config.mapper";
import {
  NodeNotConfigured,
  PublicAddressUnreachable,
  PublicUrlRequired,
  ReachabilityDependencyFailure,
} from "../reachability.errors";

import type { PublicAccessPointState } from "./public-access-point.state";
import type { PublicEdgeServiceShape } from "./public-edge.service";
import type { EdgeProviderRegistryShape } from "../../edge/edge-provider.registry";
import type { EgressServiceShape } from "../../egress/egress.service";
import type { IngressLanesServiceShape } from "../../platform-ingress/services/ingress-lanes.service";
import type { NodeNetworkConfigRepositoryShape } from "../repositories/node-network-config.repository";

/**
 * The node's reachable address, as the domain gate sees it.
 *
 * The public edge is not part of this row: it belongs to the stack, so the gate asks the edge provider rather than a
 * per-node row.
 */
export type NodeAddressGate = {
  allowed: boolean;
  reason: string | null;
  publicAddress: string | null;
  addressKind: "ip" | "hostname" | null;
};

export type AddressVerification = { valid: boolean; reason?: string; latencyMs?: number; statusCode?: number };

export type DomainReachability = {
  domain: string;
  expectedIp: string | undefined;
  resolvedIps: string[];
  httpReachable: boolean;
  httpStatusCode?: number;
  dnsMatch: boolean | null;
  error?: string;
};

export type MeshUrlReachability = {
  url: string;
  reachable: boolean;
  probeUrl: string;
  latencyMs: number;
  advertisedHost?: string;
  version?: string;
  /** Why it is unreachable (network error, non-2xx answer, refused connection); absent when reachable. */
  error?: string;
};

type Failure = ReachabilityDependencyFailure;

export type ReachabilityServiceShape = {
  /** The current node's id (from its agent's record, or the local SQLite file); the network config is keyed by it. */
  readonly getCurrentNodeId: () => Effect.Effect<string, NodeNotConfigured | Failure>;
  /** A node's network config (default: this node); a never-configured node reads as an empty default. */
  readonly getNodeNetworkConfig: (nodeId?: string) => Effect.Effect<NodeNetworkConfigData, NodeNotConfigured | Failure>;
  readonly listNodeNetworkConfigs: () => Effect.Effect<NodeNetworkConfigData[], Failure>;
  /** The node's manual public address, or null (also when it cannot be read). */
  readonly getConfiguredPublicIp: (nodeId?: string) => Effect.Effect<string | null>;
  /**
   * The platform's PUBLIC URL (where OAuth redirects and webhook callbacks reach the API), derived from the lanes, never
   * from env: only with a public lane on AND the console public on it, `https://api.<public domain>` when the edge serves
   * HTTPS. The apex is NOT used: the edge and its DNS record only cover `*.<domain>`.
   */
  readonly getNodePublicUrl: (nodeId?: string) => Effect.Effect<string | null, Failure>;
  /** Like `getNodePublicUrl`, but fails with `PublicUrlRequired`: it BLOCKS what needs the node to be publicly reachable. */
  readonly requireNodePublicUrl: (what: string) => Effect.Effect<string, PublicUrlRequired | Failure>;
  /** The FULL public access point state: config (IP / hostname / tunnel + provider) AND a live availability probe. */
  readonly resolveAccessPointState: () => Effect.Effect<PublicAccessPointState, Failure>;
  /**
   * Persist a node's network config. A non-empty public address MUST verify as pointing at this node (`PublicAddressUnreachable`
   * otherwise); clearing it is always allowed. Edge provisioning is not here: the public edge belongs to the STACK.
   */
  readonly updateNodeNetworkConfig: (input: {
    nodeId?: string;
    publicAddress?: string | null;
  }) => Effect.Effect<NodeNetworkConfigData, PublicAddressUnreachable | NodeNotConfigured | Failure>;
  /** Probe an address (`/mesh/ping`, `/health` over https then http). Never fails: the answer says whether it is valid. */
  readonly verifyPublicAddress: (address: string) => Effect.Effect<AddressVerification>;
  /**
   * Domain creation gate: a custom domain is served on the public lane. With no public lane a domain can still be registered
   * (it goes live when one is turned on); with one, its provider must report itself provisioned, else its own reason is returned.
   */
  readonly checkDomainGate: () => Effect.Effect<NodeAddressGate, NodeNotConfigured | Failure>;
  /** The public IP of this API server: the configured one, else an external lookup. */
  readonly getPublicIp: () => Effect.Effect<string | null>;
  /** Whether a domain resolves (system DNS, then Google DoH) and answers over HTTP(S). Never fails. */
  readonly checkDomainReachability: (domain: string, expectedIp?: string) => Effect.Effect<DomainReachability>;
  /** Whether a mesh URL answers `/mesh/ping` (the probe of the remote setup wizard step). */
  readonly checkMeshUrlReachability: (url: string) => Effect.Effect<MeshUrlReachability, Failure>;
};

type Ports = {
  readonly nodeNetworkConfigs: NodeNetworkConfigRepositoryShape;
  readonly nodeConfig: NodeConfigRepositoryShape;
  readonly lanes: Pick<IngressLanesServiceShape, "getLanes">;
  readonly edges: EdgeProviderRegistryShape;
  readonly publicEdge: PublicEdgeServiceShape;
  readonly egress: Pick<EgressServiceShape, "probeUserAddress" | "fixedExternal" | "external" | "probeOperatorPeer">;
};

const IP_LOOKUP_SERVICES = ["https://checkip.amazonaws.com", "https://api.ipify.org", "https://icanhazip.com"];

export function makeReachabilityService({ nodeNetworkConfigs, nodeConfig, lanes, edges, publicEdge, egress }: Ports): ReachabilityServiceShape {
  const storage = <A, E extends { readonly message: string }>(operation: string, effect: Effect.Effect<A, E>): Effect.Effect<A, Failure> =>
    Effect.mapError(effect, (cause) => new ReachabilityDependencyFailure({ operation, cause }));

  const getCurrentNodeId: ReachabilityServiceShape["getCurrentNodeId"] = () =>
    Effect.gen(function* () {
      const row = yield* storage("read the node config", nodeConfig.find());
      if (!row?.nodeId) return yield* new NodeNotConfigured({});
      return row.nodeId;
    });

  const getNodeNetworkConfig: ReachabilityServiceShape["getNodeNetworkConfig"] = (nodeId) =>
    Effect.gen(function* () {
      const target = nodeId?.trim() ? nodeId : yield* getCurrentNodeId();
      const row = yield* storage("read the node network config", nodeNetworkConfigs.findByNodeId(target));
      return toNodeNetworkConfigData(target, row);
    });

  const getNodePublicUrl: ReachabilityServiceShape["getNodePublicUrl"] = () =>
    Effect.gen(function* () {
      const current = yield* storage("read the ingress lanes", lanes.getLanes());
      const lane = current.public;
      if (lane === null || current.consoleVisibility !== "public") return null;
      const scheme = edges.ingressPlan(current).tls === "none" ? "http" : "https";
      return `${scheme}://api.${lane.domain}`;
    });

  const verifyPublicAddress: ReachabilityServiceShape["verifyPublicAddress"] = (address) =>
    Effect.gen(function* () {
      const clean = address.trim().replace(/\/+$/, "");
      if (!clean) return { valid: false, reason: "Address is empty" };
      // The probe reports an unreachable address in its result: it never fails.
      const result = yield* egress.probeUserAddress(clean, ["/mesh/ping", "/health"], (value) =>
        `Address "${value}" did not respond on this node's /mesh/ping or /health endpoints. DNS may still be propagating, or a firewall/NAT prevents this node from reaching its own public address.`,
      );
      return { valid: result.valid, reason: result.reason, latencyMs: result.latencyMs, statusCode: result.statusCode };
    });

  const getConfiguredPublicIp: ReachabilityServiceShape["getConfiguredPublicIp"] = (nodeId) =>
    getNodeNetworkConfig(nodeId).pipe(
      Effect.map((config) => config.publicAddress),
      Effect.catch(() => Effect.succeed(null)),
    );

  /** A GET through the egress's fixed-host policy; `null` when it fails or answers outside 2xx. */
  const fixedGet = (url: string, hosts: readonly string[]) =>
    egress.fixedExternal({ url }, hosts).pipe(
      Effect.map((resp) => (resp.status >= 200 && resp.status < 300 ? resp : null)),
      Effect.catch(() => Effect.succeed(null)),
    );

  const resolveAccessPointState: ReachabilityServiceShape["resolveAccessPointState"] = () =>
    Effect.gen(function* () {
      const current = yield* storage("read the ingress lanes", lanes.getLanes());
      const edge = edges.active(current)?.descriptor ?? null;
      const tunnelEnabled = edge?.kind === "tunnel";
      const [account = null] = edges.accountsInUse(current);
      const publicUrl = yield* getNodePublicUrl();

      if (current.public === null || publicUrl === null) {
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
          error: "No public lane with a public console is enabled. Turn one on on the Network → Ingress page.",
        } satisfies PublicAccessPointState;
      }

      const verification = yield* verifyPublicAddress(publicUrl);
      return {
        configured: true,
        kind: tunnelEnabled ? "tunnel" : "hostname",
        address: new URL(publicUrl).hostname,
        publicUrl,
        providerId: account,
        tunnelEnabled,
        reachable: verification.valid,
        lastCheckedAt: new Date().toISOString(),
        latencyMs: verification.latencyMs ?? null,
        statusCode: verification.statusCode ?? null,
        error: verification.valid ? null : (verification.reason ?? "Public access point is not reachable"),
      } satisfies PublicAccessPointState;
    });

  return {
    getCurrentNodeId,
    getNodeNetworkConfig,
    listNodeNetworkConfigs: () =>
      storage("list the node network configs", nodeNetworkConfigs.list()).pipe(
        Effect.map((rows) => rows.map((row) => toNodeNetworkConfigData(row.nodeId, row))),
      ),
    getConfiguredPublicIp,
    getNodePublicUrl,

    requireNodePublicUrl: (what) =>
      Effect.gen(function* () {
        const url = yield* getNodePublicUrl();
        if (!url) return yield* new PublicUrlRequired({ what });
        return url;
      }),

    resolveAccessPointState,

    updateNodeNetworkConfig: (input) =>
      Effect.gen(function* () {
        const target = input.nodeId?.trim() ? input.nodeId : yield* getCurrentNodeId();
        const current = yield* getNodeNetworkConfig(target);

        let publicAddress = current.publicAddress;
        if (input.publicAddress !== undefined) {
          const value = input.publicAddress?.trim() ?? "";
          if (value) {
            const verification = yield* verifyPublicAddress(value);
            if (!verification.valid) {
              return yield* new PublicAddressUnreachable({ reason: verification.reason ?? `Address "${value}" is not reachable from this node` });
            }
            yield* Effect.logInfo(
              `Public address verified: ${value} (${String(verification.statusCode ?? "")} in ${String(verification.latencyMs ?? "?")}ms)`,
            );
          }
          publicAddress = value ? value : null;
        }

        yield* storage(
          "save the node network config",
          nodeNetworkConfigs.upsert({ nodeId: target, publicAddress, addressKind: deriveAddressKind(publicAddress) }),
        );
        return yield* getNodeNetworkConfig(target);
      }),

    verifyPublicAddress,

    checkDomainGate: () =>
      Effect.gen(function* () {
        const config = yield* getNodeNetworkConfig();
        const current = yield* storage("read the ingress lanes", lanes.getLanes());
        const base = { publicAddress: config.publicAddress, addressKind: config.addressKind };
        const edge = yield* publicEdge.view(current);
        if (edge === null || edge.status.provisioned) return { allowed: true, reason: null, ...base };
        return {
          allowed: false,
          reason: edge.status.detail ?? `The public edge (${edge.provider?.label ?? edge.providerId}) is not ready yet.`,
          ...base,
        };
      }),

    getPublicIp: () =>
      Effect.gen(function* () {
        const configured = yield* getConfiguredPublicIp();
        if (configured) return configured;
        for (const service of IP_LOOKUP_SERVICES) {
          const resp = yield* fixedGet(service, [new URL(service).hostname]);
          if (resp === null) continue;
          // The answer is untrusted input that ends up in DNS guidance: only an IP is accepted.
          const ip = new TextDecoder().decode(resp.body).trim();
          if (isIP(ip) !== 0) return ip;
        }
        return null;
      }),

    checkDomainReachability: (domain, expectedIp) =>
      Effect.gen(function* () {
        const cleanDomain = (domain.replace(/^https?:\/\//, "").split("/")[0] ?? "").split(":")[0] ?? "";
        const resolve4 = (name: string) => Effect.tryPromise({ try: () => dns.resolve4(name), catch: (cause) => cause });

        // Step 1: system DNS.
        let resolvedIps: string[] = yield* resolve4(cleanDomain).pipe(Effect.catch(() => Effect.succeed([] as string[])));

        // Step 2: Google DNS-over-HTTPS, for cross-validation when the system resolver finds nothing.
        if (resolvedIps.length === 0) {
          const query = new URL("https://dns.google/resolve");
          query.searchParams.set("name", cleanDomain);
          query.searchParams.set("type", "A");
          const resp = yield* fixedGet(query.toString(), ["dns.google"]);
          if (resp !== null) {
            const data = yield* Effect.try({
              try: () => JSON.parse(new TextDecoder().decode(resp.body)) as { Answer?: { data?: unknown }[] },
              catch: (cause) => cause,
            }).pipe(Effect.catch(() => Effect.succeed<{ Answer?: { data?: unknown }[] }>({})));
            resolvedIps = (data.Answer ?? []).flatMap((a) => (typeof a.data === "string" && isIP(a.data) !== 0 ? [a.data] : []));
          }
        }

        // Step 3: does it match the expected address? (an IP, or a hostname resolved and compared by intersection)
        let dnsMatch: boolean | null = null;
        if (expectedIp && resolvedIps.length > 0) {
          const expected = (expectedIp.replace(/^https?:\/\//, "").split("/")[0] ?? "").split(":")[0] ?? "";
          if (isIP(expected) !== 0) {
            dnsMatch = resolvedIps.includes(expected);
          } else {
            const expectedIps = yield* resolve4(expected).pipe(Effect.catch(() => Effect.succeed(null)));
            dnsMatch = expectedIps === null ? false : expectedIps.some((ip) => resolvedIps.includes(ip));
          }
        }

        // Step 4: HTTP reachability, https first.
        const head = (scheme: "https" | "http", timeoutMs: number) =>
          egress.external({ url: `${scheme}://${cleanDomain}`, method: "HEAD" }, { timeoutMs }).pipe(
            Effect.map((resp) => resp.status),
            Effect.catch(() => Effect.succeed(undefined)),
          );
        const httpsStatus = yield* head("https", 8000);
        const httpStatusCode = httpsStatus ?? (yield* head("http", 5000));

        return {
          domain: cleanDomain,
          expectedIp,
          resolvedIps,
          dnsMatch,
          httpReachable: httpStatusCode !== undefined,
          httpStatusCode,
          error: resolvedIps.length === 0 ? "Domain does not resolve to any IP" : undefined,
        };
      }),

    checkMeshUrlReachability: (url) =>
      Effect.gen(function* () {
        // The probe mechanics are the egress's generic primitive; which paths identify a node is this platform's convention.
        const result = yield* egress.probeOperatorPeer(url, "/mesh/ping", "/health");
        if (result.reachable) {
          yield* Effect.logInfo(`Mesh reachable at ${result.probeUrl} (${String(result.latencyMs)}ms)`);
        } else {
          yield* Effect.logWarning(`Mesh unreachable at ${url}: ${result.error ?? "unknown error"}`);
        }
        return {
          url,
          reachable: result.reachable,
          probeUrl: result.probeUrl,
          latencyMs: result.latencyMs,
          advertisedHost: result.identity?.advertisedHost,
          version: result.identity?.version,
          error: result.error,
        };
      }),
  };
}

export class ReachabilityService extends Context.Service<ReachabilityService, ReachabilityServiceShape>()("shared/ReachabilityService") {}
