import { Context } from 'effect'

import type { CloudflareTunnelEdgeProvider } from '@/modules/providers/edge/cloudflare-tunnel/cloudflare-tunnel.edge-provider'

/** Effect view of the Cloudflare tunnel edge: what the tunnels page asks of it. */
export type TunnelEdgeShape = Pick<
    CloudflareTunnelEdgeProvider,
    'stackWildcard' | 'forgetDeletedTunnel'
>

export class TunnelEdge extends Context.Service<TunnelEdge, TunnelEdgeShape>()(
    'fleet/TunnelEdge'
) {}
