/**
 * NodeAgentBootstrapService — make sure the node the API runs on has its agent.
 *
 * Setup starts the agent on a fresh install. This covers the other case: a node
 * installed before the mesh existed, or whose agent container was removed. It
 * runs once at boot, best-effort — the API never fails to start over it, because
 * every consumer of the agent already degrades to "local only" without one.
 *
 * Once the node is in a cluster it publishes its platform node id as a member
 * label (`deployer.node-id`), so the Network pages can tell which mesh member is
 * which node. Labels merge, so this never clobbers another fact.
 */

import { Context, Effect } from 'effect'

import { DockerEngine, type DockerEngineShape } from '@deployer/docker'
import {
    NODE_DOOR_SOCKET_ENV,
    NODE_ID_LABEL,
    nodeDoorFromEnv,
    type NodeDoorClient,
} from '@deployer/mesh-client'
import {
    serviceLifecycle,
    type ServiceLifecycleShape,
} from '@deployer/nest-effect'
import {
    ensureNodeAgentContainer,
    isNodeAgentSwarmMode,
    makeNodeAgentEngine,
} from '@deployer/node-agent-container'
import {
    NodeConfigRepository,
    type NodeConfigRepositoryShape,
} from '@deployer/node-state'

import { EnvService } from '../../../config/env/env.module'

export type NodeAgentBootstrapShape = ServiceLifecycleShape & {
    /** Ensure the node's agent once; resolves with what happened. Never fails: every step is best-effort and logged. */
    readonly ensure: () => Effect.Effect<void>
}

/** shortcut: matches the daemon error text, so a rewording of it brings the warning back; upgrade when the engine error carries a code. */
export function isDockerSocketMissing(message: string): boolean {
    return message.includes('ENOENT') && message.includes('docker.sock')
}

export class NodeAgentBootstrap extends Context.Service<
    NodeAgentBootstrap,
    NodeAgentBootstrapShape
>()('shared/NodeAgentBootstrap') {
    /**
     * Collaborators are constructor arguments: the shape's members are all
     * lifecycle or fail-free, so nothing is yielded at call time.
     */
    static readonly live = class NodeAgentBootstrapImpl
        implements NodeAgentBootstrapShape
    {
        constructor(
            private readonly docker: DockerEngineShape,
            private readonly nodeConfig: NodeConfigRepositoryShape,
            private readonly door: NodeDoorClient,
            /** `NODE_AGENT_SWARM_MODE`, `NODE_AGENT_IMAGE` and the door socket path, read when needed. */
            private readonly settings: {
                readonly swarmMode: () => unknown
                readonly image: () => string | undefined
                readonly doorSocket: () => string | undefined
            }
        ) {}

        /** Labels this node's roster entry with its platform node id, through the node door. Best-effort: labels are cosmetic. */
        private labelNode(nodeId: string): Effect.Effect<void, unknown> {
            const { door } = this
            return Effect.promise(() =>
                door.labels({ [NODE_ID_LABEL]: nodeId })
            ).pipe(
                Effect.flatMap((labelled) =>
                    labelled === null
                        ? Effect.logWarning(
                              'Mesh agent label write failed: the node door did not answer'
                          )
                        : Effect.logInfo(
                              `Mesh member labelled with node id ${nodeId}`
                          )
                )
            )
        }

        private ensureAgent(): Effect.Effect<void, unknown> {
            const { docker, nodeConfig, door, settings } = this
            return Effect.gen({ self: this }, function* () {
                const node = yield* nodeConfig.find()
                if (node?.setupState !== 'setup_done') return

                // NODE_AGENT_SWARM_MODE=true: the swarm runs the agent as a GLOBAL service. Creating the host
                // container too would give the socket and the `deployer-mesh` interface a second owner, so only
                // the door is read here.
                if (isNodeAgentSwarmMode(settings.swarmMode())) {
                    yield* Effect.logInfo(
                        "NODE_AGENT_SWARM_MODE=true — the swarm owns this node's mesh agent; not creating the host container"
                    )
                } else {
                    const image = settings.image()
                    if (image === undefined || image === '') {
                        yield* Effect.logWarning(
                            'No mesh agent image: set NODE_AGENT_IMAGE'
                        )
                        return
                    }
                    const outcome = yield* Effect.promise(() =>
                        ensureNodeAgentContainer(makeNodeAgentEngine(docker), {
                            image,
                        })
                    )
                    if (outcome !== 'running')
                        yield* Effect.logInfo(
                            `Mesh agent ${outcome} on this node`
                        )
                }

                const status = yield* Effect.promise(() => door.status())
                if (status === null) {
                    yield* Effect.logWarning(
                        `Mesh agent started but its node door is not visible at ${settings.doorSocket() ?? '(unset NODE_AGENT_SOCKET)'} — is the run volume mounted into the API?`
                    )
                    return
                }
                yield* Effect.logInfo(
                    `Mesh agent answered: ${status.agentId} — interface ${status.interfaceUp ? 'up' : 'down'}`
                )

                // A lone node founds its own mesh; on a multi-node swarm a down interface means the node cannot
                // reach its peers, which is an operator problem, not something this process can fix by founding a
                // second network.
                if (!status.interfaceUp) {
                    const nodes = yield* docker.swarmNodes
                        .list()
                        .pipe(Effect.orElseSucceed(() => []))
                    if (nodes.length > 1) {
                        yield* Effect.logWarning(
                            `This node shares a ${String(nodes.length)}-node swarm but its mesh interface is down — check its agent (see "Upgrading an existing cluster" in docs/edge-mesh-architecture.md)`
                        )
                    }
                }

                yield* this.labelNode(node.nodeId)
            })
        }

        /** Ensure the node's agent once; resolves with what happened. Never fails: every step is best-effort and logged. */
        ensure(): Effect.Effect<void> {
            return this.ensureAgent().pipe(
                Effect.catchCause((cause) => {
                    const message = String(cause)
                    // A service without the Docker socket (project, identity, health) cannot own the agent by
                    // design: fleet and runtime do. Warning there on every boot reads as a fault and is not one.
                    return isDockerSocketMissing(message)
                        ? Effect.logDebug(
                              `Mesh agent not ensured here, no Docker engine in this service: ${message}`
                          )
                        : Effect.logWarning(
                              `Mesh agent not ensured: ${message}`
                          )
                })
            )
        }

        // Fire-and-forget: the API never fails to start over the agent, so boot does not wait for it either.
        onReady(): Effect.Effect<void> {
            return Effect.forkDetach(this.ensure()).pipe(Effect.asVoid)
        }
    }

    /** The factory, as Nest wires it: the node's door, built from the environment. */
    static readonly provider = {
        provide: NodeAgentBootstrap,
        useFactory: (
            docker: DockerEngineShape,
            env: EnvService,
            nodeConfig: NodeConfigRepositoryShape
        ) =>
            new NodeAgentBootstrap.live(docker, nodeConfig, nodeDoorFromEnv(env), {
                swarmMode: () => env.get('NODE_AGENT_SWARM_MODE'),
                image: () => env.get('NODE_AGENT_IMAGE'),
                doorSocket: () => env.get(NODE_DOOR_SOCKET_ENV),
            }),
        inject: [DockerEngine, EnvService, NodeConfigRepository],
    }
}

export const nodeAgentBootstrapLifecycle = () =>
    serviceLifecycle(NodeAgentBootstrap)
