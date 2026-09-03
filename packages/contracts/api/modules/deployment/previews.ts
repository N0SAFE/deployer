import { standard, standardDomainErrorContracts } from "@repo/orpc-utils";
import z from "zod/v4";

/**
 * Preview environment read model — exposes the `preview_environments` table
 * (previously write-only / dead) so the web UI can show real preview state:
 * active/expired, webhook-triggered, expiry, source metadata.
 */
export const previewEnvironmentSchema = z.object({
    id: z.string(),
    subdomain: z.string(),
    fullDomain: z.string(),
    sslEnabled: z.boolean(),
    isActive: z.boolean(),
    webhookTriggered: z.boolean(),
    expiresAt: z.string().nullable(),
    deploymentId: z.string().nullable(),
    metadata: z
        .object({
            pullRequestUrl: z.string().nullable().optional(),
            branchName: z.string().nullable().optional(),
            lastAccessedAt: z.string().nullable().optional(),
            accessCount: z.number().nullable().optional(),
        })
        .nullable()
        .optional(),
    createdAt: z.string(),
    updatedAt: z.string(),
});

export const listServicePreviewsOutputSchema = z.object({
    previews: z.array(previewEnvironmentSchema),
});

const previewOps = standard.zod(listServicePreviewsOutputSchema, "servicePreviews");

export const listServicePreviewsContract = previewOps
    .list()
    .path("/previews")
    .input((b) =>
        b.params((p) => p`/${p("serviceId", z.uuid())}`),
    )
    .output(listServicePreviewsOutputSchema)
    .errors((e) => [...standardDomainErrorContracts(e)])
    .build();

// ─── Promote preview → stable ─────────────────────────────────────────────

export const promoteServicePreviewOutputSchema = z.object({
    promoted: z.boolean(),
    host: z.string().nullable(),
    reason: z.string().nullable().optional(),
    mappingId: z.string().nullable().optional(),
});

const promotePreviewOps = standard.zod(promoteServicePreviewOutputSchema, "promoteServicePreview");

export const promoteServicePreviewContract = promotePreviewOps
    .create()
    .path("/previews/promote")
    .input((b) =>
        b
            .params((p) => p`/${p("serviceId", z.uuid())}`)
            .body(z.object({ previewName: z.string().min(1) })),
    )
    .output(promoteServicePreviewOutputSchema)
    .errors((e) => [...standardDomainErrorContracts(e)])
    .build();
