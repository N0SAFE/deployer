import { Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import type { PreviewTemplateConfig } from "@repo/api-contracts/common/template";
import { slugify } from "@/core/utils/slug.utils";

export interface PreviewNamingInput {
    serviceId: string;
    branchName?: string | null;
    prNumber?: number | null;
    commitSha?: string | null;
    urlPattern: string;
    namingStrategy: PreviewTemplateConfig["namingStrategy"];
}

export interface PreviewNamingResult {
    previewName: string;
    resolvedUrl: string;
    strategy: PreviewTemplateConfig["namingStrategy"];
}

@Injectable()
export class PreviewNamingService {
    buildPreviewName(input: PreviewNamingInput): PreviewNamingResult {
        const previewName = this.resolveName(input);
        const resolvedUrl = this.resolveUrlPattern(input.urlPattern, {
            preview_name: previewName,
            branch: input.branchName ? this.toSlug(input.branchName) : "",
            pr_number: input.prNumber != null ? String(input.prNumber) : "",
            commit_sha: input.commitSha ? input.commitSha.slice(0, 7) : "",
        });

        return { previewName, resolvedUrl, strategy: input.namingStrategy };
    }

    private resolveName(input: PreviewNamingInput): string {
        switch (input.namingStrategy) {
            case "pr": {
                if (input.prNumber == null) {
                    throw new Error("namingStrategy=pr requires prNumber");
                }
                return `pr-${String(input.prNumber)}`;
            }
            case "branch": {
                if (!input.branchName) {
                    throw new Error("namingStrategy=branch requires branchName");
                }
                return this.toSlug(input.branchName);
            }
            case "branch_hash": {
                if (!input.branchName) {
                    throw new Error("namingStrategy=branch_hash requires branchName");
                }
                const slug = this.toSlug(input.branchName);
                const hashSeed = `${input.serviceId}:${input.branchName}:${input.commitSha ?? ""}`;
                const fragment = createHash("sha256").update(hashSeed).digest("hex").slice(0, 7);
                return `${slug}-${fragment}`;
            }
            case "custom": {
                return this.toSlug(
                    this.resolveUrlPattern(input.urlPattern, {
                        preview_name: "",
                        branch: input.branchName ? this.toSlug(input.branchName) : "",
                        pr_number: input.prNumber != null ? String(input.prNumber) : "",
                        commit_sha: input.commitSha ? input.commitSha.slice(0, 7) : "",
                    }),
                );
            }
        }
    }

    private resolveUrlPattern(pattern: string, tokens: Record<string, string>): string {
        return Object.entries(tokens).reduce((acc, [key, value]) => acc.replaceAll(`{{${key}}}`, value), pattern);
    }

    private toSlug(value: string): string {
        return slugify(value, { maxLength: 48, fallback: "preview", trimInput: true });
    }
}