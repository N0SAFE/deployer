import { useId } from 'react';

import { ArrowDefs, Box, Label, ink, TONES } from './svg-kit';

/** What the agent does with one relayed call, as a flowchart. Static: it has no state to step through. */
export function MeshRelayDecision() {
  const arrow = useId();
  const line = { fill: 'none', stroke: ink.muted, style: { strokeWidth: 1.5, markerEnd: `url(#${arrow})` } } as const;
  return (
    <figure style={{ margin: '1.5rem 0' }}>
      <svg width="100%" viewBox="0 0 680 540" role="img" aria-label="What the agent does with one relayed call">
        <title>What the agent does with one relayed call</title>
        <desc>
          A call arrives. The agent forwards it to another node&apos;s agent if it is pinned elsewhere, grants a direct link if the lease policy says so, otherwise resolves a replica, calls it, answers any redirect itself and returns the result.
        </desc>
        <ArrowDefs id={arrow} />
        <Box x={220} y={20} width={240} height={44}>
          <Label x={340} y={42} anchor="middle" size="title">relay.call arrives</Label>
        </Box>
        <path d="M340 64V90" {...line} />

        <Box x={190} y={92} width={300} height={52} tone="purple">
          <Label x={340} y={110} anchor="middle" size="title">Pinned to another node?</Label>
          <Label x={340} y={128} anchor="middle">request.node is not this node</Label>
        </Box>
        <path d="M490 118H540" {...line} />
        <Label x={515} y={108} anchor="middle">yes</Label>
        <Box x={542} y={92} width={110} height={52} tone="teal">
          <Label x={597} y={110} anchor="middle" size="title">Forward</Label>
          <Label x={597} y={128} anchor="middle">to that agent</Label>
        </Box>
        <path d="M340 144V172" {...line} />
        <Label x={352} y={160}>no</Label>

        <Box x={190} y={174} width={300} height={52} tone="purple">
          <Label x={340} y={192} anchor="middle" size="title">Lease policy says direct?</Label>
          <Label x={340} y={210} anchor="middle">heavy, asked, overloaded, hot pair</Label>
        </Box>
        <path d="M490 200H540" {...line} />
        <Label x={515} y={190} anchor="middle">yes</Label>
        <Box x={542} y={174} width={110} height={52} tone="amber">
          <Label x={597} y={192} anchor="middle" size="title">MESH_DIRECT</Label>
          <Label x={597} y={210} anchor="middle">signed grant</Label>
        </Box>
        <path d="M340 226V254" {...line} />
        <Label x={352} y={242}>no</Label>

        <Box x={190} y={256} width={300} height={52}>
          <Label x={340} y={274} anchor="middle" size="title">Resolve a replica</Label>
          <Label x={340} y={292} anchor="middle">key holder, own node, hash, load</Label>
        </Box>
        <path d="M340 308V336" {...line} />

        <Box x={190} y={338} width={300} height={52}>
          <Label x={340} y={356} anchor="middle" size="title">Call it on the pooled link</Label>
          <Label x={340} y={374} anchor="middle">same path and input, untouched</Label>
        </Box>
        <path d="M340 390V418" {...line} />

        <Box x={190} y={420} width={300} height={52} tone="purple">
          <Label x={340} y={438} anchor="middle" size="title">Answered MESH_REDIRECT?</Label>
          <Label x={340} y={456} anchor="middle">the replica names another one</Label>
        </Box>
        <path d="M190 446H70V282H188" {...line} />
        <Label x={130} y={428} anchor="middle">yes, replay</Label>
        <Label x={130} y={448} anchor="middle">(3 hops max)</Label>
        <path d="M340 472V498" {...line} />
        <Label x={352} y={486}>no</Label>

        <Box x={220} y={500} width={240} height={32} tone="teal">
          <Label x={340} y={516} anchor="middle" size="title">Return the result or stream</Label>
        </Box>
      </svg>
      <figcaption style={{ fontSize: 12, color: TONES.gray, marginTop: 4 }}>The relay's decisions, in order.</figcaption>
    </figure>
  );
}
