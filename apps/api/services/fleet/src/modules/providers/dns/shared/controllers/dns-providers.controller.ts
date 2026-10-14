/**
 * DNS Providers Controller (shared)
 *
 * Provider-agnostic DNS provider app CRUD + runtime state. Provider state
 * (token validity, account) is checked at runtime — never trusted from the
 * DB alone. Shared across ALL DNS provider variants (cloudflare, route53, ...).
 *
 * Cloudflare-specific zones/records/tunnels live in
 * `dns/cloudflare/controllers/cloudflare.controller.ts`.
 */
import { Controller, Logger } from "@nestjs/common";
import { Implement } from "@orpc/nest";
import { implement } from "@orpc/server";
import { providersContract } from "@repo/api-contracts";
import { requireAuth } from "@/core/modules/auth/orpc/middlewares";
import { CloudflareAppService } from "@/modules/providers/dns/cloudflare/services/cloudflare-app.service";

@Controller()
export class DnsProvidersController {
    private readonly logger = new Logger(DnsProvidersController.name);

    constructor(private readonly appService: CloudflareAppService) {}

    // ─── Provider app CRUD ──────────────────────────────────────────────────

    @Implement(providersContract.dns.list)
    list() {
        return implement(providersContract.dns.list)
            .use(requireAuth())
            .handler(async () => {
                const providers = await this.appService.listApps();
                return { providers, total: providers.length };
            });
    }

    @Implement(providersContract.dns.create)
    create() {
        return implement(providersContract.dns.create)
            .use(requireAuth())
            .handler(async ({ input }) => {
                return this.appService.createApp({
                    name: input.name,
                    providerType: input.providerType,
                    apiToken: input.apiToken,
                    accountEmail: input.accountEmail,
                    features: input.features,
                });
            });
    }

    @Implement(providersContract.dns.update)
    update() {
        return implement(providersContract.dns.update)
            .use(requireAuth())
            .handler(async ({ input }) => {
                return this.appService.updateApp(input.params.id, input.body ?? {});
            });
    }

    @Implement(providersContract.dns.delete)
    delete() {
        return implement(providersContract.dns.delete)
            .use(requireAuth())
            .handler(async ({ input }) => {
                const success = await this.appService.deleteApp(input.params.id);
                return { success };
            });
    }

    @Implement(providersContract.dns.checkState)
    checkState() {
        return implement(providersContract.dns.checkState)
            .use(requireAuth())
            .handler(async ({ input }) => {
                return this.appService.getLiveState(input.params.id, true);
            });
    }
}
