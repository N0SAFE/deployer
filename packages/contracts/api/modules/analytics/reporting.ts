import { oc } from "@orpc/contract";
import z from "zod/v4";
import {
    analyticsReportSchema,
    dateRangeSchema,
    generateReportInputSchema,
    reportConfigurationSchema,
} from "./schemas";

export const analyticsGenerateReportContract = oc
    .route({ method: "POST", path: "/reports/generate" })
    .input(generateReportInputSchema)
    .output(
        z.object({
            reportId: z.string(),
            status: z.enum(["pending", "generating", "completed", "failed"]),
            message: z.string(),
            estimatedCompletion: z.date().optional(),
        }),
    );

export const analyticsGetReportContract = oc
    .route({ method: "GET", path: "/reports/{reportId}" })
    .input(
        z.object({
            reportId: z.string(),
        }),
    )
    .output(
        z.union([
            analyticsReportSchema,
            z.object({
                id: z.string(),
                status: z.enum(["pending", "generating", "failed"]),
                error: z.string().optional(),
                progress: z.number().min(0).max(100).optional(),
            }),
        ]),
    );

export const analyticsListReportsContract = oc
    .route({ method: "GET", path: "/reports" })
    .input(
        z
            .object({
                status: z.enum(["pending", "generating", "completed", "failed"]).optional(),
                limit: z.coerce.number().min(1).max(100).default(20),
                offset: z.coerce.number().min(0).default(0),
            })
            .optional(),
    )
    .output(
        z.object({
            data: z.array(
                z.object({
                    id: z.string(),
                    name: z.string(),
                    status: z.enum(["pending", "generating", "completed", "failed"]),
                    generatedAt: z.date().optional(),
                    period: dateRangeSchema,
                    format: z.enum(["json", "pdf", "csv"]),
                    size: z.number().optional(),
                }),
            ),
            total: z.number(),
            limit: z.number(),
            offset: z.number(),
        }),
    );

export const analyticsDeleteReportContract = oc
    .route({ method: "DELETE", path: "/reports/{reportId}" })
    .input(
        z.object({
            reportId: z.string(),
        }),
    )
    .output(
        z.object({
            success: z.boolean(),
            message: z.string(),
        }),
    );

export const analyticsDownloadReportContract = oc
    .route({ method: "GET", path: "/reports/{reportId}/download" })
    .input(
        z.object({
            reportId: z.string(),
        }),
    )
    .output(
        z.object({
            downloadUrl: z.string(),
            expiresAt: z.date(),
            format: z.enum(["json", "pdf", "csv"]),
            size: z.number(),
        }),
    );

export const analyticsCreateReportConfigContract = oc
    .route({ method: "POST", path: "/reports/configurations" })
    .input(reportConfigurationSchema)
    .output(
        z.object({
            id: z.string(),
            ...reportConfigurationSchema.shape,
            createdAt: z.date(),
            updatedAt: z.date(),
        }),
    );

export const analyticsListReportConfigsContract = oc
    .route({ method: "GET", path: "/reports/configurations" })
    .input(
        z
            .object({
                limit: z.coerce.number().min(1).max(100).default(20),
                offset: z.coerce.number().min(0).default(0),
            })
            .optional(),
    )
    .output(
        z.object({
            data: z.array(
                z.object({
                    id: z.string(),
                    ...reportConfigurationSchema.shape,
                    createdAt: z.date(),
                    updatedAt: z.date(),
                }),
            ),
            total: z.number(),
            limit: z.number(),
            offset: z.number(),
        }),
    );

export const analyticsUpdateReportConfigContract = oc
    .route({ method: "PUT", path: "/reports/configurations/{configId}" })
    .input(
        z.object({
            configId: z.string(),
            ...reportConfigurationSchema.partial().shape,
        }),
    )
    .output(
        z.object({
            id: z.string(),
            ...reportConfigurationSchema.shape,
            createdAt: z.date(),
            updatedAt: z.date(),
        }),
    );

export const analyticsDeleteReportConfigContract = oc
    .route({ method: "DELETE", path: "/reports/configurations/{configId}" })
    .input(
        z.object({
            configId: z.string(),
        }),
    )
    .output(
        z.object({
            success: z.boolean(),
            message: z.string(),
        }),
    );
