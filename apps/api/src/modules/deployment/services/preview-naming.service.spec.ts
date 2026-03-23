import { describe, it, expect, beforeEach } from "vitest";
import { PreviewNamingService } from "@/core/modules/deployment/services/preview-naming.service";

describe("PreviewNamingService", () => {
    let service: PreviewNamingService;

    beforeEach(() => {
        service = new PreviewNamingService();
    });

    describe("strategy=pr", () => {
        it("returns pr-<number> name", () => {
            const result = service.buildPreviewName({
                serviceId: "svc-1",
                prNumber: 42,
                urlPattern: "preview-{{preview_name}}.example.com",
                namingStrategy: "pr",
            });
            expect(result.previewName).toBe("pr-42");
            expect(result.resolvedUrl).toBe("preview-pr-42.example.com");
            expect(result.strategy).toBe("pr");
        });

        it("throws when prNumber is missing", () => {
            expect(() =>
                service.buildPreviewName({
                    serviceId: "svc-1",
                    urlPattern: "{{preview_name}}.example.com",
                    namingStrategy: "pr",
                }),
            ).toThrow("prNumber");
        });
    });

    describe("strategy=branch", () => {
        it("slugifies the branch name", () => {
            const result = service.buildPreviewName({
                serviceId: "svc-1",
                branchName: "feature/my-new-Feature",
                urlPattern: "{{preview_name}}.example.com",
                namingStrategy: "branch",
            });
            expect(result.previewName).toBe("feature-my-new-feature");
            expect(result.resolvedUrl).toBe("feature-my-new-feature.example.com");
        });

        it("throws when branchName is missing", () => {
            expect(() =>
                service.buildPreviewName({
                    serviceId: "svc-1",
                    urlPattern: "{{preview_name}}.example.com",
                    namingStrategy: "branch",
                }),
            ).toThrow("branchName");
        });

        it("trims slugs to max 48 chars", () => {
            const longBranch = "feature/this-is-a-very-very-very-long-branch-name-that-exceeds-limit";
            const result = service.buildPreviewName({
                serviceId: "svc-1",
                branchName: longBranch,
                urlPattern: "{{preview_name}}.example.com",
                namingStrategy: "branch",
            });
            expect(result.previewName.length).toBeLessThanOrEqual(48);
        });
    });

    describe("strategy=branch_hash", () => {
        it("appends a 7-char hash fragment", () => {
            const result = service.buildPreviewName({
                serviceId: "svc-1",
                branchName: "main",
                commitSha: "abc1234def5678",
                urlPattern: "{{preview_name}}.example.com",
                namingStrategy: "branch_hash",
            });
            expect(result.previewName).toMatch(/^main-[0-9a-f]{7}$/);
            expect(result.resolvedUrl).toContain("main-");
        });

        it("is deterministic for the same inputs", () => {
            const input = {
                serviceId: "svc-1",
                branchName: "feat/preview",
                commitSha: "deadbeef",
                urlPattern: "{{preview_name}}.preview.dev",
                namingStrategy: "branch_hash" as const,
            };
            const r1 = service.buildPreviewName(input);
            const r2 = service.buildPreviewName(input);
            expect(r1.previewName).toBe(r2.previewName);
        });

        it("produces different names for different branches", () => {
            const base = {
                serviceId: "svc-1",
                commitSha: "abc",
                urlPattern: "{{preview_name}}.example.com",
                namingStrategy: "branch_hash" as const,
            };
            const r1 = service.buildPreviewName({ ...base, branchName: "feat/a" });
            const r2 = service.buildPreviewName({ ...base, branchName: "feat/b" });
            expect(r1.previewName).not.toBe(r2.previewName);
        });

        it("throws when branchName is missing", () => {
            expect(() =>
                service.buildPreviewName({
                    serviceId: "svc-1",
                    urlPattern: "{{preview_name}}.example.com",
                    namingStrategy: "branch_hash",
                }),
            ).toThrow("branchName");
        });
    });

    describe("strategy=custom", () => {
        it("resolves token substitution in url pattern", () => {
            const result = service.buildPreviewName({
                serviceId: "svc-1",
                branchName: "feat/custom",
                prNumber: 7,
                commitSha: "abcdef1234567",
                urlPattern: "{{branch}}-{{pr_number}}.preview.dev",
                namingStrategy: "custom",
            });
            expect(result.resolvedUrl).toBe("feat-custom-7.preview.dev");
        });
    });

    describe("url pattern token substitution", () => {
        it("substitutes {{branch}} token", () => {
            const result = service.buildPreviewName({
                serviceId: "svc-1",
                branchName: "feat/tokens",
                urlPattern: "{{branch}}.preview.example.com",
                namingStrategy: "branch",
            });
            expect(result.resolvedUrl).toBe("feat-tokens.preview.example.com");
        });

        it("substitutes {{commit_sha}} token with 7-char slice", () => {
            const result = service.buildPreviewName({
                serviceId: "svc-1",
                branchName: "main",
                commitSha: "abcdef1234567",
                urlPattern: "{{preview_name}}-{{commit_sha}}.preview.dev",
                namingStrategy: "branch",
            });
            expect(result.resolvedUrl).toContain("abcdef1");
        });
    });
});
