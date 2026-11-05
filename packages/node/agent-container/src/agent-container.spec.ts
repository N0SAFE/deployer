import { hostname } from 'node:os'

import { expect, it } from 'vitest'

import {
    DEFAULT_DOOR_IMAGE,
    NODE_AGENT_ADMIN_VOLUME,
    NODE_AGENT_CONTAINER_NAME,
    NODE_AGENT_DATA_VOLUME,
    NODE_AGENT_PORT,
    NODE_AGENT_RUN_VOLUME,
    nodeAgentContainerEnv,
    nodeAgentContainerSpec,
    primaryLanAddress,
} from './agent-container'

it("advertises the host's LAN address, never the container's own name", () => {
    const host = primaryLanAddress() ?? hostname()
    expect(nodeAgentContainerEnv({})).toContain(
        `MESH_ADVERTISE_URL=ws://${host}:${String(NODE_AGENT_PORT)}/mesh/ws`
    )
})

it('keeps an explicit advertise URL', () => {
    expect(
        nodeAgentContainerEnv({ advertiseUrl: 'ws://node-a:3106/mesh/ws' })
    ).toContain('MESH_ADVERTISE_URL=ws://node-a:3106/mesh/ws')
})

it('pins the door image the deployment chose, so a setting cannot run another one', () => {
    expect(nodeAgentContainerEnv({ doorImage: 'nginx:1.27-alpine' })).toContain(
        'NODE_AGENT_DOOR_IMAGE=nginx:1.27-alpine'
    )
    expect(nodeAgentContainerEnv({})).toContain(
        `NODE_AGENT_DOOR_IMAGE=${process.env.DEPLOYER_DOOR_IMAGE ?? DEFAULT_DOOR_IMAGE}`
    )
})

it("owns the socket as the tier's user, so its services can open the door", () => {
    expect(nodeAgentContainerEnv({})).toEqual(
        expect.arrayContaining([
            'NODE_AGENT_SOCKET_UID=1001',
            'NODE_AGENT_SOCKET_GID=1001',
        ])
    )
    expect(nodeAgentContainerEnv({ socketUid: 1000, socketGid: 1000 })).toEqual(
        expect.arrayContaining([
            'NODE_AGENT_SOCKET_UID=1000',
            'NODE_AGENT_SOCKET_GID=1000',
        ])
    )
})

it("mounts the agent's own data volume and the shared run volume under the shared container name", () => {
    const spec = nodeAgentContainerSpec({ image: 'agent:v2' }) as {
        Env: string[]
        HostConfig: { Binds: string[] }
    }
    expect(spec.HostConfig.Binds).toEqual([
        `${NODE_AGENT_DATA_VOLUME}:/var/lib/deployer/node-agent`,
        `${NODE_AGENT_RUN_VOLUME}:/run/deployer-node`,
        `${NODE_AGENT_ADMIN_VOLUME}:/run/deployer-node-admin`,
        '/var/run/docker.sock:/var/run/docker.sock',
    ])
    expect(spec.Env).toContain(
        'NODE_AGENT_SOCKET=/run/deployer-node/agent.sock'
    )
    expect(spec.Env).toContain(
        'NODE_AGENT_ADMIN_SOCKET=/run/deployer-node-admin/admin.sock'
    )
    expect(NODE_AGENT_CONTAINER_NAME).toBe('deployer-node-agent')
})
