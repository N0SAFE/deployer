import { Injectable, Logger, type NestMiddleware } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";

import { AuthCoreService, normalizeHeaders } from "@/core/modules/auth/services/auth-core.service";

/**
 * SsrAuthGuardMiddleware — server-side auth guard for the SSR pages served by
 * the API itself (@nestjs-ssr/react views). Every request to `/manage/*`
 * (except `/manage/login`) must carry a valid Better Auth session cookie;
 * otherwise the request is redirected to the login page.
 *
 * Reuses the SAME auth core as the ORPC/HTTP surfaces — no duplicated
 * session logic, no client-only redirects.
 */
@Injectable()
export class SsrAuthGuardMiddleware implements NestMiddleware {
	private readonly logger = new Logger(SsrAuthGuardMiddleware.name);

	constructor(private readonly authCore: AuthCoreService) {}

	async use(req: Request, res: Response, next: NextFunction): Promise<void> {
		try {
			const session = await this.authCore.api.getSession({
				headers: normalizeHeaders(req.headers),
			});
			if (session?.user !== undefined) {
				next();
				return;
			}
		} catch (error) {
			// Treat session-check failure as unauthenticated — never leak or
			// crash on a malformed cookie.
			this.logger.debug(
				`SSR auth session check failed: ${error instanceof Error ? error.message : String(error)}`,
			);
		}

		res.redirect("/manage/login");
	}
}