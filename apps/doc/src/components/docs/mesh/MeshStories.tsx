'use client';

import { useId, useState } from 'react';

import { STATUS_LABEL, STORIES, type NodeId, type StoryStatus } from './mesh-stories.data';
import { ArrowDefs, Box, buttonStyle, Frame, ink, Label, ROUTE_COLOURS, Stepper, StepList } from './svg-kit';

/** The service boxes of the three-node example: label, x, y. Node A at x 108, node B at 323, node C at 538. */
const SERVICES: readonly (readonly [string, number, number])[] = [
  ['bff 1', 108, 72], ['identity 1', 108, 110], ['project 1', 108, 148], ['fleet 1', 108, 186], ['runtime 1', 108, 224],
  ['bff 2', 323, 72], ['project 2', 323, 148], ['fleet 2', 323, 186], ['runtime 2', 323, 224],
  ['identity 2', 538, 110], ['project 3', 538, 148], ['runtime 3', 538, 224],
];

const AGENT_X: Record<NodeId, number> = { A: 38, B: 253, C: 468 };

const STATUS_NOTE: Record<StoryStatus, string> = {
  built: 'This story works in the code today.',
  mechanism: 'The mechanism in this story is built and tested; no service uses it yet.',
  design: 'This story is the design, not yet in the code.',
};

/**
 * Eight user and developer stories across three nodes, stepped one hop at a time. Each story says how much of it is
 * built, so the diagram never claims more than the code does.
 */
export function MeshStories() {
  const arrow = useId();
  const [story, setStory] = useState(0);
  const [step, setStep] = useState(0);
  const current = STORIES[story];
  if (current === undefined) return null;
  const steps = current.steps;
  const active = steps[step] ?? steps[0];
  if (active === undefined) return null;

  return (
    <figure style={{ margin: '1.5rem 0' }}>
      <div role="group" aria-label="User story" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, margin: '0 0 12px' }}>
        {STORIES.map((entry, index) => (
          <button
            key={entry.name}
            type="button"
            aria-pressed={index === story}
            style={buttonStyle(index === story)}
            onClick={() => {
              setStory(index);
              setStep(0);
            }}
          >
            {entry.name}
          </button>
        ))}
      </div>
      <p style={{ margin: '0 0 8px', fontSize: 13, color: ink.muted }}>
        <strong style={{ color: ink.text }}>{STATUS_LABEL[current.status]}.</strong> {STATUS_NOTE[current.status]} {current.note}
      </p>
      <svg width="100%" viewBox="0 0 680 395" role="img" aria-label="Brokered mesh request paths across three nodes">
        <title>Brokered mesh request paths across three nodes</title>
        <desc>
          Every service talks only to its local mesh agent. Agents hold the pooled links between nodes, prefer a replica on their own node and answer redirects themselves. A direct lease opens a pooled link straight to one replica.
        </desc>
        <ArrowDefs id={arrow} />
        <Label x={340} y={38} anchor="middle">Agent-to-agent pooled links (direct, or through bridges in a large mesh)</Label>
        <Frame x={30} y={60} width={190} height={210} caption="Node A" captionY={286} />
        <Frame x={245} y={60} width={190} height={210} caption="Node B" captionY={286} />
        <Frame x={460} y={60} width={190} height={210} caption="Node C" captionY={286} />
        <Frame x={30} y={296} width={620} height={50} />
        <Label x={340} y={330} anchor="middle">Overlay network (used only by direct leases)</Label>
        {(['A', 'B', 'C'] as const).map((node) => (
          <Box key={node} x={AGENT_X[node]} y={72} width={56} height={182} radius={6} active={active.highlight.includes(node)}>
            <Label x={AGENT_X[node] + 28} y={155} anchor="middle" size="title">mesh</Label>
            <Label x={AGENT_X[node] + 28} y={173} anchor="middle" size="title">agent</Label>
          </Box>
        ))}
        {SERVICES.map(([name, x, y]) => (
          <Box key={name} x={x} y={y} width={80} height={30} radius={4} tone="blue">
            <Label x={x + 40} y={y + 15} anchor="middle">{name}</Label>
          </Box>
        ))}
        <g fill="none">
          {steps.slice(0, step + 1).flatMap((past, index) =>
            past.paths.map(([d, route, style]) => (
              <path
                key={`${String(index)}-${d}`}
                d={d}
                stroke={ROUTE_COLOURS[route]}
                style={{
                  strokeWidth: style === 'wide' ? 2.5 : 1.5,
                  strokeDasharray: style === 'dashed' ? '5 4' : undefined,
                  markerEnd: `url(#${arrow})`,
                  opacity: index === step ? 1 : 0.3,
                }}
              />
            )),
          )}
        </g>
        {([
          ['Node router', ROUTE_COLOURS.node, false, 40],
          ['External router', ROUTE_COLOURS.external, false, 160],
          ['Peer router', ROUTE_COLOURS.peer, false, 300],
          ['Redirect or grant', ROUTE_COLOURS.external, true, 420],
          ['Direct lease', ROUTE_COLOURS.lease, false, 555],
        ] as const).map(([label, colour, dashed, x]) => (
          <g key={label}>
            <line x1={x} y1={372} x2={x + 24} y2={372} stroke={colour} style={{ strokeWidth: label === 'Direct lease' ? 2.5 : 1.5, strokeDasharray: dashed ? '5 4' : undefined }} />
            <Label x={x + 30} y={372}>{label}</Label>
          </g>
        ))}
      </svg>
      <Stepper count={steps.length} index={step} onIndex={setStep} />
      <StepList titles={steps.map((entry) => entry.title)} index={step} detail={active.detail} />
    </figure>
  );
}
