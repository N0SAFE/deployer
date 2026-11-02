import type { ReactNode } from 'react';

/** The colours the mesh diagrams use, one per kind of thing. Fills mix the hue into the page's card colour so they follow light and dark. */
export const TONES = {
  gray: '#888780',
  blue: '#378ADD',
  purple: '#7F77DD',
  teal: '#1D9E75',
  amber: '#BA7517',
  coral: '#D85A30',
} as const;

export type Tone = keyof typeof TONES;

/** The four kinds of router a call can travel on, and the direct lease, with the line colour each one gets. */
export const ROUTE_COLOURS = {
  node: TONES.coral,
  external: TONES.purple,
  peer: TONES.teal,
  lease: TONES.amber,
} as const;

export type Route = keyof typeof ROUTE_COLOURS;

const TEXT = 'var(--color-fd-foreground, currentColor)';
const MUTED = 'var(--color-fd-muted-foreground, currentColor)';
const BORDER = 'var(--color-fd-border, #8884)';

interface BoxProps {
  x: number;
  y: number;
  width: number;
  height: number;
  tone?: Tone;
  radius?: number;
  /** A thicker, accented outline: the box the current step is about. */
  active?: boolean;
  faded?: boolean;
  children?: ReactNode;
}

/** A rounded box tinted with a tone. */
export function Box({ x, y, width, height, tone = 'gray', radius = 8, active = false, faded = false, children }: BoxProps) {
  const hue = TONES[tone];
  return (
    <g opacity={faded ? 0.3 : 1}>
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        rx={radius}
        fill={`color-mix(in srgb, ${hue} 16%, var(--color-fd-card, transparent))`}
        stroke={active ? 'var(--color-fd-primary, #7F77DD)' : hue}
        style={{ strokeWidth: active ? 2.5 : 0.75 }}
      />
      {children}
    </g>
  );
}

interface LabelProps {
  x: number;
  y: number;
  anchor?: 'start' | 'middle' | 'end';
  /** `title` is the box's name; `small` is the secondary line. */
  size?: 'title' | 'small';
  children: ReactNode;
}

export function Label({ x, y, anchor = 'start', size = 'small', children }: LabelProps) {
  return (
    <text
      x={x}
      y={y}
      style={{
        textAnchor: anchor,
        dominantBaseline: 'central',
        fontSize: size === 'title' ? 14 : 12,
        fontWeight: size === 'title' ? 600 : 400,
        fill: size === 'title' ? TEXT : MUTED,
      }}
    >
      {children}
    </text>
  );
}

/** A dashed frame around a group, with its caption. */
export function Frame({ x, y, width, height, caption, captionY }: { x: number; y: number; width: number; height: number; caption?: string; captionY?: number }) {
  return (
    <g>
      <rect x={x} y={y} width={width} height={height} rx={12} fill="none" stroke={BORDER} style={{ strokeWidth: 1, strokeDasharray: '4 4' }} />
      {caption === undefined ? null : <Label x={x} y={captionY ?? y + height + 16}>{caption}</Label>}
    </g>
  );
}

/** The arrow head every line in a diagram uses; give each diagram its own id. */
export function ArrowDefs({ id }: { id: string }) {
  return (
    <defs>
      <marker id={id} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
        <path d="M2 1L8 5L2 9" fill="none" stroke="context-stroke" style={{ strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' }} />
      </marker>
    </defs>
  );
}

export const ink = { text: TEXT, muted: MUTED, border: BORDER };

interface StepperProps {
  count: number;
  index: number;
  onIndex: (next: number) => void;
}

/** Previous / Next with the position. */
export function Stepper({ count, index, onIndex }: StepperProps) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 12, fontSize: 13, color: MUTED }}>
      <button type="button" style={buttonStyle(false, index === 0)} disabled={index === 0} onClick={() => { onIndex(index - 1); }}>
        Previous
      </button>
      <span>
        Step {index + 1} of {count}
      </span>
      <button type="button" style={buttonStyle(false, index === count - 1)} disabled={index === count - 1} onClick={() => { onIndex(index + 1); }}>
        Next
      </button>
    </div>
  );
}

export function buttonStyle(pressed: boolean, disabled = false): React.CSSProperties {
  return {
    font: 'inherit',
    fontSize: 13,
    padding: '6px 12px',
    borderRadius: 8,
    border: `1px solid ${pressed ? 'var(--color-fd-primary, #7F77DD)' : BORDER}`,
    background: pressed ? 'color-mix(in srgb, var(--color-fd-primary, #7F77DD) 14%, var(--color-fd-card, transparent))' : 'var(--color-fd-card, transparent)',
    color: TEXT,
    cursor: disabled ? 'default' : 'pointer',
    opacity: disabled ? 0.4 : 1,
  };
}

interface StepListProps {
  titles: readonly string[];
  index: number;
  detail: string;
}

/** The numbered list of steps (the current one bold, the past ones dimmed) and the explanation of the current one. */
export function StepList({ titles, index, detail }: StepListProps) {
  return (
    <>
      <ol style={{ fontSize: 14, lineHeight: 1.5, margin: '12px 0 0', paddingLeft: 22, color: MUTED }}>
        {titles.map((title, i) => (
          <li key={title} style={{ color: i === index ? TEXT : i < index ? 'var(--color-fd-muted-foreground)' : MUTED, fontWeight: i === index ? 600 : 400, opacity: i > index ? 0.65 : 1 }}>
            {title}
          </li>
        ))}
      </ol>
      <p style={{ fontSize: 14, lineHeight: 1.6, margin: '8px 0 0', color: TEXT }} aria-live="polite">
        {detail}
      </p>
    </>
  );
}
