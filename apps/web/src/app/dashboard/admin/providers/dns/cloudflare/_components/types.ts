import type { useDNSProviders } from '@/domains/dns-providers/hooks'

/** One DNS provider account, as the API lists it (this page only shows the Cloudflare ones). */
export type CloudflareAccount = NonNullable<ReturnType<typeof useDNSProviders>['data']>['providers'][number]
