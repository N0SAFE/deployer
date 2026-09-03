import { Injectable, Logger, type NestMiddleware } from "@nestjs/common";
import type { Request, Response } from "express";
import type * as os from "os";
@Injectable()
export class LoggerMiddleware implements NestMiddleware {
    private readonly logger = new Logger(LoggerMiddleware.name);
    
    // Safelist of URL patterns to skip logging
    private readonly logSafelist = [
        '/health',
        '/metrics',
        '/favicon.ico'
    ];
    
    private shouldSkipLogging(url: string): boolean {
        return this.logSafelist.some(pattern => url.startsWith(pattern));
    }
    
    use(req: Request, res: Response, next: () => void): void {
        const { ip, method, originalUrl: url } = req;
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const hostname = (require("os") as typeof os).hostname();
        const userAgent = req.get("user-agent") ?? "";
        const referer = req.get("referer") ?? "";
        res.on("close", () => {
            // Skip logging for safelisted URLs
            if (this.shouldSkipLogging(url)) {
                return;
            }
            
            const { statusCode, statusMessage } = res;
            const contentLength = res.get("content-length");
            // Enhanced debug logging with structured data and green-colored path
            const greenPath = `\x1b[32m${url}\x1b[0m`;
            const statusCodeColorized = (() => {
                if (statusCode >= 500) return `\x1b[31m${String(statusCode)}\x1b[0m`; // Red for server errors
                if (statusCode >= 400) return `\x1b[35m${String(statusCode)}\x1b[0m`; // Purple for client errors
                if (statusCode >= 300) return `\x1b[33m${String(statusCode)}\x1b[0m`; // Yellow for redirects
                return `\x1b[32m${String(statusCode)}\x1b[0m`; // Green for success
            })()
            if (statusCode >= 500) {
                this.logger.error(`[${hostname}] "${method} ${greenPath}" ${statusCodeColorized} ${statusMessage} ${String(contentLength)} "${referer}" "${userAgent}" "${String(ip)}"`);
            } else if (statusCode >= 400) {
                // 4xx are actionable (validation/auth/not-found) — log at warn
                // so they're visible without enabling full debug logging.
                this.logger.warn(`[${hostname}] "${method} ${greenPath}" ${statusCodeColorized} ${statusMessage} ${String(contentLength)} "${referer}" "${userAgent}" "${String(ip)}"`);
            } else {
                this.logger.debug(`[${hostname}] "${method} ${greenPath}" ${statusCodeColorized} ${statusMessage} ${String(contentLength)} "${referer}" "${userAgent}" "${String(ip)}"`);
            }
            
            // NOTE: Do NOT call res.end() here - it interrupts streaming responses
            // and causes HTTP/2 protocol errors (ERR_HTTP2_PROTOCOL_ERROR)
        });
        next();
    }
}
