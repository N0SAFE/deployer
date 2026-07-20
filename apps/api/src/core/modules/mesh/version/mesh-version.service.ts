/**
 * Mesh Version Service
 *
 * Queries peer node versions across the mesh and provides comparison
 * utilities for the startup coordinator. Uses the existing MeshInitializationService
 * to connect to peers and the ping endpoint (which returns version info)
 * to gather versions.
 *
 * MOVED from core/modules/startup/mesh-version.service.ts (v1) to this location.
 *
 * This is a diagnostic / coordination service — it never writes to any DB.
 * It is NOT invoked on every request, only during startup / upgrade flows.
 */

import { Injectable, Logger } from "@nestjs/common";
import { MeshInitializationService } from "@/core/modules/mesh/initialization/services/mesh-initialization.service";
import { DEPLOYER_VERSION, semverCompare } from "@/core/utils/deployer-version";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PeerVersionInfo {
  /** The node's mesh URL (origin) */
  readonly url: string;
  /** The node's self-reported version from ping */
  readonly version: string;
  /** Whether the version could be fetched successfully */
  readonly reachable: boolean;
  /** Error message if not reachable */
  readonly error?: string;
}

export interface MeshVersionSummary {
  /** This node's own version */
  readonly localVersion: string;
  /** All peer versions gathered */
  readonly peers: PeerVersionInfo[];
  /** Whether all reachable peers are on the same version */
  readonly consistent: boolean;
  /** The common version if all peers agree (null if inconsistent) */
  readonly meshVersion: string | null;
  /** Number of reachable peers */
  readonly reachableCount: number;
  /** Number of unreachable peers */
  readonly unreachableCount: number;
}

/**
 * Result of comparing the local version against the mesh consensus.
 */
export type VersionComparisonResult =
  | { status: "same"; message: string }
  | { status: "local_behind"; localVersion: string; meshVersion: string; message: string }
  | { status: "local_ahead"; localVersion: string; meshVersion: string; message: string }
  | { status: "inconsistent_mesh"; meshVersions: string[]; message: string }
  | { status: "no_peers"; message: string };

// ─── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class MeshVersionService {
  private readonly logger = new Logger(MeshVersionService.name);

  constructor(
    private readonly meshInitializationService: MeshInitializationService,
  ) {}

  /**
   * Gather versions from all mesh peers by connecting to each known URL
   * and calling the public ping endpoint.
   *
   * @param meshUrls - List of peer mesh URLs to query
   * @param peerServiceToken - Optional token for authenticated peer calls
   * @returns Summary of gathered versions
   */
  async gatherPeerVersions(
    meshUrls: string[],
    peerServiceToken?: string | null,
  ): Promise<MeshVersionSummary> {
    const peers: PeerVersionInfo[] = [];

    for (const url of meshUrls) {
      try {
        const session = await this.meshInitializationService.connectToMesh(url, {
          peerServiceToken: peerServiceToken ?? undefined,
        });

        let version: string;
        try {
          // The ping endpoint returns { ok: true, version, advertisedHost }
          const pingResult = await session.client.ping();
          version = pingResult.version ?? "unknown";
        } finally {
          await session.close().catch(() => {});
        }

        peers.push({ url, version, reachable: true });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.warn(`Peer ${url} unreachable: ${message}`);
        peers.push({ url, version: "unknown", reachable: false, error: message });
      }
    }

    // Determine consensus version
    const reachablePeers = peers.filter((p) => p.reachable);
    const versions = [...new Set(reachablePeers.map((p) => p.version))];
    const consistent = versions.length <= 1;

    return {
      localVersion: DEPLOYER_VERSION,
      peers,
      consistent,
      meshVersion: consistent && versions.length === 1 ? versions[0]! : null,
      reachableCount: reachablePeers.length,
      unreachableCount: peers.length - reachablePeers.length,
    };
  }

  /**
   * Compare the local deployer version against the mesh consensus.
   *
   * @param meshUrls - Peer URLs to query
   * @param peerServiceToken - Optional token for authenticated peer calls
   * @returns Comparison result with actionable message
   */
  async compareLocalWithMesh(
    meshUrls: string[],
    peerServiceToken?: string | null,
  ): Promise<VersionComparisonResult> {
    const summary = await this.gatherPeerVersions(meshUrls, peerServiceToken);

    if (summary.reachableCount === 0) {
      return {
        status: "no_peers",
        message:
          `No mesh peers are reachable. Cannot verify version consistency. ` +
          `Local version: ${DEPLOYER_VERSION}. The mesh may be starting up or unreachable.`,
      };
    }

    if (!summary.consistent) {
      const meshVersions = [...new Set(summary.peers.filter((p) => p.reachable).map((p) => p.version))];
      return {
        status: "inconsistent_mesh",
        meshVersions,
        message:
          `Mesh has inconsistent versions across peers: ${meshVersions.join(", ")}. ` +
          `Local version: ${DEPLOYER_VERSION}. All mesh nodes must be on the same version. ` +
          `Please complete the upgrade across all nodes before starting this node.`,
      };
    }

    const meshVersion = summary.meshVersion!;
    const comparison = semverCompare(DEPLOYER_VERSION, meshVersion);

    if (comparison === 0) {
      return {
        status: "same",
        message: `Local version ${DEPLOYER_VERSION} matches mesh version ${meshVersion}. Node is ready.`,
      };
    }

    if (comparison < 0) {
      return {
        status: "local_behind",
        localVersion: DEPLOYER_VERSION,
        meshVersion,
        message:
          `This node is at version ${DEPLOYER_VERSION} but the mesh is at ${meshVersion}. ` +
          `The node must be upgraded to ${meshVersion} before it can join. ` +
          `Please deploy version ${meshVersion} to this node.`,
      };
    }

    // comparison > 0
    return {
      status: "local_ahead",
      localVersion: DEPLOYER_VERSION,
      meshVersion,
      message:
        `This node is at version ${DEPLOYER_VERSION} but the mesh is at ${meshVersion}. ` +
        `The mesh can be upgraded to ${DEPLOYER_VERSION}. ` +
        `Requires super-admin authorization to trigger a sequential upgrade across all nodes.`,
    };
  }

  /**
   * Quick version check against a single remote node (used during remote setup).
   *
   * @param meshUrl - The remote mesh URL to check
   * @returns The remote node's version, or null if unreachable
   */
  async getRemoteMeshVersion(meshUrl: string): Promise<string | null> {
    try {
      const session = await this.meshInitializationService.connectToMesh(meshUrl, {
        peerServiceToken: undefined, // ping is public
      });
      try {
        const pingResult = await session.client.ping();
        return pingResult.version;
      } finally {
        await session.close().catch(() => { void 0 });
      }
    } catch {
      return null;
    }
  }
}
