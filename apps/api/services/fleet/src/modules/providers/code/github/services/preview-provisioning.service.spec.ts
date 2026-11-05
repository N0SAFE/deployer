import { Effect } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { provideTo } from "@deployer/effect-core";

import { DomainRoutingFailure } from "@deployer/shared/core/modules/domain/errors/index";

import { DomainRouting, type DomainRoutingShape } from "@/core/ports/domain-routing.port";
import { PublicAccessPoint, type PublicAccessPointShape } from "@/core/ports/public-access-point.port";
import { CloudflareDnsProviderService, type CloudflareDnsProviderServiceShape } from "@/modules/providers/dns/cloudflare/services/cloudflare-dns-provider.service";

import { PreviewEnvironmentStore, type PreviewEnvironmentStoreShape } from "../repositories/preview-environment.repository";

import { PreviewProvisioningService } from "./preview-provisioning.service";

const input = { serviceId: "svc-1", previewName: "pr-7", prNumber: 7, branchName: "feat/x", deliveryId: "d-1" };
const account = { providerId: "p1", providerType: "cloudflare" };

function setup() {
    const store = {
        deactivateByFullDomain: vi.fn(() => Effect.void),
        findExpired: vi.fn(() => Effect.succeed([] as { id: string; serviceId: string; subdomain: string; fullDomain: string }[])),
        findLatestDeploymentByService: vi.fn(() => Effect.succeed<{ id: string } | null>({ id: "dep-1" })),
        upsertPreview: vi.fn(() => Effect.void),
    };
    const routing = {
        resolveServiceUrls: vi.fn(() => Effect.succeed<object[]>([{ domain: "example.com", isPrimary: true }])),
        addPreviewRoute: vi.fn((): Effect.Effect<object | null, DomainRoutingFailure> => Effect.succeed({})),
        removePreviewRoute: vi.fn((): Effect.Effect<boolean, DomainRoutingFailure> => Effect.succeed(true)),
    };
    const accessPoint = {
        getAccessPoint: vi.fn(() => Effect.succeed({ kind: "tunnel", address: "tun.cfargotunnel.com", configured: true })),
    };
    const dns = {
        findFirstActiveProvider: vi.fn(() => Effect.succeed<typeof account | null>(account)),
        findZoneForHostname: vi.fn(() => Effect.succeed<{ zoneId: string; zoneName: string } | null>({ zoneId: "z1", zoneName: "example.com" })),
        createRecord: vi.fn((_account: unknown, record: { name: string; type: string; content: string }) => Effect.succeed({ ...record, id: "rec-1" })),
        listRecords: vi.fn(() => Effect.succeed([{ id: "rec-1", zoneId: "z1", name: "pr-7.example.com", type: "CNAME", content: "tun.cfargotunnel.com", ttl: 1, proxied: true }])),
        deleteRecord: vi.fn(() => Effect.void),
    };
    // The fakes need nothing from the context beyond what is provided here.
    const service = provideTo(PreviewProvisioningService.live, (effect) =>
        effect.pipe(
            Effect.provideService(PreviewEnvironmentStore, store as unknown as PreviewEnvironmentStoreShape),
            Effect.provideService(DomainRouting, routing as unknown as DomainRoutingShape),
            Effect.provideService(PublicAccessPoint, accessPoint as unknown as PublicAccessPointShape),
            Effect.provideService(CloudflareDnsProviderService, dns as unknown as CloudflareDnsProviderServiceShape),
        ) as Effect.Effect<unknown>,
    );
    return { service, store, routing, accessPoint, dns };
}

