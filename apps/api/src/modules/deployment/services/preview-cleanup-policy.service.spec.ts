import { describe, it, expect, beforeEach } from "vitest";
import { PreviewCleanupPolicyService } from "@/core/modules/deployment/services/preview-cleanup-policy.service";

const defaultConfig = {
    autoDeleteOnMerge: true,
    autoDeleteOnClose: true,
    ttlHours: 168,
};

describe("PreviewCleanupPolicyService", () => {
    let service: PreviewCleanupPolicyService;

    beforeEach(() => {
        service = new PreviewCleanupPolicyService();
    });

    describe("shouldCleanup: merge trigger", () => {
        it("cleans up when autoDeleteOnMerge=true", () => {
            const result = service.shouldCleanup("merge", { ...defaultConfig, autoDeleteOnMerge: true });
            expect(result.cleanup).toBe(true);
            expect(result.reason).toBe("pr_merged_auto_delete");
        });

        it("does not clean up when autoDeleteOnMerge=false", () => {
            const result = service.shouldCleanup("merge", { ...defaultConfig, autoDeleteOnMerge: false });
            expect(result.cleanup).toBe(false);
            expect(result.reason).toBe("pr_merged_auto_delete_disabled");
        });
    });

    describe("shouldCleanup: close trigger", () => {
        it("cleans up when autoDeleteOnClose=true", () => {
            const result = service.shouldCleanup("close", { ...defaultConfig, autoDeleteOnClose: true });
            expect(result.cleanup).toBe(true);
            expect(result.reason).toBe("pr_closed_auto_delete");
        });

        it("does not clean up when autoDeleteOnClose=false", () => {
            const result = service.shouldCleanup("close", { ...defaultConfig, autoDeleteOnClose: false });
            expect(result.cleanup).toBe(false);
            expect(result.reason).toBe("pr_closed_auto_delete_disabled");
        });
    });

    describe("shouldCleanup: ttl_expired trigger", () => {
        it("always cleans up on TTL expiry", () => {
            const result = service.shouldCleanup("ttl_expired", { ...defaultConfig, ttlHours: 72 });
            expect(result.cleanup).toBe(true);
            expect(result.reason).toBe("ttl_expired_after_72h");
        });

        it("includes configured TTL in reason string", () => {
            const result = service.shouldCleanup("ttl_expired", { ...defaultConfig, ttlHours: 24 });
            expect(result.reason).toContain("24h");
        });
    });

    describe("computeExpiryDate", () => {
        it("returns createdAt + ttlHours", () => {
            const created = new Date("2026-01-01T00:00:00Z");
            const expiry = service.computeExpiryDate(created, 168);
            const expectedMs = created.getTime() + 168 * 60 * 60 * 1000;
            expect(expiry.getTime()).toBe(expectedMs);
        });
    });

    describe("isTtlExpired", () => {
        it("returns false before TTL elapses", () => {
            const created = new Date("2026-01-01T00:00:00Z");
            const now = new Date("2026-01-04T00:00:00Z"); // 72h after
            expect(service.isTtlExpired(created, 168, now)).toBe(false);
        });

        it("returns true after TTL elapses", () => {
            const created = new Date("2026-01-01T00:00:00Z");
            const now = new Date("2026-01-08T01:00:00Z"); // 169h after
            expect(service.isTtlExpired(created, 168, now)).toBe(true);
        });

        it("returns true exactly at expiry boundary", () => {
            const created = new Date("2026-01-01T00:00:00Z");
            const now = new Date(created.getTime() + 168 * 60 * 60 * 1000);
            expect(service.isTtlExpired(created, 168, now)).toBe(true);
        });
    });
});
