import * as z from "zod/v4";
import { contractBuilder } from "@repo/nest-events";

// T037: Preview lifecycle audit trail event contracts.

export const previewLifecycleEventContracts = {
    previewCreated: contractBuilder()
        .input(z.object({ serviceId: z.string() }))
        .output(
            z.object({
                serviceId: z.string(),
                previewName: z.string(),
                resolvedUrl: z.string(),
                branchName: z.string().nullable(),
                prNumber: z.number().int().nullable(),
                commitSha: z.string().nullable(),
                previewTemplateId: z.string().nullable(),
                deliveryId: z.string(),
                timestamp: z.string(),
            }),
        )
        .build(),

    previewUpdated: contractBuilder()
        .input(z.object({ serviceId: z.string() }))
        .output(
            z.object({
                serviceId: z.string(),
                previewName: z.string(),
                resolvedUrl: z.string(),
                branchName: z.string().nullable(),
                prNumber: z.number().int().nullable(),
                commitSha: z.string().nullable(),
                deliveryId: z.string(),
                timestamp: z.string(),
            }),
        )
        .build(),

    previewCleaned: contractBuilder()
        .input(z.object({ serviceId: z.string() }))
        .output(
            z.object({
                serviceId: z.string(),
                previewName: z.string(),
                trigger: z.enum(["merge", "close", "ttl_expired"]),
                reason: z.string(),
                deliveryId: z.string(),
                timestamp: z.string(),
            }),
        )
        .build(),
} as const;

export type PreviewLifecycleEventContracts = typeof previewLifecycleEventContracts;