describe("PreviewProvisioningService", () => {
    let t: ReturnType<typeof setup>;
    beforeEach(() => {
        vi.clearAllMocks();
        t = setup();
    });

    describe("provisionPreview", () => {
        it("creates the DNS record, the route and the preview row on the service's primary domain", async () => {
            const result = await Effect.runPromise(t.service.provisionPreview(input));

            expect(result).toEqual({
                action: "provisioned",
                reason: "preview_provisioned",
                host: "pr-7.example.com",
                dnsRecord: { name: "pr-7.example.com", type: "CNAME", content: "tun.cfargotunnel.com" },
                routeApplied: true,
                recorded: true,
            });
            expect(t.routing.addPreviewRoute).toHaveBeenCalledWith("svc-1", "pr-7.example.com", { sslEnabled: true });
            expect(t.store.upsertPreview).toHaveBeenCalledWith(
                expect.objectContaining({ deploymentId: "dep-1", subdomain: "pr-7", fullDomain: "pr-7.example.com", branchName: "feat/x" }),
            );
        });

        it("is skipped when the service has no domain mapping", async () => {
            t.routing.resolveServiceUrls.mockReturnValue(Effect.succeed([]));

            const result = await Effect.runPromise(t.service.provisionPreview(input));

            expect(result).toMatchObject({ action: "skipped", reason: "no_domain_mapping", host: null });
            expect(t.routing.addPreviewRoute).not.toHaveBeenCalled();
        });

        it("points an IP access point at an A record", async () => {
            t.accessPoint.getAccessPoint.mockReturnValue(Effect.succeed({ kind: "ip", address: "203.0.113.9", configured: true }));

            const result = await Effect.runPromise(t.service.provisionPreview(input));

            expect(t.dns.createRecord).toHaveBeenCalledWith(account, expect.objectContaining({ type: "A", content: "203.0.113.9" }));
            expect(result).toMatchObject({ dnsRecord: { type: "A" } });
        });

        it("creates no record when no DNS provider covers the zone, and still routes", async () => {
            t.dns.findZoneForHostname.mockReturnValue(Effect.succeed(null));

            const result = await Effect.runPromise(t.service.provisionPreview(input));

            expect(t.dns.createRecord).not.toHaveBeenCalled();
            expect(result).toMatchObject({ action: "provisioned", dnsRecord: null, routeApplied: true });
        });

        it("keeps going when the DNS step fails: the route and the row are still provisioned", async () => {
            t.dns.createRecord.mockReturnValue(Effect.fail(new Error("cloudflare down")) as never);

            const result = await Effect.runPromise(t.service.provisionPreview(input));

            expect(result).toMatchObject({ dnsRecord: null, routeApplied: true, recorded: true });
        });

        it("keeps going when the route step fails", async () => {
            t.routing.addPreviewRoute.mockReturnValue(Effect.fail(new DomainRoutingFailure({ operation: "traefik down" })));

            const result = await Effect.runPromise(t.service.provisionPreview(input));

            expect(result).toMatchObject({ routeApplied: false, recorded: true });
        });

        it("records no row for a preview that is not a pull request, or when no deployment exists", async () => {
            await Effect.runPromise(t.service.provisionPreview({ ...input, prNumber: null }));
            expect(t.store.upsertPreview).not.toHaveBeenCalled();

            t.store.findLatestDeploymentByService.mockReturnValue(Effect.succeed(null));
            const result = await Effect.runPromise(t.service.provisionPreview(input));
            expect(result).toMatchObject({ recorded: false });
            expect(t.store.upsertPreview).not.toHaveBeenCalled();
        });
    });

    describe("cleanupPreview", () => {
        it("removes the route and the DNS record and marks the row inactive", async () => {
            const result = await Effect.runPromise(t.service.cleanupPreview({ ...input, reason: "pr_closed" }));

            expect(result).toEqual({
                action: "cleaned",
                reason: "pr_closed",
                host: "pr-7.example.com",
                dnsRecord: { name: "pr-7.example.com", type: "CNAME", content: "tun.cfargotunnel.com" },
                routeApplied: true,
                recorded: false,
            });
            expect(t.dns.deleteRecord).toHaveBeenCalledWith(account, "z1", "rec-1");
            expect(t.store.deactivateByFullDomain).toHaveBeenCalledWith("pr-7.example.com");
        });

        it("still marks the row inactive when the route and the DNS cleanup fail", async () => {
            t.routing.removePreviewRoute.mockReturnValue(Effect.fail(new DomainRoutingFailure({ operation: "traefik down" })));
            t.dns.deleteRecord.mockReturnValue(Effect.fail(new Error("cloudflare down")) as never);

            const result = await Effect.runPromise(t.service.cleanupPreview(input));

            expect(result).toMatchObject({ action: "cleaned", routeApplied: false });
            expect(t.store.deactivateByFullDomain).toHaveBeenCalledWith("pr-7.example.com");
        });

        it("is skipped when the service has no domain mapping", async () => {
            t.routing.resolveServiceUrls.mockReturnValue(Effect.succeed([]));

            expect(await Effect.runPromise(t.service.cleanupPreview(input))).toMatchObject({ action: "skipped" });
            expect(t.store.deactivateByFullDomain).not.toHaveBeenCalled();
        });
    });

    describe("expiry", () => {
        it("lists the expired previews under the names the cleanup uses", async () => {
            t.store.findExpired.mockReturnValue(Effect.succeed([{ id: "e1", serviceId: "svc-1", subdomain: "pr-7", fullDomain: "pr-7.example.com" }]));

            expect(await Effect.runPromise(t.service.findExpiredPreviews())).toEqual([
                { id: "e1", serviceId: "svc-1", previewName: "pr-7", fullDomain: "pr-7.example.com" },
            ]);
        });

        it("expires a preview through the same cleanup, with the TTL reason", async () => {
            const result = await Effect.runPromise(t.service.expirePreview("e1", "svc-1", "pr-7"));

            expect(result).toMatchObject({ action: "cleaned", reason: "preview_ttl_expired", host: "pr-7.example.com" });
        });
    });
});
