import { Controller, Get, Header, HttpCode, HttpException, HttpStatus, Param, Res, UseGuards } from "@nestjs/common";
import type { Response } from "express";
import { AuthGuard } from "@/core/modules/auth/guards/auth.guard";
import { AnalyticsRepository } from "../repositories/analytics.repository";

/**
 * REST download endpoint for generated analytics reports.
 *
 * The ORPC `downloadReport` action returns a metadata envelope (url/format/
 * size); the actual bytes are streamed here as a JSON attachment. The route is
 * auth-guarded with the same session AuthGuard used by every REST controller —
 * the browser call carries the session cookie.
 */
@Controller("api/analytics")
export class AnalyticsDownloadController {
    constructor(private readonly repository: AnalyticsRepository) {}

    @Get("reports/:reportId/download")
    @UseGuards(AuthGuard)
    @HttpCode(200)
    async download(@Param("reportId") reportId: string, @Res() res: Response) {
        const report = await this.repository.getReport(reportId);
        if (!report) {
            throw new HttpException("Report not found", HttpStatus.NOT_FOUND);
        }

        const fileName = `report-${report.id}.json`;
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
        res.setHeader("X-Report-Id", report.id);
        res.status(200).send(JSON.stringify(report.content ?? {}, null, 2));
    }
}