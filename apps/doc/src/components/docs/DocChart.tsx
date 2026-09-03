'use client';

/**
 * Declarative chart component for MDX pages, backed by TanStack Charts
 * (https://tanstack.com/charts). Doc authors pass plain JSON data via a
 * quoted attribute — no brace expressions needed in MDX source:
 *
 *   <DocChart
 *     kind="bar"
 *     title="Deployments per day"
 *     data='[{"label":"Mon","value":12},{"label":"Tue","value":18}]'
 *     xLabel="Day"
 *     yLabel="Deployments"
 *     height="320"
 *   />
 */

import { useMemo } from 'react';
import { Chart } from '@tanstack/charts/react';
import { barY, defineChart, lineY } from '@tanstack/charts';
import { scaleBand } from '@tanstack/charts/scales/band';
import { scaleLinear } from '@tanstack/charts/scales/linear';
import { scalePoint } from '@tanstack/charts/scales/point';
import { tooltip } from '@tanstack/charts/tooltip';

export interface DocChartProps {
  /** Mark family to render. Defaults to `line`. */
  kind?: 'line' | 'bar';
  /**
   * JSON array of `{ label: string, value: number }` points, passed as a
   * quoted MDX attribute to keep brace expressions out of doc sources.
   */
  data: string;
  title?: string;
  caption?: string;
  xLabel?: string;
  yLabel?: string;
  /** Chart height in pixels. Defaults to `320`. */
  height?: string;
}

interface DataPoint {
  label: string;
  value: number;
}

function parseDataPoints(raw: string): DataPoint[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!Array.isArray(parsed) || parsed.length === 0) return null;

  const points: DataPoint[] = [];
  for (const item of parsed) {
    if (typeof item !== 'object' || item === null) return null;
    const record = item as Record<string, unknown>;
    const label = record.label;
    const value = record.value;
    if (typeof label !== 'string' || label.length === 0) return null;
    if (typeof value !== 'number' || !Number.isFinite(value)) return null;
    points.push({ label, value });
  }
  return points;
}

function parseHeight(raw: string | undefined): number {
  if (!raw) return 320;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 320;
}

const figureStyle = {
  border: '1px solid var(--fd-border)',
  borderRadius: 14,
  margin: '1.25rem 0',
  overflow: 'hidden',
  background: 'var(--fd-card)',
} as const;

const captionStyle = {
  borderBottom: '1px solid var(--fd-border)',
  padding: '0.75rem 1rem',
  background: 'color-mix(in oklab, var(--fd-card) 90%, var(--fd-accent) 10%)',
} as const;

export function DocChart({
  kind = 'line',
  data,
  title,
  caption,
  xLabel,
  yLabel,
  height,
}: DocChartProps) {
  const points = useMemo(() => parseDataPoints(data), [data]);
  const resolvedHeight = parseHeight(height);

  // Definitions must be memoized against every captured value — identity
  // tells the chart host when captured values changed.
  const definition = useMemo(() => {
    if (!points) return null;

    if (kind === 'bar') {
      return defineChart({
        marks: [barY(points, { id: 'doc-chart', x: 'label', y: 'value' })],
        x: {
          scale: () => scaleBand().padding(0.18),
          ...(xLabel ? { axis: { label: xLabel } } : {}),
        },
        y: {
          scale: scaleLinear,
          nice: true,
          grid: true,
          ...(yLabel ? { axis: { label: yLabel } } : {}),
        },
        svgAnimation: true,
        tooltip,
      });
    }

    return defineChart({
      marks: [
        lineY(points, {
          id: 'doc-chart',
          x: 'label',
          y: 'value',
          points: true,
        }),
      ],
      x: {
        scale: () => scalePoint().padding(0.2),
        ...(xLabel ? { axis: { label: xLabel } } : {}),
      },
      y: {
        scale: scaleLinear,
        nice: true,
        grid: true,
        ...(yLabel ? { axis: { label: yLabel } } : {}),
      },
      svgAnimation: true,
      tooltip,
    });
  }, [points, kind, xLabel, yLabel]);

  if (!points || !definition) {
    return (
      <figure style={figureStyle}>
        {(title || caption) ? (
          <figcaption style={captionStyle}>
            {title ? <p style={{ margin: 0, fontWeight: 700 }}>{title}</p> : null}
          </figcaption>
        ) : null}
        <div style={{ padding: '1rem' }}>
          <p style={{ margin: '0 0 0.6rem 0', color: '#ef4444', fontWeight: 600 }}>
            Invalid chart data
          </p>
          <p style={{ margin: '0 0 0.75rem 0', fontSize: '0.92rem', opacity: 0.85 }}>
            <code>data</code> must be JSON like{' '}
            <code>[{'{'}&quot;label&quot;: &quot;Jan&quot;, &quot;value&quot;: 42{'}'}]</code>.
          </p>
          <pre style={{ margin: 0, overflowX: 'auto' }}>
            <code>{data}</code>
          </pre>
        </div>
      </figure>
    );
  }

  return (
    <figure style={figureStyle}>
      {(title || caption) ? (
        <figcaption style={captionStyle}>
          {title ? <p style={{ margin: 0, fontWeight: 700 }}>{title}</p> : null}
          {caption ? (
            <p
              style={{
                margin: title ? '0.2rem 0 0 0' : 0,
                opacity: 0.85,
                fontSize: '0.92rem',
              }}
            >
              {caption}
            </p>
          ) : null}
        </figcaption>
      ) : null}
      <div style={{ padding: '1rem' }}>
        <Chart
          definition={definition}
          height={resolvedHeight}
          ariaLabel={title ?? 'Documentation chart'}
        />
      </div>
    </figure>
  );
}
