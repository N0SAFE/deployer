/**
 * DNS Providers Contract Router
 *
 * Top-level router for all DNS providers. Generic provider-app CRUD lives
 * directly at `orpc.providers.dns.*` (shared across all variants); each
 * provider variant (cloudflare, route53, ...) owns a sub-router exposed as
 * `orpc.providers.dns.<variant>.*`.
 */
import { oc } from "@orpc/contract";
import {
    dnsProviderAppContract,
    dnsProviderListContract,
    dnsProviderCreateContract,
    dnsProviderUpdateContract,
    dnsProviderDeleteContract,
    dnsProviderCheckStateContract,
} from "./shared";
import { cloudflareProviderContract } from "./cloudflare";

export const dnsProvidersContract = oc.router({
    // Generic provider-app CRUD (shared across all DNS provider variants)
    list: dnsProviderListContract,
    create: dnsProviderCreateContract,
    update: dnsProviderUpdateContract,
    delete: dnsProviderDeleteContract,
    checkState: dnsProviderCheckStateContract,
    // Provider variants
    cloudflare: cloudflareProviderContract,
});

export type DnsProvidersContract = typeof dnsProvidersContract;

export * from "./shared";
export * from "./cloudflare";
export { dnsProviderAppContract } from "./shared";
export { cloudflareProviderContract } from "./cloudflare";
