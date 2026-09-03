import { standard, standardDomainErrorContracts } from "@repo/orpc-utils";
import z from "zod/v4";
import {
    analyticsReportSchema,
    dateRangeSchema,
    generateReportInputSchema,
    reportConfigurationSchema,
} from "./schemas";

const analyticsGenerateReportOutputSchema = z.object({
    reportId: z.string(),
    status: z.enum(["pending", "generating", "completed", "failed"]),
    message: z.string(),
    estimatedCompletion: z.date().optional(),
});

const analyticsGetReportOutputSchema = z.union([
    analyticsReportSchema,
    z.object({
        id: z.string(),
        status: z.enum(["pending", "generating", "failed"]),
        error: z.string().optional(),
        progress: z.number().min(0).max(100).optional(),
    }),
]);

const analyticsListReportsQuerySchema = z
    .object({
        status: z.enum(["pending", "generating", "completed", "failed"]).optional(),
        limit: z.coerce.number().min(1).max(100).default(20),
        offset: z.coerce.number().min(0).default(0),
    })
    .optional();

const analyticsListReportsOutputSchema = z.object({
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
});

const analyticsReportActionOutputSchema = z.object({
    success: z.boolean(),
    message: z.string(),
});

const analyticsDownloadReportOutputSchema = z.object({
    downloadUrl: z.string(),
    expiresAt: z.date(),
    format: z.enum(["json", "pdf", "csv"]),
    size: z.number(),
});

const analyticsReportConfigOutputSchema = z.object({
    id: z.string(),
    ...reportConfigurationSchema.shape,
    createdAt: z.date(),
    updatedAt: z.date(),
});

const analyticsListReportConfigsQuerySchema = z
    .object({
        limit: z.coerce.number().min(1).max(100).default(20),
        offset: z.coerce.number().min(0).default(0),
    })
    .optional();

const analyticsListReportConfigsOutputSchema = z.object({
    data: z.array(analyticsReportConfigOutputSchema),
    total: z.number(),
    limit: z.number(),
    offset: z.number(),
});

const analyticsGenerateReportOps = standard.zod(analyticsGenerateReportOutputSchema, "analyticsGenerateReport");
const analyticsGetReportOps = standard.zod(analyticsReportSchema, "analyticsGetReport");
const analyticsListReportsOps = standard.zod(analyticsListReportsOutputSchema, "analyticsListReports");
const analyticsDeleteReportOps = standard.zod(analyticsReportActionOutputSchema, "analyticsDeleteReport");
const analyticsDownloadReportOps = standard.zod(analyticsDownloadReportOutputSchema, "analyticsDownloadReport");
const analyticsCreateReportConfigOps = standard.zod(analyticsReportConfigOutputSchema, "analyticsCreateReportConfig");
const analyticsListReportConfigsOps = standard.zod(analyticsListReportConfigsOutputSchema, "analyticsListReportConfigs");
const analyticsUpdateReportConfigOps = standard.zod(analyticsReportConfigOutputSchema, "analyticsUpdateReportConfig");
const analyticsDeleteReportConfigOps = standard.zod(analyticsReportActionOutputSchema, "analyticsDeleteReportConfig");

export const analyticsGenerateReportContract = analyticsGenerateReportOps
    .create()
    .path("/reports/generate")
    .input((input) => input.body(generateReportInputSchema))
    .output(analyticsGenerateReportOutputSchema)
    .errors((e) => [...standardDomainErrorContracts(e)])
    .build();

export const analyticsGetReportContract = analyticsGetReportOps
    .read({ idFieldName: "reportId", idSchema: z.string() })
    // path-template params form (schema-only params doesn't wire URL substitution)
    .input((b) => b.params((p) => p`/reports/${p("reportId", z.string())}`))
    .output(analyticsGetReportOutputSchema)
    .errors((e) => [...standardDomainErrorContracts(e)])
    .build();

export const analyticsListReportsContract = analyticsListReportsOps
    .list()
    .path("/reports")
    .input((input) => input.query(analyticsListReportsQuerySchema))
    .output(analyticsListReportsOutputSchema)
    .errors((e) => [...standardDomainErrorContracts(e)])
    .build();

export const analyticsDeleteReportContract = analyticsDeleteReportOps
    .delete({ idFieldName: "reportId", idSchema: z.string() })
    .input((b) => b.params((p) => p`/reports/${p("reportId", z.string())}`))
    .output(analyticsReportActionOutputSchema)
    .errors((e) => [...standardDomainErrorContracts(e)])
    .build();

export const analyticsDownloadReportContract = analyticsDownloadReportOps
    .list()
    .input((b) => b.params((p) => p`/reports/${p("reportId", z.string())}/download`))
    .output(analyticsDownloadReportOutputSchema)
    .errors((e) => [...standardDomainErrorContracts(e)])
    .build();

export const analyticsCreateReportConfigContract = analyticsCreateReportConfigOps
    .create()
    .path("/reports/configurations")
    .input((input) => input.body(reportConfigurationSchema))
    .output(analyticsReportConfigOutputSchema)
    .errors((e) => [...standardDomainErrorContracts(e)])
    .build();

export const analyticsListReportConfigsContract = analyticsListReportConfigsOps
    .list()
    .path("/reports/configurations")
    .input((input) => input.query(analyticsListReportConfigsQuerySchema))
    .output(analyticsListReportConfigsOutputSchema)
    .errors((e) => [...standardDomainErrorContracts(e)])
    .build();

export const analyticsUpdateReportConfigContract = analyticsUpdateReportConfigOps
    .update({ idFieldName: "configId", idSchema: z.string() })
    .input((b) =>
        b
            .params((p) => p`/reports/configurations/${p.configId}`)
            .body(reportConfigurationSchema.partial()),
    )
    .output(analyticsReportConfigOutputSchema)
    .errors((e) => [...standardDomainErrorContracts(e)])
    .build();

export const analyticsDeleteReportConfigContract = analyticsDeleteReportConfigOps
    .delete({ idFieldName: "configId", idSchema: z.string() })
    .input((b) => b.params((p) => p`/reports/configurations/${p.configId}`))
    .output(analyticsReportActionOutputSchema)
    .errors((e) => [...standardDomainErrorContracts(e)])
    .build();
