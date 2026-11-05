import { chmodSync, chownSync, mkdirSync, rmSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server } from 'node:http'
import { dirname } from 'node:path'

import {
    Inject,
    Injectable,
    Logger,
    type OnApplicationBootstrap,
    type OnModuleDestroy,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { AbstractHttpAdapter, HttpAdapterHost } from '@nestjs/core'
import { Effect } from 'effect'

import { attachMeshWebSocket, type MeshWebSocket } from '@deployer/mesh-server'
import { EffectHost } from '@deployer/nest-effect'
import {
    MESH_INTERVAL_DEFAULTS,
    MESH_TRANSPORT_OPTIONS,
    MeshRouterResolver,
    type MeshRouter,
    type MeshTransportOptions,
} from '@deployer/nest-mesh'
import { MESH_WEBSOCKET_PATH } from '@deployer/node-agent-contracts'
import {
    MESH_CREDENTIAL_VERIFIER,
    type MeshCredentialVerifier,
} from '@deployer/shared/server'

import {
    type NodeAgentEnv,
    resolveAdminSocketPath,
    resolveLocalSocketPath,
    resolveSeeds,
    resolveSocketOwnership,
    wireguardEnabled,
} from '../config/node-agent.env'
import { AgentStore } from '../local/agent-store'
import { AgentLinkFactory } from '../modules/mesh/services/agent-link-factory.service'
import { AgentLoad } from '../modules/mesh/services/agent-load.service'
import { PendingSeeds } from '../modules/mesh/services/pending-seeds.service'
import { ReplicaLinks } from '../modules/mesh/services/replica-links.service'
import { RosterGossip } from '../modules/mesh/services/roster-gossip.service'
import { DoorsTick } from '../network/doors/doors-tick.service'
import { WireguardTick } from '../network/wireguard-tick.service'

import { type GossipLoop, startGossipLoop } from './gossip-loop'
import { startTickLoop } from './tick-loop'

import type { Context, Router } from '@orpc/server'

const logger = new Logger('MeshTransport')

/** A loop the transport started: one `stop`, and nothing to await. */
type Loop = { readonly stop: () => void }

/**
 * What an agent does once its HTTP port is bound: serve the mesh over a persistent websocket, and keep its view of the
 * other agents and of every replica fresh by gossip.
 *
 * The routers come from `MeshRouterResolver`, which reads the `static procedures` map of every `MeshController`
 * provider: a procedure is declared once, on its method, and both doors are assembled from that. The oRPC context is
 * read per call from the Effect host, so a call on a connection that lives for hours still sees the services of the
 * moment.
 *
 * Nest owns the lifecycle: bootstrap binds the sockets and starts the loops, destroy stops both. `main.ts` and the
 * boot harness call nothing.
 */
@Injectable()
export class MeshTransportService
    implements OnApplicationBootstrap, OnModuleDestroy
{
    private path: string | null = null
    private adminPath: string | null = null
    private peer: MeshWebSocket | null = null
    private local: MeshWebSocket | null = null
    private admin: MeshWebSocket | null = null
    private localServer: Server | null = null
    private adminServer: Server | null = null
    private loops: Loop[] = []
    private stopping: Promise<void> | null = null

    constructor(
        private readonly config: ConfigService<NodeAgentEnv, true>,
        @Inject(EffectHost) private readonly host: EffectHost['Service'],
        @Inject(MeshRouterResolver)
        private readonly resolver: MeshRouterResolver['Service'],
        private readonly adapterHost: HttpAdapterHost<
            AbstractHttpAdapter<Server | undefined>
        >,
        @Inject(MESH_CREDENTIAL_VERIFIER)
        private readonly verify: MeshCredentialVerifier,
        @Inject(MESH_TRANSPORT_OPTIONS)
        private readonly options: MeshTransportOptions
    ) {}

    /** The unix socket the services of this node reach the agent through. Bound at bootstrap, removed at destroy. */
    get localSocketPath(): string {
        if (this.path === null)
            throw new Error(
                'The mesh transport has not started: its local socket is bound at bootstrap'
            )
        return this.path
    }

    /**
     * The admin socket: credential, rotate, join, token, block and `node.configure`. Mode 0600, so only the processes the
     * deployment mounts it into can use it.
     */
    get adminSocketPath(): string {
        if (this.adminPath === null)
            throw new Error(
                'The mesh transport has not started: its admin socket is bound at bootstrap'
            )
        return this.adminPath
    }

    async onApplicationBootstrap(): Promise<void> {
        const { peer, node, admin } = this.resolver.resolve()
        // The lease policy's bytes-per-second input: counted on the socket, never by parsing a payload.
        const load = await this.host.runUnwrapped(AgentLoad)

        // `nodeDoor` names the door a call came in on: it is the marker `roster.join` and `roster.setting` read to refuse
        // everything that is not this node's own socket.
        const serve = (
            server: Server,
            trusted: MeshCredentialVerifier,
            router: MeshRouter,
            nodeDoor: boolean
        ) =>
            attachMeshWebSocket({
                server,
                path: MESH_WEBSOCKET_PATH,
                router: router as unknown as Router<Context>,
                verify: trusted,
                onBytes: (bytes) => {
                    load.bytesMoved(bytes)
                },
                context: async (request: IncomingMessage) => ({
                    request: { headers: request.headers },
                    'effect/context': await this.host.context(),
                    nodeDoor,
                }),
            })

        // The mesh, for other agents: on the service's own port, behind the swarm's credential. Nest builds the HTTP server
        // before the bootstrap hook and listens after it, so the upgrade listener is in place before the port opens.
        this.peer = serve(this.getHttpServer(), this.verify, peer, false)

        // The node, for its own services: a unix socket, behind nothing but the file's permissions. A service on the node
        // reaches its agent here and never holds the swarm's credential, so there is nothing in it to leak or to rotate.
        // The socket's permissions ARE the trust boundary: the owner is the deployment's user, and only that user (and its
        // group) may talk to the agent at all. A hand-started agent that is not root cannot chown: it says so and keeps the
        // owner it runs as, which is the same user anyway.
        const owner = resolveSocketOwnership({
            NODE_AGENT_SOCKET_UID: this.env('NODE_AGENT_SOCKET_UID'),
            NODE_AGENT_SOCKET_GID: this.env('NODE_AGENT_SOCKET_GID'),
        })
        const bind = async (path: string, mode: number, router: MeshRouter) => {
            mkdirSync(dirname(path), { recursive: true, mode: 0o755 })
            rmSync(path, { force: true })
            const server = createServer((_request, response) =>
                response.writeHead(404).end()
            )
            const gateway = serve(server, () => true, router, true)
            await new Promise<void>((resolve, reject) => {
                server.once('error', reject)
                server.listen(path, resolve)
            })
            try {
                chownSync(path, owner.uid, owner.gid)
            } catch (error) {
                logger.warn(
                    `Could not set the owner of ${path} to ${String(owner.uid)}:${String(owner.gid)}: ${error instanceof Error ? error.message : String(error)}`
                )
            }
            chmodSync(path, mode)
            logger.log(
                `Local socket ${path} owned by ${String(owner.uid)}:${String(owner.gid)}, mode 0${mode.toString(8)}`
            )
            return { server, gateway }
        }

        // Two sockets, two audiences. A service gets the allowlisted procedures only; the admin socket (0600, mounted into
        // the operator-facing processes alone) gets everything, so a compromised service cannot join a swarm, rotate the
        // secret or reconfigure the node.
        const servicePath = resolveLocalSocketPath({
            NODE_AGENT_DATA_DIR: this.env('NODE_AGENT_DATA_DIR'),
            NODE_AGENT_SOCKET: this.env('NODE_AGENT_SOCKET'),
        })
        const bound = await bind(servicePath, 0o660, node)
        this.localServer = bound.server
        this.local = bound.gateway
        this.path = servicePath

        const adminPath = resolveAdminSocketPath({
            NODE_AGENT_DATA_DIR: this.env('NODE_AGENT_DATA_DIR'),
            NODE_AGENT_ADMIN_SOCKET: this.env('NODE_AGENT_ADMIN_SOCKET'),
        })
        const boundAdmin = await bind(adminPath, 0o600, admin)
        this.adminServer = boundAdmin.server
        this.admin = boundAdmin.gateway
        this.adminPath = adminPath

        // A node that joined a swarm rejoins by itself: the seeds it was given are kept in its store. The environment can
        // add more (dev only), and `roster.join` adds one at any time.
        const remembered = await this.host.runUnwrapped(
            Effect.flatMap(AgentStore, (store) => store.seeds())
        )
        for (const address of [
            ...remembered,
            ...resolveSeeds({ MESH_SEEDS: this.env('MESH_SEEDS') }),
        ]) {
            await this.host.runUnwrapped(
                Effect.flatMap(PendingSeeds, (seeds) => seeds.add(address))
            )
        }

        // The doors: read `node.doors` from the node's store and converge. No setting is a no-op, so a node that has never
        // been given one runs the loop without touching Docker.
        this.loops.push(
            startTickLoop({
                intervalMs: this.interval(
                    'doorsIntervalMs',
                    this.env('MESH_DOORS_INTERVAL_MS')
                ),
                onError: (error) => {
                    logger.warn(
                        `Doors pass failed: ${error instanceof Error ? error.message : String(error)}`
                    )
                },
                tick: () =>
                    this.host.runUnwrapped(
                        Effect.flatMap(DoorsTick, (tick) => tick.convergeOnce())
                    ),
            })
        )

        // The overlay: only when the deployment says this agent owns the interface. Off by default so a hand-started agent
        // never touches the host; the container spec turns it on.
        if (
            wireguardEnabled({
                MESH_WIREGUARD_ENABLED: this.env('MESH_WIREGUARD_ENABLED'),
            })
        ) {
            this.loops.push(
                startTickLoop({
                    intervalMs: this.interval(
                        'wireguardIntervalMs',
                        this.env('MESH_WIREGUARD_INTERVAL_MS')
                    ),
                    onError: (error) => {
                        logger.warn(
                            `Wireguard pass failed: ${error instanceof Error ? error.message : String(error)}`
                        )
                    },
                    tick: () =>
                        this.host.runUnwrapped(
                            Effect.flatMap(WireguardTick, (tick) =>
                                tick.convergeOnce()
                            )
                        ),
                })
            )
        }

        // Idle links are closed on a pass of their own: gossip and the relay never close a connection nobody uses, and a mesh
        // that lost a node would otherwise keep its sockets (and the agent's memory) for the life of the process.
        const replicaLinks = await this.host.runUnwrapped(ReplicaLinks)
        const agentLinks = await this.host.runUnwrapped(AgentLinkFactory)
        this.loops.push(
            startTickLoop({
                intervalMs: this.interval(
                    'evictionIntervalMs',
                    this.env('MESH_EVICTION_INTERVAL_MS')
                ),
                onError: (error) => {
                    logger.warn(
                        `Link eviction failed: ${error instanceof Error ? error.message : String(error)}`
                    )
                },
                tick: async () => {
                    await replicaLinks.evictIdle()
                    await agentLinks.evictIdle?.()
                },
            })
        )

        const gossip: GossipLoop = startGossipLoop({
            intervalMs: this.interval(
                'gossipIntervalMs',
                this.env('MESH_GOSSIP_INTERVAL_MS')
            ),
            onError: (error) => {
                logger.warn(
                    `Gossip round failed: ${error instanceof Error ? error.message : String(error)}`
                )
            },
            pending: () =>
                this.host.runUnwrapped(
                    Effect.flatMap(PendingSeeds, (seeds) => seeds.pending())
                ),
            seed: (address) =>
                this.host.runUnwrapped(
                    Effect.flatMap(RosterGossip, (g) => g.seed(address))
                ),
            reached: (address) =>
                this.host.runUnwrapped(
                    Effect.flatMap(PendingSeeds, (seeds) =>
                        seeds.reached(address)
                    )
                ),
            round: () =>
                this.host.runUnwrapped(
                    Effect.flatMap(RosterGossip, (g) => g.round())
                ),
        })
        this.loops.push(gossip)
    }

    /**
     * Destroy, not shutdown: Nest closes the HTTP server between the two hooks, and a `server.close()` never completes
     * while the peer websocket still holds a connection. Terminating the gateways first is what lets the app close.
     */
    async onModuleDestroy(): Promise<void> {
        this.stopping ??= this.stopOnce()
        await this.stopping
    }

    /** Idempotent: gates close once, the socket is removed once, and a second call waits on the first. */
    private async stopOnce(): Promise<void> {
        const loops = this.loops
        this.loops = []
        for (const loop of loops) loop.stop()

        const gateways = [this.peer, this.local, this.admin]
        this.peer = null
        this.local = null
        this.admin = null
        await Promise.all(
            gateways.map((gateway) => gateway?.close() ?? Promise.resolve())
        )

        const servers = [this.localServer, this.adminServer]
        this.localServer = null
        this.adminServer = null
        for (const server of servers) {
            if (server?.listening === true) {
                await new Promise<void>((resolve) =>
                    server.close(() => {
                        resolve()
                    })
                )
            }
        }

        const paths = [this.path, this.adminPath]
        this.path = null
        this.adminPath = null
        for (const path of paths) {
            if (path !== null) rmSync(path, { force: true })
        }
    }

    /** The http server Nest owns: the peer websocket shares its port. */
    private getHttpServer(): Server {
        const server = this.adapterHost.httpAdapter.getHttpServer()
        if (server === undefined)
            throw new Error(
                'The mesh transport needs the HTTP server: it starts after the app is created'
            )
        return server
    }

    /** The interval in force: the deployment's setting, then the module option, then the default. */
    private interval(
        name: keyof typeof MESH_INTERVAL_DEFAULTS,
        configured: number | undefined
    ): number {
        return configured ?? this.options[name] ?? MESH_INTERVAL_DEFAULTS[name]
    }

    private env<K extends keyof NodeAgentEnv>(name: K): NodeAgentEnv[K] {
        return this.config.get(name, { infer: true })
    }
}
