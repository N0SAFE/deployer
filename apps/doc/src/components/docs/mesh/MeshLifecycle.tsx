'use client'

import { useId, useState } from 'react'

import {
    ArrowDefs,
    Box,
    Frame,
    ink,
    Label,
    ROUTE_COLOURS,
    Stepper,
    StepList,
    TONES,
} from './svg-kit'

type Arrow =
    | 'reg1'
    | 'reg2'
    | 'call'
    | 'serve'
    | 'join1'
    | 'join2'
    | 'cross'
    | 'grant'
    | 'direct'

interface Phase {
    readonly title: string
    readonly detail: string
    /** Whether node B (the swarm) is part of the picture. */
    readonly swarm: boolean
    /** Replica 1 has stopped beating. */
    readonly dead?: boolean
    /** The directory lines each agent shows. */
    readonly a: readonly string[]
    readonly b: readonly string[]
    readonly on: readonly Arrow[]
    readonly caption: string
}

const PHASES: readonly Phase[] = [
    {
        title: 'The agent boots on a node that is in no swarm',
        detail: 'Nothing is configured. On first boot the agent creates its local store and generates the node id and a credential of its own, then binds its HTTP port, serves the mesh websocket on it and starts the gossip loop. It needs no database and no auth module. The directory is empty and the loop has nobody to ask, which is a normal state.',
        swarm: false,
        a: [],
        b: [],
        on: [],
        caption:
            'Boot: store created, id generated, port bound, directory empty, no seed',
    },
    {
        title: 'Two runtimes register and keep beating',
        detail: 'Each runtime registers with its local agent over the unix socket every 5 seconds, with its address, load and the keys it holds. The agent stamps the node id, bumps the generation and sets an expiry of four beats, so a runtime that stops beating ages out by itself.',
        swarm: false,
        a: [
            'runtime-1 · A · load 0.60',
            'runtime-2 · A · load 0.10 · key stream-7',
        ],
        b: [],
        on: ['reg1', 'reg2'],
        caption: 'The directory lives in memory only: nothing is persisted',
    },
    {
        title: 'Alone, it already brokers calls between them',
        detail: 'A caller asks its agent for the service runtime. With no key, the agent prefers a replica on its own node and picks the least loaded, runtime 2. If runtime 2 answered MESH_REDIRECT, the agent itself would replay the call on the replica it names. The caller never sees any of it.',
        swarm: false,
        a: [
            'runtime-1 · A · load 0.60',
            'runtime-2 · A · load 0.10 · key stream-7  (chosen)',
        ],
        b: [],
        on: ['call', 'serve'],
        caption:
            'Resolution order: key holder, own node, key hash, least loaded',
    },
    {
        title: 'Later, the node redeems a join token',
        detail: "An operator issues a join token on a node of the swarm and the new node redeems it with roster.join. The token carries the address of an agent of the swarm, the swarm's credential and an expiry; the agent adopts the credential and remembers the address as a seed, retrying it every round until it answers, so the swarm does not have to be up yet. The first exchange sends everything the agent holds and brings back everything the swarm knows.",
        swarm: true,
        a: [
            'runtime-1 · A · load 0.60',
            'runtime-2 · A · load 0.10 · key stream-7',
            'runtime-b · B · load 0.30 · key stream-9',
            'knows agents: B',
        ],
        b: [
            'runtime-b · B · load 0.30 · key stream-9',
            'runtime-1 · A · load 0.60',
            'runtime-2 · A · load 0.10 · key stream-7',
            'knows agents: A',
        ],
        on: ['join1', 'join2'],
        caption:
            'roster.exchange: both sides learn replicas and agents in one round trip',
    },
    {
        title: 'Gossip keeps both sides fresh',
        detail: "Every 5 seconds the agent exchanges with every agent it knows, and an exchange also carries the agents the peer knows, so one seed is enough to find the whole mesh. A node's own replicas only come from registration, never from a peer, so gossip cannot overwrite what the agent knows first-hand.",
        swarm: true,
        a: [
            'runtime-1 · A · load 0.55',
            'runtime-2 · A · load 0.15 · key stream-7',
            'runtime-b · B · load 0.25 · key stream-9',
            'knows agents: B',
        ],
        b: [
            'runtime-b · B · load 0.25 · key stream-9',
            'runtime-1 · A · load 0.55',
            'runtime-2 · A · load 0.15 · key stream-7',
            'knows agents: A',
        ],
        on: ['join1', 'join2'],
        caption:
            'Records expire on the clock of the agent that stamped them: keep node clocks in sync',
    },
    {
        title: 'A call for a key held on another node',
        detail: "The caller asks for runtime with key stream-9. The directory says runtime b on node B holds it, so the agent calls it over its pooled websocket and returns the answer. If the call was pinned to a node, the agent would forward it to that node's agent instead, which serves its own node only.",
        swarm: true,
        a: [
            'runtime-1 · A · load 0.55',
            'runtime-2 · A · load 0.15 · key stream-7',
            'runtime-b · B · load 0.25 · key stream-9  (key holder)',
            'knows agents: B',
        ],
        b: [
            'runtime-b · B · load 0.25 · key stream-9',
            'runtime-1 · A · load 0.55',
            'runtime-2 · A · load 0.15 · key stream-7',
            'knows agents: A',
        ],
        on: ['call', 'cross'],
        caption:
            'Cross-node: the agent relays; the caller still only talks to its own agent',
    },
    {
        title: 'A heavy call is handed a direct link',
        detail: 'For a heavy procedure, a caller that asks for it, an overloaded agent or a hot caller and target pair, the agent does not relay. It answers MESH_DIRECT with a signed grant that lives 30 seconds. The caller opens a pooled websocket straight to the replica and replays the call, and the replica checks the token. If the grant is refused, the agent is asked again.',
        swarm: true,
        a: [
            'runtime-1 · A · load 0.55',
            'runtime-2 · A · load 0.15 · key stream-7',
            'runtime-b · B · load 0.25 · key stream-9  (granted)',
            'knows agents: B',
        ],
        b: [
            'runtime-b · B · load 0.25 · key stream-9',
            'runtime-1 · A · load 0.55',
            'runtime-2 · A · load 0.15 · key stream-7',
            'knows agents: A',
        ],
        on: ['call', 'grant', 'direct'],
        caption:
            'Direct lease: the agent stays the control plane and carries none of the bytes',
    },
    {
        title: 'A replica dies, a seed goes down: the mesh heals',
        detail: 'Runtime 1 stops beating. Its record expires after about 20 seconds (four beats) on A and on every agent that gossiped it, and calls stop being routed to it. If the seed agent goes down, nothing changes, because the agents it taught this one are asked directly. Agents that restart rejoin through the seed they remember.',
        swarm: true,
        dead: true,
        a: [
            'runtime-2 · A · load 0.15 · key stream-7',
            'runtime-b · B · load 0.25 · key stream-9',
            'knows agents: B',
        ],
        b: [
            'runtime-b · B · load 0.25 · key stream-9',
            'runtime-2 · A · load 0.15 · key stream-7',
            'knows agents: A',
        ],
        on: [],
        caption:
            'Nothing to clean up by hand: expiry removes what stopped beating',
    },
]

