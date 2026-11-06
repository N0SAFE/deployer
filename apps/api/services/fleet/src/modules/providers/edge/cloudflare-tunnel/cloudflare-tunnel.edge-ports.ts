import { Context } from 'effect'

/**
 * What the connector (cloudflared) is run with: the image and how many replicas. Read each time the connector is described,
 * so a change applies on the next supervisor sweep.
 */
export type CloudflaredSettingsShape = {
    readonly image: () => string
    readonly replicas: () => number
}

export class CloudflaredSettings extends Context.Service<
    CloudflaredSettings,
    CloudflaredSettingsShape
>()('fleet/CloudflaredSettings') {}
