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
import { Controller } from "@nestjs/common";
import { Implement } from "@orpc/nest";

import { providersContract } from "@deployer/fleet-contracts";
import { procedure } from "@deployer/nest-effect";
import { requireAuth, requirePlatformRole } from "@deployer/shared/core/modules/auth/orpc/middlewares";

import { CloudflareAppService } from "@/modules/providers/dns/cloudflare/services/cloudflare-app.service";


/** A provider carries an API token: creating, patching or deleting one is an operational act. */
const DNS_OPERATOR_ROLES = ["superAdmin", "admin", "operator"];

@Controller()
export class DnsProvidersController {
    // ─── Provider app CRUD ──────────────────────────────────────────────────

    @Implement(providersContract.dns.list)
    list() {
        return procedure(providersContract.dns.list)
            .use(requireAuth())
            .effect(function* () {
                const apps = yield* CloudflareAppService;
                const providers = yield* apps.listApps();
                return { providers, total: providers.length };
            });
    }

    @Implement(providersContract.dns.create)
    create() {
        return procedure(providersContract.dns.create)
            .use(requireAuth())
            .use(requirePlatformRole(DNS_OPERATOR_ROLES))
            .effect(function* ({ input }) {
                const apps = yield* CloudflareAppService;
                return yield* apps.createApp({
                        name: input.name,
                        providerType: input.providerType,
                        apiToken: input.apiToken,
                        accountEmail: input.accountEmail,
                        features: input.features,
                    })
                ;
            });
    }

    @Implement(providersContract.dns.update)
    update() {
        return procedure(providersContract.dns.update)
            .use(requireAuth())
            .use(requirePlatformRole(DNS_OPERATOR_ROLES))
            .effect(function* ({ input }) {
                const apps = yield* CloudflareAppService;
                return yield* apps.updateApp(input.params.id, input.body ?? {});
            });
    }

    @Implement(providersContract.dns.delete)
    delete() {
        return procedure(providersContract.dns.delete)
            .use(requireAuth())
            .use(requirePlatformRole(DNS_OPERATOR_ROLES))
            .effect(function* ({ input }) {
                const apps = yield* CloudflareAppService;
                const success = yield* apps.deleteApp(input.params.id);
                return { success };
            });
    }

    @Implement(providersContract.dns.checkState)
    checkState() {
        return procedure(providersContract.dns.checkState)
            .use(requireAuth())
            .effect(function* ({ input }) {
                const apps = yield* CloudflareAppService;
                return yield* apps.getLiveState(input.params.id, true);
            });
    }
}