/** The paths of the nine arrows, with their colour. */
const ARROWS: Record<
    Arrow,
    { d: string; colour: string; dashed?: boolean; wide?: boolean }
> = {
    reg1: { d: 'M184 212V186', colour: ROUTE_COLOURS.peer },
    reg2: { d: 'M281 212V186', colour: ROUTE_COLOURS.peer },
    call: { d: 'M104 212V186', colour: ROUTE_COLOURS.external },
    serve: { d: 'M268 186V212', colour: ROUTE_COLOURS.external },
    join1: { d: 'M326 100H384', colour: ROUTE_COLOURS.node },
    join2: { d: 'M384 130H326', colour: ROUTE_COLOURS.node },
    cross: { d: 'M300 186V200H441V212', colour: ROUTE_COLOURS.external },
    grant: { d: 'M70 186V212', colour: ROUTE_COLOURS.lease, dashed: true },
    direct: {
        d: 'M88 256V280H470V256',
        colour: ROUTE_COLOURS.lease,
        wide: true,
    },
}

/** A node's life, step by step: alone, joined, gossiping, a cross-node call, a direct lease, a replica dying. */
export function MeshLifecycle() {
    const arrow = useId()
    const [index, setIndex] = useState(0)
    const phase = PHASES[index] ?? PHASES[0]
    if (phase === undefined) return null

    const directory = (lines: readonly string[], x: number) =>
        [0, 1, 2, 3, 4].map((row) => (
            <Label key={row} x={x} y={106 + row * 16}>
                {lines[row] ?? ''}
            </Label>
        ))

    return (
        <figure style={{ margin: '1.5rem 0' }}>
            <svg
                width="100%"
                viewBox="0 0 680 330"
                role="img"
                aria-label="A mesh agent from boot to joined"
            >
                <title>A mesh agent from boot to joined</title>
                <desc>
                    Node A runs an agent, a caller and two runtimes. Node B is
                    in a swarm. The steps show registration, a local call,
                    joining, gossip, a cross-node call, a direct lease and a
                    replica expiring.
                </desc>
                <ArrowDefs id={arrow} />
                <Frame x={30} y={50} width={310} height={250} />
                <Label x={30} y={40}>
                    Node A (alone at first)
                </Label>
                <g opacity={phase.swarm ? 1 : 0.3}>
                    <Frame x={370} y={50} width={280} height={250} />
                    <Label x={370} y={40}>
                        Node B (in the swarm)
                    </Label>
                    <Box x={386} y={66} width={248} height={118} radius={6}>
                        <Label x={400} y={84} size="title">
                            node-agent B
                        </Label>
                        {directory(phase.b, 400)}
                    </Box>
                    <Box
                        x={386}
                        y={214}
                        width={110}
                        height={40}
                        radius={4}
                        tone="blue"
                    >
                        <Label x={441} y={234} anchor="middle">
                            runtime b
                        </Label>
                    </Box>
                </g>
                <Box x={46} y={66} width={278} height={118} radius={6}>
                    <Label x={60} y={84} size="title">
                        node-agent A
                    </Label>
                    {directory(phase.a, 60)}
                </Box>
                <Box
                    x={46}
                    y={214}
                    width={84}
                    height={40}
                    radius={4}
                    tone="blue"
                >
                    <Label x={88} y={234} anchor="middle">
                        caller
                    </Label>
                </Box>
                <g opacity={phase.dead ? 0.3 : 1}>
                    <Box
                        x={140}
                        y={214}
                        width={88}
                        height={40}
                        radius={4}
                        tone="blue"
                    >
                        <Label x={184} y={234} anchor="middle">
                            runtime 1
                        </Label>
                    </Box>
                </g>
                <Box
                    x={238}
                    y={214}
                    width={86}
                    height={40}
                    radius={4}
                    tone="blue"
                >
                    <Label x={281} y={234} anchor="middle">
                        runtime 2
                    </Label>
                </Box>
                <g fill="none">
                    {phase.on.map((name) => {
                        const line = ARROWS[name]
                        return (
                            <path
                                key={name}
                                d={line.d}
                                stroke={line.colour}
                                style={{
                                    strokeWidth: line.wide === true ? 2.5 : 1.5,
                                    strokeDasharray:
                                        line.dashed === true
                                            ? '5 4'
                                            : undefined,
                                    markerEnd: `url(#${arrow})`,
                                }}
                            />
                        )
                    })}
                </g>
                <text
                    x={340}
                    y={318}
                    style={{
                        textAnchor: 'middle',
                        fontSize: 12,
                        fill: ink.muted,
                    }}
                >
                    {phase.caption}
                </text>
            </svg>
            <Stepper count={PHASES.length} index={index} onIndex={setIndex} />
            <StepList
                titles={PHASES.map((entry) => entry.title)}
                index={index}
                detail={phase.detail}
            />
            <p style={{ margin: '8px 0 0', fontSize: 12, color: ink.muted }}>
                <span style={{ color: TONES.teal }}>Registration</span> ·{' '}
                <span style={{ color: TONES.purple }}>call</span> ·{' '}
                <span style={{ color: TONES.coral }}>join and gossip</span> ·{' '}
                <span style={{ color: TONES.amber }}>direct lease</span>
            </p>
        </figure>
    )
}
