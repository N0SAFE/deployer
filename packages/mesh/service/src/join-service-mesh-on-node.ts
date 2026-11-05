import { existsSync } from 'node:fs'
import { hostname } from 'node:os'

import { DEFAULT_AGENT_SOCKET } from '@deployer/mesh-client'
import { MESH_WEBSOCKET_PATH } from '@deployer/node-agent-contracts'

import {
    type JoinServiceMeshOptions,
    joinServiceMesh,
} from './join-service-mesh'
import { peerInfoRouter } from './peer-router'

import type { MeshMembership } from './join-mesh'
import type { LoopbackContext } from './loopback-router'
import type { RouterContract } from '@orpc/contract'
import type { Router } from '@orpc/server'
import type { Server } from 'node:http'

export type JoinOnNodeOptions = {
    readonly service: string
    /** The port the service's HTTP surface answers on: the mesh websocket shares it, and the loopback calls it. */
    readonly port: number
    readonly server: Server
    readonly contracts: readonly RouterContract[]
    readonly extraRouter?: JoinServiceMeshOptions['extraRouter']
    /**
     * Procedures served beside the contracts, by visibility class, each at its own keys: `{ peer: { peers: { ask } } }`
     * serves `peers.ask`. `peers.info` is the join's own fact and is always served, from what it knows, so a service
     * cannot report a replica id it never registered.
     *
     * A class is a visibility label on this one socket, not a second socket: the credential the transport checks is the
     * same for both, and splitting the listeners per class is a later change.
     */
    readonly routers?: { readonly peer?: Router<LoopbackContext> }
    readonly keys?: JoinServiceMeshOptions['keys']
    readonly load?: JoinServiceMeshOptions['load']
    readonly heartbeatMs?: JoinServiceMeshOptions['heartbeatMs']
    /** The environment the service runs in, for the deployment's own facts. Defaults to `process.env`. */
    readonly env?: Readonly<Record<string, string | undefined>>
    readonly log?: (message: string) => void
}

/**
 * Takes a service onto the mesh of its node, if the node has an agent.
 *
 * Without an agent (a dev run, a node that was not given one) the service runs exactly as it always did and is reached
 * directly: the mesh is how services find each other, not a requirement to start. With one, the service registers with it,
 * serves its contracts over its websocket, and from then on its callers reach it through their own agents.
 *
 * `NODE_AGENT_SOCKET` and `MESH_ADVERTISE_URL` are deployment facts (where the agent's socket is mounted, which address the
 * overlay network knows this host by), not node configuration, and both have a default.
 */
export function joinServiceMeshOnNode(
    options: JoinOnNodeOptions
): MeshMembership | undefined {
    const env = options.env ?? process.env
    const log =
        options.log ??
        ((message: string) => {
            console.log(message)
        })
    const socketPath = env.NODE_AGENT_SOCKET ?? DEFAULT_AGENT_SOCKET
    if (!existsSync(socketPath)) {
        log(
            `[${options.service}] No mesh agent at ${socketPath}: running without the mesh`
        )
        return undefined
    }

    const advertiseUrl =
        env.MESH_ADVERTISE_URL ??
        `ws://${hostname()}:${String(options.port)}${MESH_WEBSOCKET_PATH}`
    const replicaId = `${options.service}-${hostname()}`
    // The peer class is built from the join's own facts (the replica id it registers, the keys it beats with) and the
    // caller's peer procedures are mounted beside `peers.info`, never over it.
    const peer = peerInfoRouter({
        service: options.service,
        replicaId,
        keys: options.keys,
        env,
    })
    const suppliedPeer = options.routers?.peer as
        { peers?: Record<string, unknown> } | undefined
    const membership = joinServiceMesh({
        service: options.service,
        replicaId,
        server: options.server,
        contracts: options.contracts,
        loopbackOrigin: `http://127.0.0.1:${String(options.port)}`,
        agentSocketPath: socketPath,
        advertiseUrl,
        extraRouter: {
            ...options.extraRouter,
            ...suppliedPeer,
            peers: { ...peer.peers, ...suppliedPeer?.peers },
        },
        keys: options.keys,
        load: options.load,
        heartbeatMs: options.heartbeatMs,
        // The socket EXISTS, so the mesh is expected to work: a first registration that fails is a real fault, and the
        // service says which socket and which errno instead of running quietly outside the mesh.
        onRegistrationFailure: (error) => {
            log(
                `[${options.service}] The agent socket ${socketPath} exists but the first registration failed (${errnoOf(error)}): the service keeps running outside the mesh until a beat succeeds`
            )
        },
    })
    log(
        `[${options.service}] Joined the mesh through ${socketPath}, advertised at ${advertiseUrl}`
    )
    return membership
}

/** The errno of a failed socket call: one code, or the codes of an aggregate (a dual-stack connect reports one per family). */
function errnoOf(error: unknown): string {
    const codes = new Set<string>()
    let current: unknown = error
    // The websocket library wraps the connect failure, sometimes a few times: the code is somewhere in the chain.
    for (
        let depth = 0;
        current !== null && current !== undefined && depth < 5;
        depth += 1
    ) {
        const code = (current as { code?: unknown }).code
        if (typeof code === 'string') codes.add(code)
        for (const nested of (
            current as { errors?: readonly { code?: unknown }[] }
        ).errors ?? []) {
            if (typeof nested.code === 'string') codes.add(nested.code)
        }
        current = (current as { cause?: unknown }).cause
    }
    if (codes.size > 0) return [...codes].join('/')
    // A transport that drops the errno keeps only its own message: report that, rather than inventing a code.
    return error instanceof Error ? error.message : String(error)
}
