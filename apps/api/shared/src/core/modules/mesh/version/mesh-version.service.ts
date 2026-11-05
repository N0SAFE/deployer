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

import { Context, Effect } from 'effect'

import {
    DEPLOYER_VERSION,
    semverCompare,
} from '../../../utils/deployer-version'

import type { MeshInitializationServiceShape } from '../initialization/services/mesh-initialization.service'

// ─── Types ────────────────────────────────────────────────────────────────────

export type PeerVersionInfo = {
    /** The node's mesh URL (origin) */
    readonly url: string
    /** The node's self-reported version from ping */
    readonly version: string
    /** Whether the version could be fetched successfully */
    readonly reachable: boolean
    /** Error message if not reachable */
    readonly error?: string
}

export type MeshVersionSummary = {
    /** This node's own version */
    readonly localVersion: string
    /** All peer versions gathered */
    readonly peers: PeerVersionInfo[]
    /** Whether all reachable peers are on the same version */
    readonly consistent: boolean
    /** The common version if all peers agree (null if inconsistent) */
    readonly meshVersion: string | null
    /** Number of reachable peers */
    readonly reachableCount: number
    /** Number of unreachable peers */
    readonly unreachableCount: number
}

/**
 * Result of comparing the local version against the mesh consensus.
 */
export type VersionComparisonResult =
    | { status: 'same'; message: string }
    | {
          status: 'local_behind'
          localVersion: string
          meshVersion: string
          message: string
      }
    | {
          status: 'local_ahead'
          localVersion: string
          meshVersion: string
          message: string
      }
    | { status: 'inconsistent_mesh'; meshVersions: string[]; message: string }
    | { status: 'no_peers'; message: string }

// ─── Service ──────────────────────────────────────────────────────────────────

export type MeshVersionServiceShape = {
    /**
     * Gather versions from all mesh peers by connecting to each known URL and calling the public ping endpoint. An
     * unreachable peer is reported in the summary (and logged), never failed.
     */
    readonly gatherPeerVersions: (
        meshUrls: string[],
        peerServiceToken?: string | null
    ) => Effect.Effect<MeshVersionSummary>
    /** Compare the local deployer version against the mesh consensus; the result carries an actionable message. */
    readonly compareLocalWithMesh: (
        meshUrls: string[],
        peerServiceToken?: string | null
    ) => Effect.Effect<VersionComparisonResult>
    /** Quick version check against a single remote node (used during remote setup); null when it is unreachable. */
    readonly getRemoteMeshVersion: (
        meshUrl: string
    ) => Effect.Effect<string | null>
}

/** The ping of one peer: its self-reported version, or the reason it could not be read. */
const pingVersion = (
    mesh: MeshInitializationServiceShape,
    url: string,
    peerServiceToken?: string | null
) =>
    Effect.acquireUseRelease(
        mesh.connectToMesh(url, {
            peerServiceToken: peerServiceToken ?? undefined,
        }),
        (session) =>
            Effect.tryPromise({
                try: () => session.client.ping({}),
                catch: (cause) => cause,
            }),
        (session) =>
            Effect.promise(() => session.close().catch(() => undefined))
    )

const messageOf = (err: unknown): string =>
    err instanceof Error
        ? err.message
        : typeof err === 'object' &&
            err !== null &&
            'publicMessage' in err &&
            typeof err.publicMessage === 'function'
          ? String((err.publicMessage as () => unknown)())
          : String(err)

