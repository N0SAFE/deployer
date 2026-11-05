import { Context } from 'effect'

import type { DnsProviderGateway } from '@/modules/network/dns-provider.gateway'

/** Effect view of the fleet DNS calls. */
export type DnsProviderShape = Pick<
    DnsProviderGateway,
    | 'listProviders'
    | 'listZones'
    | 'listRecords'
    | 'createRecord'
    | 'findZoneName'
>

export class DnsProvider extends Context.Service<
    DnsProvider,
    DnsProviderShape
>()('project/DnsProvider') {}
