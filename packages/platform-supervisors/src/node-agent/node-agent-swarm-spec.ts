/**
 * The node's mesh agent as a swarm GLOBAL service — one task per node, opt-in (`NODE_AGENT_SWARM_MODE`).
 *
 * The DEFAULT stays the host container (`ensureNodeAgentContainer`): the agent must exist BEFORE Swarm, which
 * advertises the address it creates. This spec exists for the deployments that want the swarm to own the task
 * lifecycle (restart, reschedule, a health state the engine reports) and can accept that ordering.
 *
 * The two are mutually exclusive: one owner of the run volume's socket and of the host's `deployer-mesh`
 * interface. `makeNodeAgentSwarmSupervisor` removes a platform-managed host container when it takes over.
 */
import type { SwarmServiceSpecInput } from '@deployer/contracts-entities'
import {
    NODE_AGENT_CONTAINER_NAME,
    NODE_AGENT_DATA_DIR,
    NODE_AGENT_DATA_VOLUME,
    NODE_AGENT_DOCKER_SOCKET,
    NODE_AGENT_ROLE,
    NODE_AGENT_ROLE_LABEL,
    NODE_AGENT_RUN_DIR,
    NODE_AGENT_ADMIN_RUN_DIR,
    NODE_AGENT_ADMIN_VOLUME,
    NODE_AGENT_RUN_VOLUME,
    nodeAgentContainerEnv,
} from '@deployer/node-agent-container'

/** The swarm service's name: not the container's, so `docker ps` and `docker service ls` never read alike. */
export const NODE_AGENT_SWARM_SERVICE_NAME = `${NODE_AGENT_CONTAINER_NAME}-swarm`

/** `deployer-node-agent-swarm[-<prefix>]`, like every other platform service name. */
export function nodeAgentSwarmServiceName(prefix: string | undefined): string {
    return prefix === undefined || prefix === ''
        ? NODE_AGENT_SWARM_SERVICE_NAME
        : `${NODE_AGENT_SWARM_SERVICE_NAME}-${prefix}`
}

export type NodeAgentSwarmSpecOptions = {
    readonly name: string
    readonly image: string
    /** Where peers reach this node's agent. Defaults to this host's LAN address, as the container spec does. */
    readonly advertiseUrl?: string | undefined
    readonly wireguard?: boolean | undefined
    readonly port?: number | undefined
}

/**
 * The desired GLOBAL spec. Env comes from `nodeAgentContainerEnv`, so the two shapes cannot drift into two
 * different agents; the run and data VOLUMES (not host paths) are what make the task's socket the same one the
 * deployment mounts, and what carry the agent's identity across the switch from the host container.
 */
export function nodeAgentSwarmSpec(
    options: NodeAgentSwarmSpecOptions
): SwarmServiceSpecInput {
    return {
        name: options.name,
        image: options.image,
        mode: 'global',
        replicas: 1,
        env: nodeAgentContainerEnv({
            advertiseUrl: options.advertiseUrl,
            wireguard: options.wireguard,
            port: options.port,
        }),
        command: [],
        args: [],
        labels: {
            [NODE_AGENT_ROLE_LABEL]: NODE_AGENT_ROLE,
            'deployer.managed': 'true',
        },
        containerLabels: {},
        mounts: [
            {
                type: 'volume',
                source: NODE_AGENT_DATA_VOLUME,
                target: NODE_AGENT_DATA_DIR,
                readOnly: false,
            },
            {
                type: 'volume',
                source: NODE_AGENT_RUN_VOLUME,
                target: NODE_AGENT_RUN_DIR,
                readOnly: false,
            },
            {
                type: 'volume',
                source: NODE_AGENT_ADMIN_VOLUME,
                target: NODE_AGENT_ADMIN_RUN_DIR,
                readOnly: false,
            },
            {
                type: 'bind',
                source: NODE_AGENT_DOCKER_SOCKET,
                target: NODE_AGENT_DOCKER_SOCKET,
                readOnly: false,
            },
        ],
        placementPreferences: [],
        placementConstraints: [],
        resourcesLimits: {},
        resourcesReservations: {},
        // Host networking: the interface must be the HOST's, because Swarm advertises it and the doors bind it.
        networks: [{ target: 'host', aliases: [] }],
        capabilitiesAdd: ['NET_ADMIN'],
        healthcheck: null,
        // One task per node and a host namespace: the replacement can only start once the old one let go.
        updateConfig: {
            parallelism: 1,
            delayMs: 0,
            order: 'stop-first',
            failureAction: 'rollback',
        },
        stopGracePeriodSeconds: 10,
        endpointPorts: [],
        endpointMode: 'dnsrr',
    }
}