export function makeMeshVersionService(
    mesh: MeshInitializationServiceShape
): MeshVersionServiceShape {
    const gatherPeerVersions: MeshVersionServiceShape['gatherPeerVersions'] = (
        meshUrls,
        peerServiceToken
    ) =>
        Effect.gen(function* () {
            const peers: PeerVersionInfo[] = []

            for (const url of meshUrls) {
                const peer = yield* pingVersion(
                    mesh,
                    url,
                    peerServiceToken
                ).pipe(
                    // The ping endpoint returns { ok: true, version, advertisedHost }
                    Effect.map((pingResult): PeerVersionInfo => ({
                        url,
                        version: pingResult.version,
                        reachable: true,
                    })),
                    Effect.catch((err) => {
                        const message = messageOf(err)
                        return Effect.logWarning(
                            `Peer ${url} unreachable: ${message}`
                        ).pipe(
                            Effect.as<PeerVersionInfo>({
                                url,
                                version: 'unknown',
                                reachable: false,
                                error: message,
                            })
                        )
                    })
                )
                peers.push(peer)
            }

            // Determine consensus version
            const reachablePeers = peers.filter((p) => p.reachable)
            const versions = [...new Set(reachablePeers.map((p) => p.version))]
            const consistent = versions.length <= 1

            return {
                localVersion: DEPLOYER_VERSION,
                peers,
                consistent,
                meshVersion:
                    consistent && versions.length === 1
                        ? (versions[0] ?? null)
                        : null,
                reachableCount: reachablePeers.length,
                unreachableCount: peers.length - reachablePeers.length,
            }
        })

    return {
        gatherPeerVersions,

        compareLocalWithMesh: (meshUrls, peerServiceToken) =>
            gatherPeerVersions(meshUrls, peerServiceToken).pipe(
                Effect.map((summary): VersionComparisonResult => {
                    if (summary.reachableCount === 0) {
                        return {
                            status: 'no_peers',
                            message:
                                `No mesh peers are reachable. Cannot verify version consistency. ` +
                                `Local version: ${DEPLOYER_VERSION}. The mesh may be starting up or unreachable.`,
                        }
                    }

                    if (!summary.consistent) {
                        const meshVersions = [
                            ...new Set(
                                summary.peers
                                    .filter((p) => p.reachable)
                                    .map((p) => p.version)
                            ),
                        ]
                        return {
                            status: 'inconsistent_mesh',
                            meshVersions,
                            message:
                                `Mesh has inconsistent versions across peers: ${meshVersions.join(', ')}. ` +
                                `Local version: ${DEPLOYER_VERSION}. All mesh nodes must be on the same version. ` +
                                `Please complete the upgrade across all nodes before starting this node.`,
                        }
                    }

                    // Consistent with at least one reachable peer: the consensus is a single version.
                    const meshVersion = summary.meshVersion ?? DEPLOYER_VERSION
                    const comparison = semverCompare(
                        DEPLOYER_VERSION,
                        meshVersion
                    )

                    if (comparison === 0) {
                        return {
                            status: 'same',
                            message: `Local version ${DEPLOYER_VERSION} matches mesh version ${meshVersion}. Node is ready.`,
                        }
                    }

                    if (comparison < 0) {
                        return {
                            status: 'local_behind',
                            localVersion: DEPLOYER_VERSION,
                            meshVersion,
                            message:
                                `This node is at version ${DEPLOYER_VERSION} but the mesh is at ${meshVersion}. ` +
                                `The node must be upgraded to ${meshVersion} before it can join. ` +
                                `Please deploy version ${meshVersion} to this node.`,
                        }
                    }

                    return {
                        status: 'local_ahead',
                        localVersion: DEPLOYER_VERSION,
                        meshVersion,
                        message:
                            `This node is at version ${DEPLOYER_VERSION} but the mesh is at ${meshVersion}. ` +
                            `The mesh can be upgraded to ${DEPLOYER_VERSION}. ` +
                            `Requires super-admin authorization to trigger a sequential upgrade across all nodes.`,
                    }
                })
            ),

        // ping is public: no token
        getRemoteMeshVersion: (meshUrl) =>
            pingVersion(mesh, meshUrl).pipe(
                Effect.map((pingResult) => pingResult.version),
                Effect.catch(() => Effect.succeed(null))
            ),
    }
}

export class MeshVersionService extends Context.Service<
    MeshVersionService,
    MeshVersionServiceShape
>()('shared/MeshVersionService') {}
